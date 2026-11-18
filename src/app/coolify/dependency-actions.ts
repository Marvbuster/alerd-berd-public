"use server";
import { intlLocale } from "@/i18n/locale";
import { recipientLocale } from "../../../scripts/i18n.mjs";
import { languagePrompt } from "../../../scripts/dependency-worker-lib.mjs";

import { messageCode as _code, translateMessage } from "@/i18n/translate";

import { retryStep } from "@/lib/dependency-phase";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { credentialsConfigured, encryptCredential } from "@/lib/credentials";
import { prisma } from "@/lib/prisma";
import { markDependencyJobsSeen } from "@/lib/dependency-notifications";
import { engineLabel, TERMINAL_STATUSES } from "@/lib/dependency-phase";
import { alreadyDelivered, isCriticalFix, jobLabel, updateMaturity } from "@/lib/dependency-target";
import { lockfileKind } from "@/lib/repository-logic";
import semver from "semver";
import type { DependencyJobStatus } from "@prisma/client";
import { expiryOrRetry } from "@/lib/credential-expiry-watch";

export type DependencyActionState = { ok?: boolean; message?: string; jobId?: string };

function refresh() {
  revalidatePath("/coolify"); revalidatePath("/services");
  revalidatePath("/versions");
  revalidatePath("/settings", "layout");
}

export async function saveClaudeCredential(_state: DependencyActionState, form: FormData): Promise<DependencyActionState> {
  const user = await requireUser();
  const token = String(form.get("token") ?? "").trim();
  if (!credentialsConfigured()) return { ok: false, message: _code("actions.md95c7b19f5") };
  if (token.length < 20 || token.length > 8_000 || /\s/.test(token)) return { ok: false, message: _code("actions.me5eae9efcd") };
  try {
    const tokenEncrypted = encryptCredential(token, `${user.id}:claude-code`);
    await prisma.claudeCredential.upsert({
      where: { ownerId: user.id },
      create: { ownerId: user.id, tokenEncrypted },
      update: { tokenEncrypted, connectedAt: new Date(), lastVerifiedAt: null, lastError: null, expiryWarnedDays: null },
    });
  } catch {
    return { ok: false, message: _code("actions.mb2186e33e4") };
  }
  refresh();
  return { ok: true, message: _code("actions.m1e6dc52847") };
}

export async function deleteClaudeCredential() {
  const user = await requireUser();
  await prisma.claudeCredential.deleteMany({ where: { ownerId: user.id } });
  refresh();
}

export async function saveLocalAnalysisNode(form: FormData) {
  const user = await requireUser();
  const apiKeyId = String(form.get("apiKeyId") ?? "");
  const key = await prisma.apiKey.findFirst({ where: { id: apiKeyId, userId: user.id, revokedAt: null }, select: { id: true } });
  if (!key) throw new Error(_code("actions.mcd6bc03e3a"));
  await prisma.localAnalysisNode.upsert({ where: { ownerId: user.id }, create: { ownerId: user.id, apiKeyId: key.id }, update: { apiKeyId: key.id, lastSeenAt: null, nodeName: null, model: null } });
  refresh();
}

export async function deleteLocalAnalysisNode() {
  const user = await requireUser();
  await prisma.localAnalysisNode.deleteMany({ where: { ownerId: user.id } });
  refresh();
}

export async function saveGitHubPublishCredential(_state: DependencyActionState, form: FormData): Promise<DependencyActionState> {
  const user = await requireUser();
  const token = String(form.get("token") ?? "").trim();
  if (!credentialsConfigured()) return { ok: false, message: _code("actions.md95c7b19f5") };
  if (!token || token.length > 2_000 || /\s/.test(token)) return { ok: false, message: _code("actions.m860ec3fc63") };
  try {
    const expiry = await expiryOrRetry(token);
    if (expiry === "invalid") return { ok: false, message: _code("actions.me574f47cd5") };
    const tokenEncrypted = encryptCredential(token, `${user.id}:github-publish`);
    const data = { tokenEncrypted, ...expiry };
    await prisma.gitHubPublishCredential.upsert({ where: { ownerId: user.id }, create: { ownerId: user.id, ...data }, update: data });
  } catch { return { ok: false, message: _code("actions.m81e8867e9d") }; }
  refresh();
  return { ok: true, message: _code("actions.m544814f235") };
}

