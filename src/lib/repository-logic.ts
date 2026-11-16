import semver from "semver";

export function githubRepository(input: string): string {
  let value = input.trim();
  if (value.startsWith("git@github.com:")) value = value.slice(15);
  else if (value.startsWith("https://")) {
    const url = new URL(value);
    if (url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new Error("Nur GitHub-Repositories ohne Zugangsdaten sind unterstützt.");
    value = url.pathname.slice(1);
  }
  value = value.replace(/\.git$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(value) || [".", ".."].includes(value.split("/")[1])) throw new Error("Repository als owner/repo oder GitHub-URL angeben.");
  return value;
}

export function repositoryBranch(input: string): string {
  const value = input.trim();
  if (!value || value.length > 200 || /[\s\\~^:?*\[\]\x00-\x1f]/.test(value) || value.includes("..") || value.includes("@{") || value.split("/").some((p) => !p || p.startsWith(".") || p.endsWith(".lock") || p.endsWith("."))) throw new Error("Ungültiger Git-Branch.");
  return value;
}

export function repositoryFile(input: string, name: "package.json" | "package-lock.json"): string {
  const value = input.trim();
  if (value.length > 500 || /[\\\x00-\x1f]/.test(value) || value.split("/").some((p) => !p || p === "." || p === "..") || value.split("/").at(-1) !== name) throw new Error(`Repo-relativen Pfad zu ${name} ohne .. angeben.`);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ungültiges Manifest oder Lockfile.");
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
  if (values.some((v) => typeof v !== "string" || !semver.validRange(v)) || new Set(values).size !== 1) throw new Error("next hat keine eindeutig unterstützte SemVer-Angabe.");
  return values[0] as string;
}

// Liest Manifest und npm-Lockfile: alle direkten Abhängigkeiten mit gelockter
// Version. next ist optional; steht es drin, muss es eindeutig auflösbar sein.
export function parseNpmManifest(manifestData: unknown, lockData: unknown, manifestPath: string, lockfilePath: string) {
  repositoryFile(manifestPath, "package.json"); repositoryFile(lockfilePath, "package-lock.json");
  const manifest = object(manifestData);
  const lock = object(lockData);
  if (typeof manifest.packageManager === "string" && !manifest.packageManager.startsWith("npm@")) throw new Error("Aktuell wird nur npm mit package-lock.json unterstützt.");
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) throw new Error("Nur npm-Lockfile-Version 2 oder 3 wird unterstützt.");
  const appDir = manifestPath.slice(0, -"package.json".length);
  const lockDir = lockfilePath.slice(0, -"package-lock.json".length);
  if (!appDir.startsWith(lockDir)) throw new Error("Das Manifest muss innerhalb der Lockfile-Wurzel liegen.");
  const relative = appDir.slice(lockDir.length).replace(/\/$/, "");
  const packages = object(lock.packages);
  const lockedManifest = object(packages[relative]);
  const declared = declaration(manifest);
  const dependencies = directDependencies(manifest, packages, relative);
  if (declared === null) return { declaredVersion: null, lockedVersion: null, dependencies };
  if (declaration(lockedManifest) !== declared) throw new Error("Manifest und Lockfile enthalten unterschiedliche next-Versionsangaben.");
  const locked = lockedVersionOf(packages, relative, "next");
  if (locked === undefined) throw new Error("next wurde im npm-Lockfile für diesen App-Pfad nicht gefunden.");
  if (locked === null) throw new Error("Die gelockte next-Version ist nicht eindeutig auflösbar.");
  if (!semver.satisfies(locked, declared, { includePrerelease: true })) throw new Error("Die gelockte next-Version erfüllt die Manifest-Angabe nicht.");
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
  if (input.applicationMissing) return { level: "unknown", reason: "Coolify-App nicht mehr im API-Inventar" };
  if (!input.snapshot) return { level: "unknown", reason: "Noch kein Git-Snapshot" };
  if (!input.snapshot.lockedVersion) return { level: "unknown", reason: "Projekt nutzt kein next" };
  if (input.lastError) return { level: "unknown", reason: "Letzter Git-Scan fehlgeschlagen" };
  if (now.getTime() - input.snapshot.scannedAt.getTime() > 60 * 60_000) return { level: "unknown", reason: "Git-Snapshot älter als eine Stunde" };
  if (!input.monitorEnabled) return { level: "unknown", reason: "Monitor pausiert" };
  if (!input.runtime || !semver.valid(input.runtime.version)) return { level: "unknown", reason: "Keine gültige Runtime-Version" };
  const maxAge = Math.max(5 * 60_000, input.intervalSec * 3_000);
  if (now.getTime() - input.runtime.reportedAt.getTime() > maxAge) return { level: "unknown", reason: "Runtime-Meldung veraltet" };
  if (!semver.eq(input.runtime.version, input.snapshot.lockedVersion as string)) return { level: "mismatch", reason: "Git-Lockfile und Runtime unterscheiden sich; Deploy-Ursache noch nicht verifiziert" };
  return { level: "match", reason: "Git-Lockfile und gemeldete Runtime stimmen überein" };
}
