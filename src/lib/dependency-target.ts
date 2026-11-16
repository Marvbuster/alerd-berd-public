import semver from "semver";
import { inGhsaRange } from "./version-watch-logic";
import type { MajorIssues } from "./major-issues";
import { translate } from "@/i18n/translate";

// Ab diesen Zuständen ist der Bump auf GitHub, das Ziel gilt als geliefert.
export const DELIVERED_STATUSES = ["PUBLISHING", "PUSHED", "DEPLOYING", "LIVE_REVIEW", "LIVE", "LIVE_UNVERIFIED"];

export type JobPackage = { name: string; version: string; from: string | null };
type JobLike = { packageName?: string; targetVersion: string; packages?: unknown };

const NPM_NAME = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

// Gleiche Regel wie jobPackages im Worker (scripts/dependency-worker-lib.mjs):
// neue Jobs tragen eine Paketliste, alte nur packageName/targetVersion.
export function jobPackages(job: JobLike): JobPackage[] {
  const list = Array.isArray(job.packages) ? (job.packages as Record<string, unknown>[]).flatMap((p) =>
    p && typeof p.name === "string" && NPM_NAME.test(p.name) && typeof p.version === "string" && semver.valid(p.version)
      ? [{ name: p.name, version: p.version, from: typeof p.from === "string" ? p.from : null }] : []) : [];
  return list.length ? list.slice(0, 20) : [{ name: job.packageName ?? "next", version: job.targetVersion, from: null }];
}

export function jobLabel(list: { name: string; version: string }[], locale = "de"): string {
  const one = (p: { name: string; version: string }) => `${p.name === "next" ? "Next" : p.name} ${p.version}`;
  return list.length <= 2 ? list.map(one).join(", ") : translate(locale, "common.packagesCount", { count: list.length });
}

// Ist ein Update auf target schon erledigt? Der gespeicherte Git-Stand hinkt
// nach einem Push hinterher, deshalb zählen auch ein gelieferter Job mit
// gleicher oder höherer Zielversion und jede live gemeldete Version >= target.
export function alreadyDelivered(target: string, { jobs = [], runtimeVersions = [], name = "next" }: {
  jobs?: (JobLike & { status: string })[]; runtimeVersions?: (string | null | undefined)[]; name?: string;
}): boolean {
  if (!semver.valid(target)) return false;
  if (jobs.some((job) => {
    const version = jobPackages(job).find((p) => p.name === name)?.version;
    return DELIVERED_STATUSES.includes(job.status) && !!version && semver.gte(version, target);
  })) return true;
  return runtimeVersions.some((version) => !!version && !!semver.valid(version) && semver.gte(version, target));
}

export const UPDATE_MATURITY_MS = 24 * 60 * 60_000;

export type SecurityFix = { version: string; critical?: boolean };
export type UpdateCandidate = {
  name: string; from: string; to: string; jump: "patch" | "minor" | "major";
  breaking: boolean; security: boolean; critical: boolean;
  // Gesetzt, wenn das Ziel eine empfohlene Major ist (src/data/recommended-majors.json),
  // samt offener Bug-Issues seit Erscheinen der Major, sobald abgerufen.
  // hold: ein bekanntes Problem trifft die Zielversion, dann heißt es „abwarten“ statt „empfohlen“.
  recommended?: { title: string; titleEn?: string; source: string; issues?: MajorIssues | null; hold?: boolean };
  // Einträge aus known-issues.json, deren Range die Zielversion trifft.
  knownIssues?: { title: string; titleEn?: string; kind: string; url?: string }[];
};

