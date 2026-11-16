import { messageCode as _code, MessageError as _Error, errorMessage } from "@/i18n/translate";
import { prisma } from "./prisma";
import { decryptCredential } from "./credentials";
import { fetchRepositoryDependencies } from "./github-client";

export async function scanRepository(id: string, ownerId: string) {
  const now = new Date();
  const lease = new Date(now.getTime() + 120_000);
  const claimed = await prisma.repositoryWatch.updateMany({
    where: { id, application: { missingSince: null, hiddenAt: null, connection: { ownerId } }, OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }] },
    data: { syncLockedUntil: lease, lastAttemptAt: now },
  });
  if (!claimed.count) return { ok: false, message: _code("validation.m81341f3625") };
  let revision: string | undefined;
  try {
    const watch = await prisma.repositoryWatch.findFirstOrThrow({ where: { id, application: { connection: { ownerId } } } });
    revision = watch.revision;
    const credential = await prisma.gitHubCredential.findUnique({ where: { ownerId } });
    const token = credential ? decryptCredential(credential.tokenEncrypted, `${ownerId}:github`) : null;
    const data = await fetchRepositoryDependencies(watch, token);
    await prisma.$transaction(async (tx) => {
      const valid = await tx.repositoryWatch.updateMany({ where: { id, revision, syncLockedUntil: lease }, data: { lastError: null } });
      if (!valid.count) throw new _Error("validation.m6ad6eee2c1");
      const snapshot = { ...data, dependencies: data.dependencies as never, scannedAt: new Date() };
      await tx.repositorySnapshot.upsert({ where: { watchId: id }, create: { watchId: id, ...snapshot }, update: snapshot });
    });
    return { ok: true, message: _code("validation.m7601377772", { value0: data.dependencies.length, value1: data.commitSha.slice(0, 8) }) };
  } catch (error) {
    const known = error instanceof Error && /^(GitHub|Repo|Nur |Repository|Ungültig|Das Manifest|Manifest|Die gelockte|Die Token|next |Aktuell |Zugangsdaten)/.test(error.message);
    const message = known ? errorMessage(error) : _code("validation.m2c2fb8197b");
    await prisma.repositoryWatch.updateMany({ where: { id, ...(revision ? { revision } : {}), syncLockedUntil: lease }, data: { lastError: message } });
    return { ok: false, message };
  } finally {
    await prisma.repositoryWatch.updateMany({ where: { id, ...(revision ? { revision } : {}), syncLockedUntil: lease }, data: { syncLockedUntil: null } });
  }
}

export async function scanDueRepositories() {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const watches = await prisma.repositoryWatch.findMany({
    where: { application: { missingSince: null, hiddenAt: null, connection: { owner: { active: true } } }, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }] },
    select: { id: true, application: { select: { connection: { select: { ownerId: true } } } } },
    orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } }, take: 5,
  });
  const results = [];
  for (const watch of watches) results.push(await scanRepository(watch.id, watch.application.connection.ownerId));
  return results;
}
