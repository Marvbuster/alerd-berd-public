import { prisma } from "@/lib/prisma";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import type { WorkerBusy } from "@/lib/dependency-phase";
import type { DependencyJobStatus } from "@prisma/client";

// Schritte, in denen der Worker wirklich arbeitet. DEPLOYING hält den Job nur
// zwischen zwei Prüfungen zurück, der Worker ist in der Zeit frei.
const ACTIVE: DependencyJobStatus[] = ["ANALYZING", "APPROVED", "RUNNING", "VERIFYING", "PUBLISHING", "LIVE_REVIEW"];

export async function loadWorkerBusy(now = new Date()): Promise<WorkerBusy | null> {
  const job = await prisma.dependencyJob.findFirst({
    where: { status: { in: ACTIVE }, workerLockedUntil: { gt: now } },
    orderBy: { workerAttemptAt: "desc" },
    select: {
      id: true, status: true, packageName: true, targetVersion: true, packages: true, workerAttemptAt: true, updatedAt: true,
      application: { select: { name: true } }, owner: { select: { name: true, email: true } },
    },
  });
  if (!job) return null;
  return {
    jobId: job.id, appName: job.application.name, owner: job.owner.name || job.owner.email.split("@")[0],
    label: jobLabel(jobPackages(job)), status: job.status, since: job.workerAttemptAt ?? job.updatedAt,
  };
}

// Wann hat der Worker zuletzt einen Job angefasst? Hilft bei „Worker antwortet nicht“.
export async function loadWorkerLastSeen(): Promise<Date | null> {
  const job = await prisma.dependencyJob.findFirst({ where: { workerAttemptAt: { not: null } }, orderBy: { workerAttemptAt: "desc" }, select: { workerAttemptAt: true } });
  return job?.workerAttemptAt ?? null;
}

export async function loadWorkerStatus(now = new Date()): Promise<{ busy: WorkerBusy | null; lastSeen: Date | null }> {
  const [busy, lastSeen] = await Promise.all([loadWorkerBusy(now), loadWorkerLastSeen()]);
  return { busy, lastSeen };
}
