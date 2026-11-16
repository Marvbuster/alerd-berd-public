// Reine, seiteneffektfreie Übersetzung eines Coolify-Webhook-Events in einen
// Alerd-Status — analog zu check-logic.ts, ohne Prisma/Netz, separat testbar.
//
// Coolify postet team-weit ALLE Notifications an eine URL. Der Umschlag jedes
// Events: { success, event, message, ...event-spezifisch }. Dieser Monitor
// repräsentiert den Coolify-SERVER, nicht die darauf gehosteten Dienste (die
// hängt man selbst als eigene Monitore in Alerd ein). Darum treiben nur
// server-/plattformweite Events die Ampel; App-/Dienst-Events werden ignoriert.
import type { CheckStatus } from "@prisma/client";

// Rohform des Coolify-Payloads — alle Felder optional, additionalProperties.
export interface CoolifyEvent {
  success?: boolean;
  event?: string;
  message?: string;
  [key: string]: unknown;
}

// Server-/plattformweite Events → Ampel. (Coolify-Doc: Event-Namen v4.5.0.)
// Volle Platte ist eine Warnung, kein Ausfall: orange. Rot nur, wenn der Server weg ist.
const DOWN_EVENTS = new Set(["server_unreachable"]);
const DEGRADED_EVENTS = new Set([
  "high_disk_usage",
  "container_stopped",
  "docker_cleanup_failed",
  "traefik_version_outdated",
  "server_patch_check_error",
]);
const UP_EVENTS = new Set([
  "server_reachable",
  "container_restarted",
  "docker_cleanup_success",
  "server_patch_check",
  "test", // Button „Send test" im Coolify-Dashboard
]);

// App-/Dienst-Events — bewusst ignoriert: die Dienste werden separat per Pull
// überwacht, für den Server-Monitor sind sie Redundanz/Rauschen.
const IGNORE_EVENTS = new Set([
  "deployment_success",
  "deployment_failed",
  "status_changed",
  "restart_limit_reached",
  "backup_success",
  "backup_failed",
  "backup_success_with_s3_warning",
  "task_success",
  "task_failed",
]);

const UP: CheckStatus = "UP";
const DEGRADED: CheckStatus = "DEGRADED";
const DOWN: CheckStatus = "DOWN";

// uuid-Felder, die Coolify je nach Event mitschickt — fürs Idempotenz-Token.
const UUID_FIELDS = [
  "deployment_uuid",
  "application_uuid",
  "server_uuid",
  "database_uuid",
  "task_uuid",
];

function firstUuid(body: CoolifyEvent): string {
  for (const f of UUID_FIELDS) {
    const v = body[f];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

export interface MappedEvent {
  status: CheckStatus | null; // null = Event ignorieren (kein Check, keine Statusänderung)
  summary: string; // Klartext für Incident.cause / Anzeige
  eventKey: string; // stabiler Schlüssel zur Deduplizierung von Coolify-Retries
}

// Übersetzt einen Coolify-Event in Status + Kurzfassung + Idempotenz-Schlüssel.
export function mapCoolifyEvent(body: CoolifyEvent): MappedEvent {
  const event = typeof body.event === "string" ? body.event : "";
  const message = typeof body.message === "string" ? body.message : "";
  const success = body.success === true;
  const summary = message || event || "Coolify-Event";
  const eventKey = `${event}|${firstUuid(body)}|${message}`;

  let status: CheckStatus | null;
  if (IGNORE_EVENTS.has(event)) status = null;
  else if (DOWN_EVENTS.has(event)) status = DOWN;
  else if (DEGRADED_EVENTS.has(event)) status = DEGRADED;
  else if (UP_EVENTS.has(event)) status = UP;
  else status = success ? UP : DEGRADED; // unbekanntes (server-scoped) Event: lieber sichtbar machen

  return { status, summary, eventKey };
}
