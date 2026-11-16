// Reine, seiteneffektfreie Check-Entscheidungslogik — von check.ts genutzt und
// separat testbar/mutierbar (ohne Prisma/Netz).
import type { CheckStatus } from "@prisma/client";

const UP: CheckStatus = "UP";
const DEGRADED: CheckStatus = "DEGRADED";
const DOWN: CheckStatus = "DOWN";

// Verschiedene Status-Vokabulare der Dienste auf unseren Status mappen.
export function mapWord(word: string | undefined, httpOk: boolean): CheckStatus {
  if (!word) return httpOk ? UP : DOWN;
  const s = word.toLowerCase();
  if (["ok", "up", "healthy", "pass", "green", "operational"].includes(s)) return UP;
  if (["degraded", "warn", "warning", "yellow", "orange", "partial"].includes(s)) return DEGRADED;
  if (["down", "error", "fail", "failed", "unhealthy", "critical", "red"].includes(s)) return DOWN;
  return httpOk ? UP : DOWN;
}

// Alerd-Board-Fallback-Schwellen auf die Antwortzeit — können nur verschärfen.
export function worsenByResponseTime(
  status: CheckStatus,
  responseMs: number,
  degradedAboveMs: number | null,
  downAboveMs: number | null,
): CheckStatus {
  if (status !== UP) return status;
  if (downAboveMs != null && responseMs >= downAboveMs) return DOWN;
  if (degradedAboveMs != null && responseMs >= degradedAboveMs) return DEGRADED;
  return UP;
}

// Fehlt das Schema, https:// annehmen (Nutzer tippen oft nur "host.de").
export function ensureScheme(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `https://${target}`;
}

// HEALTH: target + healthPath zu einer URL zusammensetzen (mit Schema).
export function buildUrl(target: string, path: string | null): string {
  const base = ensureScheme(target);
  if (!path) return base;
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}

// Fällig auf dem Phasen-Raster? Staffelt echte Checks bei kontinuierlichem Lauf.
export function isDue(
  lastCheckedMs: number | null,
  intervalSec: number,
  phase: number,
  nowMs: number,
): boolean {
  if (lastCheckedMs == null) return true;
  const interval = intervalSec * 1000;
  const phaseMs = phase * interval;
  const nextTime = (Math.floor((lastCheckedMs - phaseMs) / interval) + 1) * interval + phaseMs;
  return nowMs >= nextTime;
}
