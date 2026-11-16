import { messageCode as _code } from "@/i18n/translate";
// Versionswächter — reine Bewertungslogik (kein I/O, voll testbar).
// Nimmt die live gemeldete Version + Referenzwissen (Advisories, npm-Releases,
// kuratierte Known Issues) und leitet eine Stufe ab. Getrennt von der
// Verfügbarkeits-Ampel: ein veraltetes Next öffnet nie einen Incident.

import semver from "semver";

// Pakete, die aktuell bewertet werden. Das Datenmodell ist generisch, gebaut
// wird vorerst nur Next — weitere Pakete hier ergänzen (+ Refresh holt sie mit).
export const WATCHED_PACKAGES = ["next"] as const;

// Patch-Rückstand auf der eigenen Minor-Linie ab so vielen Tagen → orange.
export const PATCH_BACKLOG_DAYS = 14;

// rot > orange > hint > ok; "unknown" = Dienst meldet die Version nicht.
export type WatchLevel = "red" | "orange" | "hint" | "ok" | "unknown";

export const LEVEL_RANK: Record<WatchLevel, number> = { red: 4, orange: 3, unknown: 2, hint: 1, ok: 0 };

export type Severity = "critical" | "high" | "medium" | "low" | "unknown";

export interface AdvisoryRange {
  vulnerable: string; // GHSA-Format, z. B. ">= 16.0.0, <= 16.4.0"
  firstPatched: string | null;
}

export interface AdvisoryRef {
  ghsaId: string;
  severity: string;
  summary: string;
  url: string;
  ranges: AdvisoryRange[];
  withdrawnAt?: Date | null;
}

export interface KnownIssue {
  id: string;
  package: string;
  range: string;
  kind: "leak" | "regression" | "build-trap";
  title: string;
  titleEn?: string;
  hint?: string;
  hintEn?: string;
  source: string;
  addedAt: string;
}

export interface RegistryRef {
  distTags: Record<string, string>;
  versions: Record<string, string>; // stabile Version → ISO-Release-Datum
  majorIssues?: Record<string, import("./major-issues").MajorIssues>; // Major → offene Bug-Issues (nur empfohlene Majors)
}

export interface Finding {
  level: Exclude<WatchLevel, "ok" | "unknown">;
  kind: "advisory" | "known-issue" | "patch-backlog" | "newer-release" | "upgrade-note";
  title: string;
  titleEn?: string;
  url?: string;
  ghsaId?: string;
  severity?: Severity;
  fixedIn?: string | null;
}

export interface Evaluation {
  level: WatchLevel;
  findings: Finding[];
  latest: string | null;
}

// GHSA-Ranges sind kommagetrennt mit Leerzeichen nach dem Operator
// (">= 16.0.0, <= 16.4.0", "< 13.5.1", "= 15.0.0"). semver erwartet
// leerzeichengetrennte Komparatoren ohne Lücke nach dem Operator.
export function normalizeGhsaRange(range: string): string | null {
  const norm = range
    .split(",")
    .map((part) => part.trim().replace(/^(<=|>=|<|>|=)\s+/, "$1"))
    .filter(Boolean)
    .join(" ");
  return semver.validRange(norm) ? norm : null;
}

export function inGhsaRange(version: string, range: string): boolean {
  const norm = normalizeGhsaRange(range);
  if (!norm) return false;
  return semver.satisfies(version, norm, { includePrerelease: true });
}

export function normalizeSeverity(s: string | null | undefined): Severity {
  const v = (s ?? "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  if (v === "moderate") return "medium"; // npm-audit-Vokabular
  return "unknown";
}

// critical/high → rot, medium/low/unknown → orange (abgestimmt 2026-11-08).
export function advisoryLevel(sev: Severity): "red" | "orange" {
  return sev === "critical" || sev === "high" ? "red" : "orange";
}

// Sofort-Alarm über die Kanäle nur bei critical.
export function shouldAlert(sev: Severity): boolean {
  return sev === "critical";
}

// Aus der Liste der Live-Werte nur gültige SemVer-Strings übernehmen (Spec:
// runtime.packages ist ein Objekt name → version). Fremdes ignorieren, nie werfen.
export function parseRuntimePackages(payload: unknown): Record<string, string> | null {
  if (!payload || typeof payload !== "object") return null;
  const runtime = (payload as Record<string, unknown>).runtime;
  if (!runtime || typeof runtime !== "object") return null;
  const pkgs = (runtime as Record<string, unknown>).packages;
  if (!pkgs || typeof pkgs !== "object" || Array.isArray(pkgs)) return {};
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(pkgs as Record<string, unknown>).slice(0, 50)) {
    if (typeof v !== "string") continue;
    const clean = semver.valid(v.trim().replace(/^v/, ""));
    if (clean && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) out[name] = clean;
  }
  return out;
}

