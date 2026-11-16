"use server";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MonitorKind, Prisma } from "@prisma/client";
import { nextPhase } from "@/lib/phase";
import { applyResult, runChecks, runCheckForMonitor } from "@/lib/check";
import { requireUser } from "@/lib/auth";

const KINDS: MonitorKind[] = ["HEALTH", "HTTP", "TCP", "PING", "KEYWORD", "PUSH"];

// Unguessbares Token für den Push-Ingest-URL-Pfad (/api/ingest/<token>).
function genIngestToken(): string {
  return randomBytes(24).toString("base64url");
}

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function int(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Stellt sicher, dass der Monitor dem User gehört (sonst „nicht gefunden" —
// kein Infoleak über fremde Datensätze). Gibt die geprüfte id zurück.
async function ownMonitor(id: string, ownerId: string): Promise<void> {
  const m = await prisma.monitor.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!m) throw new Error("Monitor nicht gefunden.");
}

// Baut das Prisma-Datenobjekt aus dem Formular. Nur für die gewählte Art
// relevante Felder werden gesetzt, der Rest bewusst auf null (sauberes Update).
function parseForm(fd: FormData): Prisma.MonitorUncheckedCreateInput {
  const name = str(fd, "name");
  const target = str(fd, "target");
  const kindRaw = str(fd, "kind") ?? "HEALTH";
  const kind = (KINDS.includes(kindRaw as MonitorKind) ? kindRaw : "HEALTH") as MonitorKind;

  if (!name) throw new Error("Name ist Pflicht.");
  if (!target) throw new Error("Ziel (target) ist Pflicht.");

  return {
    name,
    kind,
    target,
    enabled: fd.get("enabled") === "on",
    intervalSec: int(fd, "intervalSec") ?? 60,
    timeoutMs: int(fd, "timeoutMs") ?? 10000,

    // HTTP / KEYWORD
    method: kind === "HTTP" || kind === "KEYWORD" ? str(fd, "method") ?? "GET" : null,
    expectedStatus: kind === "HTTP" ? int(fd, "expectedStatus") : null,
    keyword: kind === "KEYWORD" ? str(fd, "keyword") : null,

    // HEALTH
    healthPath: kind === "HEALTH" ? str(fd, "healthPath") ?? "/health" : null,
    bearerToken: kind === "HEALTH" ? str(fd, "bearerToken") : null,
    degradedAboveMs: kind === "HEALTH" ? int(fd, "degradedAboveMs") : null,
    downAboveMs: kind === "HEALTH" ? int(fd, "downAboveMs") : null,
  };
}

export async function createMonitor(fd: FormData) {
  const user = await requireUser();
  const data = parseForm(fd);
  // Phase-Pool bleibt global: der Scheduler staffelt alle Mandanten gemeinsam.
  const existing = await prisma.monitor.findMany({ select: { phase: true } });
  const phase = nextPhase(existing.map((m) => m.phase));
  // PUSH: Ingest-Token direkt mitgeben, damit die Webhook-URL sofort steht.
  const ingestToken = data.kind === "PUSH" ? genIngestToken() : null;
  await prisma.monitor.create({ data: { ...data, phase, ingestToken, ownerId: user.id } });
  revalidatePath("/"); revalidatePath("/services");
  redirect("/services");
}

export async function updateMonitor(id: string, fd: FormData) {
  const user = await requireUser();
  await ownMonitor(id, user.id);
  const data = parseForm(fd);
  // Wird ein Monitor (neu) zu PUSH und hat noch kein Token → eins nachziehen.
  let ingestToken: string | undefined;
  if (data.kind === "PUSH") {
    const current = await prisma.monitor.findUnique({ where: { id }, select: { ingestToken: true } });
    if (!current?.ingestToken) ingestToken = genIngestToken();
  }
  await prisma.monitor.update({ where: { id }, data: { ...data, ...(ingestToken ? { ingestToken } : {}) } });
  revalidatePath("/"); revalidatePath("/services");
  redirect("/services");
}

export async function deleteMonitor(id: string) {
  const user = await requireUser();
  await ownMonitor(id, user.id);
  await prisma.monitor.delete({ where: { id } });
  revalidatePath("/"); revalidatePath("/services");
  redirect("/services");
}

export async function toggleMonitor(id: string, enabled: boolean) {
  const user = await requireUser();
  await ownMonitor(id, user.id);
  await prisma.monitor.update({ where: { id }, data: { enabled } });
  revalidatePath("/"); revalidatePath("/services");
}

// Sofort-Check aller EIGENEN aktiven Monitore (manueller Trigger aus der UI).
export async function checkNow() {
  const user = await requireUser();
  await runChecks(true, user.id);
  revalidatePath("/"); revalidatePath("/services");
  revalidatePath("/sphere");
}

// Sofort-Check EINES eigenen Monitors (Trigger aus der Detail-View).
export async function checkMonitorNow(id: string) {
  const user = await requireUser();
  await ownMonitor(id, user.id);
  await runCheckForMonitor(id);
  revalidatePath("/"); revalidatePath("/services");
  revalidatePath("/sphere");
  revalidatePath(`/monitors/${id}`);
}

// --- Alarm-Kanäle (pro User) ---
export async function addEmailChannel(fd: FormData) {
  const user = await requireUser();
  const to = str(fd, "email");
  const label = str(fd, "label") ?? (to ?? "E-Mail");
  if (!to) throw new Error("E-Mail-Adresse fehlt.");
  await prisma.alertChannel.create({ data: { kind: "EMAIL", label, config: { to }, ownerId: user.id } });
  revalidatePath("/settings");
}

export async function toggleChannel(id: string, enabled: boolean) {
  const user = await requireUser();
  const res = await prisma.alertChannel.updateMany({ where: { id, ownerId: user.id }, data: { enabled } });
  if (res.count === 0) throw new Error("Kanal nicht gefunden.");
  revalidatePath("/settings");
}

export async function deleteChannel(id: string) {
  const user = await requireUser();
  const res = await prisma.alertChannel.deleteMany({ where: { id, ownerId: user.id } });
  if (res.count === 0) throw new Error("Kanal nicht gefunden.");
  revalidatePath("/settings");
}

export async function setDailyUpdateDigest(enabled: boolean) {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { dailyUpdateDigest: enabled } });
  revalidatePath("/settings");
}

// Push-Monitore bekommen ihren Status nur über Ereignisse der Quelle. Schickt
// sie keine Entwarnung (Coolify nach manueller Bereinigung), setzt man ihn hier
// von Hand auf grün. Läuft über denselben Kern wie der Ingest, mit Eintrag im Verlauf.
export async function resolvePushMonitor(id: string) {
  const user = await requireUser();
  const monitor = await prisma.monitor.findFirst({ where: { id, ownerId: user.id, kind: "PUSH" } });
  if (!monitor || monitor.currentStatus === "UP") return;
  await applyResult(monitor, {
    status: "UP", responseMs: null, statusCode: null, error: null,
    payload: { success: true, event: "manual_resolved", message: `Von Hand als behoben markiert (${user.email})` },
  });
  revalidatePath(`/monitors/${id}`); revalidatePath("/services");
}
