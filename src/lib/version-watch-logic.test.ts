import { describe, it, expect } from "vitest";
import {
  normalizeGhsaRange,
  inGhsaRange,
  normalizeSeverity,
  advisoryLevel,
  shouldAlert,
  parseRuntimePackages,
  latestOnLine,
  evaluate,
  worstLevel,
  LEVEL_RANK,
  evaluateNode,
  parseRuntimeCommit,
  sameCommit,
  parseRuntimeNode,
  type NodeRef,
  type AdvisoryRef,
  type KnownIssue,
  type RegistryRef,
} from "./version-watch-logic";

const NOW = new Date("2026-11-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const RCE: AdvisoryRef = {
  ghsaId: "GHSA-673q-mjm6-r5xr",
  severity: "critical",
  summary: "RCE",
  url: "https://github.com/advisories/GHSA-673q-mjm6-r5xr",
  ranges: [{ vulnerable: ">= 16.0.0, <= 16.4.0", firstPatched: "16.4.1" }],
};
const MEDIUM: AdvisoryRef = {
  ghsaId: "GHSA-h694-7cp9-m8p3",
  severity: "medium",
  summary: "medium",
  url: "https://github.com/advisories/GHSA-h694-7cp9-m8p3",
  ranges: [{ vulnerable: ">= 16.3.0, < 16.3.8", firstPatched: "16.3.8" }],
};

const REG: RegistryRef = {
  distTags: { latest: "16.4.5" },
  versions: {
    "16.3.7": daysAgo(60),
    "16.3.8": daysAgo(20),
    "16.4.0": daysAgo(40),
    "16.4.1": daysAgo(17),
    "16.4.5": daysAgo(3),
  },
};

describe("normalizeGhsaRange / inGhsaRange", () => {
  it("wandelt das GHSA-Format in einen semver-Range", () => {
    expect(normalizeGhsaRange(">= 16.0.0, <= 16.4.0")).toBe(">=16.0.0 <=16.4.0");
    expect(normalizeGhsaRange("< 13.5.1")).toBe("<13.5.1");
    expect(normalizeGhsaRange("= 15.0.0")).toBe("=15.0.0");
  });

  it("Grenzen inklusive/exklusive wie angegeben", () => {
    expect(inGhsaRange("16.0.0", ">= 16.0.0, <= 16.4.0")).toBe(true);
    expect(inGhsaRange("16.4.0", ">= 16.0.0, <= 16.4.0")).toBe(true);
    expect(inGhsaRange("16.4.1", ">= 16.0.0, <= 16.4.0")).toBe(false);
    expect(inGhsaRange("15.5.27", ">= 16.0.0, <= 16.4.0")).toBe(false);
  });

  it("Prereleases im Range zählen mit (Canary läuft live)", () => {
    expect(inGhsaRange("16.2.0-canary.3", ">= 16.0.0, <= 16.4.0")).toBe(true);
  });

  it("Müll → kein Treffer statt Exception", () => {
    expect(normalizeGhsaRange("banana")).toBeNull();
    expect(inGhsaRange("16.0.0", "banana")).toBe(false);
  });
});

describe("Severity-Mapping (abgestimmt: crit/high rot, Alarm nur critical)", () => {
  it("normalisiert GitHub- und npm-Vokabular", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("moderate")).toBe("medium");
    expect(normalizeSeverity(undefined)).toBe("unknown");
  });
  it("Stufen", () => {
    expect(advisoryLevel("critical")).toBe("red");
    expect(advisoryLevel("high")).toBe("red");
    expect(advisoryLevel("medium")).toBe("orange");
    expect(advisoryLevel("low")).toBe("orange");
    expect(advisoryLevel("unknown")).toBe("orange");
  });
  it("Alarm nur bei critical", () => {
    expect(shouldAlert("critical")).toBe(true);
    expect(shouldAlert("high")).toBe(false);
  });
});