// Neueste stabile Version derselben Minor-Linie (z. B. 16.4.x).
export function latestOnLine(version: string, versions: Record<string, string>): string | null {
  const major = semver.major(version);
  const minor = semver.minor(version);
  const line = Object.keys(versions).filter(
    (v) => semver.valid(v) && !semver.prerelease(v) && semver.major(v) === major && semver.minor(v) === minor,
  );
  return line.length ? semver.rsort(line)[0] : null;
}

export function evaluate(
  version: string | null,
  pkg: string,
  advisories: AdvisoryRef[],
  knownIssues: KnownIssue[],
  registry: RegistryRef | null,
  now: Date = new Date(),
): Evaluation {
  const latest = registry?.distTags?.latest ?? null;
  if (!version || !semver.valid(version)) return { level: "unknown", findings: [], latest };

  const findings: Finding[] = [];

  // 1. Advisories (GitHub Advisory DB)
  for (const a of advisories) {
    if (a.withdrawnAt) continue;
    const hit = a.ranges.find((r) => inGhsaRange(version, r.vulnerable));
    if (!hit) continue;
    const sev = normalizeSeverity(a.severity);
    findings.push({
      level: advisoryLevel(sev),
      kind: "advisory",
      title: a.summary,
      url: a.url,
      ghsaId: a.ghsaId,
      severity: sev,
      fixedIn: hit.firstPatched,
    });
  }

  // 2. Kuratierte Known Issues
  for (const k of knownIssues) {
    if (k.package !== pkg || !semver.validRange(k.range)) continue;
    if (k.kind === "build-trap") {
      // Build-Fallen betreffen das UPGRADE, nicht den laufenden Dienst: Hinweis,
      // wenn das Upgrade-Ziel (latest) im Range liegt, die laufende Version nicht.
      if (latest && semver.satisfies(latest, k.range) && !semver.satisfies(version, k.range, { includePrerelease: true })) {
        findings.push({ level: "hint", kind: "upgrade-note", title: k.hint ? `${k.title}. ${k.hint}` : k.title, ...(k.titleEn ? { titleEn: k.hintEn ? `${k.titleEn}. ${k.hintEn}` : k.titleEn } : {}), url: sourceUrl(k.source) });
      }
      continue;
    }
    if (semver.satisfies(version, k.range, { includePrerelease: true })) {
      findings.push({ level: "orange", kind: "known-issue", title: k.title, ...(k.titleEn ? { titleEn: k.titleEn } : {}), url: sourceUrl(k.source) });
    }
  }

  // 3. Patch-Rückstand auf der eigenen Minor-Linie
  if (registry && !semver.prerelease(version)) {
    const top = latestOnLine(version, registry.versions);
    if (top && semver.gt(top, version)) {
      const released = registry.versions[top] ? new Date(registry.versions[top]) : null;
      const ageDays = released ? (now.getTime() - released.getTime()) / 86_400_000 : 0;
      if (ageDays > PATCH_BACKLOG_DAYS) {
        findings.push({ level: "orange", kind: "patch-backlog", title: _code("findings.mb02d5f7669", { value0: top, value1: Math.floor(ageDays) }) });
      } else {
        findings.push({ level: "hint", kind: "newer-release", title: _code("findings.m5d3f92d459", { value0: top, value1: Math.max(0, Math.floor(ageDays)) }) });
      }
    }
  }

  // 4. Neuere Minor/Major
  if (latest && semver.valid(latest) && semver.gt(latest, version)) {
    const sameLine = semver.major(latest) === semver.major(version) && semver.minor(latest) === semver.minor(version);
    if (!sameLine) findings.push({ level: "hint", kind: "newer-release", title: _code("findings.ma0c8eb8244", { value0: pkg, value1: latest }) });
  }

  findings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const level: WatchLevel = findings.length ? findings[0].level : "ok";
  return { level, findings, latest };
}

