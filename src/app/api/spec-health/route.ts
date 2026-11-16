import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { credentialsConfigured } from "@/lib/credentials";
import { listExpiries } from "@/lib/credential-expiry-watch";
import { daysLeft, expiryPhrase, soonest } from "@/lib/credential-expiry";
import { NODE_REGISTRY_ID } from "@/lib/version-watch-logic";
import { translate, translateMessage, messageCode, recipientLocale } from "../../../../scripts/i18n.mjs";

const healthMessage = (key: string, values = {}) => translate(recipientLocale(), `health.${key}`, values);

// Alerd Berds eigene Spec-Health (v1, spec/alerd-health.schema.json):
// Bearer-geschützt, getrennt von der Liveness /api/health, an der Coolifys
// Container-Healthcheck hängt. Body gewinnt, deshalb immer HTTP 200.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompStatus = "ok" | "degraded" | "down";
type Component = { name: string; status: CompStatus; detail?: string };
type Metric = { name: string; value: number; unit: string; warn?: number; crit?: number; direction: "above" | "below" };

const RANK: Record<CompStatus, number> = { ok: 0, degraded: 1, down: 2 };
const DB_TIMEOUT_MS = 5_000;
// Pakete, die Alerd live meldet. Alle übrigen belegt runtime.commit über das Lockfile.
const REPORTED = ["next", "react", "react-dom", "@prisma/client", "web-push"];

// Live-Stand aus dem node_modules des laufenden Containers, einmal pro Prozess.
let runtimeInfo: { node: string; commit?: string; packages: Record<string, string> } | undefined;
function getRuntime() {
  if (runtimeInfo) return runtimeInfo;
  const packages: Record<string, string> = {};
  for (const name of REPORTED) {
    try {
      const pkg = JSON.parse(readFileSync(`${process.cwd()}/node_modules/${name}/package.json`, "utf8"));
      if (typeof pkg.version === "string") packages[name] = pkg.version;
    } catch { /* nicht gefunden, Feld fehlt */ }
  }
  // Coolify: SOURCE_COMMIT, im Dockerfile als ARG/ENV durchgereicht.
  const commit = process.env.SOURCE_COMMIT?.trim();
  return (runtimeInfo = { node: process.versions.node, ...(commit && /^[0-9a-f]{7,40}$/i.test(commit) ? { commit } : {}), packages });
}

const briefErr = (e: unknown) => translateMessage(recipientLocale(), e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => { setTimeout(() => reject(new Error("timeout")), ms); })]);
}

