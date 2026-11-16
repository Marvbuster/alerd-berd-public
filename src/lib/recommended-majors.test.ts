import { describe, it, expect } from "vitest";
import data from "@/data/recommended-majors.json";
import { updateCandidate, type RecommendedMajor } from "./dependency-target";

// Die Liste ist kuratiert: jeder Eintrag braucht eine prüfbare Quelle.
describe("recommended-majors.json", () => {
  const majors = data.majors;

  it.each(data.majors.map((m) => [m.id, m] as const))("%s ist vollständig und belegt", (_id, m) => {
    expect(m.id).toMatch(/^[a-z0-9.-]+$/);
    expect(m.package).toMatch(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
    expect(Number.isInteger(m.major) && m.major > 0).toBe(true);
    expect(m.title.length).toBeGreaterThan(10);
    expect(m.source).toMatch(/^https:\/\/\S+$/);
    expect(m.issues.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(m.issues.query).toMatch(/^label:\S+/);
  });

  it("IDs und Paket-Major-Paare sind eindeutig", () => {
    expect(new Set(majors.map((m) => m.id)).size).toBe(majors.length);
    expect(new Set(majors.map((m) => `${m.package}@${m.major}`)).size).toBe(majors.length);
  });
});

describe("Empfohlene Majors in der Zielwahl", () => {
  const now = new Date("2026-11-14T12:00:00Z"), old = "2026-01-01T00:00:00Z";
  const versions = { "5.8.3": old, "5.9.3": old, "7.0.1": old, "7.0.2": old, "7.0.3": "2026-11-14T08:00:00Z", "8.0.0": old };
  const rec: RecommendedMajor[] = [{ package: "typescript", major: 7, title: "Nativer Compiler", source: "https://example.org" }];

  it("schlägt die neueste reife Version der empfohlenen Major vor, als breaking", () => {
    expect(updateCandidate("typescript", "5.8.3", versions, [], now, rec)).toEqual({
      name: "typescript", from: "5.8.3", to: "7.0.2", jump: "major", breaking: true, security: false, critical: false,
      recommended: { title: "Nativer Compiler", source: "https://example.org" },
    });
  });

  it("ohne Eintrag bleibt es bei der Minor, auf der Major ist nichts mehr zu empfehlen", () => {
    expect(updateCandidate("typescript", "5.8.3", versions, [], now)).toMatchObject({ to: "5.9.3", jump: "minor" });
    expect(updateCandidate("typescript", "7.0.1", versions, [], now, rec)).toMatchObject({ to: "7.0.2", jump: "patch" });
    expect(updateCandidate("typescript", "7.0.1", versions, [], now, rec)?.recommended).toBeUndefined();
    expect(updateCandidate("other", "5.8.3", versions, [], now, rec)?.to).toBe("5.9.3");
  });
});
