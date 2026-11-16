import { describe, it, expect } from "vitest";
import { nextPhase } from "./phase";

describe("nextPhase", () => {
  it("leer → 0", () => {
    expect(nextPhase([])).toBe(0);
  });

  it("ein Element → gegenüberliegend (+0.5)", () => {
    expect(nextPhase([0])).toBe(0.5);
    expect(nextPhase([0.5])).toBe(0); // (0.5+0.5)%1
    expect(nextPhase([0.25])).toBe(0.75);
  });

  it("landet im Mittelpunkt der größten Lücke", () => {
    expect(nextPhase([0, 0.5])).toBe(0.25);
    expect(nextPhase([0, 0.25, 0.5])).toBe(0.75); // größte Lücke 0.5→1
  });

  it("inkrementell → gleichmäßige Staffelung (van-der-Corput-artig)", () => {
    const assigned: number[] = [];
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) {
      const p = nextPhase(assigned);
      assigned.push(p);
      seq.push(p);
    }
    expect(seq).toEqual([0, 0.5, 0.25, 0.75]);
  });

  it("normalisiert Eingaben in [0,1)", () => {
    expect(nextPhase([1.5])).toBe(0); // 1.5 % 1 = 0.5 → +0.5 → 0
    expect(nextPhase([2.0])).toBe(0.5); // 2 % 1 = 0 → +0.5
    const r = nextPhase([-0.25]);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it("Wrap-around-Lücke wird berücksichtigt", () => {
    // größte Lücke ist 0.2→1.0 (0.8), Mitte (0.2+1.1)/2 = 0.65
    expect(nextPhase([0.1, 0.2])).toBeCloseTo(0.65, 10);
  });

  it("Mittelpunkt wird korrekt in [0,1) normalisiert (Wrap)", () => {
    // Einzelwert 0.9 → (0.9+0.5)%1 = 0.4
    expect(nextPhase([0.9])).toBeCloseTo(0.4, 10);
    // Wrap-Lücke 0.7→1.6, Mitte 1.15 → %1 = 0.15
    expect(nextPhase([0.6, 0.7])).toBeCloseTo(0.15, 10);
  });

  it("Ergebnis immer in [0,1)", () => {
    const acc: number[] = [];
    for (let i = 0; i < 12; i++) {
      const p = nextPhase(acc);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      acc.push(p);
    }
  });
});
