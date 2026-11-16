import { translate as _t, translateMessage } from "@/i18n/translate";
// Was passiert gerade, und wer ist dran? Eine Antwort pro Job-Zustand, damit
// der Update-Chat nie stumm wirkt. Rein und ohne Uhr, damit testbar.

export type PhaseJob = {
  id?: string;
  engine?: string;
  status: string;
  updatedAt: Date;
  workerLockedUntil: Date | null;
  workerAttemptAt: Date | null;
  lastError: string | null;
  messages?: { role: string; content: string; createdAt: Date | string }[];
};

// Der Worker meldet im Chat, sobald die neue Version live auftaucht. Danach
// wartet er, ob sie stabil bleibt (LIVE_SETTLE_MS im Worker, 2 Minuten).
export const LIVE_SEEN_PREFIX = _t("de", "dependency_phase.liveSeenPrefix");
// Die Ausgangslage ohne Update baut der Worker schon während der Analyse.
export const BASELINE_OK_PREFIX = _t("de", "dependency_phase.baselinePrefix");
export function isBaselineMessage(content: string): boolean {
  return ["de", "en"].some(locale => content.startsWith(_t(locale, "dependency_phase.baselinePrefix")));
}
export function isLiveSeenMessage(content: string): boolean {
  return ["de", "en"].some(locale => content.startsWith(_t(locale, "dependency_phase.liveSeenPrefix")));
}

// Wer die Analyse und das Fazit schreibt. Steht überall, wo ein Job sichtbar ist.
export function engineLabel(engine: string | null | undefined, locale = "de"): string {
  return engine === "LOCAL_NODE" ? _t(locale, "dependency_phase.engineLocal") : "Claude";
}

export type Phase = {
  action?: "credentials";
  actor: "user" | "worker" | "waiting" | "stalled" | "done" | "failed";
  title: string;
  detail: string;
  since: Date | null;
};

// Kurzes Wort zum Zustand, neben der Farbe. Farbe allein liest man nicht sofort.
export function localizedACTOR_LABEL(_locale: string = "de"): Record<Phase["actor"], string> { return ({
  user: _t(_locale, "dependency_phase.md3b54f17ff"), worker: _t(_locale, "dependency_phase.mf85fd2bc56"), waiting: _t(_locale, "dependency_phase.mcff72948cf"), stalled: _t(_locale, "dependency_phase.m06c4a86312"), done: _t(_locale, "dependency_phase.m25d52d7e86"), failed: _t(_locale, "dependency_phase.mf6cc01cb7e"),
}); }
export const ACTOR_LABEL = localizedACTOR_LABEL();

// Ohne Übernahme durch den Worker nach dieser Zeit stimmt etwas nicht.
export const WORKER_PICKUP_MS = 45_000;

function localizedworkerSteps(_locale: string = "de"): Record<string, { title: string; detail: string }> { return ({
  ANALYZING: { title: _t(_locale, "dependency_phase.m4476a7ef36"), detail: _t(_locale, "dependency_phase.m916c292dc7") },
  APPROVED: { title: _t(_locale, "dependency_phase.m26e66c2113"), detail: _t(_locale, "dependency_phase.m32592ea091") },
  RUNNING: { title: _t(_locale, "dependency_phase.m233fa5a307"), detail: _t(_locale, "dependency_phase.me8ae7298e8") },
  VERIFYING: { title: _t(_locale, "dependency_phase.m233fa5a307"), detail: _t(_locale, "dependency_phase.me8ae7298e8") },
  PUBLISHING: { title: _t(_locale, "dependency_phase.ma28b661d42"), detail: _t(_locale, "dependency_phase.md4c9a2b5af") },
  DEPLOYING: { title: _t(_locale, "dependency_phase.mc9177a2126"), detail: _t(_locale, "dependency_phase.m7c5a13a32a") },
  LIVE_REVIEW: { title: _t(_locale, "dependency_phase.mc9adb49a14"), detail: _t(_locale, "dependency_phase.m7d30d034a8") },
}); }

// Endzustände: kein Worker mehr dran, ein neuer Chat für die App ist erlaubt.
export const TERMINAL_STATUSES = ["FAILED", "CANCELLED", "PUSHED", "LIVE", "LIVE_UNVERIFIED", "DEPLOY_FAILED"];
export const WORKER_STATUSES = Object.keys(localizedworkerSteps("de"));

// Woran der Worker gerade arbeitet, über alle Nutzer hinweg. Nur zwei Nutzer,
// deshalb offen sichtbar: so sieht man, ob er läuft und wer vor einem dran ist.
export type WorkerBusy = { jobId: string; appName: string; owner: string; label: string; status: string; since: Date };