// Wiki-Refs (tech/<slug>, project/category/slug) sind keine URLs → kein Link.
function sourceUrl(source: string): string | undefined {
  return /^https?:\/\//.test(source) ? source : undefined;
}

export function worstLevel(levels: WatchLevel[]): WatchLevel {
  return levels.reduce<WatchLevel>((w, l) => (LEVEL_RANK[l] > LEVEL_RANK[w] ? l : w), "ok");
}

// ---------------------------------------------------------------------------
// Node als Laufzeit: kein npm-Paket, eigene Quelle (nodejs.org Release-Plan und
// Release-Liste). Die Spec-Health meldet runtime.node.
// ---------------------------------------------------------------------------

export const NODE_RUNTIME = "node";
export const NODE_REGISTRY_ID = "runtime:node";
// So viele Tage vor dem Support-Ende wird es orange.
export const NODE_EOL_WARN_DAYS = 90;

export interface NodeRef {
  // "v22" → { start, lts?, maintenance?, end } als ISO-Datum (nodejs/Release schedule.json)
  schedule: Record<string, { start: string; lts?: string; maintenance?: string; end: string }>;
  // "22.11.0" → { date, security } (nodejs.org/dist/index.json)
  releases: Record<string, { date: string; security: boolean }>;
}

// Commit des laufenden Builds (runtime.commit), kleingeschrieben. Läuft als
// Zeile RUNTIME_COMMIT in MonitorPackage mit, so gibt es „seit“ gratis.
export const RUNTIME_COMMIT = "runtime:commit";

export function parseRuntimeCommit(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const runtime = (payload as Record<string, unknown>).runtime;
  if (!runtime || typeof runtime !== "object") return null;
  const commit = (runtime as Record<string, unknown>).commit;
  return typeof commit === "string" && /^[0-9a-f]{7,40}$/i.test(commit.trim()) ? commit.trim().toLowerCase() : null;
}

// Gleicher Commit, auch wenn eine Seite gekürzt ist (mindestens 7 Zeichen).
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length < 7 || b.length < 7) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

export function parseRuntimeNode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const runtime = (payload as Record<string, unknown>).runtime;
  if (!runtime || typeof runtime !== "object") return null;
  const node = (runtime as Record<string, unknown>).node;
  return typeof node === "string" ? semver.valid(node.trim().replace(/^v/, "")) : null;
}

const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

export function evaluateNode(version: string | null, ref: NodeRef | null, now: Date = new Date()): Evaluation {
  if (!version || !semver.valid(version)) return { level: "unknown", findings: [], latest: null };
  const major = semver.major(version);
  const sameMajor = ref ? Object.keys(ref.releases).filter((v) => semver.valid(v) && semver.major(v) === major && semver.gt(v, version)) : [];
  const latest = sameMajor.length ? semver.rsort([...sameMajor])[0] : version;
  const findings: Finding[] = [];
  const plan = ref?.schedule[`v${major}`];
  if (plan) {
    const end = new Date(plan.end);
    const days = (end.getTime() - now.getTime()) / 86_400_000;
    if (days < 0) findings.push({ level: "red", kind: "known-issue", title: _code("findings.m27e918e03e", { value0: major, value1: day(plan.end) }) });
    else if (days < NODE_EOL_WARN_DAYS) findings.push({ level: "orange", kind: "known-issue", title: _code("findings.mc2e0969950", { value0: major, value1: day(plan.end) }) });
    else if (!plan.lts) findings.push({ level: "hint", kind: "upgrade-note", title: _code("findings.m680d75af7f", { value0: major }) });
  }
  const security = sameMajor.filter((v) => ref?.releases[v]?.security);
  if (security.length) {
    const top = semver.rsort([...security])[0];
    findings.push({ level: "orange", kind: "patch-backlog", title: _code("findings.m21ab0af9e8", { value0: top }), fixedIn: top });
  } else if (latest !== version) {
    findings.push({ level: "hint", kind: "newer-release", title: _code("findings.m58c68aaebb", { value0: latest }) });
  }
  findings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return { level: findings.length ? findings[0].level : "ok", findings, latest };
}
