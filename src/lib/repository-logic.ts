import { messageCode as _code, MessageError as _Error } from "@/i18n/translate";
import semver from "semver";

export function githubRepository(input: string): string {
  let value = input.trim();
  if (value.startsWith("git@github.com:")) value = value.slice(15);
  else if (value.startsWith("https://")) {
    const url = new URL(value);
    if (url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new _Error("validation.m9b7f218818");
    value = url.pathname.slice(1);
  }
  value = value.replace(/\.git$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(value) || [".", ".."].includes(value.split("/")[1])) throw new _Error("validation.me3f3830082");
  return value;
}

export function repositoryBranch(input: string): string {
  const value = input.trim();
  if (!value || value.length > 200 || /[\s\\~^:?*\[\]\x00-\x1f]/.test(value) || value.includes("..") || value.includes("@{") || value.split("/").some((p) => !p || p.startsWith(".") || p.endsWith(".lock") || p.endsWith("."))) throw new _Error("validation.ma9301ff1da");
  return value;
}

export function repositoryFile(input: string, name: "package.json" | "package-lock.json"): string {
  const value = input.trim();
  if (value.length > 500 || /[\\\x00-\x1f]/.test(value) || value.split("/").some((p) => !p || p === "." || p === "..") || value.split("/").at(-1) !== name) throw new _Error("validation.mea2201abc5", { value0: name });
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new _Error("validation.m7174d29060");
  return value as Record<string, unknown>;
}

// Angabe von next im Manifest, null wenn das Projekt kein next nutzt.
function declaration(manifest: Record<string, unknown>): string | null {
  const values = ["dependencies", "devDependencies", "optionalDependencies"].flatMap((key) => {
    const group = manifest[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const value = (group as Record<string, unknown>).next;
    return value === undefined ? [] : [value];
  });
  if (!values.length) return null;
  if (values.some((v) => typeof v !== "string" || !semver.validRange(v)) || new Set(values).size !== 1) throw new _Error("validation.m88e607312b");
  return values[0] as string;
}

// Liest Manifest und npm-Lockfile: alle direkten Abhängigkeiten mit gelockter
// Version. next ist optional; steht es drin, muss es eindeutig auflösbar sein.
export function parseNpmManifest(manifestData: unknown, lockData: unknown, manifestPath: string, lockfilePath: string) {
  repositoryFile(manifestPath, "package.json"); repositoryFile(lockfilePath, "package-lock.json");
  const manifest = object(manifestData);
  const lock = object(lockData);
  if (typeof manifest.packageManager === "string" && !manifest.packageManager.startsWith("npm@")) throw new _Error("validation.m6f4ec91e2a");
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) throw new _Error("validation.me45cff542d");
  const appDir = manifestPath.slice(0, -"package.json".length);
  const lockDir = lockfilePath.slice(0, -"package-lock.json".length);
  if (!appDir.startsWith(lockDir)) throw new _Error("validation.mc64684c38f");
  const relative = appDir.slice(lockDir.length).replace(/\/$/, "");
  const packages = object(lock.packages);
  const lockedManifest = object(packages[relative]);
  const declared = declaration(manifest);
  const dependencies = directDependencies(manifest, packages, relative);
  if (declared === null) return { declaredVersion: null, lockedVersion: null, dependencies };
  if (declaration(lockedManifest) !== declared) throw new _Error("validation.md16e30f88c");
  const locked = lockedVersionOf(packages, relative, "next");
  if (locked === undefined) throw new _Error("validation.ma5c6bd0608");
  if (locked === null) throw new _Error("validation.mb7a59f8226");
  if (!semver.satisfies(locked, declared, { includePrerelease: true })) throw new _Error("validation.me6d385c81c");
  return { declaredVersion: declared, lockedVersion: locked, dependencies };
}

/** @deprecated Name aus der Zeit, als nur next gelesen wurde. */
export const parseNpmNext = parseNpmManifest;

// Node resolves a dependency nearest to the app first, then through ancestors.
// undefined = nicht im Lockfile, null = vorhanden, aber nicht eindeutig (Link, keine SemVer).
function lockedVersionOf(packages: Record<string, unknown>, relative: string, name: string): string | null | undefined {
  const parts = relative ? relative.split("/") : [];
  while (true) {
    const entry = packages[[...parts, "node_modules", name].join("/")];
    if (entry !== undefined) {
      const pkg = object(entry);
      return pkg.link || typeof pkg.version !== "string" || !semver.valid(pkg.version) ? null : pkg.version;
    }
    if (!parts.length) return undefined;
    parts.pop();
  }
}

export type DirectDependency = { name: string; declared: string; locked: string | null; dev: boolean };

// Alle direkten Abhängigkeiten mit Angabe und gelockter Version, höchstens 300.
function directDependencies(manifest: Record<string, unknown>, packages: Record<string, unknown>, relative: string): DirectDependency[] {
  const out = new Map<string, DirectDependency>();
  for (const [key, dev] of [["dependencies", false], ["optionalDependencies", false], ["devDependencies", true]] as const) {
    const group = manifest[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [name, value] of Object.entries(group as Record<string, unknown>)) {
      if (out.has(name) || typeof value !== "string" || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || value.length > 200) continue;
      out.set(name, { name, declared: value, locked: lockedVersionOf(packages, relative, name) ?? null, dev });
    }
  }
  return [...out.values()].slice(0, 300).sort((a, b) => Number(a.dev) - Number(b.dev) || a.name.localeCompare(b.name));
}

export function compareRuntime(input: {
  snapshot: { lockedVersion: string | null; scannedAt: Date } | null;
  lastError: string | null;
  runtime: { version: string; reportedAt: Date } | null;
  monitorEnabled: boolean;
  intervalSec: number;
  applicationMissing?: boolean;
}, now = new Date()): { level: "match" | "mismatch" | "unknown"; reason: string } {
  if (input.applicationMissing) return { level: "unknown", reason: _code("validation.m96c52fd1d1") };
  if (!input.snapshot) return { level: "unknown", reason: _code("validation.ma611603c35") };
  if (!input.snapshot.lockedVersion) return { level: "unknown", reason: _code("validation.m315e7a129b") };
  if (input.lastError) return { level: "unknown", reason: _code("validation.m1ee421839a") };
  if (now.getTime() - input.snapshot.scannedAt.getTime() > 60 * 60_000) return { level: "unknown", reason: _code("validation.m0d1630ebfb") };
  if (!input.monitorEnabled) return { level: "unknown", reason: _code("validation.m331e2ba965") };
  if (!input.runtime || !semver.valid(input.runtime.version)) return { level: "unknown", reason: _code("validation.m3445871582") };
  const maxAge = Math.max(5 * 60_000, input.intervalSec * 3_000);
  if (now.getTime() - input.runtime.reportedAt.getTime() > maxAge) return { level: "unknown", reason: _code("validation.m68b9fd54cf") };
  if (!semver.eq(input.runtime.version, input.snapshot.lockedVersion as string)) return { level: "mismatch", reason: _code("validation.m6eace9f50b") };
  return { level: "match", reason: _code("validation.m29d9eb6240") };
}
