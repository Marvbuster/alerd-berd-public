import { prisma } from "@/lib/prisma";

// Alte Checks löschen. Jeder Monitor schreibt pro Minute eine Zeile, bei
// Spec-Health samt kompletter Antwort als JSON, und gelesen werden nur die
// letzten 48 Checks (Antwortzeit-Kurve) und der letzte (Version, Komponenten).
// Ohne Aufräumen wuchs die Tabelle unbegrenzt (633 MB am 2026-11-16).
// Incidents liegen in einer eigenen Tabelle und bleiben vollständig.

export const CHECK_KEEP_MS = 14 * 24 * 60 * 60_000;
// Die volle Antwort gesunder Checks braucht nach einem Tag niemand mehr: Die App
// liest nur die jeweils letzte, Kurven brauchen Status und Antwortzeit. Bei
// eingeschränkten und ausgefallenen Checks bleibt sie die vollen 14 Tage für die
// Fehlersuche, Push-Ereignisse bleiben ganz. Senkte die Tabelle um grob 90 %.
export const PAYLOAD_KEEP_MS = 24 * 60 * 60_000;
// Häppchen pro Monitor über den Index (monitorId, checkedAt), damit die
// Tabelle nie lange gesperrt ist. Pro Lauf höchstens MAX_ROWS, der Altbestand
// verteilt sich so auf ein paar Läufe im Minutentakt.
const BATCH = 5_000;
const MAX_ROWS = 50_000;
// Ist alles Alte weg, reicht ein Durchgang pro Stunde.
const IDLE_MS = 60 * 60_000;

let idleUntil = 0;
let running = false;

export function resetCheckRetention() { idleUntil = 0; running = false; }

export async function pruneOldChecks(now = new Date()): Promise<{ deleted: number; stripped: number; skipped: boolean }> {
  if (running || now.getTime() < idleUntil) return { deleted: 0, stripped: 0, skipped: true };
  running = true;
  try {
    const cutoff = new Date(now.getTime() - CHECK_KEEP_MS);
    const payloadCutoff = new Date(now.getTime() - PAYLOAD_KEEP_MS);
    const monitors = await prisma.monitor.findMany({ select: { id: true, kind: true } });
    let deleted = 0;
    let stripped = 0;
    let more = false;
    for (const monitor of monitors) {
      while (deleted + stripped < MAX_ROWS) {
        const n = await prisma.$executeRaw`DELETE FROM "Check" WHERE "id" IN (SELECT "id" FROM "Check" WHERE "monitorId" = ${monitor.id} AND "checkedAt" < ${cutoff} LIMIT ${BATCH})`;
        deleted += n;
        if (n < BATCH) break;
      }
      // Antwort gesunder Checks nach einem Tag leeren, den jeweils letzten Check
      // aber nie (ein pausierter Monitor zeigt sonst keine Komponenten mehr).
      while (monitor.kind !== "PUSH" && deleted + stripped < MAX_ROWS) {
        const n = await prisma.$executeRaw`UPDATE "Check" SET "payload" = NULL WHERE "id" IN (SELECT "id" FROM "Check" WHERE "monitorId" = ${monitor.id} AND "checkedAt" < ${payloadCutoff} AND "status" = 'UP' AND "payload" IS NOT NULL AND "checkedAt" < (SELECT max("checkedAt") FROM "Check" WHERE "monitorId" = ${monitor.id}) LIMIT ${BATCH})`;
        stripped += n;
        if (n < BATCH) break;
      }
      if (deleted + stripped >= MAX_ROWS) { more = true; break; }
    }
    if (!more) idleUntil = now.getTime() + IDLE_MS;
    if (deleted || stripped) console.log(`[checks] ${deleted} Checks älter als 14 Tage gelöscht, ${stripped} Antworten älter als 24 h geleert${more ? ", es kommt noch mehr" : ""}`);
    return { deleted, stripped, skipped: false };
  } finally {
    running = false;
  }
}