function tokenOk(header: string | null, expected: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function checkDatabase(): Promise<{ comp: Component; latencyMs: number | null }> {
  const t0 = performance.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
    return { comp: { name: "database", status: "ok" }, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { comp: { name: "database", status: "down", detail: briefErr(e) }, latencyMs: null };
  }
}

// Läuft der Check-Runner noch? Er wird extern getriggert (/api/run-checks).
// Bleibt er aus, prüft und alarmiert Alerd nichts mehr, obwohl die Seite lädt.
async function lastCheckAgeSec(now: number): Promise<number | null> {
  try {
    const latest = await withTimeout(prisma.monitor.findFirst({
      where: { enabled: true, kind: { not: "PUSH" }, lastCheckedAt: { not: null } },
      orderBy: { lastCheckedAt: "desc" }, select: { lastCheckedAt: true },
    }), DB_TIMEOUT_MS);
    return latest?.lastCheckedAt ? Math.round((now - latest.lastCheckedAt.getTime()) / 1000) : null;
  } catch { return null; }
}

async function openIncidents(): Promise<number | null> {
  try { return await withTimeout(prisma.incident.count({ where: { resolvedAt: null } }), DB_TIMEOUT_MS); }
  catch { return null; }
}

// Ohne Kanal kommt kein Alarm an. Ohne Schlüssel lassen sich gespeicherte
// Zugänge (Coolify, GitHub, Claude) nicht entschlüsseln.
function checkConfig(): Component[] {
  const push = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const email = !!(process.env.BREVO_API_KEY || process.env.SMTP_HOST);
  const key = credentialsConfigured();
  return [
    push || email
      ? { name: "alerting", status: push && email ? "ok" : "degraded", ...(push && email ? {} : { detail: healthMessage(push ? "pushOnly" : "emailOnly") }) }
      : { name: "alerting", status: "down", detail: healthMessage("noAlerting") },
    key ? { name: "credential-key", status: "ok" } : { name: "credential-key", status: "down", detail: healthMessage("credentialKey") },
  ];
}

// Läuft der Update-Worker? Er holt Jobs in diesen Status ab. Wartet einer
// lange ohne Lease, ist der Worker tot oder hängt.
const WORKER_STATUSES = ["ANALYZING", "APPROVED", "PUBLISHING", "RUNNING"] as const;
async function workerQueueWaitSec(now: number): Promise<number | null> {
  try {
    const waiting = await withTimeout(prisma.dependencyJob.findMany({
      where: { status: { in: [...WORKER_STATUSES] }, owner: { active: true }, OR: [{ workerLockedUntil: null }, { workerLockedUntil: { lt: new Date(now) } }] },
      select: { updatedAt: true, workerAttemptAt: true },
    }), DB_TIMEOUT_MS);
    return waiting.reduce((max, j) => Math.max(max, Math.round((now - (j.workerAttemptAt ?? j.updatedAt).getTime()) / 1000)), 0);
  } catch { return null; }
}

// Coolify-Abgleich alle 15 Minuten. Fehler oder lange kein Erfolg heißt: Dienste
// und Inventar veralten.
async function checkCoolify(now: number): Promise<{ comp: Component | null; ageSec: number | null }> {
  try {
    const rows = await withTimeout(prisma.coolifyConnection.findMany({ where: { owner: { active: true } }, select: { label: true, lastSyncedAt: true, lastError: true } }), DB_TIMEOUT_MS);
    if (!rows.length) return { comp: null, ageSec: null };
    const failing = rows.filter((r) => r.lastError);
    const ageSec = Math.max(...rows.map((r) => (r.lastSyncedAt ? Math.round((now - r.lastSyncedAt.getTime()) / 1000) : Number.MAX_SAFE_INTEGER)));
    const comp: Component = failing.length
      ? { name: "coolify-sync", status: "degraded", detail: `${failing.map((r) => r.label).join(", ")}: ${briefErr(failing[0].lastError)}` }
      : { name: "coolify-sync", status: "ok" };
    return { comp, ageSec: Number.isFinite(ageSec) && ageSec < Number.MAX_SAFE_INTEGER ? ageSec : null };
  } catch { return { comp: { name: "coolify-sync", status: "degraded", detail: healthMessage("unreadable") }, ageSec: null }; }
}

// Versionswächter: npm- und Node-Referenzdaten werden täglich aufgefrischt,
// Repo-Scans lesen die Lockfiles. Fehler dort heißen veraltete Versions-Badges.
async function checkVersionWatch(now: number): Promise<{ comps: Component[]; refAgeH: number | null }> {
  try {
    const [node, registryErrors, scanErrors] = await withTimeout(Promise.all([
      prisma.packageRegistry.findUnique({ where: { name: NODE_REGISTRY_ID }, select: { npmFetchedAt: true } }),
      prisma.packageRegistry.count({ where: { lastError: { not: null } } }),
      prisma.repositoryWatch.findMany({ where: { lastError: { not: null }, application: { missingSince: null, connection: { owner: { active: true } } } }, select: { repository: true } }),
    ]), DB_TIMEOUT_MS);
    const refAgeH = node?.npmFetchedAt ? Math.round((now - node.npmFetchedAt.getTime()) / 3_600_000) : null;
    return {
      refAgeH,
      comps: [
        registryErrors ? { name: "version-watch", status: "degraded", detail: healthMessage("stalePackages", { count: registryErrors }) } : { name: "version-watch", status: "ok" },
        scanErrors.length ? { name: "repository-scans", status: "degraded", detail: healthMessage("scanFailed", { repositories: scanErrors.map((w) => w.repository).join(", ").slice(0, 180) }) } : { name: "repository-scans", status: "ok" },
      ],
    };
  } catch { return { comps: [{ name: "version-watch", status: "degraded", detail: healthMessage("unreadable") }], refAgeH: null }; }
}

// Fehlgeschlagene Alarme und AlerdReperd-Mails des letzten Tages.
async function failedNotifications(now: number): Promise<number | null> {
  try {
    const since = new Date(now - 86_400_000);
    const [alerts, digests] = await withTimeout(Promise.all([
      prisma.notificationLog.count({ where: { success: false, sentAt: { gte: since } } }),
      prisma.dailyUpdateDigest.count({ where: { success: false, sentAt: { gte: since } } }),
    ]), DB_TIMEOUT_MS);
    return alerts + digests;
  } catch { return null; }
}

// Der Zugang, der als Nächstes abläuft (GitHub-Tokens, Claude-Code-Token).
async function checkCredentials(now: number): Promise<{ comp: Component; daysLeft: number | null }> {
  try {
    const next = soonest(await withTimeout(listExpiries(), DB_TIMEOUT_MS));
    if (!next) return { comp: { name: "credentials", status: "ok" }, daysLeft: null };
    const days = daysLeft(next.expiresAt, now);
    const locale = recipientLocale();
    const detail = `${translate(locale, `mail.credential_${next.kind}`)} ${expiryPhrase(days, locale)}`;
    return { comp: days <= 0 ? { name: "credentials", status: "down", detail } : days <= 30 ? { name: "credentials", status: "degraded", detail } : { name: "credentials", status: "ok" }, daysLeft: days };
  } catch { return { comp: { name: "credentials", status: "degraded", detail: healthMessage("unreadable") }, daysLeft: null }; }
}

function metricStatus(m: Metric): CompStatus {
  if (m.warn == null && m.crit == null) return "ok";
  const hit = (limit?: number) => limit != null && (m.direction === "below" ? m.value <= limit : m.value >= limit);
  return hit(m.crit) ? "down" : hit(m.warn) ? "degraded" : "ok";
}

export async function GET(req: Request) {
  const token = process.env.SPEC_HEALTH_TOKEN;
  if (!token) return NextResponse.json({ error: messageCode("health.missingToken") }, { status: 503 });
  if (!tokenOk(req.headers.get("authorization"), token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const [db, checkAge, incidents, queueWait, coolify, watch, failed, creds] = await Promise.all([
    checkDatabase(), lastCheckAgeSec(now), openIncidents(), workerQueueWaitSec(now), checkCoolify(now), checkVersionWatch(now), failedNotifications(now), checkCredentials(now),
  ]);
  const components: Component[] = [db.comp, ...checkConfig(), ...(coolify.comp ? [coolify.comp] : []), ...watch.comps, creds.comp];
  const metrics: Metric[] = [];
  if (db.latencyMs != null) metrics.push({ name: "db_latency_ms", value: db.latencyMs, unit: "ms", warn: 500, direction: "above" });
  if (checkAge != null) metrics.push({ name: "last_check_age_s", value: checkAge, unit: "s", warn: 600, crit: 1800, direction: "above" });
  if (incidents != null) metrics.push({ name: "open_incidents", value: incidents, unit: "count", direction: "above" });
  if (queueWait != null) metrics.push({ name: "worker_queue_wait_s", value: queueWait, unit: "s", warn: 600, crit: 1800, direction: "above" });
  if (coolify.ageSec != null) metrics.push({ name: "coolify_sync_age_s", value: coolify.ageSec, unit: "s", warn: 3600, direction: "above" });
  if (watch.refAgeH != null) metrics.push({ name: "reference_data_age_h", value: watch.refAgeH, unit: "h", warn: 36, crit: 72, direction: "above" });
  if (failed != null) metrics.push({ name: "failed_notifications_24h", value: failed, unit: "count", warn: 1, direction: "above" });
  if (creds.daysLeft != null) metrics.push({ name: "credential_days_left", value: creds.daysLeft, unit: "d", warn: 30, crit: 0, direction: "below" });
  metrics.push({ name: "process_rss_mb", value: Math.round(process.memoryUsage().rss / 1048576), unit: "MB", direction: "above" });

  let worst: CompStatus = "ok";
  for (const s of [...components.map((c) => c.status), ...metrics.map(metricStatus)]) if (RANK[s] > RANK[worst]) worst = s;

  return NextResponse.json({
    status: worst,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date(now).toISOString(),
    runtime: getRuntime(),
    components,
    metrics,
  });
}
