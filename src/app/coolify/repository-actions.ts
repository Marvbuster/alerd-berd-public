"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credentials";
import { fetchCoolifyEnvKeys } from "@/lib/coolify-client";
import { mergeBuildEnvNames, parseBuildEnv } from "../../../scripts/dependency-worker-lib.mjs";
import { githubRepository, repositoryBranch, repositoryFile } from "@/lib/repository-logic";
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
  if (!token || token.length > 2000 || /\s/.test(token)) return { ok: false, message: "Vollständigen GitHub-Token ohne Leerzeichen einfügen." };
  try {
    const expiry = await expiryOrRetry(token);
    if (expiry === "invalid") return { ok: false, message: "GitHub lehnt den Token ab, er ist ungültig oder abgelaufen." };
    const tokenEncrypted = encryptCredential(token, `${user.id}:github`);
    const data = { tokenEncrypted, ...expiry };
    await prisma.gitHubCredential.upsert({ where: { ownerId: user.id }, create: { ownerId: user.id, ...data }, update: data });
  } catch { return { ok: false, message: "GitHub-Zugang konnte nicht gespeichert werden. Verschlüsselung und Datenbank prüfen." }; }
  refresh();
  return { ok: true, message: "GitHub-Token gespeichert. Die Repo-Leserechte werden beim Scan geprüft." };
}

export async function deleteGitHubCredential() {
  const user = await requireUser();
  await prisma.gitHubCredential.deleteMany({ where: { ownerId: user.id } });
  refresh();
}

export async function saveRepository(applicationId: string, _state: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const app = await prisma.coolifyApplication.findFirst({ where: { id: applicationId, missingSince: null, hiddenAt: null, connection: { ownerId: user.id } }, select: { id: true } });
  if (!app) return { ok: false, message: "Eigene Coolify-App auswählen." };
  let config: { repository: string; branch: string; manifestPath: string; lockfilePath: string };
  try {
    config = {
      repository: githubRepository(String(form.get("repository") ?? "")),
      branch: repositoryBranch(String(form.get("branch") ?? "")),
      manifestPath: repositoryFile(String(form.get("manifestPath") ?? ""), "package.json"),
      lockfilePath: repositoryFile(String(form.get("lockfilePath") ?? ""), "package-lock.json"),
    };
  } catch { return { ok: false, message: "GitHub-Repo, Branch und Repo-relative JSON-Pfade prüfen. Nur npm wird unterstützt." }; }
  await prisma.$transaction(async (tx) => {
    const row = await tx.repositoryWatch.upsert({
      where: { applicationId }, create: { applicationId, ...config },
      update: { ...config, revision: randomUUID(), lastAttemptAt: null, lastError: null, syncLockedUntil: null },
    });
    await tx.repositorySnapshot.deleteMany({ where: { watchId: row.id } });
  });
  refresh();
  return { ok: true, message: "Git-Einstellungen gespeichert. Jetzt Versionen prüfen." };
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
  if (!watch) return { ok: false, message: "Erst die Versionsüberwachung einrichten." };
  const text = String(form.get("buildEnv") ?? "").replace(/\r\n/g, "\n").trim();
  try { parseBuildEnv(text); } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Build-Variablen prüfen." }; }
  await prisma.repositoryWatch.update({ where: { id: watch.id }, data: { buildEnv: text || null } });
  refresh();
  return { ok: true, message: "Gespeichert, gilt ab der nächsten Analyse." };
}

// Holt nur die Namen der Env-Variablen aus Coolify und ergänzt fehlende als Platzhalter.
export async function suggestBuildEnv(applicationId: string, current: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  const user = await requireUser();
  const app = await prisma.coolifyApplication.findFirst({ where: { id: applicationId, connection: { ownerId: user.id } }, select: { uuid: true, connection: { select: { baseUrl: true, tokenEncrypted: true } } } });
  if (!app) return { ok: false, message: "App nicht gefunden." };
  try {
    const token = decryptCredential(app.connection.tokenEncrypted, `${user.id}:${app.connection.baseUrl}`);
    const names = await fetchCoolifyEnvKeys(app.connection.baseUrl, token, app.uuid);
    if (!names.length) return { ok: true, text: current, message: "Coolify meldet keine Variablen für diese App." };
    return { ok: true, text: mergeBuildEnvNames(current, names) };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Coolify nicht erreichbar." }; }
}
