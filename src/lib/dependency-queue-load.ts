import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/dependency-phase";
import { loadWorkerLastSeen } from "@/lib/dependency-worker-status";
import { buildQueue, RECENT_QUEUE_MS, type Queue } from "@/lib/dependency-queue";
import type { DependencyJobStatus } from "@prisma/client";

// Alle offenen Jobs aller aktiven Nutzer (der Worker ist geteilt), dazu die
// eigenen abgeschlossenen der letzten 24 Stunden. Welche Felder fremder Jobs
// sichtbar sind, entscheidet buildQueue.
export async function loadQueue(viewerId: string, now = new Date()): Promise<Queue> {
  const [jobs, lastSeen] = await Promise.all([
    prisma.dependencyJob.findMany({
      where: {
        status: { not: "CANCELLED" }, owner: { active: true },
        OR: [
          { status: { notIn: TERMINAL_STATUSES as DependencyJobStatus[] } },
          { ownerId: viewerId, updatedAt: { gt: new Date(now.getTime() - RECENT_QUEUE_MS) } },
        ],
      },
      orderBy: { updatedAt: "asc" }, take: 100,
      select: {
        id: true, ownerId: true, applicationId: true, packageName: true, targetVersion: true, packages: true, engine: true, status: true,
        updatedAt: true, workerLockedUntil: true, workerAttemptAt: true, lastError: true, publishedAt: true, progress: true,
        application: { select: { name: true } }, owner: { select: { name: true, email: true } },
        messages: { where: { role: "SYSTEM" }, orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true, createdAt: true } },
      },
    }),
    loadWorkerLastSeen(),
  ]);
  return buildQueue(jobs.map((j) => ({
    ...j, applicationName: j.application.name, ownerName: j.owner.name || j.owner.email.split("@")[0],
    messages: [...j.messages].reverse(),
  })), viewerId, now, lastSeen);
}
