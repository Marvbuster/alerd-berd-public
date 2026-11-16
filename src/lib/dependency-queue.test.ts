import { describe, expect, it } from "vitest";
import { buildQueue, type QueueJobInput } from "./dependency-queue";
import { ago } from "./dependency-phase";

const now = new Date("2026-11-15T12:00:00Z");
const min = (m: number) => new Date(now.getTime() + m * 60_000);
let n = 0;
function job(over: Partial<QueueJobInput>): QueueJobInput {
  n += 1;
  return {
    id: `j${n}`, ownerId: "me", ownerName: "user-a", applicationId: `a${n}`, applicationName: `App ${n}`,
    packageName: "next", targetVersion: "16.4.6", packages: null, engine: "CLAUDE", status: "ANALYZING",
    updatedAt: min(-10), workerLockedUntil: null, workerAttemptAt: null, lastError: null, publishedAt: null, messages: [], ...over,
  };
}

describe("buildQueue", () => {
  it("zeigt den laufenden Job und die Schlange in der Reihenfolge des Workers", () => {
    const running = job({ status: "RUNNING", workerLockedUntil: min(2), workerAttemptAt: min(-3), messages: [{ role: "SYSTEM", content: "Ausgangslage grün: ci\nmehr", createdAt: min(-1) }] });
    const later = job({ status: "APPROVED", updatedAt: min(-2) });
    const first = job({ status: "ANALYZING", updatedAt: min(-8) });
    const q = buildQueue([running, later, first], "me", now);
    expect(q.running.map((e) => e.jobId)).toEqual([running.id]);
    expect(q.running[0].actor).toBe("worker");
    expect(q.running[0].latest).toBe("Ausgangslage grün: ci");
    expect(q.next.map((e) => e.jobId)).toEqual([first.id, later.id]);
    expect(q.next.every((e) => e.actor === "waiting" && e.title === "Wartet in der Schlange")).toBe(true);
  });

  it("trennt beobachtete Deploys von der Schlange", () => {
    const held = job({ status: "DEPLOYING", workerLockedUntil: min(0.5) });
    const due = job({ status: "DEPLOYING", workerLockedUntil: min(-1) });
    const q = buildQueue([held, due], "me", now);
    expect(q.deploying.map((e) => e.jobId)).toEqual([held.id]);
    expect(q.next.map((e) => e.jobId)).toEqual([due.id]);
    expect(q.running).toEqual([]);
  });

  it("zeigt fremde Jobs nur mit App, Besitzer und Schritt", () => {
    const foreign = job({ ownerId: "other", ownerName: "anna", status: "ANALYZING", workerLockedUntil: min(2), messages: [{ role: "SYSTEM", content: "geheim", createdAt: min(-1) }] });
    const foreignTurn = job({ ownerId: "other", status: "READY_FOR_REVIEW" });
    const foreignDone = job({ ownerId: "other", status: "LIVE", updatedAt: min(-5) });
    const q = buildQueue([foreign, foreignTurn, foreignDone], "me", now);
    expect(q.running[0]).toMatchObject({ own: false, owner: "anna", detail: "", latest: null });
    expect(q.yours).toEqual([]);
    expect(q.recent).toEqual([]);
  });

  it("listet eigene Aufgaben und die Abschlüsse der letzten 24 Stunden, neueste zuerst", () => {
    const turn = job({ status: "READY_TO_PUSH" });
    const old = job({ status: "LIVE", updatedAt: min(-25 * 60) });
    const live = job({ status: "LIVE", updatedAt: min(-60) });
    const failed = job({ status: "FAILED", updatedAt: min(-5) });
    const node = job({ status: "AWAITING_NODE" });
    const q = buildQueue([turn, old, live, failed, node], "me", now);
    expect(q.yours.map((e) => [e.jobId, e.actor])).toEqual([[turn.id, "user"]]);
    expect(q.recent.map((e) => e.jobId)).toEqual([failed.id, live.id]);
    expect(q.node.map((e) => e.jobId)).toEqual([node.id]);
  });

  it("meldet einen hängenden Worker, wenn niemand übernimmt", () => {
    const q = buildQueue([job({ status: "ANALYZING", updatedAt: min(-5) })], "me", now, min(-90));
    expect(q.next[0].actor).toBe("stalled");
    expect(q.workerLastSeen).toBe(min(-90).toISOString());
  });
});

describe("ago", () => {
  it("rundet grob", () => {
    expect(ago(now, now)).toBe("gerade");
    expect(ago(min(-5), now)).toBe("vor 5 Min.");
    expect(ago(min(-150), now)).toBe("vor 2 Std.");
    expect(ago(min(-24 * 60), now)).toBe("vor 1 Tag");
    expect(ago(min(-72 * 60), now)).toBe("vor 3 Tagen");
  });
});
