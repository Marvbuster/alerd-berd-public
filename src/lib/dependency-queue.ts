import { dependencyPhase, TERMINAL_STATUSES, type Phase, type WorkerBusy } from "@/lib/dependency-phase";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import { parseProgress, type ProgressStep } from "@/lib/dependency-progress";

// Die Warteschlange des Workers, so wie er sie abarbeitet: ein Job nach dem
// anderen, der älteste Statuswechsel zuerst (tick() im Worker). Der Worker ist
// für alle Nutzer derselbe, deshalb stehen fremde Jobs mit drin, aber nur mit
// App, Besitzer und Schritt, ohne Chat und ohne Link.

// Schritte, die der Worker übernimmt (dieselbe Liste wie in tick()).
export const CLAIMABLE = ["ANALYZING", "APPROVED", "PUBLISHING", "RUNNING", "DEPLOYING", "LIVE_REVIEW"];
// Schritte, in denen er wirklich arbeitet. DEPLOYING hält den Job nur zwischen zwei Prüfungen fest.
const ACTIVE = ["ANALYZING", "APPROVED", "RUNNING", "VERIFYING", "PUBLISHING", "LIVE_REVIEW"];
const USER_TURN = ["DRAFT", "AWAITING_CLAUDE", "READY_FOR_REVIEW", "READY_TO_PUSH"];
export const RECENT_QUEUE_MS = 24 * 60 * 60_000;

export type QueueJobInput = {
  id: string; ownerId: string; ownerName: string; applicationId: string; applicationName: string;
  packageName: string; targetVersion: string; packages: unknown; engine: string; status: string;
  updatedAt: Date; workerLockedUntil: Date | null; workerAttemptAt: Date | null; lastError: string | null; publishedAt: Date | null;
  progress?: unknown;
  // Nur SYSTEM-Nachrichten, älteste zuerst.
  messages: { role: string; content: string; createdAt: Date }[];
};

export type QueueEntry = {
  jobId: string; applicationId: string; applicationName: string; label: string; status: string;
  owner: string; own: boolean; actor: Phase["actor"]; title: string; detail: string;
  since: string | null; changedAt: string; lockedUntil: string | null; latest: string | null; latestAt: string | null;
  // Nur beim laufenden Job: Teilschritte des Workers (Labels sind generisch, keine Inhalte).
  progress: ProgressStep[];
};

export type Queue = {
  running: QueueEntry[]; next: QueueEntry[]; deploying: QueueEntry[]; node: QueueEntry[];
  yours: QueueEntry[]; recent: QueueEntry[]; workerLastSeen: string | null;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function buildQueue(jobs: QueueJobInput[], viewerId: string, now: Date, workerLastSeen: Date | null = null): Queue {
  const locked = (j: QueueJobInput) => !!j.workerLockedUntil && j.workerLockedUntil > now;
  const runningJobs = jobs.filter((j) => locked(j) && ACTIVE.includes(j.status)).sort((a, b) => +(b.workerAttemptAt ?? b.updatedAt) - +(a.workerAttemptAt ?? a.updatedAt));
  const top = runningJobs[0];
  const workerBusy: WorkerBusy | null = top ? { jobId: top.id, appName: top.applicationName, owner: top.ownerName, label: jobLabel(jobPackages(top)), status: top.status, since: top.workerAttemptAt ?? top.updatedAt } : null;

  const entry = (j: QueueJobInput): QueueEntry => {
    const own = j.ownerId === viewerId;
    const phase = dependencyPhase(j, now, { workerBusy, workerLastSeen });
    const last = own ? j.messages.at(-1) ?? null : null;
    return {
      jobId: j.id, applicationId: j.applicationId, applicationName: j.applicationName, label: jobLabel(jobPackages(j)), status: j.status,
      owner: j.ownerName, own, actor: phase.actor, title: phase.title, detail: own ? phase.detail : "",
      since: iso(phase.since), changedAt: j.updatedAt.toISOString(), lockedUntil: iso(j.workerLockedUntil),
      latest: last?.content.split("\n")[0] ?? null, latestAt: iso(last?.createdAt ?? null),
      progress: [],
    };
  };

  const byAge = (a: QueueJobInput, b: QueueJobInput) => +a.updatedAt - +b.updatedAt;
  const own = (j: QueueJobInput) => j.ownerId === viewerId;
  return {
    running: runningJobs.map((j) => ({ ...entry(j), progress: parseProgress(j.progress) })),
    // Genau die Reihenfolge, in der tick() den nächsten freien Job greift.
    next: jobs.filter((j) => CLAIMABLE.includes(j.status) && !locked(j)).sort(byAge).map(entry),
    // Zwischen zwei Deploy-Prüfungen gehalten, der Worker ist in der Zeit frei.
    deploying: jobs.filter((j) => j.status === "DEPLOYING" && locked(j)).sort(byAge).map(entry),
    node: jobs.filter((j) => j.status === "AWAITING_NODE" && own(j)).sort(byAge).map(entry),
    yours: jobs.filter((j) => USER_TURN.includes(j.status) && own(j)).sort(byAge).map(entry),
    recent: jobs.filter((j) => TERMINAL_STATUSES.includes(j.status) && j.status !== "CANCELLED" && own(j) && now.getTime() - j.updatedAt.getTime() < RECENT_QUEUE_MS)
      .sort((a, b) => byAge(b, a)).slice(0, 12).map(entry),
    workerLastSeen: iso(workerLastSeen),
  };
}
