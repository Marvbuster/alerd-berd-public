import { prisma } from "@/lib/prisma";
import { dependencyPhase, isUnread, TERMINAL_STATUSES, type Phase } from "@/lib/dependency-phase";
import type { DependencyJobStatus } from "@prisma/client";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";
import { currentStep, parseProgress } from "@/lib/dependency-progress";
import { batchStage, type BatchStage } from "@/lib/dependency-batch";
import { translate } from "@/i18n/translate";

export type DependencyNotification = {
  jobId: string; applicationId: string; applicationName: string; targetVersion: string; label: string;
  actor: Phase["actor"]; title: string; since: string | null; changedAt: string; unread: boolean;
  // Laufender Teilschritt des Workers, etwa „Mit Update: npm run build“.
  current: string | null;
  // Sammel-Update: eine Zeile für den ganzen Lauf, Klick führt auf seine Seite.
  href?: string;
};

// Pro App nur der neueste Job. Laufende und offene Jobs immer, abgeschlossene
// noch eine Woche lang, abgebrochene gar nicht.
const RECENT_MS = 7 * 24 * 60 * 60_000;

export async function loadDependencyNotifications(ownerId: string, now = new Date(), locale = "de"): Promise<DependencyNotification[]> {
  const jobs = await prisma.dependencyJob.findMany({
    where: {
      // Jobs eines Sammel-Updates meldet der Lauf gesammelt (loadBatchNotifications).
      ownerId, status: { not: "CANCELLED" }, batchId: null,
      OR: [{ status: { notIn: TERMINAL_STATUSES as DependencyJobStatus[] } }, { updatedAt: { gt: new Date(now.getTime() - RECENT_MS) } }],
    },
    orderBy: { updatedAt: "desc" }, take: 40,
    select: { id: true, applicationId: true, packageName: true, targetVersion: true, packages: true, status: true, updatedAt: true, seenAt: true, workerLockedUntil: true, workerAttemptAt: true, lastError: true, progress: true, application: { select: { name: true } } },
  });
  const { busy: workerBusy, lastSeen: workerLastSeen } = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status)) ? await loadWorkerStatus(now, locale) : { busy: null, lastSeen: null };
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) if (!latest.has(job.applicationId)) latest.set(job.applicationId, job);
  const batches = await loadBatchNotifications(ownerId, now, locale);
  return [...batches, ...[...latest.values()].map((job) => {
    const phase = dependencyPhase(job, now, { workerBusy, workerLastSeen }, locale);
    return {
      jobId: job.id, applicationId: job.applicationId, applicationName: job.application.name, targetVersion: job.targetVersion, label: jobLabel(jobPackages(job), locale),
      actor: phase.actor, title: phase.title, since: phase.since?.toISOString() ?? null, changedAt: job.updatedAt.toISOString(),
      unread: isUnread(phase, job),
      current: phase.actor === "worker" ? currentStep(parseProgress(job.progress))?.label ?? null : null,
    };
  })];
}

const BATCH_ACTOR: Record<BatchStage, Phase["actor"]> = {
  analyzing: "worker", approval1: "user", preparing: "worker", approval2: "user", publishing: "worker", paused: "stalled", done: "done", cancelled: "done",
};

// Ein Eintrag pro Sammel-Update, solange es offen ist, danach noch eine Woche.
// Ungelesen ist er, wenn man dran ist oder der Lauf fertig ist und man das seit
// dem letzten Wechsel nicht angesehen hat.
async function loadBatchNotifications(ownerId: string, now: Date, locale: string): Promise<DependencyNotification[]> {
  const batches = await prisma.dependencyBatch.findMany({
    where: { ownerId, cancelledAt: null, OR: [{ createdAt: { gt: new Date(now.getTime() - RECENT_MS) } }, { jobs: { some: { status: { notIn: TERMINAL_STATUSES as DependencyJobStatus[] } } } }] },
    orderBy: { createdAt: "desc" }, take: 5,
    select: { id: true, pausedAt: true, cancelledAt: true, seenAt: true, createdAt: true, jobs: { select: { status: true, publishApprovalAt: true, updatedAt: true } } },
  });
  return batches.filter((b) => b.jobs.length > 0).map((batch) => {
    const stage = batchStage(batch, batch.jobs);
    const changed = new Date(Math.max(batch.createdAt.getTime(), batch.pausedAt?.getTime() ?? 0, ...batch.jobs.map((j) => j.updatedAt.getTime())));
    const actor = BATCH_ACTOR[stage];
    return {
      jobId: `batch:${batch.id}`, applicationId: "", applicationName: translate(locale, "BatchUpdate.pageTitle"), targetVersion: "",
      label: translate(locale, "BatchUpdate.servicesCount", { count: batch.jobs.length }), actor, title: translate(locale, `BatchUpdate.stage_${stage}`),
      since: null, changedAt: changed.toISOString(), current: null, href: `/batch/${batch.id}`,
      unread: (actor === "user" || actor === "stalled" || stage === "done") && (!batch.seenAt || batch.seenAt < changed),
    };
  });
}

// Raw-SQL, damit Prismas @updatedAt nicht anspringt: updatedAt bleibt der
// Zeitpunkt des Statuswechsels, an dem „ungelesen“ gemessen wird. Die Zeit kommt
// aus der App, nicht aus NOW() der DB, weil auch updatedAt die App-Uhr nutzt.
export async function markDependencyJobsSeen(ownerId: string, jobIds: string[]) {
  // Einträge eines Sammel-Updates heißen batch:<id>, ihr Lauf merkt sich das Ansehen.
  const batchIds = jobIds.filter((id) => id.startsWith("batch:")).map((id) => id.slice(6));
  if (batchIds.length) await prisma.dependencyBatch.updateMany({ where: { ownerId, id: { in: batchIds } }, data: { seenAt: new Date() } });
  jobIds = jobIds.filter((id) => !id.startsWith("batch:"));
  if (!jobIds.length) return;
  await prisma.$executeRaw`UPDATE "DependencyJob" SET "seenAt" = ${new Date()} WHERE "ownerId" = ${ownerId} AND "id" = ANY(${jobIds})`;
}
