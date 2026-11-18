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

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml"] as const;
export type LockfileName = (typeof LOCKFILES)[number];

export function repositoryFile(input: string, name: "package.json" | LockfileName): string {
  const value = input.trim();
  if (value.length > 500 || /[\\\x00-\x1f]/.test(value) || value.split("/").some((p) => !p || p === "." || p === "..") || value.split("/").at(-1) !== name) throw new _Error("validation.mea2201abc5", { value0: name });
  return value;
}

// Lockfile von npm oder pnpm. Der Dateiname entscheidet, welcher Parser greift.
export function repositoryLockfile(input: string): string {
  const name = LOCKFILES.find((file) => input.trim().split("/").at(-1) === file) ?? "package-lock.json";
  return repositoryFile(input, name);
}

export function lockfileKind(lockfilePath: string): "npm" | "pnpm" {
  return lockfilePath.split("/").at(-1) === "pnpm-lock.yaml" ? "pnpm" : "npm";
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

// Pfad der App relativ zur Lockfile-Wurzel, "" für die Wurzel selbst.
function appRelative(manifestPath: string, lockfilePath: string, lockfileName: LockfileName): string {
  const appDir = manifestPath.slice(0, -"package.json".length);
  const lockDir = lockfilePath.slice(0, -lockfileName.length);
  if (!appDir.startsWith(lockDir)) throw new _Error("validation.mc64684c38f");
  return appDir.slice(lockDir.length).replace(/\/$/, "");
}

// undefined = nicht im Lockfile, null = vorhanden, aber nicht eindeutig (Link, keine SemVer).
type Resolve = (name: string) => string | null | undefined;

// Gemeinsamer Rest für npm und pnpm: alle direkten Abhängigkeiten, und wenn
// next drinsteht, muss es eindeutig zur Angabe im Manifest passen.
function resolveManifest(manifest: Record<string, unknown>, lockedDeclaration: () => string | null, resolve: Resolve, notFound: string) {
  const declared = declaration(manifest);
  const dependencies = directDependencies(manifest, resolve);
  if (declared === null) return { declaredVersion: null, lockedVersion: null, dependencies };
  if (lockedDeclaration() !== declared) throw new _Error("validation.md16e30f88c");
  const locked = resolve("next");
  if (locked === undefined) throw new _Error(notFound);
  if (locked === null) throw new _Error("validation.mb7a59f8226");
  if (!semver.satisfies(locked, declared, { includePrerelease: true })) throw new _Error("validation.me6d385c81c");
  return { declaredVersion: declared, lockedVersion: locked, dependencies };
}

// Liest Manifest und npm-Lockfile: alle direkten Abhängigkeiten mit gelockter
// Version. next ist optional; steht es drin, muss es eindeutig auflösbar sein.
export function parseNpmManifest(manifestData: unknown, lockData: unknown, manifestPath: string, lockfilePath: string) {
  repositoryFile(manifestPath, "package.json"); repositoryFile(lockfilePath, "package-lock.json");
  const manifest = object(manifestData);
  const lock = object(lockData);
  if (typeof manifest.packageManager === "string" && !manifest.packageManager.startsWith("npm@")) throw new _Error("validation.m6f4ec91e2a");
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) throw new _Error("validation.me45cff542d");
  const relative = appRelative(manifestPath, lockfilePath, "package-lock.json");
  const packages = object(lock.packages);
  const lockedManifest = object(packages[relative]);
  return resolveManifest(manifest, () => declaration(lockedManifest), (name) => lockedVersionOf(packages, relative, name), "validation.ma5c6bd0608");
}

/** @deprecated Name aus der Zeit, als nur next gelesen wurde. */
export const parseNpmNext = parseNpmManifest;

// Node resolves a dependency nearest to the app first, then through ancestors.
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

const DEPENDENCY_GROUPS = ["dependencies", "optionalDependencies", "devDependencies"] as const;

// Eintrag einer direkten Abhängigkeit im pnpm-Importer: { specifier, version }.
function pnpmEntry(importer: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  for (const key of DEPENDENCY_GROUPS) {
    const group = importer[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const entry = (group as Record<string, unknown>)[name];
    if (entry !== undefined) return object(entry);
  }
  return undefined;
}

// pnpm hängt aufgelöste Peers an die Version: 16.4.6(react@19.2.4). Links
// (link:, file:) und Aliasse haben keine eindeutige SemVer und ergeben null.
function pnpmLockedVersion(importer: Record<string, unknown>, name: string): string | null | undefined {
  const entry = pnpmEntry(importer, name);
  if (!entry) return undefined;
  if (typeof entry.version !== "string") return null;
  const version = entry.version.replace(/\(.*$/, "");
  return semver.valid(version) ? version : null;
}

// Liest Manifest und pnpm-lock.yaml (lockfileVersion 6 bis 9, also pnpm 8 bis 10).
// lockData ist das bereits geparste YAML. Im Workspace steht jede App unter
// importers mit ihrem Pfad ab Lockfile-Wurzel, die Wurzel selbst unter ".".
export function parsePnpmManifest(manifestData: unknown, lockData: unknown, manifestPath: string, lockfilePath: string) {
  repositoryFile(manifestPath, "package.json"); repositoryFile(lockfilePath, "pnpm-lock.yaml");
  const manifest = object(manifestData);
  const lock = object(lockData);
  if (typeof manifest.packageManager === "string" && !manifest.packageManager.startsWith("pnpm@")) throw new _Error("validation.m3f1c9a7d21");
  const major = Number.parseInt(String(lock.lockfileVersion ?? ""), 10);
  if (!(major >= 6 && major <= 9)) throw new _Error("validation.m8b2e4d6f10");
  const relative = appRelative(manifestPath, lockfilePath, "pnpm-lock.yaml");
  // Ohne Workspace stehen die Abhängigkeiten in Version 6 direkt auf oberster Ebene.
  const importers = lock.importers === undefined ? (relative ? {} : { ".": lock }) : object(lock.importers);
  const raw = importers[relative || "."];
  if (raw === undefined) throw new _Error("validation.m5c7a9e1b32", { value0: relative || "." });
  const importer = object(raw);
  const lockedDeclaration = () => {
    const specifier = pnpmEntry(importer, "next")?.specifier;
    return typeof specifier === "string" ? specifier : null;
  };
  return resolveManifest(manifest, lockedDeclaration, (name) => pnpmLockedVersion(importer, name), "validation.md4e6f8a0c2");
}

// lockData: JSON bei npm, geparstes YAML bei pnpm.
export function parseRepositoryManifest(manifestData: unknown, lockData: unknown, manifestPath: string, lockfilePath: string) {
  return lockfileKind(lockfilePath) === "pnpm"
    ? parsePnpmManifest(manifestData, lockData, manifestPath, lockfilePath)
    : parseNpmManifest(manifestData, lockData, manifestPath, lockfilePath);
}

export type DirectDependency = { name: string; declared: string; locked: string | null; dev: boolean };

// Alle direkten Abhängigkeiten mit Angabe und gelockter Version, höchstens 300.
function directDependencies(manifest: Record<string, unknown>, resolve: Resolve): DirectDependency[] {
  const out = new Map<string, DirectDependency>();
  for (const [key, dev] of [["dependencies", false], ["optionalDependencies", false], ["devDependencies", true]] as const) {
    const group = manifest[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [name, value] of Object.entries(group as Record<string, unknown>)) {
      if (out.has(name) || typeof value !== "string" || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || value.length > 200) continue;
      out.set(name, { name, declared: value, locked: resolve(name) ?? null, dev });
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