function localizedBUSY_STEP(_locale: string = "de"): Record<string, string> { return ({
  ANALYZING: _t(_locale, "dependency_phase.md8673f9862"), APPROVED: _t(_locale, "dependency_phase.mc82d8ceed8"), RUNNING: _t(_locale, "dependency_phase.m1c14359bc3"), VERIFYING: _t(_locale, "dependency_phase.mffdca298a3"),
  PUBLISHING: _t(_locale, "dependency_phase.m731ce7ed80"), LIVE_REVIEW: _t(_locale, "dependency_phase.m491a3793cd"),
}); }

export function workerBusyText(busy: WorkerBusy, now: Date, _locale: string = "de"): string {
  return _t(_locale, "dependency_phase.meaceb59b51", { value0: busy.appName, value1: busy.owner, value2: busy.label, value3: localizedBUSY_STEP(_locale)[busy.status] ?? busy.status, value4: elapsed(busy.since, now) });
}

export function dependencyPhase(job: PhaseJob, now: Date, { hasPublish = true, workerBusy = null, workerLastSeen = null }: { hasPublish?: boolean; workerBusy?: WorkerBusy | null; workerLastSeen?: Date | null } = {}, _locale: string = "de"): Phase {
  let step = localizedworkerSteps(_locale)[job.status];
  // Lokale Node: Den ersten Schritt macht der Server (Ausgangslage, Kontext),
  // das Modell auf dem Mac kommt erst danach dran.
  if (job.engine === "LOCAL_NODE" && job.status === "ANALYZING") step = { title: _t(_locale, "dependency_phase.me96838e780"), detail: _t(_locale, "dependency_phase.mbe134e4dca") };
  if (job.engine === "LOCAL_NODE" && job.status === "LIVE_REVIEW") step = { title: _t(_locale, "dependency_phase.mc7d318fb15"), detail: _t(_locale, "dependency_phase.m1558e11f70") };
  // Deploy angekommen, aber noch in der Stabilitätsprüfung: das sagen, statt weiter „Warte auf den Deploy“.
  const seen = job.status === "DEPLOYING" ? job.messages?.findLast((m) => m.role === "SYSTEM" && isLiveSeenMessage(m.content)) : undefined;
  if (seen) step = { title: _t(_locale, "dependency_phase.m1bf06cf602"), detail: _t(_locale, "dependency_phase.m22d56768e4", { value0: job.engine === "LOCAL_NODE" ? _t(_locale, "dependency_phase.yourLocalNode") : "Claude" }) };
  // Ist die Ausgangslage schon grün, läuft nur noch der Build mit dem Update.
  const baselineDone = ["APPROVED", "RUNNING", "VERIFYING"].includes(job.status) && !!job.messages?.some((m) => m.role === "SYSTEM" && isBaselineMessage(m.content));
  if (baselineDone) step = { title: job.status === "APPROVED" ? _t(_locale, "dependency_phase.m26e66c2113") : _t(_locale, "dependency_phase.m233fa5a307"), detail: _t(_locale, "dependency_phase.mf76dd3ef93") };
  if (step) {
    const claimed = !!job.workerLockedUntil && job.workerLockedUntil > now;
    // RUNNING setzt der Worker selbst, dort ist er per Definition schon dran.
    // Beim Deploy hält der Worker den Job zwischen den Prüfungen per Lock zurück.
    if (claimed || job.status === "RUNNING" || job.status === "VERIFYING") return { actor: "worker", ...step, since: seen ? new Date(seen.createdAt) : job.workerAttemptAt ?? job.updatedAt };
    // Der Worker arbeitet einen Job nach dem anderen ab: steckt er in einem
    // anderen, ist das eine Schlange und kein Ausfall.
    if (workerBusy && workerBusy.jobId !== job.id) {
      return { actor: "waiting", title: _t(_locale, "dependency_phase.m7bae9a1bd7"), detail: _t(_locale, "dependency_phase.m71bb8a1997", { value0: workerBusyText(workerBusy, now, _locale) }), since: job.updatedAt };
    }
    if (now.getTime() - job.updatedAt.getTime() > WORKER_PICKUP_MS) {
      const last = workerLastSeen ? _t(_locale, "dependency_phase.m5745c06119", { value0: elapsed(workerLastSeen, now) }) : _t(_locale, "dependency_phase.mabe1193bef");
      return { actor: "stalled", title: _t(_locale, "dependency_phase.m76ce9e195f"), detail: _t(_locale, "dependency_phase.m3a076cd1d7", { value0: last }), since: job.updatedAt };
    }
    return { actor: "waiting", title: _t(_locale, "dependency_phase.md1f0354fd9"), detail: _t(_locale, "dependency_phase.m9ffb6ce6d2"), since: job.updatedAt };
  }
  switch (job.status) {
    case "DRAFT":
    case "AWAITING_CLAUDE":
      return { actor: "user", title: _t(_locale, "dependency_phase.md3b54f17ff"), detail: _t(_locale, "dependency_phase.ma5861e322c"), since: null };
    case "AWAITING_NODE":
      return { actor: "waiting", title: _t(_locale, "dependency_phase.m49aca9c2f4"), detail: _t(_locale, "dependency_phase.mb3fb52c781"), since: job.updatedAt };
    case "READY_FOR_REVIEW":
      return { actor: "user", title: _t(_locale, "dependency_phase.md3b54f17ff"), detail: _t(_locale, "dependency_phase.mae573348ca"), since: null };
    case "READY_TO_PUSH":
      return hasPublish
        ? { actor: "user", title: _t(_locale, "dependency_phase.md3b54f17ff"), detail: _t(_locale, "dependency_phase.m30e2bd688c"), since: null }
        : { actor: "user", action: "credentials", title: _t(_locale, "dependency_phase.m3ab721805e"), detail: _t(_locale, "dependency_phase.m188a5d78f4"), since: null };
    case "PUSHED":
      return { actor: "done", title: _t(_locale, "dependency_phase.m8eabf87cdd"), detail: _t(_locale, "dependency_phase.mf1944a286f"), since: null };
    case "LIVE":
      return { actor: "done", title: _t(_locale, "dependency_phase.m53c5e56493"), detail: _t(_locale, "dependency_phase.m802f5281b3", { value0: engineLabel(job.engine, _locale) }), since: null };
    case "LIVE_UNVERIFIED":
      return { actor: "done", title: _t(_locale, "dependency_phase.m09993bf7ed"), detail: _t(_locale, "dependency_phase.m2ff02b9c99"), since: null };
    case "DEPLOY_FAILED":
      return { actor: "failed", title: _t(_locale, "dependency_phase.md103e05a57"), detail: translateMessage(_locale, job.lastError) ?? _t(_locale, "dependency_phase.m8caa450208"), since: null };
    case "CANCELLED":
      return { actor: "failed", title: _t(_locale, "dependency_phase.mb9731e79a8"), detail: _t(_locale, "dependency_phase.m783c60c70a"), since: null };
    default:
      return { actor: "failed", title: _t(_locale, "dependency_phase.m1c47a9734b"), detail: translateMessage(_locale, job.lastError) ?? _t(_locale, "dependency_phase.m017c280e00"), since: null };
  }
}