export async function deleteGitHubPublishCredential() {
  const user = await requireUser();
  await prisma.gitHubPublishCredential.deleteMany({ where: { ownerId: user.id } });
  refresh();
}

// Ein Update-Chat für ein oder mehrere Pakete. Das Formular schickt
// package=name@version pro Häkchen; alte Formulare nur targetVersion für next.
export async function createDependencyJob(_state: DependencyActionState, form: FormData): Promise<DependencyActionState> {
  const user = await requireUser();
  const applicationId = String(form.get("applicationId") ?? "");
  const entries = form.getAll("package").map(String);
  const legacy = String(form.get("targetVersion") ?? "").trim();
  const wanted = (entries.length ? entries : legacy ? [`next@${legacy}`] : []).slice(0, 20).map((entry) => {
    const at = entry.lastIndexOf("@");
    return { name: entry.slice(0, at), version: entry.slice(at + 1) };
  });
  if (!wanted.length) return { ok: false, message: _code("actions.meffc1135c9") };
  if (wanted.some((p) => p.version.length > 60 || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(p.name) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(p.version))) return { ok: false, message: _code("actions.m928ec78354") };
  if (new Set(wanted.map((p) => p.name)).size !== wanted.length) return { ok: false, message: _code("actions.mef497c1483") };
  const application = await prisma.coolifyApplication.findFirst({
    where: { id: applicationId, hiddenAt: null, missingSince: null, connection: { ownerId: user.id } },
    select: { id: true, repositoryWatch: { select: { lockfilePath: true, snapshot: { select: { commitSha: true, lockedVersion: true, dependencies: true } } } } },
  });
  if (!application) return { ok: false, message: _code("actions.mb31a189955") };
  const pnpm = application.repositoryWatch && lockfileKind(application.repositoryWatch.lockfilePath) === "pnpm";
  const snapshot = application.repositoryWatch?.snapshot;
  // Nur direkte Abhängigkeiten aus dem Git-Stand, und nur nach oben.
  const deps = Array.isArray(snapshot?.dependencies) ? snapshot.dependencies as { name?: string; locked?: string | null }[] : [];
  const fromOf = (name: string) => deps.find((d) => d.name === name)?.locked ?? (name === "next" ? snapshot?.lockedVersion ?? null : null);
  for (const p of wanted) {
    const from = fromOf(p.name);
    if (!from && (pnpm || p.name !== "next")) return { ok: false, message: _code("actions.m2718d24d70", { value0: p.name }) };
    // Der Git-Stand hat sich seit dem Laden der Seite geändert (z. B. Paket von Hand gehoben):
    // Seite neu rendern lassen, damit die Auswahl die erledigten Pakete nicht mehr zeigt.
    if (from && semver.valid(from) && !semver.gt(p.version, from)) { refresh(); return { ok: false, message: _code("actions.m2e348b0c55", { value0: p.name, value1: from }) }; }
  }
  // Der Browser darf die 24-Stunden-Sperre nicht umgehen. Nur die exakt erste
  // gepatchte Version einer critical-GitHub-Advisory ist sofort zulässig.
  const [registries, advisories] = await Promise.all([
    prisma.packageRegistry.findMany({ where: { name: { in: wanted.map((p) => p.name) } }, select: { name: true, versions: true } }),
    prisma.advisory.findMany({ where: { packageName: { in: wanted.map((p) => p.name) }, withdrawnAt: null }, select: { packageName: true, severity: true, ranges: true } }),
  ]);
  for (const p of wanted) {
    const from = fromOf(p.name);
    const registry = registries.find((row) => row.name === p.name);
    const criticalFixes = advisories
      .filter((advisory) => advisory.packageName === p.name && advisory.severity.toLowerCase() === "critical")
      .flatMap((advisory) => Array.isArray(advisory.ranges) ? advisory.ranges : [])
      .flatMap((range) => {
        if (!range || typeof range !== "object") return [];
        const value = range as { firstPatched?: unknown; vulnerable?: unknown };
        return typeof value.firstPatched === "string" && typeof value.vulnerable === "string"
          ? [{ version: value.firstPatched, vulnerable: value.vulnerable }]
          : [];
      });
    const critical = isCriticalFix(from, p.version, criticalFixes);
    const maturity = updateMaturity(registry?.versions as Record<string, string> | null | undefined, p.version);
    if (!critical && !maturity.ready) {
      const when = maturity.readyAt ? maturity.readyAt.toLocaleString(intlLocale(recipientLocale(user.locale)), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }) : null;
      return { ok: false, message: when ? _code("actions.m02cd27824a", { value0: p.name, value1: p.version, value2: when }) : _code("actions.mf5df6f45e4", { value0: p.name, value1: p.version }) };
    }
  }
  const engine = form.get("engine") === "LOCAL_NODE" ? "LOCAL_NODE" : "CLAUDE";
  const [credential, localNode] = await Promise.all([
    prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
  ]);
  if (engine === "CLAUDE" && !credential) return { ok: false, message: _code("actions.mb72a0a05a1") };
  if (engine === "LOCAL_NODE" && !localNode) return { ok: false, message: _code("actions.ma319cdf07d") };
  const open = await prisma.dependencyJob.findFirst({ where: { ownerId: user.id, applicationId: application.id, status: { notIn: [...TERMINAL_STATUSES] as DependencyJobStatus[] } }, select: { id: true } });
  if (open) return { ok: false, message: _code("actions.ma8968703f3") };
  // Nie dasselbe Update zweimal: weder nach einem Push noch wenn live schon die Version läuft.
  const [delivered, runtime] = await Promise.all([
    prisma.dependencyJob.findMany({ where: { ownerId: user.id, applicationId: application.id }, select: { status: true, packageName: true, targetVersion: true, packages: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.monitorPackage.findMany({ where: { name: { in: wanted.map((p) => p.name) }, monitor: { ownerId: user.id, coolifyLinks: { some: { applicationId: application.id } } } }, select: { name: true, version: true } }),
  ]);
  const done = wanted.filter((p) => alreadyDelivered(p.version, { jobs: delivered, runtimeVersions: runtime.filter((r) => r.name === p.name).map((r) => r.version), name: p.name }));
  if (done.length) return { ok: false, message: _code("actions.m61cbf666d0", { value0: done.length > 2 ? _code("common.packagesCount", { count: done.length }) : jobLabel(done) }) };
  const packages = wanted.map((p) => ({ ...p, from: fromOf(p.name) }));
  const job = await prisma.dependencyJob.create({
    data: {
      ownerId: user.id,
      applicationId: application.id,
      packageName: packages[0].name,
      targetVersion: packages[0].version,
      packages: packages as never,
      engine,
      baseCommitSha: snapshot?.commitSha ?? null,
      // Die Paketauswahl ist die Freigabe: Die Analyse startet sofort, mit Claude wie mit der lokalen Node.
      status: "ANALYZING",
      messages: { create: { role: "SYSTEM", content: _code("actions.m58c5ccb2f7", { value0: packages.map((p) => `${p.name} ${p.from ?? "?"} → ${p.version}`).join(", ") }) } },
    },
  });
  refresh();
  return { ok: true, jobId: job.id, message: _code("actions.m18bce6ba0b", { value0: engine === "LOCAL_NODE" ? _code("dependency_phase.engineLocal") : engineLabel(engine) }) };
}

// Abbrechen geht nur, solange der Worker den Job nicht hält. Läuft gerade
// Claude oder ein Build, würde der Worker den Status danach überschreiben.
const CANCELLABLE = ["DRAFT", "AWAITING_CLAUDE", "AWAITING_NODE", "ANALYZING", "READY_FOR_REVIEW", "APPROVED", "READY_TO_PUSH"] as const;

export async function cancelDependencyJob(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const now = new Date();
  const updated = await prisma.dependencyJob.updateMany({
    where: { id: jobId, ownerId: user.id, status: { in: [...CANCELLABLE] }, OR: [{ workerLockedUntil: null }, { workerLockedUntil: { lt: now } }] },
    data: { status: "CANCELLED", lastError: null },
  });
  if (!updated.count) return { ok: false, message: _code("actions.m9587798efa") };
  await prisma.localAnalysisTask.updateMany({ where: { jobId, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "CANCELLED", leaseUntil: null } });
  await prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content: _code("actions.mf50a9accad") } });
  refresh();
  return { ok: true, message: _code("actions.cancelled") };
}

