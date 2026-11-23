import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadBatch } from "@/lib/dependency-batch";
import { loadChatProps } from "@/lib/dependency-chat-load";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";
import { dependencyPhase } from "@/lib/dependency-phase";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import { PageHeader } from "@/components/PageHeader";
import { BatchBoard, type BatchRow } from "@/components/BatchBoard";
import { QueueChat } from "@/components/QueueChat";

// Ein Sammel-Update: Fortschritt aller Dienste und die beiden Sammelfreigaben.
// ?chat=<appId> öffnet den Update-Chat eines Dienstes als Fenster über der Seite,
// Schließen führt zurück hierher.
export const dynamic = "force-dynamic";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ chat?: string }> }) {
  const _locale = await _getLocale();
  const user = await requireUser();
  const [{ id }, { chat }] = await Promise.all([params, searchParams]);
  const [batch, { busy, lastSeen }, chatProps, claude, localNode] = await Promise.all([
    loadBatch(user.id, id),
    loadWorkerStatus(undefined, _locale),
    typeof chat === "string" && chat ? loadChatProps(user.id, chat, _locale) : null,
    prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
  ]);
  if (!batch) notFound();
  const now = new Date();
  const rows: BatchRow[] = batch.jobs.map((job) => {
    let phase = dependencyPhase(job, now, { workerBusy: busy, workerLastSeen: lastSeen }, _locale);
    // Im Lauf entscheidet man an der Sammelfreigabe, nicht pro Dienst: Wer fertig ist,
    // wartet auf die anderen, statt „du bist dran“ zu melden.
    const early = (batch.stage === "analyzing" && job.status === "READY_FOR_REVIEW") || (batch.stage === "preparing" && job.status === "READY_TO_PUSH");
    if (early) phase = { ...phase, actor: "waiting", title: _t(_locale, job.status === "READY_FOR_REVIEW" ? "BatchUpdate.analysisDone" : "BatchUpdate.testsDone") };
    // Nach Freigabe 2 wartet ein Dienst, bis sein Push an der Reihe ist.
    if (job.status === "READY_TO_PUSH" && job.publishApprovalAt) phase = { ...phase, actor: batch.stage === "paused" ? "stalled" : "waiting", title: _t(_locale, batch.stage === "paused" ? "BatchUpdate.pushOnHold" : "BatchUpdate.pushQueued") };
    return {
      jobId: job.id, applicationId: job.applicationId, applicationName: job.applicationName, label: jobLabel(jobPackages(job), _locale),
      engine: job.engine, status: job.status, risk: job.risk, recommendation: job.recommendation, actor: phase.actor, title: phase.title, changedAt: job.updatedAt.toISOString(), publishApproved: !!job.publishApprovalAt,
    };
  });
  const basePath = `/batch/${batch.id}`;
  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-7">
    <PageHeader title={_t(_locale, "BatchUpdate.pageTitle")} description={_t(_locale, "BatchUpdate.pageDescription", { count: rows.length })} icon="refresh" />
    <BatchBoard basePath={basePath} stage={batch.stage} pauseReason={batch.pauseReason} rows={rows} gate={{ batchId: batch.id, hasClaude: !!claude, hasLocalNode: !!localNode }} chatOpen={!!chatProps} />
    {chatProps && <QueueChat key={chatProps.applicationId} basePath={basePath} {...chatProps} />}
  </main>;
}
