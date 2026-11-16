import { prisma } from "@/lib/prisma";
import { dependencyPhase, isUnread, TERMINAL_STATUSES, type Phase } from "@/lib/dependency-phase";
import type { DependencyJobStatus } from "@prisma/client";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";
import { currentStep, parseProgress } from "@/lib/dependency-progress";

export type DependencyNotification = {
  jobId: string; applicationId: string; applicationName: string; targetVersion: string; label: string;
  actor: Phase["actor"]; title: string; since: string | null; changedAt: string; unread: boolean;
  // Laufender Teilschritt des Workers, etwa „Mit Update: npm run build“.
  current: string | null;
};

// Pro App nur der neueste Job. Laufende und offene Jobs immer, abgeschlossene
// noch eine Woche lang, abgebrochene gar nicht.
const RECENT_MS = 7 * 24 * 60 * 60_000;

export async function loadDependencyNotifications(ownerId: string, now = new Date()): Promise<DependencyNotification[]> {
  const jobs = await prisma.dependencyJob.findMany({
    where: {
      ownerId, status: { not: "CANCELLED" },
      OR: [{ status: { notIn: TERMINAL_STATUSES as DependencyJobStatus[] } }, { updatedAt: { gt: new Date(now.getTime() - RECENT_MS) } }],
    },
    orderBy: { updatedAt: "desc" }, take: 40,
    select: { id: true, applicationId: true, packageName: true, targetVersion: true, packages: true, status: true, updatedAt: true, seenAt: true, workerLockedUntil: true, workerAttemptAt: true, lastError: true, progress: true, application: { select: { name: true } } },
  });
  const { busy: workerBusy, lastSeen: workerLastSeen } = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status)) ? await loadWorkerStatus(now) : { busy: null, lastSeen: null };
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) if (!latest.has(job.applicationId)) latest.set(job.applicationId, job);
  return [...latest.values()].map((job) => {
    const phase = dependencyPhase(job, now, { workerBusy, workerLastSeen });
    return {
      jobId: job.id, applicationId: job.applicationId, applicationName: job.application.name, targetVersion: job.targetVersion, label: jobLabel(jobPackages(job)),
      actor: phase.actor, title: phase.title, since: phase.since?.toISOString() ?? null, changedAt: job.updatedAt.toISOString(),
      unread: isUnread(phase, job),
      current: phase.actor === "worker" ? currentStep(parseProgress(job.progress))?.label ?? null : null,
    };
  });
}

// Raw-SQL, damit Prismas @updatedAt nicht anspringt: updatedAt bleibt der
// Zeitpunkt des Statuswechsels, an dem „ungelesen“ gemessen wird. Die Zeit kommt
// aus der App, nicht aus NOW() der DB, weil auch updatedAt die App-Uhr nutzt.
export async function markDependencyJobsSeen(ownerId: string, jobIds: string[]) {
  if (!jobIds.length) return;
  await prisma.$executeRaw`UPDATE "DependencyJob" SET "seenAt" = ${new Date()} WHERE "ownerId" = ${ownerId} AND "id" = ANY(${jobIds})`;
}
