import { translate as _t } from "@/i18n/translate";
// Reine Logik der Dienste-Ansicht, ohne DB und ohne React: Ampel aus mehreren
// Checks, Hosts und Domains vergleichen, Health-Probes deuten, filtern.
import type { VizStatus } from "./viz";

export type ServiceStatus = VizStatus | "PAUSED" | "UNMONITORED";

const RANK: Record<VizStatus, number> = { DOWN: 3, DEGRADED: 2, UNKNOWN: 1, UP: 0 };

// Der schlechteste aktive Check bestimmt die Ampel. Nur pausierte Checks:
// PAUSED. Gar keine Checks: UNMONITORED.
export function aggregateStatus(checks: { status: VizStatus; enabled: boolean }[]): ServiceStatus {
  if (!checks.length) return "UNMONITORED";
  const active = checks.filter((c) => c.enabled);
  if (!active.length) return "PAUSED";
  return active.reduce<VizStatus>((worst, c) => RANK[c.status] > RANK[worst] ? c.status : worst, "UP");
}

// Reihenfolge in der Liste: was Aufmerksamkeit braucht, zuerst.
export const STATUS_ORDER: Record<ServiceStatus, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, UNMONITORED: 3, UP: 4, PAUSED: 5 };

export function localizedSTATUS_META(_locale: string = "de"): Record<ServiceStatus, { label: string; cls: string }> { return ({
  UP: { label: _t(_locale, "service_logic.m0d21bd5202"), cls: "up" },
  DEGRADED: { label: _t(_locale, "service_logic.m55b60500c7"), cls: "degraded" },
  DOWN: { label: _t(_locale, "service_logic.ma1794783aa"), cls: "down" },
  UNKNOWN: { label: _t(_locale, "service_logic.m276ffa1fb4"), cls: "unknown" },
  PAUSED: { label: _t(_locale, "service_logic.m02a733f164"), cls: "unknown" },
  UNMONITORED: { label: _t(_locale, "service_logic.m3d28c2e598"), cls: "unknown" },
}); }
export const STATUS_META = localizedSTATUS_META();

export function localizedCHECK_KIND_LABEL(_locale: string = "de"): Record<string, string> { return ({
  HEALTH: _t(_locale, "service_logic.me6f5858c68"), HTTP: _t(_locale, "service_logic.mbecf4edf10"), PUSH: _t(_locale, "service_logic.m731ce7ed80"),
  // Auslaufende Arten: bestehende Checks bleiben sichtbar, neue gibt es nicht.
  TCP: _t(_locale, "service_logic.mac281519eb"), KEYWORD: _t(_locale, "service_logic.mf734b5a889"), PING: _t(_locale, "service_logic.m796e1d6cb6"),
}); }
export const CHECK_KIND_LABEL = localizedCHECK_KIND_LABEL();

// Gliederung der Dienstliste nach Art der Überwachung. Hat ein Dienst mehrere
// Monitore, zählt der aussagekräftigste: Spec-Health vor Erreichbarkeit vor Push.
export type ServiceGroup = "HEALTH" | "REACH" | "PUSH" | "NONE";
export function localizedSERVICE_GROUPS(_locale: string = "de"): { id: ServiceGroup; label: string }[] { return ([
  { id: "HEALTH", label: _t(_locale, "service_logic.me6f5858c68") },
  { id: "REACH", label: _t(_locale, "service_logic.mbecf4edf10") },
  { id: "PUSH", label: _t(_locale, "service_logic.m731ce7ed80") },
  { id: "NONE", label: _t(_locale, "service_logic.m84d966d03f") },
]); }
export const SERVICE_GROUPS = localizedSERVICE_GROUPS();
export function serviceGroup(monitors: { kind: string }[]): ServiceGroup {
  if (monitors.some((m) => m.kind === "HEALTH")) return "HEALTH";
  if (monitors.some((m) => m.kind !== "PUSH")) return "REACH";
  return monitors.length ? "PUSH" : "NONE";
}

export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch { return null; }
}

export function domainList(domains: string | null | undefined): string[] {
  return String(domains ?? "").split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);
}