export function elapsed(since: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Grobe relative Zeit für Listen: „gerade“, „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“.
export function ago(since: Date, now: Date, _locale: string = "de"): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - since.getTime()) / 60_000);
  if (minutes < 1) return _t(_locale, "dependency_phase.ma303a7d1c0");
  if (minutes < 60) return _t(_locale, "dependency_phase.m631df8ac08", { value0: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return _t(_locale, "dependency_phase.m863807c7b0", { value0: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? _t(_locale, "dependency_phase.m6c92536a0b") : _t(_locale, "dependency_phase.md3f29ddf7e", { value0: days });
}

export type StepState = "todo" | "current" | "running" | "done" | "failed";
export function localizedSTEP_LABELS(_locale: string = "de") { return ([_t(_locale, "dependency_phase.md8673f9862"), _t(_locale, "dependency_phase.mc1c1009d3f"), _t(_locale, "dependency_phase.m731ce7ed80"), _t(_locale, "dependency_phase.mb64ac05f17")] as const); }
export const STEP_LABELS = localizedSTEP_LABELS();

// Drei Freigaben und die Begleitung danach. Für FAILED wird der Schritt aus dem
// Fortschritt geschätzt: Prüfprotokoll da = Push, Claude-Antwort da = Update.
export function dependencySteps(status: string, { analysed = false, validated = false }: { analysed?: boolean; validated?: boolean } = {}): StepState[] {
  const at = (index: number, state: StepState): StepState[] => STEP_LABELS.map((_, i) => i < index ? "done" : i === index ? state : "todo");
  switch (status) {
    case "DRAFT": case "AWAITING_CLAUDE": return at(0, "current");
    case "ANALYZING": return at(0, "running");
    // Wartet auf die lokale Node: Analyse (oder Fazit nach dem Deploy) läuft noch.
    case "AWAITING_NODE": return validated ? at(3, "running") : at(0, "running");
    case "READY_FOR_REVIEW": return at(1, "current");
    case "APPROVED": case "RUNNING": case "VERIFYING": return at(1, "running");
    case "READY_TO_PUSH": return at(2, "current");
    case "PUBLISHING": return at(2, "running");
    case "PUSHED": return at(3, "todo");
    case "DEPLOYING": case "LIVE_REVIEW": return at(3, "running");
    case "LIVE": case "LIVE_UNVERIFIED": return at(4, "done");
    case "DEPLOY_FAILED": return at(3, "failed");
    default: return at(validated ? 2 : analysed ? 1 : 0, "failed");
  }
}

// Ein Job braucht Aufmerksamkeit, wenn der Nutzer dran ist oder etwas zu Ende
// ging. Ungelesen ist er, solange der letzte Statuswechsel (updatedAt) nach
// dem letzten Ansehen (seenAt) liegt.
export function needsAttention(phase: Phase): boolean {
  return phase.actor === "user" || phase.actor === "done" || phase.actor === "failed" || phase.actor === "stalled";
}

export function isUnread(phase: Phase, job: { updatedAt: Date; seenAt: Date | null }): boolean {
  return needsAttention(phase) && (!job.seenAt || job.seenAt < job.updatedAt);
}

// Eine sichere Analyse zeigt nur die Empfehlung, der Rest liegt eingeklappt
// darunter. So springt das Fenster beim Eintreffen nicht auf. Abschnitte
// beginnen mit einer Überschrift oder einer fetten Zeile ("**Empfehlung:** …").
const HEADING = /^(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
const RECOMMENDATION = /^(#{1,6}\s*|\*\*)\s*(?:Empfehlung|Recommendation)/i;

export function analysisRisk(text: string): string | null {
  const risk = text.match(/(?:Risiko|Risk):?\**\s*\**\s*\(?\s*(sicher|safe|prüfen|review|riskant|risky)\b/i)?.[1].toLowerCase();
  return risk ? ({ safe: "sicher", review: "prüfen", risky: "riskant" } as Record<string, string>)[risk] ?? risk : null;
}

export function analysisRecommendation(text: string): { safe: boolean; recommendation: string | null } {
  const safe = analysisRisk(text) === "sicher";
  const lines = text.trim().split("\n");
  let start = lines.findLastIndex((line) => RECOMMENDATION.test(line.trim()));
  if (start < 0) start = lines.findLastIndex((line) => HEADING.test(line.trim()));
  // Ohne Gliederung oder wenn der Abschnitt schon alles ist, gibt es nichts einzuklappen.
  if (start <= 0) return { safe, recommendation: null };
  const next = lines.findIndex((line, i) => i > start && HEADING.test(line.trim()) && !RECOMMENDATION.test(line.trim()));
  const recommendation = lines.slice(start, next < 0 ? undefined : next).join("\n").trim();
  return { safe, recommendation: recommendation || null };
}

// Hash-Zusatz für einen offenen Update-Chat: /services#app-<id>~chat.
export const CHAT_SUFFIX = "~chat";

// Welcher Schritt ist gescheitert und lässt sich wiederholen, ohne neu zu
// analysieren? Jeder Schritt prüft beim Wiederholen seine Voraussetzungen selbst
// (Worktree-Basis, Diff-Hash, Remote-Stand), deshalb reicht der Status.
export type RetryStep = { status: "ANALYZING" | "APPROVED" | "PUBLISHING" | "DEPLOYING"; label: string };

export function retryStep(job: { status: string; approvalAt?: Date | string | null; diffHash?: string | null; publishApprovalAt?: Date | string | null; publishedAt?: Date | string | null }, _locale: string = "de"): RetryStep | null {
  if (job.status !== "FAILED" && job.status !== "DEPLOY_FAILED") return null;
  if (job.publishedAt) return { status: "DEPLOYING", label: _t(_locale, "dependency_phase.ma395048581") };
  if (job.diffHash && job.publishApprovalAt) return { status: "PUBLISHING", label: _t(_locale, "dependency_phase.m8ba57ea372") };
  if (job.approvalAt) return { status: "APPROVED", label: _t(_locale, "dependency_phase.m4c6e6fc4d8") };
  return { status: "ANALYZING", label: _t(_locale, "dependency_phase.mc5a7d052ab") };
}
