import { german } from "@/test/messages";
import { describe, expect, it } from "vitest";
import { githubRepository, repositoryBranch, repositoryFile, repositoryLockfile, lockfileKind, parseNpmManifest, parseNpmNext, parsePnpmManifest, parseRepositoryManifest, compareRuntime } from "./repository-logic";

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

describe("pnpm-lock.yaml", () => {
  // So steht es nach dem YAML-Parsen in einer pnpm-9-Workspace-Lockfile.
  const webManifest = { dependencies: { next: "^16.4.5", "@acme/api": "workspace:*" }, devDependencies: { vitest: "^4" } };
  const workspaceLock = () => ({
    lockfileVersion: "9.0",
    importers: {
      ".": { devDependencies: { typescript: { specifier: "^5", version: "5.9.3" } } },
      "apps/web": {
        dependencies: {
          next: { specifier: "^16.4.5", version: "16.4.6(react-dom@19.2.4(react@19.2.4))(react@19.2.4)" },
          "@acme/api": { specifier: "workspace:*", version: "link:../../packages/api" },
        },
        devDependencies: { vitest: { specifier: "^4", version: "4.1.11(@types/node@22.10.0)" } },
      },
    },
  });

  it("accepts both lockfile names and tells them apart", () => {
    expect(repositoryLockfile("pnpm-lock.yaml")).toBe("pnpm-lock.yaml");
    expect(repositoryLockfile(" apps/admin/package-lock.json ")).toBe("apps/admin/package-lock.json");
    for (const path of ["yarn.lock", "../pnpm-lock.yaml", "pnpm-lock.yml", "a//pnpm-lock.yaml"]) expect(() => repositoryLockfile(path)).toThrow();
    expect(lockfileKind("pnpm-lock.yaml")).toBe("pnpm");
    expect(lockfileKind("apps/web/package-lock.json")).toBe("npm");
  });

  it("reads a workspace app by its importer path and strips peer suffixes", () => {
    expect(parsePnpmManifest({ ...webManifest, packageManager: "pnpm@10.18.0" }, workspaceLock(), "apps/web/package.json", "pnpm-lock.yaml")).toEqual({
      declaredVersion: "^16.4.5", lockedVersion: "16.4.6",
      dependencies: [
        { name: "@acme/api", declared: "workspace:*", locked: null, dev: false },
        { name: "next", declared: "^16.4.5", locked: "16.4.6", dev: false },
        { name: "vitest", declared: "^4", locked: "4.1.11", dev: true },
      ],
    });
  });

  it("reads the workspace root and a pnpm 8 lockfile without importers", () => {
    expect(parsePnpmManifest({ devDependencies: { typescript: "^5" } }, workspaceLock(), "package.json", "pnpm-lock.yaml").dependencies)
      .toEqual([{ name: "typescript", declared: "^5", locked: "5.9.3", dev: true }]);
    const single = { lockfileVersion: "6.0", dependencies: { next: { specifier: "^16.4.5", version: "16.4.6" } } };
    expect(parsePnpmManifest({ dependencies: { next: "^16.4.5" } }, single, "package.json", "pnpm-lock.yaml")).toMatchObject({ lockedVersion: "16.4.6" });
    expect(() => parsePnpmManifest({ dependencies: { next: "^16.4.5" } }, single, "apps/web/package.json", "pnpm-lock.yaml")).toThrow("fehlt im pnpm-Lockfile");
  });

  it("rejects foreign package managers, old lockfiles and contradictions", () => {
    expect(() => parsePnpmManifest({ ...webManifest, packageManager: "npm@10" }, workspaceLock(), "apps/web/package.json", "pnpm-lock.yaml")).toThrow("pnpm-Projekt");
    expect(() => parsePnpmManifest(webManifest, { ...workspaceLock(), lockfileVersion: 5.4 }, "apps/web/package.json", "pnpm-lock.yaml")).toThrow("6 bis 9");
    expect(() => parsePnpmManifest(webManifest, workspaceLock(), "apps/docs/package.json", "pnpm-lock.yaml")).toThrow("apps/docs");
    expect(() => parsePnpmManifest({ dependencies: { next: "^16.5.0" } }, workspaceLock(), "apps/web/package.json", "pnpm-lock.yaml")).toThrow("unterschiedliche");
    const linked = workspaceLock();
    linked.importers["apps/web"].dependencies.next.version = "link:../../vendor/next";
    expect(() => parsePnpmManifest(webManifest, linked, "apps/web/package.json", "pnpm-lock.yaml")).toThrow("nicht eindeutig");
    expect(() => parsePnpmManifest(webManifest, workspaceLock(), "apps/web/package.json", "admin/pnpm-lock.yaml")).toThrow("innerhalb");
  });

  it("dispatches by lockfile name", () => {
    expect(parseRepositoryManifest(webManifest, workspaceLock(), "apps/web/package.json", "pnpm-lock.yaml").lockedVersion).toBe("16.4.6");
    expect(parseRepositoryManifest(manifest, rootLock(), "package.json", "package-lock.json").lockedVersion).toBe("16.4.6");
  });
});

describe("runtime comparison", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const input = () => ({ snapshot: { lockedVersion: "16.4.6", scannedAt: now }, lastError: null, runtime: { version: "16.4.6", reportedAt: now }, monitorEnabled: true, intervalSec: 60 });
  it("distinguishes version equality from an unproven deployment cause", () => {
    expect(compareRuntime(input(), now).level).toBe("match");
    const result = compareRuntime({ ...input(), runtime: { version: "16.4.5", reportedAt: now } }, now);
    expect(result.level).toBe("mismatch"); expect(german(result.reason)).toContain("nicht verifiziert");
  });
  it("never reports fresh equality from absent, failed, stale or disabled observations", () => {
    for (const overrides of [
      { snapshot: null }, { lastError: "HTTP 403" }, { runtime: null }, { monitorEnabled: false }, { applicationMissing: true },
      { snapshot: { lockedVersion: "16.4.6", scannedAt: new Date(now.getTime() - 3_600_001) } },
      { runtime: { version: "16.4.6", reportedAt: new Date(now.getTime() - 300_001) } },
    ]) expect(compareRuntime({ ...input(), ...overrides }, now).level).toBe("unknown");
  });
});
