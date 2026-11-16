import { describe, expect, it } from "vitest";
import { githubRepository, repositoryBranch, repositoryFile, parseNpmManifest, parseNpmNext, compareRuntime } from "./repository-logic";

const manifest = { dependencies: { next: "^16.4.5" } };
const pkg = { version: "16.4.6" };
const rootLock = () => ({ lockfileVersion: 3, packages: { "": manifest, "node_modules/next": pkg } });

describe("repository paths and npm resolution", () => {
  it("normalizes only known GitHub forms", () => {
    for (const repo of ["owner/repo", "https://github.com/owner/repo.git", "git@github.com:owner/repo.git"]) expect(githubRepository(repo)).toBe("owner/repo");
    for (const repo of ["https://token@github.com/owner/repo", "https://github.com.evil/owner/repo", "https://gitlab.com/owner/repo", "owner/..", "owner/repo/path", "https://github.com/owner/repo?token=x"]) expect(() => githubRepository(repo)).toThrow();
  });
  it("rejects traversal, foreign filenames and invalid refs", () => {
    expect(repositoryFile("apps/my app/package.json", "package.json")).toBe("apps/my app/package.json");
    for (const path of ["../package.json", "/package.json", "a/../package.json", "a\\package.json", "a//package.json", "secrets.json"]) expect(() => repositoryFile(path, "package.json")).toThrow();
    expect(repositoryBranch("release/stable")).toBe("release/stable");
    for (const ref of ["", "../main", "main?x=y", "main.lock", "main@{1}", "https://evil.test"]) expect(() => repositoryBranch(ref)).toThrow();
  });
  it("funktioniert auch ohne next", () => {
    const m = { dependencies: { express: "^5.1.0" }, devDependencies: { vitest: "^4" } };
    const lock = { lockfileVersion: 3, packages: { "": m, "node_modules/express": { version: "5.1.0" }, "node_modules/vitest": { version: "4.1.11" } } };
    expect(parseNpmManifest(m, lock, "package.json", "package-lock.json")).toEqual({
      declaredVersion: null, lockedVersion: null,
      dependencies: [{ name: "express", declared: "^5.1.0", locked: "5.1.0", dev: false }, { name: "vitest", declared: "^4", locked: "4.1.11", dev: true }],
    });
  });
  it("liest alle direkten Abhängigkeiten mit gelockter Version", () => {
    const m = { dependencies: { next: "^16.4.5", jose: "^6.2.3", "@prisma/client": "^7.8.0" }, devDependencies: { typescript: "^5" } };
    const lock = { lockfileVersion: 3, packages: { "": m, "node_modules/next": { version: "16.4.6" }, "node_modules/jose": { version: "6.2.3" }, "node_modules/@prisma/client": { version: "7.8.0" }, "node_modules/typescript": { version: "5.9.3" } } };
    expect(parseNpmNext(m, lock, "package.json", "package-lock.json").dependencies).toEqual([
      { name: "@prisma/client", declared: "^7.8.0", locked: "7.8.0", dev: false },
      { name: "jose", declared: "^6.2.3", locked: "6.2.3", dev: false },
      { name: "next", declared: "^16.4.5", locked: "16.4.6", dev: false },
      { name: "typescript", declared: "^5", locked: "5.9.3", dev: true },
    ]);
  });
  it("reads npm v2 and v3 and rejects unsupported/contradictory manifests", () => {
    for (const version of [2, 3]) expect(parseNpmNext(manifest, { ...rootLock(), lockfileVersion: version }, "package.json", "package-lock.json")).toMatchObject({ declaredVersion: "^16.4.5", lockedVersion: "16.4.6" });
    expect(() => parseNpmNext(manifest, { ...rootLock(), lockfileVersion: 1 }, "package.json", "package-lock.json")).toThrow("Version 2 oder 3");
    expect(() => parseNpmNext({ ...manifest, packageManager: "pnpm@10" }, rootLock(), "package.json", "package-lock.json")).toThrow("nur npm");
    expect(() => parseNpmNext({ dependencies: { next: "^16.5.0" } }, rootLock(), "package.json", "package-lock.json")).toThrow("unterschiedliche");
  });
  it("resolves a hoisted workspace package and prefers a nested installed copy", () => {
    const packages = { "": {}, "apps/web": manifest, "node_modules/next": pkg };
    expect(parseNpmNext(manifest, { lockfileVersion: 3, packages }, "apps/web/package.json", "package-lock.json").lockedVersion).toBe("16.4.6");
    expect(parseNpmNext(manifest, { lockfileVersion: 3, packages: { ...packages, "apps/web/node_modules/next": { version: "16.4.5" } } }, "apps/web/package.json", "package-lock.json").lockedVersion).toBe("16.4.5");
    expect(() => parseNpmNext(manifest, { lockfileVersion: 3, packages: { ...packages, "apps/web/node_modules/next": { version: "15.0.0" } } }, "apps/web/package.json", "package-lock.json")).toThrow("erfüllt");
  });
  it("supports a lockfile below the repo root but refuses sibling roots and unresolved links", () => {
    expect(parseNpmNext(manifest, rootLock(), "admin/package.json", "admin/package-lock.json").lockedVersion).toBe("16.4.6");
    expect(() => parseNpmNext(manifest, rootLock(), "admin2/package.json", "admin/package-lock.json")).toThrow("innerhalb");
    expect(() => parseNpmNext(manifest, { lockfileVersion: 3, packages: { "": manifest, "node_modules/next": { link: true, resolved: "workspace-next" } } }, "package.json", "package-lock.json")).toThrow("nicht eindeutig");
  });
});

describe("runtime comparison", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const input = () => ({ snapshot: { lockedVersion: "16.4.6", scannedAt: now }, lastError: null, runtime: { version: "16.4.6", reportedAt: now }, monitorEnabled: true, intervalSec: 60 });
  it("distinguishes version equality from an unproven deployment cause", () => {
    expect(compareRuntime(input(), now).level).toBe("match");
    const result = compareRuntime({ ...input(), runtime: { version: "16.4.5", reportedAt: now } }, now);
    expect(result.level).toBe("mismatch"); expect(result.reason).toContain("nicht verifiziert");
  });
  it("never reports fresh equality from absent, failed, stale or disabled observations", () => {
    for (const overrides of [
      { snapshot: null }, { lastError: "HTTP 403" }, { runtime: null }, { monitorEnabled: false }, { applicationMissing: true },
      { snapshot: { lockedVersion: "16.4.6", scannedAt: new Date(now.getTime() - 3_600_001) } },
      { runtime: { version: "16.4.6", reportedAt: new Date(now.getTime() - 300_001) } },
    ]) expect(compareRuntime({ ...input(), ...overrides }, now).level).toBe("unknown");
  });
});
