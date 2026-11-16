// Versionswächter — I/O-Seite: Referenzwissen holen (npm-Registry + GitHub
// Advisory DB, täglich; npm zusätzlich bei manuellen Checks), Live-Versionen aus der Spec-Health-
// Antwort synchronisieren, Monitore bewerten und bei kritischen Advisories
// einmal pro Monitor+Advisory+Kanal alarmieren. Die Bewertung selbst ist pure
// Logik in version-watch-logic.ts.

import semver from "semver";
import { prisma } from "./prisma";
import recommendedMajorsData from "@/data/recommended-majors.json";
import type { RecommendedMajor } from "./dependency-target";
import { issueSearchQuery, issueSearchUrl, majorReleaseDate, parseIssueSearch, type MajorIssues } from "./major-issues";
import { ownerChannels, sendToChannel } from "./alert";
import knownIssuesData from "@/data/known-issues.json";
import {
  NODE_REGISTRY_ID,
  NODE_RUNTIME,
  RUNTIME_COMMIT,
  WATCHED_PACKAGES,
  evaluate,
  evaluateNode,
  parseRuntimeCommit,
  parseRuntimeNode,
  type NodeRef,
  normalizeSeverity,
  parseRuntimePackages,
  shouldAlert,
  type AdvisoryRef,
  type AdvisoryRange,
  type Evaluation,
  type KnownIssue,
  type RegistryRef,
} from "./version-watch-logic";

const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000; // höchstens einmal täglich
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ADVISORY_PAGES = 10; // Sicherung gegen Endlos-Pagination

export const knownIssues = knownIssuesData.issues as KnownIssue[];

// ---------------------------------------------------------------------------
// Referenzwissen auffrischen
// ---------------------------------------------------------------------------

function isStale(at: Date | null | undefined, now: number, maxAgeMs = REFRESH_EVERY_MS): boolean {
  return !at || now - at.getTime() > maxAgeMs;
}

// npm-Packument (komprimiert ~2,4 MB für next) → dist-tags + Release-Daten der
// stabilen Versionen. Nur die volle Variante enthält `time`.
async function fetchNpm(name: string) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, {
    headers: { accept: "application/json", "user-agent": "alerd-board" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`npm ${res.status}`);
  const doc = (await res.json()) as { "dist-tags"?: Record<string, string>; time?: Record<string, string> };
  const versions: Record<string, string> = {};
  for (const [v, t] of Object.entries(doc.time ?? {})) {
    if (semver.valid(v) && !semver.prerelease(v)) versions[v] = t;
  }
  return { distTags: doc["dist-tags"] ?? {}, versions };
}

interface GhAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  severity: string;
  published_at: string;
  withdrawn_at: string | null;
  vulnerabilities: { package: { ecosystem: string; name: string }; vulnerable_version_range: string | null; first_patched_version: string | null }[];
}

