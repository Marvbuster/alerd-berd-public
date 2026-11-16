"use client";
import { localizedTitle } from "@/i18n/data";
import { intlLocale } from "@/i18n/locale";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDependencyMessage, approveDependencyPreparation, approveDependencyPublish, cancelDependencyJob, createDependencyJob, markDependencySeen, retryDependencyStep, startDependencyAnalysis, switchLocalNodeToClaude, type DependencyActionState } from "@/app/coolify/dependency-actions";
import { NOTIFICATIONS_EVENT } from "./NotificationHub";
import { jobLabel, jobPackages, type UpdateCandidate } from "@/lib/dependency-target";
import { Icon } from "./Icon";
import { WorkerProgress } from "./WorkerProgress";
import { parseProgress, type ProgressStep } from "@/lib/dependency-progress";
import { majorIssuesLine } from "@/lib/major-issues";
import { analysisRecommendation, analysisRisk, CHAT_SUFFIX, engineLabel, retryStep, type WorkerBusy, dependencyPhase, dependencySteps, elapsed, localizedSTEP_LABELS as STEP_LABELS, TERMINAL_STATUSES, WORKER_STATUSES, type Phase } from "@/lib/dependency-phase";

type Message = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM"; content: string; createdAt: Date };
export type DependencyJobView = {
  id: string; targetVersion: string; packageName?: string; packages?: unknown; model: string; engine?: string; status: string; updatedAt: Date;
  workerLockedUntil: Date | null; workerAttemptAt: Date | null;
  lastError: string | null; validationLog: string | null; messages: Message[];
  diffHash?: string | null; publishApprovalAt?: Date | null; publishedAt?: Date | null;
  progress?: unknown;
};

const initial: DependencyActionState = {};
// Neu laden, solange der Worker oder die lokale Node an dem Job arbeitet.
const POLLING = [...WORKER_STATUSES, "AWAITING_NODE"];
const LEGACY_PARAM = "update";

function Result({ state }: { state: DependencyActionState }) {
  const _locale = _useLocale();
  return state.message && !state.ok ? <p role="status" className="mt-2 text-xs text-[var(--down)]">{_message(_locale, state.message)}</p> : null;
}

