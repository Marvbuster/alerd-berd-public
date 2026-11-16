import { describe, expect, it } from "vitest";
import { currentStep, parseProgress } from "./dependency-progress";
import { createProgress, npmStepLabel } from "../../scripts/dependency-worker-lib.mjs";

describe("parseProgress", () => {
  it("liest gültige Schritte und verwirft den Rest", () => {
    expect(parseProgress(null)).toEqual([]);
    expect(parseProgress({ steps: "x" })).toEqual([]);
    expect(parseProgress({ steps: [
      { label: "npm ci", startedAt: "2026-11-15T12:00:00Z", endedAt: "2026-11-15T12:01:00Z", ok: true },
      { label: 5, startedAt: "2026-11-15T12:00:00Z" },
      { label: "kaputt", startedAt: "nie" },
      { label: "npm run build", startedAt: "2026-11-15T12:01:00Z" },
    ] })).toEqual([
      { label: "npm ci", startedAt: "2026-11-15T12:00:00Z", endedAt: "2026-11-15T12:01:00Z", ok: true },
      { label: "npm run build", startedAt: "2026-11-15T12:01:00Z", endedAt: null, ok: null },
    ]);
  });

  it("nimmt als aktuellen Schritt den zuletzt gestarteten offenen", () => {
    const steps = parseProgress({ steps: [
      { label: "Claude liest", startedAt: "2026-11-15T12:00:00Z" },
      { label: "npm ci", startedAt: "2026-11-15T12:00:01Z", endedAt: "2026-11-15T12:01:00Z", ok: true },
      { label: "npm run build", startedAt: "2026-11-15T12:01:00Z" },
    ] });
    expect(currentStep(steps)?.label).toBe("npm run build");
    expect(currentStep([])).toBeNull();
  });
});

describe("createProgress (Worker)", () => {
  it("speichert Start, Ende und Ergebnis jedes Teilschritts in Reihenfolge", async () => {
    const saved: { steps: { label: string; ok?: boolean; endedAt?: string }[] }[] = [];
    let t = 0;
    const progress = createProgress(async (s: typeof saved[number]) => { saved.push(s); }, () => new Date(Date.UTC(2026, 10, 15, 12, 0, t++)));
    await progress.reset();
    await progress.step("npm ci", async () => "ok");
    await expect(progress.step("npm run test", async () => { throw new Error("rot"); })).rejects.toThrow("rot");
    await progress.flushed();
    const last = saved.at(-1)!;
    expect(saved[0]).toEqual({ steps: [] });
    expect(last.steps.map((s) => [s.label, s.ok, !!s.endedAt])).toEqual([["npm ci", true, true], ["npm run test", false, true]]);
    // Ein laufender Schritt wurde gespeichert, bevor er fertig war.
    expect(saved.some((s) => s.steps.some((x) => x.label === "npm run test" && !x.endedAt))).toBe(true);
  });

  it("bricht den Job nicht ab, wenn das Speichern scheitert", async () => {
    const progress = createProgress(async () => { throw new Error("db weg"); });
    const original = console.error;
    console.error = () => {};
    try { await expect(progress.step("npm ci", async () => 42)).resolves.toBe(42); await progress.flushed(); }
    finally { console.error = original; }
  });
});

describe("npmStepLabel", () => {
  it("benennt npm-Aufrufe kurz", () => {
    expect(npmStepLabel("Ohne Update", ["ci"])).toBe("Ohne Update: npm ci");
    expect(npmStepLabel("Mit Update", ["run", "alerd:build"])).toBe("Mit Update: npm run alerd:build");
    expect(npmStepLabel("Mit Update", ["install", "next@16.4.6", "--package-lock-only", "--ignore-scripts"])).toBe("Mit Update: Lockfile aktualisieren");
    expect(npmStepLabel("", ["exec", "--no", "--", "prisma", "generate"])).toBe("prisma generate");
  });
});
