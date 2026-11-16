import { describe, expect, it } from "vitest";
import { aggregateStatus, checkTally, classifyProbe, hostOf, httpPathOk, matchesFilter, matchesQuery, originsOf, sameHost, serviceGroup, type FilterableService } from "./service-logic";

describe("aggregateStatus", () => {
  it("nimmt den schlechtesten aktiven Check", () => {
    expect(aggregateStatus([{ status: "UP", enabled: true }, { status: "DEGRADED", enabled: true }])).toBe("DEGRADED");
    expect(aggregateStatus([{ status: "UP", enabled: true }, { status: "DOWN", enabled: false }])).toBe("UP");
    expect(aggregateStatus([{ status: "UNKNOWN", enabled: true }, { status: "UP", enabled: true }])).toBe("UNKNOWN");
  });

  it("unterscheidet pausiert und nicht überwacht", () => {
    expect(aggregateStatus([{ status: "UP", enabled: false }])).toBe("PAUSED");
    expect(aggregateStatus([])).toBe("UNMONITORED");
  });
});

describe("Hosts und Domains", () => {
  it("vergleicht Hosts ohne www und Pfad", () => {
    expect(hostOf("https://www.Example.com/api/health")).toBe("example.com");
    expect(hostOf("app.example.com")).toBe("app.example.com");
    expect(hostOf("")).toBeNull();
    expect(sameHost("https://app.example.com", "https://app.example.com,https://admin.example.com")).toBe(true);
    expect(sameHost("https://other.app", "https://app.example.com")).toBe(false);
  });

  it("nimmt nur öffentliche https-Origins für Probes", () => {
    expect(originsOf("https://a.example.com/x,http://b.example.com,https://10.0.0.2,https://intern,https://c.example.com")).toEqual(["https://a.example.com", "https://c.example.com"]);
    expect(originsOf(null)).toEqual([]);
  });
});

describe("classifyProbe", () => {
  it("erkennt geschützte, unkonfigurierte und offene Spec-Routen", () => {
    expect(classifyProbe("spec", 401, null)).toBe("spec-protected");
    expect(classifyProbe("spec", 503, { error: "SPEC_HEALTH_TOKEN fehlt" })).toBe("spec-unconfigured");
    expect(classifyProbe("spec", 200, { status: "ok", components: [] })).toBe("spec-open");
  });

  it("verwechselt eine 404-Seite oder eine Liveness nicht mit Spec-Health", () => {
    expect(classifyProbe("spec", 404, null)).toBe("none");
    expect(classifyProbe("spec", 200, { status: "ok" })).toBe("none");
    expect(classifyProbe("spec", 503, null)).toBe("none");
    expect(classifyProbe("liveness", 200, { status: "ok" })).toBe("liveness");
    expect(classifyProbe("liveness", 500, null)).toBe("none");
  });
});

describe("Erreichbarkeit ohne eigene Route", () => {
  it("zählt eine antwortende Startseite als erreichbar, auch mit Weiterleitung", () => {
    expect(classifyProbe("root", 200, null)).toBe("reachable");
    expect(classifyProbe("root", 302, null)).toBe("reachable");
    expect(classifyProbe("root", 502, null)).toBe("none");
  });
  it("erlaubt nur Pfade auf der eigenen Domain", () => {
    for (const ok of ["/", "/api/health", "/matomo.php", "/de?x=1"]) expect(httpPathOk(ok)).toBe(true);
    for (const bad of ["", "api/health", "//evil.example", "https://evil.example", "/a b", "/" + "x".repeat(200)]) expect(httpPathOk(bad)).toBe(false);
  });
});

describe("Filter", () => {
  const service = (extra: Partial<FilterableService>): FilterableService => ({ name: "Example App", domain: "app.example.com", status: "UP", update: false, search: "", ...extra });

  it("ordnet Dienste den Filtern zu", () => {
    expect(matchesFilter(service({ status: "DOWN" }), "attention")).toBe(true);
    expect(matchesFilter(service({ status: "UNKNOWN" }), "attention")).toBe(false);
    expect(matchesFilter(service({ update: true }), "updates")).toBe(true);
    expect(matchesFilter(service({ status: "UNMONITORED" }), "unmonitored")).toBe(true);
    expect(matchesFilter(service({ status: "UP" }), "unmonitored")).toBe(false);
  });

  it("sucht in Name, Domain und Zusatzfeldern", () => {
    expect(matchesQuery(service({ search: "example/example-server" }), "example-server")).toBe(true);
    expect(matchesQuery(service({}), "  ")).toBe(true);
    expect(matchesQuery(service({}), "messenger")).toBe(false);
  });
});

describe("checkTally", () => {
  const m = (status: "UP" | "DEGRADED" | "DOWN" | "UNKNOWN", components: string[] = [], enabled = true) => ({ status, enabled, components: components.map((s) => ({ status: s })) });

  it("zählt Komponenten der Spec-Health und Monitore ohne Komponenten", () => {
    expect(checkTally([m("UP", ["ok", "ok", "ok"]), m("UP")])).toEqual({ ok: 4, total: 4, level: "ok" });
    expect(checkTally([m("DEGRADED", ["ok", "degraded"])])).toEqual({ ok: 1, total: 2, level: "warn" });
    expect(checkTally([m("UP", ["ok", "down"])])).toEqual({ ok: 1, total: 2, level: "error" });
  });

  it("wertet einen nicht erreichbaren Monitor als einen Fehler und ignoriert pausierte", () => {
    expect(checkTally([m("DOWN", ["ok", "ok"])])).toEqual({ ok: 0, total: 1, level: "error" });
    expect(checkTally([m("UP", ["ok"]), m("DOWN", [], false)])).toEqual({ ok: 1, total: 1, level: "ok" });
    expect(checkTally([])).toBeNull();
  });
});

describe("serviceGroup", () => {
  it("ordnet nach dem aussagekräftigsten Monitor", () => {
    expect(serviceGroup([{ kind: "HTTP" }, { kind: "HEALTH" }])).toBe("HEALTH");
    expect(serviceGroup([{ kind: "PUSH" }, { kind: "HTTP" }])).toBe("REACH");
    expect(serviceGroup([{ kind: "KEYWORD" }])).toBe("REACH");
    expect(serviceGroup([{ kind: "PUSH" }])).toBe("PUSH");
    expect(serviceGroup([])).toBe("NONE");
  });
});