// Offener Update-Chat steht im Hash (#app-<appId>~chat), nie in den Query-
// Parametern: Ändern die sich, baut Next die Seite beim nächsten Server-Refresh
// (etwa nach jeder Freigabe) neu auf, und Chat und Auswahl gingen verloren.
export { CHAT_SUFFIX };
function setChatHash(applicationId: string, open: boolean) {
  const url = new URL(window.location.href);
  url.hash = `app-${applicationId}${open ? CHAT_SUFFIX : ""}`;
  window.history.replaceState(window.history.state, "", url);
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

// Claude antwortet in Markdown. Rohes HTML bleibt aus (react-markdown rendert
// es ohne rehype-raw nicht), Links öffnen in einem neuen Tab.
function Markdown({ text }: { text: string }) {
  return <div className="dependency-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>;
}

// Absender und Zeitpunkt über jeder Nachricht, wie in einem Log. Lokale Zeit
// des Browsers, deshalb ohne Hydration-Warnung (Server rendert in UTC).
const STAMP = (_locale: string) => new Intl.DateTimeFormat(intlLocale(_locale), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function Sender({ name, at }: { name: string; at: Date | string }) {
  const _locale = _useLocale();
  const date = new Date(at);
  return <span className="dependency-sender">{name}<time dateTime={date.toISOString()} suppressHydrationWarning>{STAMP(_locale).format(date)}</time></span>;
}

// Kopfzeile einer eingeklappten Analyse: das Risiko, sonst die erste Textzeile.
function analysisSummary(text: string, _locale: string = "de") {
  const risk = analysisRisk(text);
  if (risk) return _t(_locale, "DependencyAssistant.m3b556afd60", { value0: _t(_locale, ({ sicher: "common.riskSafe", prüfen: "common.riskReview", riskant: "common.riskRisky" })[risk as "sicher" | "prüfen" | "riskant"]) });
  const first = text.split("\n").map((line) => line.replace(/[#*_`>]/g, "").trim()).find(Boolean) ?? _t(_locale, "DependencyAssistant.md8673f9862");
  return first.length > 70 ? `${first.slice(0, 70)} …` : first;
}

function CopyConclusion({ applicationName, job, text }: { applicationName: string; job: DependencyJobView; text: string }) {
  const _locale = _useLocale();
  const [copied, setCopied] = useState(false);
  const recommendation = analysisRecommendation(text).recommendation;
  if (!recommendation) return null;
  const content = _t(_locale, "DependencyAssistant.mf6666b59fa", { value0: applicationName, value1: jobLabel(jobPackages(job), _locale), value2: job.engine === "LOCAL_NODE" ? _t(_locale, "DependencyAssistant.m812077b282") : _t(_locale, "common.claudeConclusion"), value3: recommendation });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { setCopied(false); }
  };
  return <button type="button" className="btn btn--ghost mt-3" onClick={() => void copy()}>{copied ? _t(_locale, "DependencyAssistant.mc2756e0294") : _t(_locale, "DependencyAssistant.m3a8adc3c64")}</button>;
}

// Wer arbeitet an diesem Chat: Claude oder die lokale Node. Immer sichtbar.
function EngineChip({ engine }: { engine?: string }) {
  const _locale = _useLocale();
  return <span className={`service-chip dependency-engine-chip${engine === "LOCAL_NODE" ? " dependency-engine-chip--local" : ""}`}>{engineLabel(engine, _locale)}</span>;
}

function Steps({ job }: { job: DependencyJobView }) {
  const _locale = _useLocale();
  const states = dependencySteps(job.status, { analysed: job.messages.some((m) => m.role === "ASSISTANT"), validated: !!job.validationLog });
  return <ol className="dependency-steps" aria-label={_t(_locale, "DependencyAssistant.mabfc3f29bb")}>{STEP_LABELS(_locale).map((label, i) => <li key={label} className={`dependency-step dependency-step--${states[i]}`} aria-current={states[i] === "current" || states[i] === "running" ? "step" : undefined}>
    <span className="dependency-step-mark">{states[i] === "done" ? "✓" : states[i] === "failed" ? "!" : i + 1}</span>{label}
  </li>)}</ol>;
}

function PhaseBanner({ phase, now, progress = [] }: { phase: Phase; now: Date; progress?: ProgressStep[] }) {
  const _locale = _useLocale();
  const busy = phase.actor === "worker" || phase.actor === "waiting";
  return <div className={`dependency-phase dependency-phase--${phase.actor}`} role="status" aria-live="polite">
    <span className={`dependency-phase-dot${busy ? " dependency-phase-dot--busy" : ""}`} />
    <div className="min-w-0 flex-1">
      <p className="dependency-phase-title">{phase.title}{busy && phase.since && <span className="dependency-phase-time">{elapsed(phase.since, now)}</span>}</p>
      <p className="dependency-phase-detail">{_message(_locale, phase.detail)}</p>
      {phase.actor === "worker" && <WorkerProgress steps={progress} now={now} compact />}
      {phase.action === "credentials" && <Link href="/settings/access" className="mt-1 inline-block text-xs">{_t(_locale, "DependencyAssistant.md4d9bcad70")}</Link>}
    </div>
  </div>;
}

// Auswahl für einen neuen Update-Chat: alles, was sich bündeln lässt. Größere
// Sprünge sind markiert und nicht vorausgewählt, Claude prüft sie trotzdem.
function UpdatePicker({ applicationId, candidates, hasClaude, hasLocalNode, localNodeOnline, action, pending, state, initialPicked, initialEngine }: {
  applicationId: string; candidates: UpdateCandidate[]; hasClaude: boolean; hasLocalNode: boolean; localNodeOnline: boolean; action: (form: FormData) => void; pending: boolean; state: DependencyActionState;
  // Nach einem Abbruch: Auswahl und Engine des abgebrochenen Chats vorbelegen.
  initialPicked?: string[]; initialEngine?: string;
}) {
  const _locale = _useLocale();
  // Vorauswahl aus dem letzten Job, soweit die Pakete noch Kandidaten sind. Ist keins mehr übrig, die übliche Auswahl.
  const [picked, setPicked] = useState(() => {
    const again = candidates.filter((c) => initialPicked?.includes(c.name)).map((c) => c.name);
    return again.length ? again : candidates.filter((c) => !c.breaking).map((c) => c.name);
  });
  // Gezählt wird, was wirklich abgeschickt wird: Fällt ein Kandidat nach neuem Git-Stand weg, zählt er nicht mehr.
  const chosen = candidates.filter((c) => picked.includes(c.name)).length;
  const [engine, setEngine] = useState<"CLAUDE" | "LOCAL_NODE">(initialEngine === "LOCAL_NODE" && hasLocalNode ? "LOCAL_NODE" : initialEngine === "CLAUDE" && hasClaude ? "CLAUDE" : hasClaude ? "CLAUDE" : "LOCAL_NODE");
  const toggle = (name: string) => setPicked((list) => list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  return <div className="dependency-empty">
    <p>{_t(_locale, "DependencyAssistant.me2193f0aeb")}</p>
    <form action={action} className="mt-4 grid gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <ul className="service-pool service-pool--compact">{candidates.map((c) => <li key={c.name}>
        <label className={picked.includes(c.name) ? "is-picked" : undefined}>
          <input type="checkbox" name="package" value={`${c.name}@${c.to}`} checked={picked.includes(c.name)} onChange={() => toggle(c.name)} />
          <span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs">{c.name}</span><span className="service-meta font-mono">{c.from} → {c.to}</span>
            {c.recommended?.issues && <a className="service-meta block truncate" href={c.recommended.issues.searchUrl} target="_blank" rel="noreferrer" title={c.recommended.issues.top.map((i) => `${i.reactions} · ${i.title}`).join("\n") || undefined}>{majorIssuesLine(c.recommended.issues, _locale)}</a>}
            {c.knownIssues?.map((k) => <span key={localizedTitle(k, _locale)} className="service-meta block truncate" title={localizedTitle(k, _locale)}>{_t(_locale, "DependencyAssistant.m1165b4d840")}{k.url ? <a href={k.url} target="_blank" rel="noreferrer">{localizedTitle(k, _locale)}</a> : localizedTitle(k, _locale)}</span>)}</span>
          {c.critical ? <span className="service-chip service-chip--danger">{_t(_locale, "DependencyAssistant.m411a681ffe")}</span> : c.security && <span className="service-chip service-chip--danger">{_t(_locale, "DependencyAssistant.m4474c75260")}</span>}
          {c.recommended && <a className="service-chip service-chip--update" href={c.recommended.source} target="_blank" rel="noreferrer" title={localizedTitle(c.recommended, _locale)} onClick={(event) => event.stopPropagation()}>{c.recommended.hold ? _t(_locale, "common.wait") : _t(_locale, "common.recommended")}</a>}
          {!!c.knownIssues?.length && <span className="service-chip service-chip--warn" title={c.knownIssues.map((k) => localizedTitle(k, _locale)).join("\n")}>{_t(_locale, "DependencyAssistant.m971e520695")}</span>}
          {c.breaking ? <span className="service-chip service-chip--warn" title={_t(_locale, "DependencyAssistant.mb8ac69cdff")}>{_t(_locale, "DependencyAssistant.m01633ad25f")}</span>
            : c.jump === "minor" && <span className="service-chip" title={_t(_locale, "DependencyAssistant.m7dc84baaeb")}>{_t(_locale, "DependencyAssistant.m5717c39b81")}</span>}
        </label>
      </li>)}</ul>
      {(hasClaude && hasLocalNode) && <fieldset className="dependency-engine"><legend>{_t(_locale, "DependencyAssistant.m283deb3089")}</legend><label><input type="radio" name="engine" value="CLAUDE" checked={engine === "CLAUDE"} onChange={() => setEngine("CLAUDE")} /> {_t(_locale, "DependencyAssistant.m016b1f9fe9")}<span>{_t(_locale, "DependencyAssistant.m63b2e0c81b")}</span></label><label><input type="radio" name="engine" value="LOCAL_NODE" checked={engine === "LOCAL_NODE"} onChange={() => setEngine("LOCAL_NODE")} /> {_t(_locale, "DependencyAssistant.m5befa82e03")}<span>{localNodeOnline ? _t(_locale, "DependencyAssistant.m9277d08150") : _t(_locale, "DependencyAssistant.m4e82364d40")}</span></label></fieldset>}
      {!hasClaude && <input type="hidden" name="engine" value="LOCAL_NODE" />}
      {!(hasClaude && hasLocalNode) && <p className="text-xs text-[var(--fg-dim)]">{_t(_locale, "DependencyAssistant.m107596f9d8")}<EngineChip engine={hasClaude ? "CLAUDE" : "LOCAL_NODE"} /></p>}
      <button className="btn w-fit" disabled={pending || !chosen}>{pending ? _t(_locale, "DependencyAssistant.mc4fec48fe9") : chosen > 1 ? _t(_locale, "DependencyAssistant.m8f6d9e46b9", { value0: chosen }) : _t(_locale, "DependencyAssistant.m180d38505d")}</button>
      <Result state={state} />
    </form>
  </div>;
}

export function DependencyAssistant({ applicationId, applicationName, candidates, hasClaude, hasLocalNode = false, localNodeOnline = false, hasPublish, job, workerBusy = null, workerLastSeen = null, onClose }: { applicationId: string; applicationName: string; candidates: UpdateCandidate[]; hasClaude: boolean; hasLocalNode?: boolean; localNodeOnline?: boolean; hasPublish: boolean; workerBusy?: WorkerBusy | null; workerLastSeen?: Date | null; job: DependencyJobView | null;
  // Nur das Fenster, sofort offen, ohne Hash (Warteschlange). Schließen ruft onClose.
  onClose?: () => void }) {
  const _locale = _useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(!!onClose);
  // Neuer Update-Chat nach einem abgeschlossenen: Auswahl statt altem Verlauf.
  const [picking, setPicking] = useState(false);
  const [createState, createAction, creating] = useActionState(createDependencyJob, initial);
  const [messageState, messageAction, sending] = useActionState(job ? addDependencyMessage.bind(null, job.id) : async () => initial, initial);
  const [analysisState, analysisAction, analyzing] = useActionState(job ? async () => startDependencyAnalysis(job.id) : async () => initial, initial);
  const [prepareState, prepareAction, preparing] = useActionState(job ? async () => approveDependencyPreparation(job.id) : async () => initial, initial);
  const [publishState, publishAction, publishing] = useActionState(job ? async () => approveDependencyPublish(job.id) : async () => initial, initial);
  const [retryPushState, retryPushAction, retryingPush] = useActionState(job ? async () => retryDependencyStep(job.id) : async () => initial, initial);
  const [cancelState, cancelAction, cancelling] = useActionState(job ? async () => cancelDependencyJob(job.id) : async () => initial, initial);
  const [switchState, switchAction, switching] = useActionState(job ? async () => switchLocalNodeToClaude(job.id) : async () => initial, initial);
  // Neuer Job angelegt: Auswahl zu. Sonst stünde nach dem Ende des Jobs (etwa
  // FAILED) wieder die Auswahl da statt Verlauf und Fehler.
  useEffect(() => { setPicking(false); }, [job?.id]);
  const polling = !!job && POLLING.includes(job.status);
  const now = useNow(polling);

  // Auch alte Links mit ?update=<appId> (Mails, Glocke vor dem Umbau) öffnen den Chat.
  useEffect(() => {
    if (onClose) return;
    if (window.location.hash === `#app-${applicationId}${CHAT_SUFFIX}` || new URLSearchParams(window.location.search).get(LEGACY_PARAM) === applicationId) setOpen(true);
    // Glocke bei schon ausgewähltem Dienst: Komponente steht, nur der Hash ändert sich.
    const sync = () => { if (window.location.hash === `#app-${applicationId}${CHAT_SUFFIX}`) setOpen(true); };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [applicationId, onClose]);
  useEffect(() => { if (createState.jobId || messageState.ok || analysisState.ok || prepareState.ok || publishState.ok || retryPushState.ok || cancelState.ok || switchState.ok) router.refresh(); }, [createState.jobId, messageState.ok, analysisState.ok, prepareState.ok, publishState.ok, retryPushState.ok, cancelState.ok, switchState.ok, router]);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [polling, job?.id, router]);

  // Offener Chat gilt als gelesen, auch wenn währenddessen ein Schritt fertig
  // wird. Danach den Hub im Header auffrischen.
  const changedAt = job ? new Date(job.updatedAt).getTime() : 0;
  useEffect(() => {
    if (!open || !job) return;
    void markDependencySeen([job.id]).then(() => window.dispatchEvent(new Event(NOTIFICATIONS_EVENT)));
  }, [open, job?.id, job?.status, changedAt]);
  useEffect(() => { window.dispatchEvent(new Event(NOTIFICATIONS_EVENT)); }, [job?.status]);

  // Neue Nachrichten ans Ende scrollen, damit die aktuelle Antwort sichtbar ist.
  const messagesRef = useRef<HTMLDivElement>(null);
  const count = job?.messages.length ?? 0;
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [count, open, job?.status]);

  // Next setzt die URL nach Server-Actions teils auf seinen eigenen Stand zurück;
  // solange der Chat offen ist, den Hash nach jedem Refresh wieder ergänzen.
  useEffect(() => {
    if (open && !onClose && window.location.hash !== `#app-${applicationId}${CHAT_SUFFIX}`) setChatHash(applicationId, true);
  });
  const show = () => { setOpen(true); setChatHash(applicationId, true); };
  const hide = () => { setPicking(false); if (onClose) { onClose(); return; } setOpen(false); setChatHash(applicationId, false); };
  const phase = job ? dependencyPhase(job, now, { hasPublish, workerBusy: workerBusy ? { ...workerBusy, since: new Date(workerBusy.since) } : null, workerLastSeen: workerLastSeen ? new Date(workerLastSeen) : null }, _locale) : null;
  const pastReview = !!job && !["DRAFT", "AWAITING_CLAUDE", "ANALYZING", "READY_FOR_REVIEW", "FAILED", "CANCELLED"].includes(job.status);
  const lastAssistant = job ? job.messages.findLastIndex((m) => m.role === "ASSISTANT") : -1;
  // Offen bleibt nur das Live-Fazit, also die zweite Claude-Antwort nach dem Deploy.
  const verdictIndex = job && ["LIVE", "LIVE_UNVERIFIED", "DEPLOY_FAILED"].includes(job.status) && job.messages.filter((m) => m.role === "ASSISTANT").length > 1 ? lastAssistant : -1;
  // Scheitert die Vorbereitung, steht der Fehler unter der Analyse: Analyse zu.
  const lastSystem = job?.status === "FAILED" ? job.messages.findLastIndex((m) => m.role === "SYSTEM") : -1;
  const finished = !!job && TERMINAL_STATUSES.includes(job.status);
  // Öffnen nur, solange ein Chat läuft oder ein neuerer Patch da ist. Der letzte
  // Verlauf bleibt über die Glocke erreichbar.
  const activeChat = !!job && !finished;
  // Neu analysieren nach Abbruch oder Fehler. Nach einem gelieferten Update nur,
  // wenn inzwischen ein neuerer Patch da ist.
  // Gescheiterter Schritt lässt sich einzeln wiederholen, ohne neue Analyse.
  const step = job ? retryStep(job, _locale) : null;
  const retryable = !!job && finished && ["FAILED", "CANCELLED", "DEPLOY_FAILED"].includes(job.status);
  const label = job ? jobLabel(jobPackages(job), _locale) : "";
  const summary = candidates.length === 1 ? _t(_locale, "DependencyAssistant.m2a2a3abd6a", { value0: candidates[0].name === "next" ? "Next" : candidates[0].name, value1: candidates[0].to }) : candidates.length ? _t(_locale, "DependencyAssistant.m64d2748099", { value0: candidates.length }) : _t(_locale, "DependencyAssistant.m563a85d965");
  // Nach manuellem Abbruch direkt wieder die Auswahl, damit man Pakete abwählen kann.
  const afterCancel = job?.status === "CANCELLED";
  const showPicker = !activeChat && (!job || picking || afterCancel) && candidates.length > 0;
  // Gleiche Regel wie cancelDependencyJob: nicht, solange der Worker den Job hält.
  const cancellable = !!job && !finished && ["DRAFT", "AWAITING_CLAUDE", "ANALYZING", "READY_FOR_REVIEW", "APPROVED", "READY_TO_PUSH"].includes(job.status) && phase?.actor !== "worker";

  const modal = <div className="dependency-modal-backdrop" role="presentation" onMouseDown={hide}><section className="dependency-modal" role="dialog" aria-modal="true" aria-label={_t(_locale, "DependencyAssistant.ma6147f7b0a", { value0: applicationName })} onMouseDown={(event) => event.stopPropagation()}>
      <div className="dependency-modal-header">
        <div><p className="text-xs text-[var(--cyan)]">{applicationName}</p><h2>{showPicker ? "Update" : label}</h2>{!showPicker && job && <p className="mt-1"><EngineChip engine={job.engine} /></p>}</div>
        <button type="button" className="icon-button" aria-label={_t(_locale, "DependencyAssistant.m177fe9ee01")} onClick={hide}><Icon name="close" size={18} /></button>
      </div>

      {showPicker || !job ? (showPicker ? <UpdatePicker key={job?.id ?? _t(_locale, "common.new")} applicationId={applicationId} candidates={candidates} hasClaude={hasClaude} hasLocalNode={hasLocalNode} localNodeOnline={localNodeOnline} initialPicked={job && finished ? jobPackages(job).map((p) => p.name) : undefined} initialEngine={job && finished ? job.engine : undefined} action={createAction} pending={creating} state={createState} /> : <div className="dependency-empty"><p>{_t(_locale, "DependencyAssistant.mfbe184ddeb")}</p></div>) : <div className="dependency-chat">
        <Steps job={job} />
        {phase && <PhaseBanner phase={phase} now={now} progress={parseProgress(job?.progress)} />}

        {/* Abgebrochen: der alte Verlauf ist erledigt, sichtbar bleiben Status und „Neu analysieren“. */}
        {job.messages.length > 0 && job.status !== "CANCELLED" && <div className="dependency-messages" ref={messagesRef}>{job.messages.map((message, index) => {
            // Nach der Freigabe ist die Analyse erledigt: eingeklappt, mit Risiko als Zeile.
            const assistantName = engineLabel(job.engine, _locale);
            if (message.role === "ASSISTANT" && ((pastReview && index !== verdictIndex) || index < lastSystem)) return <details key={message.id} className="dependency-message dependency-message--assistant dependency-collapsed"><summary><Sender name={assistantName} at={message.createdAt} />{analysisSummary(message.content, _locale)}</summary><Markdown text={message.content} /></details>;
            // Sichere Analyse vor der Freigabe: nur die Empfehlung, die ganze Analyse eingeklappt.
            const verdict = message.role === "ASSISTANT" && job.status === "READY_FOR_REVIEW" && index === lastAssistant ? analysisRecommendation(message.content) : null;
            if (verdict?.safe && verdict.recommendation) return <div key={message.id} className="dependency-message dependency-message--assistant"><Sender name={assistantName} at={message.createdAt} />
              <Markdown text={verdict.recommendation} />
              <CopyConclusion applicationName={applicationName} job={job} text={message.content} />
              <details className="dependency-collapsed dependency-full"><summary>{_t(_locale, "DependencyAssistant.mcdd739ede3")}</summary><Markdown text={message.content} /></details>
            </div>;
            return <div key={message.id} className={`dependency-message dependency-message--${message.role.toLowerCase()}`}><Sender name={message.role === "USER" ? _t(_locale, "common.you") : message.role === "ASSISTANT" ? assistantName : "Alerd"} at={message.createdAt} />{message.role === "ASSISTANT" ? <><Markdown text={message.content} />{job.status === "READY_FOR_REVIEW" && index === lastAssistant && <CopyConclusion applicationName={applicationName} job={job} text={message.content} />}</> : <p>{_message(_locale, message.content)}</p>}</div>;
          })}
          {/* Tipp-Punkte nur, wenn wirklich ein Modell schreibt: bei Claude im Worker-Schritt, bei der lokalen Node erst, wenn sie online ist und der Job auf sie wartet. */}
          {((job.engine !== "LOCAL_NODE" && ["ANALYZING", "LIVE_REVIEW"].includes(job.status) && phase?.actor === "worker") || (job.engine === "LOCAL_NODE" && job.status === "AWAITING_NODE" && localNodeOnline)) && <div className="dependency-message dependency-message--assistant dependency-typing" aria-label={_t(_locale, "DependencyAssistant.m352514e955", { value0: engineLabel(job.engine, _locale) })}><span>{engineLabel(job.engine, _locale)}</span><i /><i /><i /></div>}
        </div>}

        <div className="dependency-actions">
          {["AWAITING_CLAUDE", "DRAFT"].includes(job.status) && <form action={analysisAction}><button className="btn" disabled={analyzing}>{analyzing ? _t(_locale, "DependencyAssistant.ma4669e6e5e") : _t(_locale, "DependencyAssistant.md093f09cf2")}</button><Result state={analysisState} /></form>}
          {job.status === "READY_FOR_REVIEW" && <form action={prepareAction}><button className="btn" disabled={preparing}>{preparing ? _t(_locale, "DependencyAssistant.ma4669e6e5e") : _t(_locale, "DependencyAssistant.m068e88e5d6")}</button><Result state={prepareState} /></form>}
          {job.status === "READY_TO_PUSH" && <form action={publishAction} onSubmit={(event) => { if (!confirm(_t(_locale, "DependencyAssistant.m53d2930987"))) event.preventDefault(); }}><button className="btn" disabled={publishing || !hasPublish}>{publishing ? _t(_locale, "DependencyAssistant.ma4669e6e5e") : _t(_locale, "DependencyAssistant.mc86120828e")}</button><Result state={publishState} /></form>}
          {step && <form action={retryPushAction}><button className="btn" disabled={retryingPush || (step.status === "PUBLISHING" && !hasPublish)}>{retryingPush ? _t(_locale, "DependencyAssistant.ma4669e6e5e") : step.label}</button><Result state={retryPushState} /></form>}
          {job.status === "AWAITING_NODE" && hasClaude && <form action={switchAction}><button className="btn btn--ghost" disabled={switching}>{switching ? _t(_locale, "DependencyAssistant.m1eb96a3915") : _t(_locale, "DependencyAssistant.m0c7dce8ed4")}</button><Result state={switchState} /></form>}
          {/* Neu analysieren führt über die Auswahl: Der Git-Stand kann sich seit dem Fehler geändert haben, erledigte Pakete fallen dort heraus. */}
          {retryable && candidates.length > 0 && <button type="button" className={step ? "btn btn--ghost" : "btn"} onClick={() => setPicking(true)}>{_t(_locale, "DependencyAssistant.mc0176dff26")}</button>}
          {cancellable && <form action={cancelAction} className="ml-auto" onSubmit={(event) => { if (!confirm(_t(_locale, "DependencyAssistant.mb406b317bb"))) event.preventDefault(); }}><button className="dependency-cancel" disabled={cancelling}>{cancelling ? _t(_locale, "DependencyAssistant.m9595dc9455") : _t(_locale, "DependencyAssistant.mf7ff1178af")}</button><Result state={cancelState} /></form>}
        </div>

        {job.status === "READY_FOR_REVIEW" && <form action={messageAction} className="dependency-compose"><label className="sr-only" htmlFor={`ask-${job.id}`}>{_t(_locale, "DependencyAssistant.m9baf2970ea")}{engineLabel(job.engine, _locale)}</label><textarea id={`ask-${job.id}`} name="message" rows={3} maxLength={4000} placeholder={_t(_locale, "DependencyAssistant.m893bc794cc", { value0: engineLabel(job.engine, _locale) })} readOnly={sending} required /><button className="btn btn--ghost" disabled={sending}>{sending ? _t(_locale, "DependencyAssistant.mb71949c730") : _t(_locale, "common.ask")}</button><Result state={messageState} /></form>}
        {job.validationLog && <details className="disclosure mt-4"><summary>{_t(_locale, "DependencyAssistant.m24355327b4")}</summary><pre className="disclosure-content max-h-72 overflow-auto text-xs text-[var(--fg-dim)]">{job.validationLog}</pre></details>}
      </div>}
    </section></div>;
  if (onClose) return modal;

  return <section className="detail-section dependency-entry">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3>{_t(_locale, "DependencyAssistant.mc1c1009d3f")}</h3>
        <p className="text-xs text-[var(--fg-dim)]">{phase && (activeChat || !candidates.length) ? <><EngineChip engine={job?.engine} /> {label} · {phase.title}</> : summary}</p>
      </div>
      {activeChat || (candidates.length && (hasClaude || hasLocalNode))
        ? <button type="button" className="btn btn--ghost" onClick={() => { setPicking(!activeChat); show(); }}>{activeChat ? _t(_locale, "DependencyAssistant.m4e9e7df2ae") : _t(_locale, "DependencyAssistant.m4c30a27db4")}</button>
        : job && <button type="button" className="btn btn--ghost" disabled title={_t(_locale, "DependencyAssistant.mcca21ce963")}>{_t(_locale, "DependencyAssistant.mf4d865ae1b")}</button>}
    </div>
    {candidates.length > 0 && !job && !hasClaude && !hasLocalNode && <p className="mt-3 text-xs text-[var(--fg-dim)]"><Link href="/settings/access">{_t(_locale, "DependencyAssistant.m0d03924fb6")}</Link></p>}

    {open && modal}
  </section>;
}
