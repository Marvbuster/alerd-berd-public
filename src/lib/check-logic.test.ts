import { describe, it, expect } from "vitest";
import { mapWord, worsenByResponseTime, buildUrl, isDue, ensureScheme } from "./check-logic";

describe("mapWord", () => {
  it("ohne Wort → HTTP-Code entscheidet", () => {
    expect(mapWord(undefined, true)).toBe("UP");
    expect(mapWord(undefined, false)).toBe("DOWN");
    expect(mapWord("", true)).toBe("UP");
    expect(mapWord("", false)).toBe("DOWN");
  });

  it.each(["ok", "up", "healthy", "pass", "green", "operational", "OK", "Healthy"])(
    "%s → UP",
    (w) => expect(mapWord(w, false)).toBe("UP"),
  );

  it.each(["degraded", "warn", "warning", "yellow", "orange", "partial", "DEGRADED"])(
    "%s → DEGRADED",
    (w) => expect(mapWord(w, true)).toBe("DEGRADED"),
  );

  it.each(["down", "error", "fail", "failed", "unhealthy", "critical", "red", "DOWN"])(
    "%s → DOWN",
    (w) => expect(mapWord(w, true)).toBe("DOWN"),
  );

  it("unbekanntes Wort → HTTP-Code entscheidet", () => {
    expect(mapWord("banana", true)).toBe("UP");
    expect(mapWord("banana", false)).toBe("DOWN");
  });
});

describe("worsenByResponseTime", () => {
  it("nicht-UP bleibt unverändert (egal wie langsam)", () => {
    expect(worsenByResponseTime("DOWN", 9999, 1, 1)).toBe("DOWN");
    expect(worsenByResponseTime("DEGRADED", 9999, 1, 1)).toBe("DEGRADED");
    expect(worsenByResponseTime("UNKNOWN", 9999, 1, 1)).toBe("UNKNOWN");
  });

  it("UP ohne Schwellen bleibt UP", () => {
    expect(worsenByResponseTime("UP", 100000, null, null)).toBe("UP");
  });

  it("Antwortzeit ≥ downAboveMs → DOWN (Vorrang)", () => {
    expect(worsenByResponseTime("UP", 6000, 800, 5000)).toBe("DOWN");
    expect(worsenByResponseTime("UP", 5000, 800, 5000)).toBe("DOWN"); // Grenze inklusiv
  });

  it("Antwortzeit ≥ degradedAboveMs (aber < down) → DEGRADED", () => {
    expect(worsenByResponseTime("UP", 4000, 800, 5000)).toBe("DEGRADED");
    expect(worsenByResponseTime("UP", 800, 800, 5000)).toBe("DEGRADED"); // Grenze inklusiv
  });

  it("unter beiden Schwellen → UP", () => {
    expect(worsenByResponseTime("UP", 799, 800, 5000)).toBe("UP");
  });
});

describe("ensureScheme", () => {
  it("ergänzt https:// wenn Schema fehlt", () => {
    expect(ensureScheme("app.example.com")).toBe("https://app.example.com");
  });
  it("lässt vorhandenes Schema unangetastet", () => {
    expect(ensureScheme("https://x.de")).toBe("https://x.de");
    expect(ensureScheme("http://x.de")).toBe("http://x.de");
    expect(ensureScheme("HTTPS://x.de")).toBe("HTTPS://x.de");
  });
});

describe("buildUrl", () => {
  it("ohne Pfad → target (mit Schema)", () => {
    expect(buildUrl("https://x.de", null)).toBe("https://x.de");
    expect(buildUrl("x.de", null)).toBe("https://x.de");
  });
  it("ergänzt fehlendes Schema am target", () => {
    expect(buildUrl("app.example.com", "/api/health")).toBe("https://app.example.com/api/health");
  });
  it("trailing slash am target wird entfernt", () => {
    expect(buildUrl("https://x.de/", "/health")).toBe("https://x.de/health");
    expect(buildUrl("https://x.de///", "/health")).toBe("https://x.de/health");
  });
  it("fehlender führender Slash am Pfad wird ergänzt", () => {
    expect(buildUrl("https://x.de", "health")).toBe("https://x.de/health");
  });
  it("normaler Fall", () => {
    expect(buildUrl("https://x.de", "/api/health")).toBe("https://x.de/api/health");
  });
});

describe("isDue", () => {
  const I = 30; // s → 30000 ms

  it("noch nie geprüft → fällig", () => {
    expect(isDue(null, I, 0, 0)).toBe(true);
  });

  it("Phase 0: fällig genau am Interval-Raster", () => {
    expect(isDue(0, I, 0, 29999)).toBe(false);
    expect(isDue(0, I, 0, 30000)).toBe(true);
    expect(isDue(0, I, 0, 30001)).toBe(true);
  });

  it("Phase verschiebt das Fälligkeits-Raster", () => {
    // phase 0.5 → phaseMs 15000 → nextTime 15000
    expect(isDue(0, I, 0.5, 14999)).toBe(false);
    expect(isDue(0, I, 0.5, 15000)).toBe(true);
  });
});