// Bekannte Probleme (src/data/known-issues.json), die die Zielversion treffen.
// Build-Fallen mit Hinweis, weil sie beim Update selbst zuschlagen.
export function knownIssuesFor(name: string, to: string, issues: { package: string; range: string; kind: string; title: string; titleEn?: string; hint?: string; hintEn?: string; source: string }[]) {
  return issues.filter((k) => k.package === name && semver.validRange(k.range) && semver.satisfies(to, k.range)).map((k) => ({
    title: k.hint ? `${k.title}. ${k.hint}` : k.title, ...(k.titleEn ? { titleEn: k.hintEn ? `${k.titleEn}. ${k.hintEn}` : k.titleEn } : {}), kind: k.kind, ...(/^https?:\/\//.test(k.source) ? { url: k.source } : {}),
  }));
}

export type RecommendedMajor = { package: string; major: number; title: string; titleEn?: string; source: string };

function releasedAt(versions: Record<string, string> | null | undefined, version: string): Date | null {
  const value = versions?.[version];
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

// Ohne bestätigten npm-Zeitpunkt bleibt ein reguläres Release gesperrt.
// Kritische Fixes sind die einzige Ausnahme und werden separat belegt.
export function updateMaturity(versions: Record<string, string> | null | undefined, version: string, now = new Date()) {
  const publishedAt = releasedAt(versions, version);
  if (!publishedAt) return { ready: false, publishedAt: null, readyAt: null };
  const readyAt = new Date(publishedAt.getTime() + UPDATE_MATURITY_MS);
  return { ready: now >= readyAt, publishedAt, readyAt };
}

export function latestMatureOnLine(version: string, versions: Record<string, string> | null | undefined, now = new Date()): string | null {
  if (!versions) return null;
  const major = semver.major(version), minor = semver.minor(version);
  const choices = Object.keys(versions).filter((candidate) =>
    semver.valid(candidate) && !semver.prerelease(candidate) &&
    semver.major(candidate) === major && semver.minor(candidate) === minor &&
    updateMaturity(versions, candidate, now).ready,
  );
  return choices.length ? semver.rsort(choices)[0] : null;
}

// Neueste reife Version derselben Major, also auch Minor-Updates. Ab 1.0 sind
// die laut SemVer kompatibel und bringen Fixes und Performance mit.
export function latestMatureInMajor(version: string, versions: Record<string, string> | null | undefined, now = new Date()): string | null {
  if (!versions) return null;
  const major = semver.major(version);
  const choices = Object.keys(versions).filter((v) => semver.valid(v) && !semver.prerelease(v) && semver.major(v) === major && updateMaturity(versions, v, now).ready);
  return choices.length ? semver.rsort(choices)[0] : null;
}

export function isCriticalFix(from: string | null, target: string, fixes: { version: string; vulnerable: string }[]): boolean {
  if (!from || !semver.valid(from)) return false;
  return fixes.some((fix) => fix.version === target && inGhsaRange(from, fix.vulnerable));
}

// Ziel für ein beobachtetes Paket: ab 1.0 die neueste reife Version der Major
// (Minor eingeschlossen), bei 0.x der neueste Patch der eigenen Linie, weil dort
// schon eine Minor breaking sein darf. Ist eine Sicherheitsmeldung erst später
// gefixt, der neueste Patch auf der Linie des Fixes. Ein größerer Sprung wird als „breaking“ markiert.
// Eine Major aus der gepflegten Liste (deutlich bessere Performance) zählt
// ebenfalls, mit ihrer neuesten reifen Version.
export function updateCandidate(name: string, from: string | null, versions: Record<string, string> | null | undefined, fixedIn: (string | SecurityFix | null | undefined)[], now = new Date(), recommended: RecommendedMajor[] = []): UpdateCandidate | null {
  if (!from || !semver.valid(from) || !versions) return null;
  const patch = semver.major(from) === 0 ? latestMatureOnLine(from, versions, now) : latestMatureInMajor(from, versions, now);
  const fixes = fixedIn.flatMap((value) => {
    const fix = typeof value === "string" ? { version: value, critical: false } : value;
    return fix && semver.valid(fix.version) && semver.gt(fix.version, from) ? [fix] : [];
  });
  const matureFixes = fixes.flatMap((fix) => {
    const top = latestMatureOnLine(fix.version, versions, now);
    return top ? [{ version: top, critical: false }] : [];
  });
  // Kritisch darf sofort nur die exakt von GitHub Advisory benannte erste
  // gepatchte Version sein, nie ein beliebiger, noch frischer Folgerelease.
  const majors = recommended.filter((r) => r.package === name && r.major > semver.major(from)).flatMap((r) => {
    const top = latestMatureInMajor(`${r.major}.0.0`, versions, now);
    return top ? [{ version: top, critical: false }] : [];
  });
  const options = [patch ? { version: patch, critical: false } : null, ...matureFixes, ...majors, ...fixes.filter((fix) => fix.critical)]
    .filter((value): value is { version: string; critical: boolean } => !!value && semver.gt(value.version, from));
  const picked = options.sort((a, b) => semver.rcompare(a.version, b.version))[0];
  if (!picked) return null;
  const to = picked.version;
  const diff = semver.diff(from, to);
  const jump = diff === "major" || diff === "premajor" ? "major" : diff === "minor" || diff === "preminor" ? "minor" : "patch";
  const breaking = jump === "major" || (semver.major(from) === 0 && jump === "minor");
  const rec = recommended.find((r) => r.package === name && r.major === semver.major(to) && r.major > semver.major(from));
  return {
    name, from, to, jump, breaking, security: fixes.some((fix) => semver.gte(to, fix.version)), critical: picked.critical,
    ...(rec ? { recommended: { title: rec.title, ...(rec.titleEn ? { titleEn: rec.titleEn } : {}), source: rec.source } } : {}),
  };
}
