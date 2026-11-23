import { prisma } from "@/lib/prisma";
import { analysisRecommendation, analysisRisk, TERMINAL_STATUSES } from "@/lib/dependency-phase";
import type { DependencyJobStatus } from "@prisma/client";
import { batchStage as libBatchStage } from "../../scripts/dependency-worker-lib.mjs";

// Sammel-Update (tasks/batch-update.md): Wo ein Lauf steht, folgt aus seinen Jobs.
// Gespeichert sind am Lauf nur Pause und Abbruch.

// Die Stufenlogik liegt in der Worker-Lib, weil auch der Worker sie braucht
// (Web Push je Stufe). Hier nur mit Typen.
export type BatchStage = "analyzing" | "approval1" | "preparing" | "approval2" | "publishing" | "paused" | "done" | "cancelled";
export type StageJob = { status: string; publishApprovalAt?: Date | null };
export const batchStage = libBatchStage as (batch: { pausedAt?: Date | null; cancelledAt?: Date | null }, jobs: StageJob[]) => BatchStage;

export const LIVE_STATUSES = ["LIVE", "LIVE_UNVERIFIED", "PUSHED"];

// Der Tab „Sammel-Update“ gibt es nur, solange ein Lauf offene Jobs hat.
export async function loadActiveBatchId(ownerId: string): Promise<string | null> {
  const batch = await prisma.dependencyBatch.findFirst({
    where: { ownerId, cancelledAt: null, jobs: { some: { status: { notIn: TERMINAL_STATUSES as DependencyJobStatus[] } } } },
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  return batch?.id ?? null;
}

export async function loadBatch(ownerId: string, id: string) {
  const batch = await prisma.dependencyBatch.findFirst({
    where: { id, ownerId },
    select: {
      id: true, createdAt: true, pausedAt: true, pauseReason: true, cancelledAt: true,
      jobs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, applicationId: true, packageName: true, targetVersion: true, packages: true, engine: true, status: true,
          updatedAt: true, workerLockedUntil: true, workerAttemptAt: true, lastError: true, publishedAt: true, publishApprovalAt: true,
          application: { select: { name: true } },
          // Die jüngste Analyse, nicht die letzte Antwort auf eine Rückfrage.
          messages: { where: { role: "ASSISTANT" }, orderBy: { createdAt: "desc" }, take: 8, select: { content: true } },
        },
      },
    },
  });
  if (!batch) return null;
  const jobs = batch.jobs.map(({ application, messages, ...job }) => {
    const analysis = messages.find((m) => analysisRisk(m.content))?.content ?? null;
    return { ...job, applicationName: application.name, risk: analysis ? analysisRisk(analysis) : null, recommendation: analysis ? recommendationLine(analysis) : null };
  });
  return { ...batch, jobs, stage: batchStage(batch, jobs) };
}

// Die Empfehlung der Analyse als eine Zeile für die Sammelfreigabe, ohne Überschrift und Markdown.
export function recommendationLine(text: string): string | null {
  const block = analysisRecommendation(text).recommendation;
  if (!block) return null;
  const line = block.split("\n").slice(1).map((l) => l.replace(/[#*_`>]/g, "").replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean).join(" ");
  if (!line) return null;
  return line.length > 180 ? `${line.slice(0, 178).trimEnd()} …` : line;
}
