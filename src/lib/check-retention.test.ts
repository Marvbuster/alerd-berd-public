import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ monitors: vi.fn(), exec: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { monitor: { findMany: mocks.monitors }, $executeRaw: mocks.exec } }));
import { CHECK_KEEP_MS, pruneOldChecks, resetCheckRetention } from "./check-retention";

const now = new Date("2026-11-16T10:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  resetCheckRetention();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.monitors.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
});

describe("pruneOldChecks", () => {
  it("löscht pro Monitor in Häppchen bis nichts Altes mehr da ist, mit Grenze 14 Tage", async () => {
    mocks.exec.mockResolvedValueOnce(5_000).mockResolvedValueOnce(120).mockResolvedValueOnce(0);
    const result = await pruneOldChecks(now);
    expect(result).toEqual({ deleted: 5_120, skipped: false });
    expect(mocks.exec).toHaveBeenCalledTimes(3);
    const cutoff = mocks.exec.mock.calls[0].find((v: unknown) => v instanceof Date) as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(CHECK_KEEP_MS);
  });
  it("pausiert danach eine Stunde", async () => {
    mocks.exec.mockResolvedValue(0);
    await pruneOldChecks(now);
    expect((await pruneOldChecks(new Date(now.getTime() + 30 * 60_000))).skipped).toBe(true);
    expect((await pruneOldChecks(new Date(now.getTime() + 61 * 60_000))).skipped).toBe(false);
  });
  it("macht beim Altbestand im nächsten Lauf sofort weiter", async () => {
    mocks.exec.mockResolvedValue(5_000);
    const first = await pruneOldChecks(now);
    expect(first.deleted).toBe(50_000);
    expect((await pruneOldChecks(new Date(now.getTime() + 60_000))).skipped).toBe(false);
  });
});
