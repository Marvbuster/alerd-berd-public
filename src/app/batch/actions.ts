"use server";

import { messageCode as _code } from "@/i18n/translate";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { batchStage } from "@/lib/dependency-batch";
import { engineLabel, TERMINAL_STATUSES } from "@/lib/dependency-phase";

// Die Sammelfreigaben eines Sammel-Updates (tasks/batch-update.md). Jede
// Freigabe landet wie im Einzelchat mit Zeitstempel im Chat des Dienstes.

export type BatchGateState = { ok?: boolean; message?: string };

function refresh(batchId: string) {
  revalidatePath(`/batch/${batchId}`);
  revalidatePath("/services"); revalidatePath("/queue");
}

async function loadOwnBatch(ownerId: string, batchId: string) {
  return prisma.dependencyBatch.findFirst({
    where: { id: batchId, ownerId },
    select: { id: true, pausedAt: true, cancelledAt: true, jobs: { select: { id: true, status: true, publishApprovalAt: true, diffHash: true, applicationId: true } } },
  });
}

// Freigabe 1: Die gewählten Dienste gehen in Update und Tests, die übrigen
// verlassen den Lauf und bleiben als einzelner Chat beim Dienst stehen.
export async function approveBatchAnalyses(batchId: string, _state: BatchGateState, form: FormData): Promise<BatchGateState> {
  const user = await requireUser();
  const batch = await loadOwnBatch(user.id, batchId);
  if (!batch) return { ok: false, message: _code("BatchUpdate.notFound") };
  // Erst wenn keine Analyse mehr läuft, sonst entschiede man ohne alle Ergebnisse.
  if (batchStage(batch, batch.jobs) !== "approval1") return { ok: false, message: _code("BatchUpdate.notYet") };
  const waiting = batch.jobs.filter((j) => j.status === "READY_FOR_REVIEW").map((j) => j.id);
  const picked = new Set(form.getAll("job").map(String).filter((id) => waiting.includes(id)));
  if (!picked.size) return { ok: false, message: _code("BatchUpdate.pickOne") };
  const dropped = waiting.filter((id) => !picked.has(id));
  const now = new Date();
  await prisma.$transaction([
    prisma.dependencyJob.updateMany({ where: { id: { in: [...picked] }, ownerId: user.id, batchId, status: "READY_FOR_REVIEW" }, data: { status: "APPROVED", approvalAt: now, lastError: null } }),
    prisma.dependencyJob.updateMany({ where: { id: { in: dropped }, ownerId: user.id, batchId, status: "READY_FOR_REVIEW" }, data: { batchId: null } }),
    prisma.dependencyMessage.createMany({ data: [
      ...[...picked].map((jobId) => ({ jobId, role: "SYSTEM" as const, content: _code("BatchUpdate.approvedInBatch") })),
      ...dropped.map((jobId) => ({ jobId, role: "SYSTEM" as const, content: _code("BatchUpdate.leftBatch") })),
    ] }),
  ]);
  refresh(batchId);
  return { ok: true, message: _code("BatchUpdate.approved1", { count: picked.size }) };
}

