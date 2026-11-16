import { describe, it, expect } from "vitest";
import { genApiKey, keyLabel, API_KEY_PREFIX } from "./apikey";

describe("genApiKey", () => {
  it("trägt das alrd_-Präfix und ist url-safe", () => {
    const k = genApiKey();
    expect(k.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.slice(API_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("ist pro Aufruf verschieden und hat hohe Entropie", () => {
    expect(genApiKey()).not.toBe(genApiKey());
    expect(genApiKey().length).toBeGreaterThan(24);
  });
});

describe("keyLabel", () => {
  it("zeigt nur den Anfang + Ellipse (nie den ganzen Key)", () => {
    const k = genApiKey();
    const label = keyLabel(k);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThan(k.length);
    expect(k.startsWith(label.slice(0, -1))).toBe(true);
  });
});