export async function addDependencyMessage(jobId: string, _state: DependencyActionState, form: FormData): Promise<DependencyActionState> {
  const user = await requireUser();
  const content = String(form.get("message") ?? "").trim();
  if (!content || content.length > 4_000) return { ok: false, message: _code("actions.m395c30aeda") };
  const job = await prisma.dependencyJob.findFirst({ where: { id: jobId, ownerId: user.id, status: { in: ["AWAITING_CLAUDE", "READY_FOR_REVIEW"] } }, select: { id: true, engine: true, packageName: true, targetVersion: true, messages: { orderBy: { createdAt: "asc" }, take: 30, select: { role: true, content: true } } } });
  if (!job) return { ok: false, message: _code("actions.me86e244925") };
  if (job.engine === "LOCAL_NODE") {
    const context = job.messages.map((message) => `${message.role}: ${translateMessage(recipientLocale(user.locale), message.content)}`).join("\n\n").slice(-12_000);
    await prisma.$transaction([
      prisma.dependencyMessage.create({ data: { jobId: job.id, role: "USER", content } }),
      prisma.localAnalysisTask.create({ data: { ownerId: user.id, jobId: job.id, phase: "ANALYSIS", prompt: languagePrompt(user.locale, `Du bist die lokale Analyse-Node von Alerd. Antworte auf Deutsch auf diese Rückfrage zu ${job.packageName} → ${job.targetVersion}. Du hast keine Werkzeuge und darfst keine Dateien ändern. Wenn du es nicht anhand des Kontexts sicher weißt, sage das klar.\n\nBisheriger Chat:\n${context}\n\nNeue Rückfrage:\n${content}`) } }),
      prisma.dependencyJob.update({ where: { id: job.id }, data: { status: "AWAITING_NODE", lastError: null } }),
    ]);
    refresh();
    return { ok: true, message: _code("actions.md318fc2801") };
  }
  const credential = await prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } });
  if (!credential) return { ok: false, message: _code("actions.mb72a0a05a1") };
  await prisma.$transaction([prisma.dependencyMessage.create({ data: { jobId: job.id, role: "USER", content } }), prisma.dependencyJob.update({ where: { id: job.id }, data: { status: "ANALYZING", lastError: null } })]);
  refresh();
  return { ok: true, message: _code("actions.m0c43779501") };
}

