"use client";

import { intlLocale } from "@/i18n/locale";
import { translate as _t, translateMessage as _message } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { StateChip } from "./QueueBoard";
import { NOTIFICATIONS_EVENT } from "./NotificationHub";
import { markDependencySeen } from "@/app/coolify/dependency-actions";
import { EngineChip } from "./DependencyAssistant";
import { ago, type Phase } from "@/lib/dependency-phase";
import type { BatchStage } from "@/lib/dependency-batch";
import { approveBatchAnalyses, approveBatchPushes, cancelBatch, resumeBatch, setBatchConclusionEngine, switchBatchEngine, type BatchGateState } from "@/app/batch/actions";

export type BatchRow = {
  jobId: string; applicationId: string; applicationName: string; label: string; engine: string; status: string;
  risk: string | null; recommendation: string | null; actor: Phase["actor"]; title: string; changedAt: string;
  publishApproved: boolean;
};

export type BatchGate = { batchId: string; hasClaude: boolean; hasLocalNode: boolean };

const POLL_MS = 5_000;
const STEPS = ["analyzing", "approval1", "preparing", "approval2", "publishing"] as const;
const RISK_KEY: Record<string, string> = { sicher: "common.riskSafe", prüfen: "common.riskReview", riskant: "common.riskRisky" };
const RISK_CHIP: Record<string, string> = { sicher: "service-chip--ok", prüfen: "service-chip--warn", riskant: "service-chip--danger" };

function Steps({ stage }: { stage: BatchStage }) {
  const _locale = _useLocale();
  const at = stage === "done" ? STEPS.length : stage === "paused" ? STEPS.length - 1 : STEPS.indexOf(stage as (typeof STEPS)[number]);
  return <ol className="dependency-steps" aria-label={_t(_locale, "BatchUpdate.stepsLabel")}>{STEPS.map((step, i) => {
    const state = i < at ? "done" : i > at ? "todo" : stage === "paused" ? "failed" : step.startsWith("approval") ? "current" : "running";
    return <li key={step} className={`dependency-step dependency-step--${state}`} aria-current={i === at ? "step" : undefined}>
      <span className="dependency-step-mark">{state === "done" ? "✓" : state === "failed" ? "!" : i + 1}</span>{_t(_locale, `BatchUpdate.step_${step}`)}
    </li>;
  })}</ol>;
}

function RowBody({ row, basePath }: { row: BatchRow; basePath: string }) {
  const _locale = _useLocale();
  return <div className="min-w-0 flex-1">
    <span className="queue-title"><Link href={`${basePath}?chat=${encodeURIComponent(row.applicationId)}`} scroll={false}><strong>{row.applicationName}</strong><span className="queue-label">{row.label}</span></Link></span>
    <span className="batch-row-meta"><EngineChip engine={row.engine} />{row.risk && <span className={`service-chip ${RISK_CHIP[row.risk] ?? ""}`}>{_t(_locale, RISK_KEY[row.risk] ?? "common.riskReview")}</span>}<span>{row.title}</span></span>
  </div>;
}

function Time({ row, now }: { row: BatchRow; now: Date }) {
  const _locale = _useLocale();
  return <span className="queue-time" title={new Date(row.changedAt).toLocaleString(intlLocale(_locale))}>{ago(new Date(row.changedAt), now, _locale)}</span>;
}

// Freigabe 1: Analyse mit der anderen Engine neu. Freigabe 2: wer das Fazit
// nach dem Deploy schreibt, ohne dass etwas neu läuft.
function EngineSwitch({ row, gate, mode }: { row: BatchRow; gate: BatchGate; mode: "analysis" | "conclusion" }) {
  const _locale = _useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (engine: "CLAUDE" | "LOCAL_NODE") => start(async () => {
    const result = mode === "analysis" ? await switchBatchEngine(row.jobId, engine) : await setBatchConclusionEngine(row.jobId, engine);
    setError(result.ok ? null : result.message ?? null);
    router.refresh();
  });
  if (mode === "analysis") {
    const other = row.engine === "LOCAL_NODE" ? "CLAUDE" : "LOCAL_NODE";
    if (other === "CLAUDE" ? !gate.hasClaude : !gate.hasLocalNode) return null;
    return <span className="batch-engine-switch">
      <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => set(other)}>{_t(_locale, other === "CLAUDE" ? "BatchUpdate.againClaude" : "BatchUpdate.againLocal")}</button>
      {error && <span className="service-error">{_message(_locale, error)}</span>}
    </span>;
  }
  if (!gate.hasClaude || !gate.hasLocalNode) return null;
  return <span className="batch-engine-switch">
    <span className="service-meta">{_t(_locale, "BatchUpdate.conclusion")}</span>
    <span className="view-toggle batch-toggle">{(["CLAUDE", "LOCAL_NODE"] as const).map((engine) => <button key={engine} type="button" disabled={pending} aria-pressed={row.engine === engine} aria-current={row.engine === engine ? "true" : undefined} onClick={() => set(engine)}>{engine === "CLAUDE" ? "Claude" : _t(_locale, "BatchUpdate.localShort")}</button>)}</span>
    {error && <span className="service-error">{_message(_locale, error)}</span>}
  </span>;
}

