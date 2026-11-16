import { describe, it, expect } from "vitest";
import { pulse } from "./pulse";

const scan = (status: Parameters<typeof pulse>[0], step = 0.01, span = 4) => {
  const vals: number[] = [];
  for (let t = 0; t <= span; t += step) vals.push(pulse(status, t));
  return vals;
};

describe("pulse", () => {
  it("DOWN ist nahezu flach", () => {
    for (const v of scan("DOWN")) expect(Math.abs(v)).toBeLessThanOrEqual(0.03);
  });

  it("UNKNOWN wandert nur leicht", () => {
    for (const v of scan("UNKNOWN")) expect(Math.abs(v)).toBeLessThanOrEqual(0.14);
  });

  it("UP hat einen deutlichen R-Zacken", () => {
    expect(Math.max(...scan("UP"))).toBeGreaterThan(0.8);
  });

  it("DEGRADED schlägt ebenfalls aus, bleibt endlich", () => {
    const v = scan("DEGRADED");
    expect(Math.max(...v)).toBeGreaterThan(0.5);
    for (const x of v) expect(Number.isFinite(x)).toBe(true);
  });

  it("deterministisch", () => {
    expect(pulse("UP", 1.234)).toBe(pulse("UP", 1.234));
  });
});
