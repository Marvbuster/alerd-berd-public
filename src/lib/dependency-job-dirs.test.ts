import { describe, expect, it } from "vitest";
import { staleJobDirs, RETRY_KEEP_MS } from "../../scripts/dependency-worker-lib.mjs";

const now = new Date("2026-11-16T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const day = 24 * 60 * 60_000;

describe("staleJobDirs", () => {
  const jobs = new Map([
    ["live", { ownerId: "o1", status: "LIVE", updatedAt: ago(60_000) }],
    ["pushed", { ownerId: "o1", status: "PUSHED", updatedAt: ago(60_000) }],
    ["cancelled", { ownerId: "o1", status: "CANCELLED", updatedAt: ago(60_000) }],
    ["failedFresh", { ownerId: "o1", status: "FAILED", updatedAt: ago(day) }],
    ["failedOld", { ownerId: "o1", status: "DEPLOY_FAILED", updatedAt: ago(RETRY_KEEP_MS + 60_000) }],
    ["review", { ownerId: "o1", status: "READY_FOR_REVIEW", updatedAt: ago(30 * day) }],
    ["node", { ownerId: "o1", status: "AWAITING_NODE", updatedAt: ago(30 * day) }],
    ["running", { ownerId: "o1", status: "RUNNING", updatedAt: ago(60_000) }],
    ["foreign", { ownerId: "o2", status: "RUNNING", updatedAt: ago(60_000) }],
  ]);
  const dirs = [...jobs.keys(), "gone"].map((jobId) => ({ ownerId: "o1", jobId }));

  it("löscht fertige, alte fehlgeschlagene und verwaiste Ordner, lässt offene und frisch gescheiterte stehen", () => {
    const stale = staleJobDirs(dirs, jobs, now).map((d: { jobId: string }) => d.jobId);
    expect(stale.sort()).toEqual(["cancelled", "failedOld", "foreign", "gone", "live", "pushed"]);
  });
});

describe("compareContains", () => {
  it("live enthält den gepushten Commit nur bei ahead oder identical", async () => {
    const { compareContains } = await import("../../scripts/dependency-worker-lib.mjs");
    expect(compareContains({ status: "ahead" })).toBe(true);
    expect(compareContains({ status: "identical" })).toBe(true);
    expect(compareContains({ status: "behind" })).toBe(false);
    expect(compareContains({ status: "diverged" })).toBe(false);
    expect(compareContains(null)).toBe(false);
  });
});