// Eine Sammelfreigabe. Freigabe 1: vorausgewählt ist, was die Analyse für sicher
// hält. Freigabe 2: alles, was getestet bereitsteht.
function Gate({ which, rows, basePath, gate, now }: { which: 1 | 2; rows: BatchRow[]; basePath: string; gate: BatchGate; now: Date }) {
  const _locale = _useLocale();
  const choosable = (r: BatchRow) => which === 1 ? r.status === "READY_FOR_REVIEW" : r.status === "READY_TO_PUSH" && !r.publishApproved;
  const open = rows.filter(choosable);
  const [picked, setPicked] = useState(() => open.filter((r) => which === 2 || r.risk === "sicher").map((r) => r.jobId));
  const [state, action, pending] = useActionState<BatchGateState, FormData>((which === 1 ? approveBatchAnalyses : approveBatchPushes).bind(null, gate.batchId), {});
  const toggle = (id: string) => setPicked((list) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const chosen = open.filter((r) => picked.includes(r.jobId)).length;
  return <form action={action} className="queue-section">
    <h2>{_t(_locale, "BatchUpdate.services")}<span className="queue-count">{rows.length}</span></h2>
    <ul className="panel queue-list">{rows.map((row) => {
      const can = choosable(row);
      return <li key={row.jobId} className={`queue-row batch-gate-row${picked.includes(row.jobId) && can ? " is-picked" : ""}`}>
        {can ? <input type="checkbox" name="job" value={row.jobId} checked={picked.includes(row.jobId)} onChange={() => toggle(row.jobId)} aria-label={row.applicationName} /> : <span className="batch-gate-spacer" />}
        <div className="min-w-0 flex-1">
          <RowBody row={row} basePath={basePath} />
          {can && which === 1 && row.recommendation && <p className="batch-recommendation">{row.recommendation}</p>}
          {can && <EngineSwitch row={row} gate={gate} mode={which === 1 ? "analysis" : "conclusion"} />}
        </div>
        <Time row={row} now={now} />
      </li>;
    })}</ul>
    <div className="batch-gate-actions">
      <button className="btn" disabled={pending || !chosen}>{pending ? _t(_locale, "BatchUpdate.approving") : _t(_locale, which === 1 ? "BatchUpdate.approve1" : "BatchUpdate.approve2", { count: chosen })}</button>
      <p className="service-hint">{_t(_locale, which === 1 ? "BatchUpdate.dropHint" : "BatchUpdate.pushHint")}</p>
      {state.message && !state.ok && <p role="status" className="service-error">{_message(_locale, state.message)}</p>}
    </div>
  </form>;
}

// Fortsetzen nach einer Pause, Abbrechen jederzeit, solange der Lauf offen ist.
function Controls({ stage, batchId }: { stage: BatchStage; batchId: string }) {
  const _locale = _useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<BatchGateState>) => start(async () => { await fn(); setConfirm(false); router.refresh(); });
  return <div className="batch-controls">
    {stage === "paused" && <button type="button" className="btn" disabled={pending} onClick={() => run(() => resumeBatch(batchId))}>{_t(_locale, "BatchUpdate.resume")}</button>}
    {confirm ? <>
      <span className="service-hint">{_t(_locale, "BatchUpdate.cancelConfirm")}</span>
      <button type="button" className="btn btn--danger btn--small" disabled={pending} onClick={() => run(() => cancelBatch(batchId))}>{_t(_locale, "BatchUpdate.cancelYes")}</button>
      <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => setConfirm(false)}>{_t(_locale, "BatchUpdate.cancelNo")}</button>
    </> : <button type="button" className="btn btn--ghost btn--small" disabled={pending} onClick={() => setConfirm(true)}>{_t(_locale, "BatchUpdate.cancel")}</button>}
  </div>;
}

export function BatchBoard({ basePath, stage, pauseReason, rows, gate, chatOpen = false }: { basePath: string; stage: BatchStage; pauseReason: string | null; rows: BatchRow[]; gate: BatchGate; chatOpen?: boolean }) {
  const _locale = _useLocale();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const live = stage !== "done" && stage !== "cancelled";
  // Ist ein Chat offen, frischt der schon die ganze Seite auf, ein zweites Polling
  // würde nur parallele Server-Renders erzeugen, hinter denen Klicks warten.
  // Im Hintergrund-Tab gar nicht, beim Zurückkommen sofort.
  useEffect(() => {
    if (!live || chatOpen) return;
    const tick = () => { if (document.visibilityState === "visible") { router.refresh(); setNow(new Date()); } };
    const poll = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(poll); document.removeEventListener("visibilitychange", tick); };
  }, [live, chatOpen, router]);
  // Wer die Seite sieht, hat den Lauf gesehen: Glocke für diese Stufe still.
  useEffect(() => {
    void markDependencySeen([`batch:${gate.batchId}`]).then(() => window.dispatchEvent(new Event(NOTIFICATIONS_EVENT)));
  }, [gate.batchId, stage]);
  const user = stage === "approval1" || stage === "approval2" || stage === "paused";
  return <div className="queue-board">
    <section className={`panel batch-stage batch-stage--${user ? "user" : live ? "worker" : "done"}`} role="status" aria-live="polite">
      <Steps stage={stage} />
      <p className="queue-now-step">{_t(_locale, `BatchUpdate.stage_${stage}`)}</p>
      <p className="queue-now-detail">{stage === "paused" && pauseReason ? _message(_locale, pauseReason) : _t(_locale, `BatchUpdate.stageDetail_${stage}`)}</p>
      {live && <Controls stage={stage} batchId={gate.batchId} />}
    </section>
    {stage === "approval1" || stage === "approval2" ? <Gate key={stage} which={stage === "approval1" ? 1 : 2} rows={rows} basePath={basePath} gate={gate} now={now} /> : <section className="queue-section">
      <h2>{_t(_locale, "BatchUpdate.services")}<span className="queue-count">{rows.length}</span></h2>
      <ul className="panel queue-list">{rows.map((row) => <li key={row.jobId} className={`queue-row queue-row--${row.actor}`}>
        <RowBody row={row} basePath={basePath} />
        <StateChip actor={row.actor} />
        <Time row={row} now={now} />
      </li>)}</ul>
    </section>}
  </div>;
}
