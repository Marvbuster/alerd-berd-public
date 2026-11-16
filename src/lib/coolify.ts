import { messageCode as _code, MessageError as _Error, errorMessage } from "@/i18n/translate";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { decryptCredential } from "./credentials";
import { fetchCoolifyApplications } from "./coolify-client";

export async function syncCoolifyConnection(id: string, ownerId: string) {
  const now = new Date();
  const lease = new Date(now.getTime() + 120_000);
  const claimed = await prisma.coolifyConnection.updateMany({
    where: { id, ownerId, OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }] },
    data: { syncLockedUntil: lease, lastAttemptAt: now },
  });
  if (!claimed.count) return { ok: false, message: _code("validation.m64eaf9a7ac") };
  try {
    const connection = await prisma.coolifyConnection.findFirstOrThrow({ where: { id, ownerId } });
    const token = decryptCredential(connection.tokenEncrypted, `${ownerId}:${connection.baseUrl}`);
    const apps = await fetchCoolifyApplications(connection.baseUrl, token);
    await prisma.$transaction(async (tx) => {
      // Validate the lease inside the transaction so an expired job cannot overwrite newer data.
      const valid = await tx.coolifyConnection.updateMany({
        where: { id, ownerId, syncLockedUntil: lease }, data: { lastSyncedAt: now, lastError: null },
      });
      if (!valid.count) throw new _Error("validation.m4fb30271be");
      for (const app of apps) {
        // hiddenAt belongs to Alerd; preserve it across imports and reappearances.
        await tx.coolifyApplication.upsert({
          where: { connectionId_uuid: { connectionId: id, uuid: app.uuid } },
          create: { id: randomUUID(), connectionId: id, ...app, lastSeenAt: now },
          update: { ...app, lastSeenAt: now, missingSince: null },
        });
      }
      await tx.coolifyApplication.updateMany({
        where: { connectionId: id, uuid: { notIn: apps.map((a) => a.uuid) }, missingSince: null },
        data: { missingSince: now },
      });
    }, { timeout: 30_000 });
    return { ok: true, message: _code("validation.mc4347ca7e1", { value0: apps.length }) };
  } catch (error) {
    // Only locally controlled error messages reach persistence/UI.
    const message = error instanceof Error && /^(Coolify|Ungültig|Unerwartet|Zugangsdaten|Synchronisation)/.test(error.message)
      ? errorMessage(error) : _code("validation.m7207a79508");
    await prisma.coolifyConnection.updateMany({ where: { id, ownerId, syncLockedUntil: lease }, data: { lastError: message } });
    return { ok: false, message };
  } finally {
    await prisma.coolifyConnection.updateMany({ where: { id, ownerId, syncLockedUntil: lease }, data: { syncLockedUntil: null } });
  }
}

export async function syncDueCoolifyConnections() {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const connections = await prisma.coolifyConnection.findMany({
    where: { owner: { active: true }, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }] },
    select: { id: true, ownerId: true }, take: 10, orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
  });
  const results = [];
  for (const connection of connections) results.push(await syncCoolifyConnection(connection.id, connection.ownerId));
  return results;
}