// An einer Sammelfreigabe die Analyse eines Dienstes mit der anderen Engine neu
// laufen lassen. Die Claude-Session beginnt dabei neu, die bisherige Analyse
// bleibt im Chat stehen und geht als Kontext in die neue ein.
export async function switchBatchEngine(jobId: string, engine: "CLAUDE" | "LOCAL_NODE"): Promise<BatchGateState> {
  const user = await requireUser();
  const job = await prisma.dependencyJob.findFirst({ where: { id: jobId, ownerId: user.id, batchId: { not: null }, status: "READY_FOR_REVIEW" }, select: { id: true, batchId: true, engine: true } });
  if (!job?.batchId) return { ok: false, message: _code("BatchUpdate.notYet") };
  if (job.engine === engine) return { ok: true };
  const ready = engine === "CLAUDE"
    ? await prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } })
    : await prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } });
  if (!ready) return { ok: false, message: _code(engine === "CLAUDE" ? "actions.mb72a0a05a1" : "actions.ma319cdf07d") };
  const updated = await prisma.dependencyJob.updateMany({ where: { id: jobId, ownerId: user.id, status: "READY_FOR_REVIEW" }, data: { engine, status: "ANALYZING", claudeSessionId: null, lastError: null } });
  if (!updated.count) return { ok: false, message: _code("BatchUpdate.notYet") };
  await prisma.$transaction([
    prisma.localAnalysisTask.updateMany({ where: { jobId, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "CANCELLED", leaseUntil: null } }),
    prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content: _code("BatchUpdate.engineSwitched", { engine: engine === "LOCAL_NODE" ? _code("dependency_phase.engineLocal") : engineLabel(engine) }) } }),
  ]);
  refresh(job.batchId);
  return { ok: true };
}

// Freigabe 2: Die gewählten Dienste werden gepusht, einer nach dem anderen (der
// Worker startet den nächsten, wenn der vorige live ist). Dienste mit Spec-Health
// kommen zuerst, weil dort ein kaputter Patch sicher auffällt. Die Reihenfolge
// steckt in publishApprovalAt, je Dienst eine Millisekunde später.
export async function approveBatchPushes(batchId: string, _state: BatchGateState, form: FormData): Promise<BatchGateState> {
  const user = await requireUser();
  const batch = await loadOwnBatch(user.id, batchId);
  if (!batch) return { ok: false, message: _code("BatchUpdate.notFound") };
  if (batchStage(batch, batch.jobs) !== "approval2") return { ok: false, message: _code("BatchUpdate.notYet") };
  const waiting = batch.jobs.filter((j) => j.status === "READY_TO_PUSH" && !j.publishApprovalAt && j.diffHash);
  const wanted = new Set(form.getAll("job").map(String));
  const picked = waiting.filter((j) => wanted.has(j.id));
  if (!picked.length) return { ok: false, message: _code("BatchUpdate.pickOne") };
  const dropped = batch.jobs.filter((j) => j.status === "READY_TO_PUSH" && !j.publishApprovalAt && !wanted.has(j.id)).map((j) => j.id);
  const verifiable = new Set((await prisma.monitorCoolifyApplication.findMany({
    where: { applicationId: { in: picked.map((j) => j.applicationId) }, monitor: { kind: "HEALTH", enabled: true, ownerId: user.id } },
    select: { applicationId: true },
  })).map((l) => l.applicationId));
  const ordered = [...picked].sort((a, b) => Number(verifiable.has(b.applicationId)) - Number(verifiable.has(a.applicationId)));
  const now = Date.now();
  await prisma.$transaction([
    ...ordered.map((j, i) => prisma.dependencyJob.updateMany({ where: { id: j.id, ownerId: user.id, batchId, status: "READY_TO_PUSH", publishApprovalAt: null }, data: { publishApprovalAt: new Date(now + i), lastError: null } })),
    prisma.dependencyJob.updateMany({ where: { id: { in: dropped }, ownerId: user.id, batchId, status: "READY_TO_PUSH" }, data: { batchId: null } }),
    prisma.dependencyMessage.createMany({ data: [
      ...ordered.map((j, i) => ({ jobId: j.id, role: "SYSTEM" as const, content: _code("BatchUpdate.pushApproved", { position: i + 1, count: ordered.length }) })),
      ...dropped.map((jobId) => ({ jobId, role: "SYSTEM" as const, content: _code("BatchUpdate.leftBatch") })),
    ] }),
  ]);
  refresh(batchId);
  return { ok: true, message: _code("BatchUpdate.approved2", { count: ordered.length }) };
}