export async function switchLocalNodeToClaude(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const credential = await prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } });
  if (!credential) return { ok: false, message: _code("actions.m55905f3a35") };
  // Wartet der Job auf das Fazit nach dem Deploy, schreibt Claude das Fazit,
  // statt die Analyse von vorn zu starten.
  const pending = await prisma.localAnalysisTask.findFirst({ where: { jobId, ownerId: user.id, status: { in: ["PENDING", "CLAIMED"] } }, orderBy: { createdAt: "desc" }, select: { phase: true } });
  const liveReview = pending?.phase === "LIVE_REVIEW";
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, engine: "LOCAL_NODE", status: "AWAITING_NODE" }, data: { engine: "CLAUDE", status: liveReview ? "LIVE_REVIEW" : "ANALYZING", lastError: null } });
  if (!updated.count) return { ok: false, message: _code("actions.mbf7008e5c9") };
  await prisma.$transaction([
    prisma.localAnalysisTask.updateMany({ where: { jobId, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "CANCELLED", leaseUntil: null } }),
    prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content: liveReview ? _code("actions.m375b52e8df") : _code("actions.m0b13654158") } }),
  ]);
  refresh();
  return { ok: true, message: _code("actions.mdb44020612") };
}

// Jede Freigabe steht mit Zeitstempel im Chat, damit später klar ist, wer wann
// welchen Schritt ausgelöst hat.
async function logApproval(jobId: string, content: string) {
  await prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content } });
}

