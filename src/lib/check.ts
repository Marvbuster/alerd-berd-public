import { messageCode as _code, MessageError as _Error } from "@/i18n/translate";
// Minimaler Check-Runner (0.2): pollt fällige/aktive Monitore, schreibt Check,
// pflegt Live-Status am Monitor und öffnet/schließt Incidents.
// HEALTH + HTTP über fetch, TCP über net-Socket. PING noch nicht implementiert.

import net from "node:net";
import { prisma } from "./prisma";
import { dispatchAlert } from "./alert";
import { alertCriticalAdvisories, refreshReferenceData, syncMonitorPackages } from "./version-watch";
import { mapWord, worsenByResponseTime, buildUrl, isDue, ensureScheme } from "./check-logic";
import type { CheckStatus, Monitor } from "@prisma/client";
import { warnExpiringCredentials } from "./credential-expiry-watch";

const UP: CheckStatus = "UP";
const DOWN: CheckStatus = "DOWN";
const UNKNOWN: CheckStatus = "UNKNOWN";

export interface Probe {
  status: CheckStatus;
  responseMs: number | null;
  statusCode: number | null;
  error: string | null;
  version?: string | null;
  uptimeSec?: number | null;
  payload?: unknown;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

async function probeHealth(m: Monitor): Promise<Probe> {
  const url = buildUrl(m.target, m.healthPath);
  const t0 = Date.now();
  const { signal, cancel } = withTimeout(m.timeoutMs);
  try {
    const res = await fetch(url, {
      signal,
      cache: "no-store",
      headers: m.bearerToken ? { authorization: `Bearer ${m.bearerToken}` } : undefined,
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text);
    } catch {}
    if (res.status === 401) return { status: UNKNOWN, responseMs: ms, statusCode: 401, error: _code("validation.mc0a2a72d0d") };
    const word = typeof payload?.status === "string" ? (payload.status as string) : undefined;
    const status = worsenByResponseTime(mapWord(word, res.ok), ms, m.degradedAboveMs, m.downAboveMs);
    return {
      status,
      responseMs: ms,
      statusCode: res.status,
      error: status === DOWN ? `status=${word ?? res.status}` : null,
      version: typeof payload?.version === "string" ? (payload.version as string) : null,
      uptimeSec: typeof payload?.uptimeSec === "number" ? (payload.uptimeSec as number) : null,
      payload: payload ?? undefined,
    };
  } catch (e) {
    return { status: DOWN, responseMs: Date.now() - t0, statusCode: null, error: (e as Error).name === "AbortError" ? "Timeout" : String(e) };
  } finally {
    cancel();
  }
}

async function probeHttp(m: Monitor): Promise<Probe> {
  const t0 = Date.now();
  const { signal, cancel } = withTimeout(m.timeoutMs);
  try {
    const res = await fetch(ensureScheme(m.target), { signal, cache: "no-store", method: m.method ?? "GET" });
    const ms = Date.now() - t0;
    let status: CheckStatus;
    let error: string | null = null;
    if (m.expectedStatus != null) {
      status = res.status === m.expectedStatus ? UP : DOWN;
      if (status === DOWN) error = _code("validation.httpExpected", { status: res.status, expected: m.expectedStatus });
    } else {
      status = res.ok ? UP : DOWN;
      if (status === DOWN) error = `HTTP ${res.status}`;
    }
    if (status === UP && m.keyword) {
      const body = await res.text();
      if (!body.includes(m.keyword)) {
        status = DOWN;
        error = _code("validation.me0ffbad143", { value0: m.keyword });
      }
    }
    return { status, responseMs: ms, statusCode: res.status, error };
  } catch (e) {
    return { status: DOWN, responseMs: Date.now() - t0, statusCode: null, error: (e as Error).name === "AbortError" ? "Timeout" : String(e) };
  } finally {
    cancel();
  }
}

function probeTcp(m: Monitor): Promise<Probe> {
  const [host, portStr] = m.target.split(":");
  const port = parseInt(portStr ?? "", 10);
  const t0 = Date.now();
  return new Promise((resolve) => {
    if (!host || !Number.isFinite(port)) {
      resolve({ status: DOWN, responseMs: null, statusCode: null, error: _code("validation.m061518b639") });
      return;
    }
    const sock = new net.Socket();
    const done = (p: Probe) => {
      sock.destroy();
      resolve(p);
    };
    sock.setTimeout(m.timeoutMs);
    sock.once("connect", () => done({ status: UP, responseMs: Date.now() - t0, statusCode: null, error: null }));
    sock.once("timeout", () => done({ status: DOWN, responseMs: Date.now() - t0, statusCode: null, error: _code("validation.m70594d9329") }));
    sock.once("error", (e) => done({ status: DOWN, responseMs: Date.now() - t0, statusCode: null, error: String(e) }));
    sock.connect(port, host);
  });
}

async function probe(m: Monitor): Promise<Probe> {
  switch (m.kind) {
    case "HEALTH": return probeHealth(m);
    case "HTTP":
    case "KEYWORD": return probeHttp(m);
    case "TCP": return probeTcp(m);
    default: return { status: UNKNOWN, responseMs: null, statusCode: null, error: _code("validation.me3bd7b4a28") };
  }
}

// Exportiert, damit der Push-Ingest (/api/ingest) denselben Pfad nutzt:
// Check schreiben, Live-Status pflegen, Incident auf/zu + Alarm. Funktioniert
// mit responseMs/statusCode = null (Push hat keine Antwortzeit).
export async function applyResult(m: Monitor, p: Probe) {
  const now = new Date();
  const changed = p.status !== m.currentStatus;

  await prisma.check.create({
    data: {
      monitorId: m.id,
      status: p.status,
      responseTimeMs: p.responseMs,
      statusCode: p.statusCode,
      error: p.error,
      version: p.version ?? null,
      uptimeSec: p.uptimeSec ?? null,
      payload: (p.payload ?? undefined) as never,
    },
  });

  await prisma.monitor.update({
    where: { id: m.id },
    data: {
      currentStatus: p.status,
      lastCheckedAt: now,
      lastResponseMs: p.responseMs,
      consecutiveFailures: p.status === DOWN ? m.consecutiveFailures + 1 : 0,
      ...(changed || m.stateSince == null ? { stateSince: now } : {}),
      ...(p.status === UP ? { lastUpAt: now } : {}),
    },
  });

  // Versionswächter: Live-Versionen aus dem runtime-Feld übernehmen — nur bei
  // einer parsebaren Spec-Antwort; ein Ausfall lässt den letzten Stand stehen.
  if (m.kind === "HEALTH" && p.payload && typeof p.payload === "object") {
    await syncMonitorPackages(m.id, p.payload, now).catch((e) => console.error("[version-watch] sync failed:", e));
  }

  // Incidents
  const open = await prisma.incident.findFirst({
    where: { monitorId: m.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  if (p.status === DOWN && !open) {
    const incident = await prisma.incident.create({ data: { monitorId: m.id, cause: p.error ?? "DOWN" } });
    await dispatchAlert(m, incident, "DOWN");
  } else if (p.status !== DOWN && open) {
    await prisma.incident.update({ where: { id: open.id }, data: { status: "RESOLVED", resolvedAt: now } });
    await dispatchAlert(m, open, "RECOVERED");
  }

  return { name: m.name, status: p.status, responseMs: p.responseMs, changed };
}

export async function runChecks(force = false, ownerId?: string) {
  // PUSH-Monitore werden nie gepollt — sie bekommen ihren Status via /api/ingest.
  // ownerId gesetzt (manueller „jetzt prüfen" eines Users) → nur dessen Monitore;
  // ohne (System-Scheduler) → alle Mandanten.
  const monitors = await prisma.monitor.findMany({
    where: { enabled: true, kind: { not: "PUSH" }, ...(ownerId ? { ownerId } : {}) },
  });
  const now = Date.now();
  const targets = force
    ? monitors
    : monitors.filter((m) => isDue(m.lastCheckedAt?.getTime() ?? null, m.intervalSec, m.phase, now));
  const results = [];
  for (const m of targets) {
    const p = await probe(m);
    results.push(await applyResult(m, p));
  }

  // Versionswächter: Referenzwissen (höchstens täglich) + Alarm bei kritischen
  // Advisories. Fehler dürfen den Check-Lauf nie kippen.
  try {
    await refreshReferenceData();
    await alertCriticalAdvisories(ownerId);
  } catch (e) {
    console.error("[version-watch] failed:", e);
  }

  // Ablaufende Zugänge (GitHub, Claude): je Stufe genau eine Meldung.
  try {
    await warnExpiringCredentials(ownerId);
  } catch (e) {
    console.error("[credential-expiry] failed:", e);
  }

  return { checked: results.length, at: new Date().toISOString(), results };
}

// Sofort-Check EINES Monitors (manueller Trigger aus der Detail-View).
// Gibt null zurück, wenn der Monitor fehlt oder pausiert ist.
export async function runCheckForMonitor(id: string) {
  const m = await prisma.monitor.findUnique({ where: { id } });
  if (!m || !m.enabled) return null;
  if (m.kind === "PUSH") return null; // Push-Monitore kann man nicht aktiv prüfen
  const p = await probe(m);
  return applyResult(m, p);
}
