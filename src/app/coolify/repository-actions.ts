"use server";

import { messageCode as _code, errorMessage } from "@/i18n/translate";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credentials";
import { fetchCoolifyEnvKeys } from "@/lib/coolify-client";
import { mergeBuildEnvNames, parseBuildEnv } from "../../../scripts/dependency-worker-lib.mjs";
import { githubRepository, repositoryBranch, repositoryFile, repositoryLockfile } from "@/lib/repository-logic";
import { scanRepository } from "@/lib/repository-watch";
import { refreshReferenceData } from "@/lib/version-watch";
import type { CoolifyActionState } from "./actions";
import { expiryOrRetry } from "@/lib/credential-expiry-watch";

function refresh() {
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/versions"); revalidatePath("/settings", "layout");
}

export async function saveGitHubCredential(_state: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const token = String(form.get("token") ?? "").trim();
  if (!token || token.length > 2000 || /\s/.test(token)) return { ok: false, message: _code("actions.m860ec3fc63") };
  try {
    const expiry = await expiryOrRetry(token);
    if (expiry === "invalid") return { ok: false, message: _code("actions.me574f47cd5") };
    const tokenEncrypted = encryptCredential(token, `${user.id}:github`);
    const data = { tokenEncrypted, ...expiry };
    await prisma.gitHubCredential.upsert({ where: { ownerId: user.id }, create: { ownerId: user.id, ...data }, update: data });
  } catch { return { ok: false, message: _code("actions.m027bf415cb") }; }
  refresh();
  return { ok: true, message: _code("actions.m0392d7bcbd") };
}

export async function deleteGitHubCredential() {
  const user = await requireUser();
  await prisma.gitHubCredential.deleteMany({ where: { ownerId: user.id } });
  refresh();
}

export async function saveRepository(applicationId: string, _state: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const app = await prisma.coolifyApplication.findFirst({ where: { id: applicationId, missingSince: null, hiddenAt: null, connection: { ownerId: user.id } }, select: { id: true } });
  if (!app) return { ok: false, message: _code("actions.md305398a11") };
  let config: { repository: string; branch: string; manifestPath: string; lockfilePath: string };
  try {
    config = {
      repository: githubRepository(String(form.get("repository") ?? "")),
      branch: repositoryBranch(String(form.get("branch") ?? "")),
      manifestPath: repositoryFile(String(form.get("manifestPath") ?? ""), "package.json"),
      lockfilePath: repositoryLockfile(String(form.get("lockfilePath") ?? "")),
    };
  } catch { return { ok: false, message: _code("actions.m0532a74fb2") }; }
  await prisma.$transaction(async (tx) => {
    const row = await tx.repositoryWatch.upsert({
      where: { applicationId }, create: { applicationId, ...config },
      update: { ...config, revision: randomUUID(), lastAttemptAt: null, lastError: null, syncLockedUntil: null },
    });
    await tx.repositorySnapshot.deleteMany({ where: { watchId: row.id } });
  });
  refresh();
  return { ok: true, message: _code("actions.mbbd64c1969") };
}

export async function scanRepositoryNow(id: string, _state: CoolifyActionState, _form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const result = await scanRepository(id, user.id);
  // Manual checks may pick up a new npm patch before the daily refresh.
  // Only refresh after an authorized, successful repository scan.
  if (result.ok) await refreshReferenceData(new Date(), 5 * 60_000);
  refresh();
  return result;
}

// Build-Variablen: Platzhalter für den Build in der Sandbox des Workers.
export async function saveBuildEnv(applicationId: string, _state: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const watch = await prisma.repositoryWatch.findFirst({ where: { applicationId, application: { connection: { ownerId: user.id } } }, select: { id: true } });
  if (!watch) return { ok: false, message: _code("actions.m7435a96c7d") };
  const text = String(form.get("buildEnv") ?? "").replace(/\r\n/g, "\n").trim();
  try { parseBuildEnv(text); } catch (error) { return { ok: false, message: errorMessage(error, _code("actions.m2da3a145a1")) }; }
  await prisma.repositoryWatch.update({ where: { id: watch.id }, data: { buildEnv: text || null } });
  refresh();
  return { ok: true, message: _code("actions.mbd719626c5") };
}

// Holt nur die Namen der Env-Variablen aus Coolify und ergänzt fehlende als Platzhalter.
export async function suggestBuildEnv(applicationId: string, current: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  const user = await requireUser();
  const app = await prisma.coolifyApplication.findFirst({ where: { id: applicationId, connection: { ownerId: user.id } }, select: { uuid: true, connection: { select: { baseUrl: true, tokenEncrypted: true } } } });
  if (!app) return { ok: false, message: _code("actions.mf655a8b2bc") };
  try {
    const token = decryptCredential(app.connection.tokenEncrypted, `${user.id}:${app.connection.baseUrl}`);
    const names = await fetchCoolifyEnvKeys(app.connection.baseUrl, token, app.uuid);
    if (!names.length) return { ok: true, text: current, message: _code("actions.m837084f05d") };
    return { ok: true, text: mergeBuildEnvNames(current, names) };
  } catch (error) { return { ok: false, message: errorMessage(error, _code("actions.mf214a775fa")) }; }
}