// Öffentliche https-Origins einer Coolify-App, ohne IPs, localhost oder
// interne Namen ohne Punkt. Grundlage für die Health-Probes.
export function originsOf(domains: string | null | undefined, max = 2): string[] {
  const origins: string[] = [];
  for (const raw of domainList(domains)) {
    let url: URL;
    try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { continue; }
    const host = url.hostname;
    if (url.protocol !== "https:" || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) continue;
    if (!origins.includes(url.origin)) origins.push(url.origin);
    if (origins.length === max) break;
  }
  return origins;
}

// Passt die URL eines Monitors zu einer der Domains einer App?
export function sameHost(target: string, domains: string | null | undefined): boolean {
  const host = hostOf(target);
  return !!host && domainList(domains).some((d) => hostOf(d) === host);
}

// Ergebnis eines Health-Probes deuten. Spec-Routen sind Bearer-geschützt:
// 401/403 heißt Route da mit Token, 503 Route da ohne gesetzten Token (so
// antworten Messenger und Example App), 200 mit Spec-JSON eine offene Spec-Route.
// Die Startseite zählt als erreichbar, sobald sie antwortet, auch mit einer
// Weiterleitung (etwa / → /de). Der eigentliche Check folgt Weiterleitungen.
export type ProbeKind = "spec-protected" | "spec-unconfigured" | "spec-open" | "liveness" | "reachable" | "none";

export function classifyProbe(path: "spec" | "liveness" | "root", status: number, json: unknown): ProbeKind {
  const body = json && typeof json === "object" && !Array.isArray(json) ? json as Record<string, unknown> : null;
  if (path === "liveness") return status >= 200 && status < 300 ? "liveness" : "none";
  if (path === "root") return status >= 200 && status < 400 ? "reachable" : "none";
  if (status === 401 || status === 403) return "spec-protected";
  if (status === 503 && body) return "spec-unconfigured";
  if (status >= 200 && status < 300 && body && typeof body.status === "string" && Array.isArray(body.components)) return "spec-open";
  return "none";
}

export const SPEC_PATHS = ["/health", "/api/spec-health"] as const;
export const LIVENESS_PATH = "/api/health";

// Pfad für einen Erreichbarkeits-Monitor: frei wählbar, aber nur ein Pfad auf der
// eigenen Domain, nie eine andere Origin (kein "//host", kein Schema).
export function httpPathOk(path: string): boolean {
  return path.length <= 200 && /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%\/?-]*$/.test(path);
}

export type ServiceFilter = "all" | "attention" | "updates" | "unmonitored";

export interface FilterableService {
  name: string; domain: string | null; status: ServiceStatus; update: boolean; search: string;
}

export function matchesFilter(service: FilterableService, filter: ServiceFilter): boolean {
  switch (filter) {
    case "attention": return service.status === "DOWN" || service.status === "DEGRADED";
    case "updates": return service.update;
    case "unmonitored": return service.status === "UNMONITORED";
    default: return true;
  }
}

export function matchesQuery(service: FilterableService, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${service.name} ${service.domain ?? ""} ${service.search}`.toLowerCase().includes(q);
}

// Einzelne Checks eines Dienstes für die Anzeige „8/10“: die Komponenten aus
// den Spec-Health-Antworten, und ein Monitor ohne Komponenten zählt als ein
// Check. Grün, wenn alle ok sind, orange bei einem eingeschränkten, rot bei
// einem Fehler. Pausierte Monitore zählen nicht.
export type CheckTally = { ok: number; total: number; level: "ok" | "warn" | "error" };

export function checkTally(monitors: { status: VizStatus; enabled: boolean; components: { status: string }[] }[]): CheckTally | null {
  let ok = 0, total = 0, warn = false, error = false;
  for (const m of monitors.filter((m) => m.enabled)) {
    // Ist der Monitor selbst nicht erreichbar, sind seine alten Komponenten nicht aussagekräftig.
    const parts = m.status === "DOWN" || !m.components.length ? [{ status: m.status === "UP" ? "ok" : m.status === "DEGRADED" ? "degraded" : m.status === "DOWN" ? "down" : "unknown" }] : m.components;
    for (const part of parts) {
      total++;
      const s = part.status.toLowerCase();
      if (s === "ok") ok++;
      else if (s === "degraded" || s === "unknown") warn = true;
      else error = true;
    }
  }
  return total ? { ok, total, level: error ? "error" : warn ? "warn" : "ok" } : null;
}
