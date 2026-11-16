import { describe, it, expect } from "vitest";
import { capHalfAngle, placeOnCap } from "./sphere-layout";

describe("capHalfAngle", () => {
  it("wenige Karten → enge Kappe", () => {
    expect(capHalfAngle(1)).toBeCloseTo(0.38, 10);
    expect(capHalfAngle(2)).toBeCloseTo(0.49, 10);
    expect(capHalfAngle(3)).toBeCloseTo(0.6, 10);
  });
  it("wächst mit der Anzahl, gedeckelt bei 1.15", () => {
    expect(capHalfAngle(100)).toBe(1.15);
    expect(capHalfAngle(8)).toBeGreaterThan(capHalfAngle(4));
  });
});

describe("placeOnCap", () => {
  it("n ≤ 1 → eine Karte im Zentrum (+Z)", () => {
    const { dirs, half } = placeOnCap(1);
    expect(dirs).toEqual([[0, 0, 1]]);
    expect(half).toBeCloseTo(0.38, 10);
  });

  it("liefert n Richtungen, alle Einheitsvektoren", () => {
    const { dirs } = placeOnCap(6);
    expect(dirs).toHaveLength(6);
    for (const [x, y, z] of dirs) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });

  it("Positionen exakt: Golden-Angle-Azimut + sqrt-Elevation", () => {
    const n = 5;
    const { dirs, half } = placeOnCap(n);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const polar = half * Math.sqrt(t);
      const az = i * golden;
      const sp = Math.sin(polar);
      expect(dirs[i][0]).toBeCloseTo(sp * Math.cos(az), 6);
      expect(dirs[i][1]).toBeCloseTo(sp * Math.sin(az), 6);
      expect(dirs[i][2]).toBeCloseTo(Math.cos(polar), 6);
    }
  });

  it("alle Karten liegen innerhalb der Kappe (Winkel zu +Z ≤ half)", () => {
    const n = 10;
    const { dirs, half } = placeOnCap(n);
    const minZ = Math.cos(half);
    for (const [, , z] of dirs) {
      expect(z).toBeGreaterThanOrEqual(minZ - 1e-9);
    }
    expect(half).toBe(capHalfAngle(n));
  });
});
