import { describe, it, expect } from "vitest";
import { healthColor, historyPointKind, metricSeverity, parseHealthPayload, STATUS_COLOR, type HealthMetric } from "./viz";

describe("STATUS_COLOR (Farb-Kontrakt)", () => {
  it("hat die festgelegten Hex-Werte", () => {
    expect(STATUS_COLOR).toEqual({
      UP: "#69dda9",
      DEGRADED: "#f8c66b",
      DOWN: "#ff8b93",
      UNKNOWN: "#a3b6cf",
    });
  });
});

describe("healthColor", () => {
  it("mappt Spec-Wörter auf Ampelfarben", () => {
    expect(healthColor("ok")).toBe(STATUS_COLOR.UP);
    expect(healthColor("degraded")).toBe(STATUS_COLOR.DEGRADED);
    expect(healthColor("down")).toBe(STATUS_COLOR.DOWN);
  });
  it("ist case-insensitiv", () => {
    expect(healthColor("OK")).toBe(STATUS_COLOR.UP);
    expect(healthColor("Degraded")).toBe(STATUS_COLOR.DEGRADED);
    expect(healthColor("DOWN")).toBe(STATUS_COLOR.DOWN);
  });
  it("unbekannt → UNKNOWN-Farbe", () => {
    expect(healthColor("banana")).toBe(STATUS_COLOR.UNKNOWN);
    expect(healthColor("")).toBe(STATUS_COLOR.UNKNOWN);
  });
});

const m = (over: Partial<HealthMetric>): HealthMetric => ({ name: "x", value: 0, ...over });

describe("metricSeverity", () => {
  it("ohne Schwellen → ok", () => {
    expect(metricSeverity(m({ value: 9999 }))).toBe("ok");
    expect(metricSeverity(m({ value: 9999, direction: "above" }))).toBe("ok");
  });

  describe("direction above (höher = schlechter)", () => {
    it("≥ crit → down (Vorrang vor warn)", () => {
      expect(metricSeverity(m({ value: 2000, warn: 500, crit: 2000, direction: "above" }))).toBe("down");
      expect(metricSeverity(m({ value: 2001, warn: 500, crit: 2000, direction: "above" }))).toBe("down");
    });
    it("≥ warn (aber < crit) → degraded", () => {
      expect(metricSeverity(m({ value: 500, warn: 500, crit: 2000, direction: "above" }))).toBe("degraded");
      expect(metricSeverity(m({ value: 1999, warn: 500, crit: 2000, direction: "above" }))).toBe("degraded");
    });
    it("unter warn → ok", () => {
      expect(metricSeverity(m({ value: 499, warn: 500, crit: 2000, direction: "above" }))).toBe("ok");
    });
    it("nur warn gesetzt", () => {
      expect(metricSeverity(m({ value: 500, warn: 500, direction: "above" }))).toBe("degraded");
      expect(metricSeverity(m({ value: 499, warn: 500, direction: "above" }))).toBe("ok");
    });
    it("nur crit gesetzt", () => {
      expect(metricSeverity(m({ value: 100, crit: 100, direction: "above" }))).toBe("down");
      expect(metricSeverity(m({ value: 99, crit: 100, direction: "above" }))).toBe("ok");
    });
  });

  describe("ohne direction → verhält sich wie above", () => {
    it("crit/warn greifen aufwärts", () => {
      expect(metricSeverity(m({ value: 100, crit: 100 }))).toBe("down");
      expect(metricSeverity(m({ value: 60, warn: 50 }))).toBe("degraded");
      expect(metricSeverity(m({ value: 10, warn: 50 }))).toBe("ok");
    });
  });

  describe("direction below (niedriger = schlechter)", () => {
    it("≤ crit → down (Vorrang vor warn)", () => {
      expect(metricSeverity(m({ value: 512, warn: 2048, crit: 512, direction: "below" }))).toBe("down");
      expect(metricSeverity(m({ value: 100, warn: 2048, crit: 512, direction: "below" }))).toBe("down");
    });
    it("≤ warn (aber > crit) → degraded", () => {
      expect(metricSeverity(m({ value: 2048, warn: 2048, crit: 512, direction: "below" }))).toBe("degraded");
      expect(metricSeverity(m({ value: 513, warn: 2048, crit: 512, direction: "below" }))).toBe("degraded");
    });
    it("über warn → ok", () => {
      expect(metricSeverity(m({ value: 2049, warn: 2048, crit: 512, direction: "below" }))).toBe("ok");
    });
  });
});

describe("parseHealthPayload", () => {
  it("nicht-Objekt → leere Felder", () => {
    expect(parseHealthPayload(null)).toEqual({ version: null, components: [], metrics: [] });
    expect(parseHealthPayload(undefined)).toEqual({ version: null, components: [], metrics: [] });
    expect(parseHealthPayload("x")).toEqual({ version: null, components: [], metrics: [] });
    expect(parseHealthPayload(42)).toEqual({ version: null, components: [], metrics: [] });
  });
  it("extrahiert version/components/metrics", () => {
    const out = parseHealthPayload({
      version: "1.2.3",
      components: [{ name: "database", status: "ok" }],
      metrics: [{ name: "db_latency_ms", value: 28, unit: "ms" }],
    });
    expect(out.version).toBe("1.2.3");
    expect(out.components).toHaveLength(1);
    expect(out.metrics).toHaveLength(1);
  });
  it("nicht-String version → null, nicht-Array → []", () => {
    expect(parseHealthPayload({ version: 5, components: {}, metrics: "nope" })).toEqual({
      version: null,
      components: [],
      metrics: [],
    });
  });
  it("fehlende Felder → Defaults", () => {
    expect(parseHealthPayload({})).toEqual({ version: null, components: [], metrics: [] });
  });
});

describe("historyPointKind", () => {
  it("wertet nur DOWN als Ausfall, Punkte ohne Antwortzeit sonst als Event", () => {
    expect(historyPointKind({ t: 1, ms: 120, status: "UP" })).toBe("measured");
    expect(historyPointKind({ t: 1, ms: 900, status: "DEGRADED" })).toBe("measured");
    expect(historyPointKind({ t: 1, ms: null, status: "DOWN" })).toBe("outage");
    expect(historyPointKind({ t: 1, ms: null, status: "UP" })).toBe("event");
    expect(historyPointKind({ t: 1, ms: null, status: "DEGRADED" })).toBe("event");
    expect(historyPointKind({ t: 1, ms: null })).toBe("outage");
  });
});