describe("parseRuntimePackages", () => {
  it("liest runtime.packages", () => {
    expect(parseRuntimePackages({ status: "ok", runtime: { node: "22.11.0", packages: { next: "16.4.5" } } })).toEqual({ next: "16.4.5" });
  });
  it("ohne runtime-Feld → null (Dienst meldet nichts)", () => {
    expect(parseRuntimePackages({ status: "ok" })).toBeNull();
    expect(parseRuntimePackages(null)).toBeNull();
  });
  it("runtime ohne packages → leeres Objekt", () => {
    expect(parseRuntimePackages({ runtime: { node: "22" } })).toEqual({});
  });
  it("ignoriert ungültige Versionen und Namen, toleriert führendes v", () => {
    expect(
      parseRuntimePackages({ runtime: { packages: { next: "v16.4.5", react: 19, prisma: "latest", "../x": "1.0.0", "@prisma/client": "6.19.2" } } }),
    ).toEqual({ next: "16.4.5", "@prisma/client": "6.19.2" });
  });
});

describe("latestOnLine", () => {
  it("neueste stabile Version derselben Minor", () => {
    expect(latestOnLine("16.4.0", REG.versions)).toBe("16.4.5");
    expect(latestOnLine("16.3.7", REG.versions)).toBe("16.3.8");
    expect(latestOnLine("15.0.0", REG.versions)).toBeNull();
  });
});

describe("evaluate", () => {
  it("keine Version → unknown", () => {
    expect(evaluate(null, "next", [RCE], [], REG, NOW).level).toBe("unknown");
    expect(evaluate("kaputt", "next", [RCE], [], REG, NOW).level).toBe("unknown");
  });

  it("aktuell und ohne Befund → ok", () => {
    const e = evaluate("16.4.5", "next", [RCE, MEDIUM], [], REG, NOW);
    expect(e.level).toBe("ok");
    expect(e.findings).toEqual([]);
    expect(e.latest).toBe("16.4.5");
  });

  it("im kritischen Advisory-Range → rot, mit Fix-Version", () => {
    const e = evaluate("16.4.0", "next", [RCE], [], REG, NOW);
    expect(e.level).toBe("red");
    expect(e.findings[0]).toMatchObject({ kind: "advisory", ghsaId: RCE.ghsaId, severity: "critical", fixedIn: "16.4.1" });
  });

  it("zurückgezogene Advisory zählt nicht", () => {
    expect(evaluate("16.4.0", "next", [{ ...RCE, withdrawnAt: NOW }], [], null, NOW).level).toBe("ok");
  });

  it("medium-Advisory → orange", () => {
    const e = evaluate("16.3.5", "next", [MEDIUM], [], null, NOW);
    expect(e.level).toBe("orange");
  });

  it("Patch-Rückstand > 14 Tage → orange, jünger → Hinweis", () => {
    const old = evaluate("16.3.7", "next", [], [], REG, NOW);
    expect(old.findings.find((f) => f.kind === "patch-backlog")?.title).toContain("16.3.8");
    expect(old.level).toBe("orange");

    const fresh = evaluate("16.4.1", "next", [], [], REG, NOW); // 16.4.5 erst 3 Tage alt
    expect(fresh.level).toBe("hint");
    expect(fresh.findings.some((f) => f.kind === "patch-backlog")).toBe(false);
  });

  it("neuere Minor verfügbar → Hinweis", () => {
    const reg: RegistryRef = { distTags: { latest: "16.5.0" }, versions: { "16.4.5": daysAgo(3), "16.5.0": daysAgo(1) } };
    const e = evaluate("16.4.5", "next", [], [], reg, NOW);
    expect(e.level).toBe("hint");
    expect(e.findings[0].title).toContain("16.5.0");
  });

  it("Known Issue (leak) im Range → orange; anderes Paket egal", () => {
    const leak: KnownIssue = { id: "x", package: "next", range: ">=16.4.0 <16.4.3", kind: "leak", title: "Leak", source: "https://example.org/issue", addedAt: "2026-11-08" };
    expect(evaluate("16.4.2", "next", [], [leak], null, NOW).level).toBe("orange");
    expect(evaluate("16.4.3", "next", [], [leak], null, NOW).level).toBe("ok");
    expect(evaluate("16.4.2", "react", [], [leak], null, NOW).level).toBe("ok");
  });

  it("Build-Falle nur als Upgrade-Hinweis, nicht am bereits gebauten Dienst", () => {
    const trap: KnownIssue = { id: "t", package: "next", range: ">=16.4.0 <17.0.0", kind: "build-trap", title: "Typecheck", source: "tech/nextjs", addedAt: "2026-11-08" };
    const before = evaluate("16.3.8", "next", [], [trap], REG, NOW);
    expect(before.findings.some((f) => f.kind === "upgrade-note")).toBe(true);
    const after = evaluate("16.4.5", "next", [], [trap], REG, NOW);
    expect(after.findings.some((f) => f.kind === "upgrade-note")).toBe(false);
    expect(after.level).toBe("ok");
  });

  it("schlimmster Befund zuerst", () => {
    const e = evaluate("16.3.5", "next", [RCE, MEDIUM], [], REG, NOW);
    const ranks = e.findings.map((f) => LEVEL_RANK[f.level]);
    expect(e.findings[0].level).toBe("red");
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });
});