async function fetchAdvisories(name: string): Promise<GhAdvisory[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "alerd-board",
  };
  // Optional: ohne Token gelten 60 Requests/h — für einen Abruf pro Tag reicht das.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const all: GhAdvisory[] = [];
  let url: string | null = `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(name)}&per_page=100`;
  for (let page = 0; url && page < MAX_ADVISORY_PAGES; page++) {
    const res: Response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`GitHub advisories ${res.status}`);
    all.push(...((await res.json()) as GhAdvisory[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return all;
}

const recommendedMajors = recommendedMajorsData.majors as (RecommendedMajor & { issues?: { repo: string; query: string } })[];

// GitHub-Suche, höchstens ein Abruf pro empfohlener Major und Tag. Ohne Token
// gelten 10 Suchen pro Minute, das reicht für die kurze Liste.
async function fetchMajorIssues(name: string, versions: Record<string, string>, now: Date, errors: string[]) {
  const entries = recommendedMajors.filter((m) => m.package === name && m.issues);
  if (!entries.length) return null;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "alerd-board" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out: Record<string, MajorIssues> = {};
  for (const m of entries) {
    const since = majorReleaseDate(versions, m.major);
    if (!since || !m.issues) continue;
    const query = issueSearchQuery(m.issues.repo, m.issues.query, since);
    try {
      const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=reactions&order=desc&per_page=3`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
      if (!res.ok) throw new Error(`GitHub search ${res.status}`);
      out[m.major] = parseIssueSearch(await res.json(), { major: m.major, repo: m.issues.repo, since, searchUrl: issueSearchUrl(query), checkedAt: now.toISOString() });
    } catch (e) {
      errors.push(`issues ${m.major}: ${String(e)}`);
    }
  }
  return Object.keys(out).length ? out : null;
}

async function refreshPackage(name: string, now: Date, npmMaxAgeMs: number) {
  const row = await prisma.packageRegistry.findUnique({ where: { name } });
  const errors: string[] = [];

  if (isStale(row?.npmFetchedAt, now.getTime(), npmMaxAgeMs)) {
    try {
      const { distTags, versions } = await fetchNpm(name);
      await prisma.packageRegistry.upsert({
        where: { name },
        create: { name, distTags, versions, npmFetchedAt: now },
        update: { distTags, versions, npmFetchedAt: now },
      });
      // Für empfohlene Majors: offene Bug-Issues seit Erscheinen, im selben Takt wie npm.
      const majorIssues = await fetchMajorIssues(name, versions, now, errors);
      if (majorIssues) await prisma.packageRegistry.update({ where: { name }, data: { meta: { majorIssues } as never } });
    } catch (e) {
      errors.push(`npm: ${String(e)}`);
    }
  }

  if (isStale(row?.advisoriesFetchedAt, now.getTime())) {
    try {
      const list = await fetchAdvisories(name);
      for (const a of list) {
        const ranges: AdvisoryRange[] = a.vulnerabilities
          .filter((v) => v.package.ecosystem === "npm" && v.package.name === name && v.vulnerable_version_range)
          .map((v) => ({ vulnerable: v.vulnerable_version_range as string, firstPatched: v.first_patched_version }));
        if (!ranges.length) continue;
        const data = {
          cveId: a.cve_id,
          severity: normalizeSeverity(a.severity),
          summary: a.summary,
          url: a.html_url,
          ranges: ranges as never,
          publishedAt: new Date(a.published_at),
          withdrawnAt: a.withdrawn_at ? new Date(a.withdrawn_at) : null,
          fetchedAt: now,
        };
        await prisma.advisory.upsert({
          where: { ghsaId_packageName: { ghsaId: a.ghsa_id, packageName: name } },
          create: { ghsaId: a.ghsa_id, packageName: name, ...data },
          update: data,
        });
      }
      await prisma.packageRegistry.upsert({
        where: { name },
        create: { name, advisoriesFetchedAt: now },
        update: { advisoriesFetchedAt: now },
      });
    } catch (e) {
      errors.push(`advisories: ${String(e)}`);
    }
  }

  // Fehler nur vermerken (Anzeige), nie den Check-Lauf abbrechen. Beim nächsten
  // Lauf wird es erneut versucht, weil fetchedAt nicht weitergesetzt wurde.
  if (errors.length || row?.lastError) {
    await prisma.packageRegistry.upsert({
      where: { name },
      create: { name, lastError: errors.join(" · ") || null },
      update: { lastError: errors.join(" · ") || null },
    });
  }
}

// next immer, dazu alles, was an irgendeinem Dienst registriert ist.
export async function watchedPackageNames(): Promise<string[]> {
  const rows = await prisma.watchedPackage.findMany({ distinct: ["name"], select: { name: true } });
  return [...new Set<string>([...WATCHED_PACKAGES, ...rows.map((r) => r.name)])];
}

// Node: Support-Plan (nodejs/Release) und Releases mit Sicherheits-Flag
// (nodejs.org/dist/index.json). Nur stabile Versionen ab Node 18.
async function refreshNode(now: Date) {
  const row = await prisma.packageRegistry.findUnique({ where: { name: NODE_REGISTRY_ID } });
  if (!isStale(row?.npmFetchedAt, now.getTime())) return;
  try {
    const get = async (url: string) => {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "alerd-board" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
      if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
      return res.json() as Promise<unknown>;
    };
    const [schedule, index] = await Promise.all([
      get("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json") as Promise<NodeRef["schedule"]>,
      get("https://nodejs.org/dist/index.json") as Promise<{ version: string; date: string; security: boolean }[]>,
    ]);
    const releases: NodeRef["releases"] = {};
    for (const r of Array.isArray(index) ? index : []) {
      const v = semver.valid(String(r.version).replace(/^v/, ""));
      if (v && !semver.prerelease(v) && semver.major(v) >= 18) releases[v] = { date: String(r.date), security: r.security === true };
    }
    const plan = Object.fromEntries(Object.entries(schedule ?? {}).filter(([k]) => /^v\d+$/.test(k) && Number(k.slice(1)) >= 18));
    const meta = { schedule: plan, releases } as never;
    await prisma.packageRegistry.upsert({
      where: { name: NODE_REGISTRY_ID },
      create: { name: NODE_REGISTRY_ID, meta, npmFetchedAt: now, lastError: null },
      update: { meta, npmFetchedAt: now, lastError: null },
    });
  } catch (e) {
    await prisma.packageRegistry.upsert({ where: { name: NODE_REGISTRY_ID }, create: { name: NODE_REGISTRY_ID, lastError: String(e) }, update: { lastError: String(e) } });
  }
}

// Ein Refresh gleichzeitig pro Prozess. Fehler landen in PackageRegistry.lastError.
let inflight: Promise<void> | null = null;
export function refreshReferenceData(now = new Date(), npmMaxAgeMs = REFRESH_EVERY_MS): Promise<void> {
  inflight ??= (async () => {
    try {
      await refreshNode(now);
      for (const name of await watchedPackageNames()) await refreshPackage(name, now, npmMaxAgeMs);
    } catch (e) {
      console.error("[version-watch] refresh failed:", e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// ---------------------------------------------------------------------------
// Live-Versionen aus der Spec-Health-Antwort übernehmen
// ---------------------------------------------------------------------------

// Nur bei einer parsebaren Antwort aufrufen. Ohne runtime-Feld (oder ohne
// Pakete darin) werden die Zeilen des Monitors entfernt → „keine Angabe".
// Ein Ausfall (kein Payload) lässt den letzten bekannten Stand stehen.
export async function syncMonitorPackages(monitorId: string, payload: unknown, now = new Date()) {
  const reported = parseRuntimePackages(payload) ?? {};
  // runtime.node läuft als Zeile "node" mit, so gibt es "seit" und Verlauf gratis.
  // Ein npm-Paket namens node meldet niemand ernsthaft, die Laufzeit hat Vorrang.
  const node = parseRuntimeNode(payload);
  if (node) reported[NODE_RUNTIME] = node; else delete reported[NODE_RUNTIME];
  const commit = parseRuntimeCommit(payload);
  if (commit) reported[RUNTIME_COMMIT] = commit; else delete reported[RUNTIME_COMMIT];
  const existing = await prisma.monitorPackage.findMany({ where: { monitorId } });
  const names = Object.keys(reported);

  const gone = existing.filter((e) => !(e.name in reported)).map((e) => e.id);
  if (gone.length) await prisma.monitorPackage.deleteMany({ where: { id: { in: gone } } });

  for (const name of names) {
    const version = reported[name];
    const prev = existing.find((e) => e.name === name);
    if (!prev) {
      await prisma.monitorPackage.create({ data: { monitorId, name, version, firstSeenAt: now, reportedAt: now } });
    } else {
      await prisma.monitorPackage.update({
        where: { id: prev.id },
        data: { version, reportedAt: now, ...(prev.version !== version ? { firstSeenAt: now } : {}) },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Bewerten
// ---------------------------------------------------------------------------

export interface WatchContext {
  node: NodeRef | null;
  advisories: Record<string, AdvisoryRef[]>;
  registry: Record<string, RegistryRef | null>;
  registryMeta: Record<string, { npmFetchedAt: Date | null; advisoriesFetchedAt: Date | null; lastError: string | null }>;
}

function majorIssuesOf(meta: unknown): Record<string, MajorIssues> | undefined {
  const value = meta && typeof meta === "object" ? (meta as { majorIssues?: unknown }).majorIssues : undefined;
  return value && typeof value === "object" ? value as Record<string, MajorIssues> : undefined;
}

export async function loadWatchContext(): Promise<WatchContext> {
  const names = await watchedPackageNames();
  const [advs, regs, nodeRow] = await Promise.all([
    prisma.advisory.findMany({ where: { packageName: { in: names } } }),
    prisma.packageRegistry.findMany({ where: { name: { in: names } } }),
    prisma.packageRegistry.findUnique({ where: { name: NODE_REGISTRY_ID }, select: { meta: true } }),
  ]);
  const node = nodeRow?.meta && typeof nodeRow.meta === "object" ? nodeRow.meta as unknown as NodeRef : null;
  const ctx: WatchContext = { node: node?.schedule && node.releases ? node : null, advisories: {}, registry: {}, registryMeta: {} };
  for (const name of names) {
    ctx.advisories[name] = advs
      .filter((a) => a.packageName === name)
      .map((a) => ({
        ghsaId: a.ghsaId,
        severity: a.severity,
        summary: a.summary,
        url: a.url,
        ranges: a.ranges as unknown as AdvisoryRange[],
        withdrawnAt: a.withdrawnAt,
      }));
    const r = regs.find((x) => x.name === name);
    ctx.registry[name] =
      r?.distTags && r.versions
        ? { distTags: r.distTags as Record<string, string>, versions: r.versions as Record<string, string>, majorIssues: majorIssuesOf(r.meta) }
        : null;
    ctx.registryMeta[name] = {
      npmFetchedAt: r?.npmFetchedAt ?? null,
      advisoriesFetchedAt: r?.advisoriesFetchedAt ?? null,
      lastError: r?.lastError ?? null,
    };
  }
  return ctx;
}

export function evaluatePackage(ctx: WatchContext, name: string, version: string | null, now = new Date()): Evaluation {
  if (name === NODE_RUNTIME) return evaluateNode(version, ctx.node, now);
  return evaluate(version, name, ctx.advisories[name] ?? [], knownIssues, ctx.registry[name] ?? null, now);
}

// ---------------------------------------------------------------------------
// Alarm bei kritischen Advisories (einmal pro Monitor + Advisory + Kanal)
// ---------------------------------------------------------------------------

export async function alertCriticalAdvisories(ownerId?: string) {
  const ctx = await loadWatchContext();
  // Monitore ohne Dienst mit Versionsüberwachung (etwa „Weitere Monitore“):
  // dort gibt es keine Auswahl, also alarmiert next wie bisher. An Diensten
  // zählt nur, was du beobachtest (unten).
  const live = await prisma.monitorPackage.findMany({
    where: { name: { in: [...WATCHED_PACKAGES] }, monitor: { enabled: true, ...(ownerId ? { ownerId } : {}), coolifyLinks: { none: { application: { repositoryWatch: { isNot: null } } } } } },
    include: { monitor: true },
  });
  // Registrierte Pakete: Version live, falls gemeldet, sonst aus dem Lockfile.
  // Der Alarm hängt am ersten aktiven Monitor des Dienstes (Spec-Health bevorzugt),
  // damit das bestehende Log pro Monitor, Advisory und Kanal greift.
  const watched = await prisma.watchedPackage.findMany({
    where: { watch: { application: { serviceAt: { not: null }, missingSince: null, ...(ownerId ? { connection: { ownerId } } : {}) } } },
    select: { name: true, watch: { select: { snapshot: { select: { dependencies: true } }, application: { select: { monitors: {
      where: { monitor: { enabled: true } }, select: { monitor: { include: { packages: { select: { name: true, version: true } } } } },
    } } } } } },
  });
  const fromGit = watched.flatMap((w) => {
    const monitors = w.watch.application.monitors.map((l) => l.monitor).sort((a, b) => Number(b.kind === "HEALTH") - Number(a.kind === "HEALTH"));
    const monitor = monitors[0];
    if (!monitor) return [];
    const reported = monitors.flatMap((m) => m.packages).find((p) => p.name === w.name)?.version;
    const deps = Array.isArray(w.watch.snapshot?.dependencies) ? w.watch.snapshot.dependencies as { name?: string; locked?: string | null }[] : [];
    const version = reported ?? deps.find((d) => d.name === w.name)?.locked;
    return version ? [{ name: w.name, version, monitorId: monitor.id, monitor }] : [];
  });
  const rows = [...live.map((r) => ({ name: r.name, version: r.version, monitorId: r.monitorId, monitor: r.monitor })), ...fromGit];

  for (const row of rows) {
    const e = evaluatePackage(ctx, row.name, row.version);
    const critical = e.findings.filter((f) => f.kind === "advisory" && f.severity && shouldAlert(f.severity));
    if (!critical.length) continue;

    const channels = await ownerChannels(row.monitor);
    for (const f of critical) {
      const subject = `🔴 ${row.monitor.name}: ${row.name} ${row.version} von ${f.ghsaId} betroffen (critical)`;
      const text =
        `Alerd Berd Versionswächter: "${row.monitor.name}" läuft live mit ${row.name} ${row.version}.\n` +
        `Advisory: ${f.ghsaId} (critical): ${f.title}\n` +
        (f.fixedIn ? `Gefixt ab: ${f.fixedIn}\n` : "") +
        `Details: ${f.url}\nZeit: ${new Date().toISOString()}`;

      for (const ch of channels) {
        const key = { monitorId: row.monitorId, ghsaId: f.ghsaId as string, channelId: ch.id };
        const already = await prisma.packageAlertLog.findUnique({ where: { monitorId_ghsaId_channelId: key } });
        if (already) continue;
        const { success, detail } = await sendToChannel(ch, subject, text, "ADVISORY");
        await prisma.packageAlertLog
          .create({ data: { ...key, version: row.version, success, detail } })
          .catch(() => {}); // paralleler Lauf hat schon geloggt → unique, ignorieren
      }
    }
  }
}
