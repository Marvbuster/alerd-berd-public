import { translate as _t } from "@/i18n/translate";
// Gemeinsame Typen/Helfer für die Konstellations-Visualisierung.
// Server-safe (kein Browser-API) — wird sowohl in der Page (Datenaufbau) als
// auch in den Client-Components (Typen) importiert.

// Typen aus der Bewertungslogik (nur type-Import → semver landet nicht im Client).
import type { WatchLevel, Finding } from "./version-watch-logic";

export type VizStatus = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";

// Ein Messpunkt der Antwortzeit-Historie mit echtem Zeitstempel.
export interface HistoryPoint {
  t: number; // Zeitpunkt des Checks (epoch ms)
  ms: number | null; // Antwortzeit; null bei DOWN oder ohne Antwortzeit (z. B. PUSH).
  status?: VizStatus; // Push events may succeed without an HTTP response time.
}

// Health-Spec-Teile aus dem letzten Check-Payload (Alerd Berd Health Spec v1).
export interface HealthComponent {
  name: string;
  status: string; // "ok" | "degraded" | "down" (Spec-Vokabular, klein)
  detail?: string;
}
export interface HealthMetric {
  name: string;
  value: number;
  unit?: string;
  warn?: number;
  crit?: number;
  direction?: "above" | "below";
}

// Versionswächter: Bewertung eines live gemeldeten Pakets (z. B. next). Getrennt
// von der Verfügbarkeits-Ampel — eigenes Badge, öffnet nie einen Incident.
export type { WatchLevel };
export type PackageFinding = Finding;

export interface PackageWatch {
  name: string; // npm-Paketname
  version: string | null; // null = Dienst meldet runtime.packages nicht
  level: WatchLevel;
  latest: string | null; // npm dist-tag latest
  sinceMs: number | null; // seit wann genau diese Version live läuft
  findings: PackageFinding[];
}

export const WATCH_COLOR: Record<WatchLevel, string> = {
  red: "#ff8b93",
  orange: "#f8c66b",
  hint: "#51dcea",
  ok: "#69dda9",
  unknown: "#a3b6cf",
};

export function localizedWATCH_LABEL(_locale: string = "de"): Record<WatchLevel, string> { return ({
  red: _t(_locale, "viz.m6438846403"),
  orange: _t(_locale, "viz.mab2cbd984c"),
  hint: _t(_locale, "viz.m6c6f456f2b"),
  ok: _t(_locale, "viz.m2b31477379"),
  unknown: _t(_locale, "viz.m34eec17ffd"),
}); }
export const WATCH_LABEL = localizedWATCH_LABEL();

export interface VizNode {
  id: string;
  label: string;
  kind: string;
  target: string;
  status: VizStatus;
  responseMs: number | null;
  intervalSec: number;
  enabled: boolean;
  stateSinceMs: number | null; // seit wann currentStatus unverändert (epoch ms)
  uptimeSec: number | null; // vom Dienst gemeldete Prozess-Laufzeit im letzten Check (Spec-Health uptimeSec)
  uptimeAtMs: number | null; // Zeitpunkt dieses Checks, damit die Laufzeit live weiterzählt
  lastCheckedMs: number | null; // letzter Check (epoch ms)
  lastUpMs: number | null; // letzter Check mit Status UP (epoch ms)
  phase: number; // Versatz im Intervall (0..1) → gestaffelte Checks
  history: HistoryPoint[]; // echte Messpunkte (älteste→neueste)
  version: string | null; // gemeldete Dienst-Version aus dem letzten Payload
  components: HealthComponent[]; // Sub-Systeme aus dem letzten Spec-Health-Payload
  metrics: HealthMetric[]; // Messwerte aus dem letzten Spec-Health-Payload
  packages: PackageWatch[]; // Versionswächter (nur HEALTH-Monitore), leer sonst
  commit: string | null; // runtime.commit: Git-Commit des laufenden Builds, falls gemeldet
  coolifyApps: { id: string; name: string; connectionLabel: string; missing: boolean }[];
}

export const STATUS_COLOR: Record<VizStatus, string> = {
  UP: "#69dda9",
  DEGRADED: "#f8c66b",
  DOWN: "#ff8b93",
  UNKNOWN: "#a3b6cf",
};

// Was ein Verlaufspunkt im Antwortzeit-Graphen ist. Ein Ausfall nur bei DOWN,
// ein Punkt ohne Antwortzeit, aber mit gutem Status (etwa ein Push-Event von
// Coolify) ist ein Event, kein Ausfall. Alte Punkte ohne Status: ms null = Ausfall.
export type PointKind = "measured" | "outage" | "event";
export function historyPointKind(p: HistoryPoint): PointKind {
  if (p.status === "DOWN" || (p.status == null && p.ms == null)) return "outage";
  return p.ms == null ? "event" : "measured";
}

export function localizedSTATUS_LABEL(_locale: string = "de"): Record<VizStatus, string> { return ({ UP: _t(_locale, "viz.m0d21bd5202"), DEGRADED: _t(_locale, "viz.m55b60500c7"), DOWN: _t(_locale, "viz.ma1794783aa"), UNKNOWN: _t(_locale, "viz.m276ffa1fb4") }); }
export const STATUS_LABEL = localizedSTATUS_LABEL();

// Spec-Status-Wort ("ok"/"degraded"/"down") → Ampelfarbe. Unbekannt → UNKNOWN.
export function healthColor(status: string): string {
  switch (status.toLowerCase()) {
    case "ok":
      return STATUS_COLOR.UP;
    case "degraded":
      return STATUS_COLOR.DEGRADED;
    case "down":
      return STATUS_COLOR.DOWN;
    default:
      return STATUS_COLOR.UNKNOWN;
  }
}

// Ampel-Beitrag einer Metrik anhand ihrer Schwellen (fehlen sie → ok).
export function metricSeverity(m: HealthMetric): "ok" | "degraded" | "down" {
  const { value, warn, crit, direction } = m;
  if (direction === "below") {
    if (crit != null && value <= crit) return "down";
    if (warn != null && value <= warn) return "degraded";
    return "ok";
  }
  if (crit != null && value >= crit) return "down";
  if (warn != null && value >= warn) return "degraded";
  return "ok";
}

// Aus dem (unbekannt geformten) Check-Payload die Spec-Teile robust extrahieren.
export function parseHealthPayload(payload: unknown): {
  version: string | null;
  components: HealthComponent[];
  metrics: HealthMetric[];
} {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    version: typeof p.version === "string" ? p.version : null,
    components: Array.isArray(p.components) ? (p.components as HealthComponent[]) : [],
    metrics: Array.isArray(p.metrics) ? (p.metrics as HealthMetric[]) : [],
  };
}

// Echte Laufzeit seit dem letzten Start oder Deploy, wie der Dienst sie meldet.
// Nicht zu verwechseln mit stateSinceMs (seit wann der Status unverändert ist):
// beim Deploy bleibt der Status oft durchgehend grün. Bei DOWN ist die letzte
// Meldung veraltet, dann gibt es keine Laufzeit.
export function liveUptimeMs(node: Pick<VizNode, "uptimeSec" | "uptimeAtMs" | "status">, now = Date.now()): number | null {
  if (node.uptimeSec == null || node.uptimeAtMs == null || node.status === "DOWN") return null;
  return node.uptimeSec * 1000 + Math.max(0, now - node.uptimeAtMs);
}