// An Freigabe 2 festlegen, wer das Fazit nach dem Deploy schreibt. Es läuft
// nichts neu, die Engine zählt erst beim Fazit wieder.
export async function setBatchConclusionEngine(jobId: string, engine: "CLAUDE" | "LOCAL_NODE"): Promise<BatchGateState> {
  const user = await requireUser();
  const ready = engine === "CLAUDE"
    ? await prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } })
    : await prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } });
  if (!ready) return { ok: false, message: _code(engine === "CLAUDE" ? "actions.mb72a0a05a1" : "actions.ma319cdf07d") };
  const job = await prisma.dependencyJob.findFirst({ where: { id: jobId, ownerId: user.id, batchId: { not: null }, status: "READY_TO_PUSH", publishApprovalAt: null }, select: { id: true, batchId: true, engine: true } });
  if (!job?.batchId) return { ok: false, message: _code("BatchUpdate.notYet") };
  if (job.engine === engine) return { ok: true };
  await prisma.$transaction([
    prisma.dependencyJob.update({ where: { id: jobId }, data: { engine } }),
    prisma.dependencyMessage.create({ data: { jobId, role: "SYSTEM", content: _code("BatchUpdate.conclusionBy", { engine: engine === "LOCAL_NODE" ? _code("dependency_phase.engineLocal") : engineLabel(engine) }) } }),
  ]);
  refresh(job.batchId);
  return { ok: true };
}

// Nach einer Pause weiter: Der gescheiterte Dienst verlässt den Lauf (sein Chat
// bietet den Schritt zum Wiederholen an), die übrigen werden wieder gepusht.
export async function resumeBatch(batchId: string): Promise<BatchGateState> {
  const user = await requireUser();
  const batch = await loadOwnBatch(user.id, batchId);
  if (!batch?.pausedAt || batch.cancelledAt) return { ok: false, message: _code("BatchUpdate.notYet") };
  const failed = batch.jobs.filter((j) => j.publishApprovalAt && ["FAILED", "DEPLOY_FAILED"].includes(j.status)).map((j) => j.id);
  await prisma.$transaction([
    prisma.dependencyJob.updateMany({ where: { id: { in: failed }, batchId }, data: { batchId: null } }),
    prisma.dependencyMessage.createMany({ data: failed.map((jobId) => ({ jobId, role: "SYSTEM" as const, content: _code("BatchUpdate.leftAfterFailure") })) }),
    prisma.dependencyBatch.update({ where: { id: batchId }, data: { pausedAt: null, pauseReason: null } }),
  ]);
  refresh(batchId);
  return { ok: true };
}

// Abbrechen: Nichts wird mehr gepusht, was der Worker gerade hält, läuft zu Ende.
// Alle offenen Dienste bleiben als einzelne Chats beim Dienst, freigegebene
// Pushes, die noch nicht dran waren, verlieren ihre Freigabe.
export async function cancelBatch(batchId: string): Promise<BatchGateState> {
  const user = await requireUser();
  const batch = await loadOwnBatch(user.id, batchId);
  if (!batch || batch.cancelledAt) return { ok: false, message: _code("BatchUpdate.notFound") };
  const open = batch.jobs.filter((j) => !TERMINAL_STATUSES.includes(j.status)).map((j) => j.id);
  const queued = batch.jobs.filter((j) => j.status === "READY_TO_PUSH" && j.publishApprovalAt).map((j) => j.id);
  await prisma.$transaction([
    prisma.dependencyBatch.update({ where: { id: batchId }, data: { cancelledAt: new Date() } }),
    prisma.dependencyJob.updateMany({ where: { id: { in: queued }, status: "READY_TO_PUSH" }, data: { publishApprovalAt: null } }),
    prisma.dependencyJob.updateMany({ where: { id: { in: open }, batchId }, data: { batchId: null } }),
    prisma.dependencyMessage.createMany({ data: open.map((jobId) => ({ jobId, role: "SYSTEM" as const, content: _code("BatchUpdate.batchCancelled") })) }),
  ]);
  refresh(batchId);
  return { ok: true };
}