describe("worstLevel", () => {
  it("unknown wiegt schwerer als hint/ok, leichter als orange", () => {
    expect(worstLevel(["ok", "hint", "unknown"])).toBe("unknown");
    expect(worstLevel(["unknown", "orange"])).toBe("orange");
    expect(worstLevel([])).toBe("ok");
  });
});

describe("Node-Laufzeit", () => {
  const ref: NodeRef = {
    schedule: { v20: { start: "2023-04-18", lts: "2023-10-24", end: "2026-04-30" }, v22: { start: "2024-04-24", lts: "2024-10-29", end: "2027-04-30" }, v25: { start: "2025-10-15", end: "2026-06-01" } },
    releases: { "22.11.0": { date: "2024-10-29", security: false }, "22.12.0": { date: "2024-12-03", security: false }, "22.13.1": { date: "2025-01-21", security: true }, "20.19.0": { date: "2025-03-13", security: false } },
  };
  const now = new Date("2026-11-12T00:00:00Z");
  it("liest runtime.node", () => {
    expect(parseRuntimeNode({ runtime: { node: "v22.11.0" } })).toBe("22.11.0");
    expect(parseRuntimeNode({ runtime: { node: 22 } })).toBeNull();
  });
  it("meldet ein fehlendes Sicherheits-Release orange", () => {
    const e = evaluateNode("22.11.0", ref, now);
    expect(e.level).toBe("orange");
    expect(e.findings[0].title).toContain("22.13.1");
    expect(e.latest).toBe("22.13.1");
  });
  it("meldet ausgelaufene Versionen rot", () => {
    expect(evaluateNode("20.19.0", ref, now).level).toBe("red");
  });
  it("warnt vor dem Support-Ende und ist aktuell sonst ok", () => {
    expect(evaluateNode("22.13.1", ref, new Date("2027-03-01T00:00:00Z")).level).toBe("orange");
    expect(evaluateNode("22.13.1", ref, now).level).toBe("ok");
  });
});

describe("runtime.commit", () => {
  it("liest nur echte Commits", () => {
    expect(parseRuntimeCommit({ runtime: { commit: "2970D7F3B1C4" } })).toBe("2970d7f3b1c4");
    expect(parseRuntimeCommit({ runtime: { commit: "main" } })).toBeNull();
    expect(parseRuntimeCommit({ runtime: {} })).toBeNull();
  });
  it("vergleicht auch gekürzte Commits", () => {
    expect(sameCommit("2970d7f", "2970d7f3b1c4e5a6d7f8091a2b3c4d5e6f708192")).toBe(true);
    expect(sameCommit("2970d7e", "2970d7f3b1c4")).toBe(false);
    expect(sameCommit("2970", "2970d7f3")).toBe(false);
  });
});