export async function startDependencyAnalysis(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const credential = await prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } });
  if (!credential) return { ok: false, message: _code("actions.mb72a0a05a1") };
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, status: "AWAITING_CLAUDE" }, data: { status: "ANALYZING", lastError: null } });
  if (!updated.count) return { ok: false, message: _code("actions.mb9546ac6a5") };
  await logApproval(jobId, _code("actions.m4e73b848c4"));
  refresh();
  return { ok: true, message: _code("actions.m4d03e838a5") };
}

export async function approveDependencyPreparation(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, status: "READY_FOR_REVIEW" }, data: { status: "APPROVED", approvalAt: new Date(), lastError: null } });
  if (!updated.count) return { ok: false, message: _code("actions.m8d3a960aae") };
  await logApproval(jobId, _code("actions.me9ca91bafb"));
  refresh();
  return { ok: true, message: _code("actions.m9b190fcbe3") };
}

export async function approveDependencyPublish(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, status: "READY_TO_PUSH", diffHash: { not: null } }, data: { status: "PUBLISHING", publishApprovalAt: new Date(), lastError: null } });
  if (!updated.count) return { ok: false, message: _code("actions.m7a00b50a6b") };
  await logApproval(jobId, _code("actions.md438262feb"));
  refresh();
  return { ok: true, message: _code("actions.mfa67897bcc") };
}

// Gescheiterter Schritt: genau diesen erneut an den Worker geben, ohne neue
// Analyse. Der Worker prüft dabei Worktree-Basis, Diff-Hash und Remote-Stand
// wieder, ein veralteter Stand scheitert also sichtbar statt still.
export async function retryDependencyStep(jobId: string): Promise<DependencyActionState> {
  const user = await requireUser();
  const job = await prisma.dependencyJob.findFirst({ where: { id: jobId, ownerId: user.id }, select: { status: true, approvalAt: true, diffHash: true, publishApprovalAt: true, publishedAt: true } });
  const step = job ? retryStep(job) : null;
  if (!job || !step) return { ok: false, message: _code("actions.noRetry") };
  // Deploy erneut prüfen: neues Zeitfenster ab jetzt, sonst liefe die Wartezeit sofort ab.
  const data = step.status === "DEPLOYING" ? { status: step.status, lastError: null, publishedAt: new Date(), workerLockedUntil: null } : { status: step.status, lastError: null };
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, status: job.status }, data });
  if (!updated.count) return { ok: false, message: _code("actions.mcad2d320ca") };
  const label = _code(({ ANALYZING: "dependency_phase.mc5a7d052ab", APPROVED: "dependency_phase.m4c6e6fc4d8", PUBLISHING: "dependency_phase.m8ba57ea372", DEPLOYING: "dependency_phase.ma395048581" })[step.status]);
  await prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content: _code("actions.retryLogged", { label }) } });
  refresh();
  return { ok: true, message: _code("actions.retryStarted", { label }) };
}

export async function markDependencySeen(jobIds: string[]): Promise<void> {
  const user = await requireUser();
  const ids = Array.isArray(jobIds) ? jobIds.filter((id) => typeof id === "string" && /^[a-z0-9]{10,40}$/i.test(id)).slice(0, 50) : [];
  await markDependencyJobsSeen(user.id, ids);
}
