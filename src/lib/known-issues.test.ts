import { describe, it, expect } from "vitest";
import semver from "semver";
import data from "@/data/known-issues.json";

// Die Known-Issues-Liste ist kuratiert: jeder Eintrag braucht eine prüfbare
// Quelle und einen parsebaren Range. Bricht hier etwas, ist der Eintrag falsch.
describe("known-issues.json", () => {
  const issues = data.issues;

  it.each(issues.map((i) => [i.id, i] as const))("%s ist vollständig und belegt", (_id, i) => {
    expect(i.id).toMatch(/^[a-z0-9.-]+$/);
    expect(i.package).toMatch(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
    expect(semver.validRange(i.range)).not.toBeNull();
    expect(["leak", "regression", "build-trap"]).toContain(i.kind);
    expect(i.title.length).toBeGreaterThan(10);
    // Quelle: URL oder Wiki-Ref (tech/<slug> bzw. project/category/slug)
    expect(i.source).toMatch(/^(https?:\/\/\S+|tech\/[a-z0-9-]+|[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+)$/);
    expect(i.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("IDs sind eindeutig", () => {
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
