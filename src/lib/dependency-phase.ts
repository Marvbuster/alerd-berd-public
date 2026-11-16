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
export const LIVE_SEEN_PREFIX = "Neue Version gefunden:";
// Die Ausgangslage ohne Update baut der Worker schon während der Analyse.
export const BASELINE_OK_PREFIX = "Ausgangslage grün:";

// Wer die Analyse und das Fazit schreibt. Steht überall, wo ein Job sichtbar ist.
export function engineLabel(engine: string | null | undefined): string {
  return engine === "LOCAL_NODE" ? "Lokaler Alerd Node" : "Claude";
}

export type Phase = {
  actor: "user" | "worker" | "waiting" | "stalled" | "done" | "failed";
  title: string;
  detail: string;
  since: Date | null;
};

// Kurzes Wort zum Zustand, neben der Farbe. Farbe allein liest man nicht sofort.
export const ACTOR_LABEL: Record<Phase["actor"], string> = {
  user: "Du bist dran", worker: "Läuft", waiting: "Wartet", stalled: "Hängt", done: "Fertig", failed: "Fehler",
};

// Ohne Übernahme durch den Worker nach dieser Zeit stimmt etwas nicht.
export const WORKER_PICKUP_MS = 45_000;

const workerSteps: Record<string, { title: string; detail: string }> = {
  ANALYZING: { title: "Claude analysiert", detail: "Claude liest Release Notes und Code, parallel baut Alerd den heutigen Stand. Dauert meist 3 bis 8 Minuten, das Fenster darf zu." },
  APPROVED: { title: "Update wird vorbereitet", detail: "Build und Tests laufen einmal ohne und einmal mit dem Update. Dauert meist 5 bis 15 Minuten, das Fenster darf zu." },
  RUNNING: { title: "Build und Tests laufen", detail: "Einmal ohne und einmal mit dem Update. Dauert meist 5 bis 15 Minuten, das Fenster darf zu." },
  VERIFYING: { title: "Build und Tests laufen", detail: "Einmal ohne und einmal mit dem Update. Dauert meist 5 bis 15 Minuten, das Fenster darf zu." },
  PUBLISHING: { title: "Commit und Push laufen", detail: "Dauert meist unter einer Minute." },
  DEPLOYING: { title: "Warte auf den Deploy", detail: "Coolify baut und startet die App. Alerd prüft alle 30 Sekunden, ob der Monitor die neue Version meldet, höchstens 30 Minuten. Das Fenster darf zu." },
  LIVE_REVIEW: { title: "Claude schreibt das Fazit", detail: "Die neue Version ist live. Claude geht seine Prüfpunkte durch, meist 1 bis 3 Minuten." },
};

// Endzustände: kein Worker mehr dran, ein neuer Chat für die App ist erlaubt.
export const TERMINAL_STATUSES = ["FAILED", "CANCELLED", "PUSHED", "LIVE", "LIVE_UNVERIFIED", "DEPLOY_FAILED"];
export const WORKER_STATUSES = Object.keys(workerSteps);

// Woran der Worker gerade arbeitet, über alle Nutzer hinweg. Nur zwei Nutzer,
// deshalb offen sichtbar: so sieht man, ob er läuft und wer vor einem dran ist.
export type WorkerBusy = { jobId: string; appName: string; owner: string; label: string; status: string; since: Date };

const BUSY_STEP: Record<string, string> = {
  ANALYZING: "Analyse", APPROVED: "Vorbereitung", RUNNING: "Build und Tests", VERIFYING: "Prüfung",
  PUBLISHING: "Push", LIVE_REVIEW: "Fazit",
};

export function workerBusyText(busy: WorkerBusy, now: Date): string {
  return `${busy.appName} von ${busy.owner}: ${busy.label}, ${BUSY_STEP[busy.status] ?? busy.status} seit ${elapsed(busy.since, now)}`;
}

export function dependencyPhase(job: PhaseJob, now: Date, { hasPublish = true, workerBusy = null, workerLastSeen = null }: { hasPublish?: boolean; workerBusy?: WorkerBusy | null; workerLastSeen?: Date | null } = {}): Phase {
  let step = workerSteps[job.status];
  // Lokale Node: Den ersten Schritt macht der Server (Ausgangslage, Kontext),
  // das Modell auf dem Mac kommt erst danach dran.
  if (job.engine === "LOCAL_NODE" && job.status === "ANALYZING") step = { title: "Alerd bereitet die Analyse vor", detail: "Der Server baut den heutigen Stand und sammelt Release Notes und Importstellen. Danach übernimmt deine lokale Node, das Fenster darf zu." };
  if (job.engine === "LOCAL_NODE" && job.status === "LIVE_REVIEW") step = { title: "Alerd misst den Live-Stand", detail: "Danach schreibt deine lokale Node das Fazit." };
  // Deploy angekommen, aber noch in der Stabilitätsprüfung: das sagen, statt weiter „Warte auf den Deploy“.
  const seen = job.status === "DEPLOYING" ? job.messages?.findLast((m) => m.role === "SYSTEM" && m.content.startsWith(LIVE_SEEN_PREFIX)) : undefined;
  if (seen) step = { title: "Neue Version gefunden", detail: `Der Monitor meldet sie. Alerd prüft noch 2 Minuten, ob sie stabil läuft, danach schreibt ${job.engine === "LOCAL_NODE" ? "deine lokale Node" : "Claude"} das Fazit. Das Fenster darf zu.` };
  // Ist die Ausgangslage schon grün, läuft nur noch der Build mit dem Update.
  const baselineDone = ["APPROVED", "RUNNING", "VERIFYING"].includes(job.status) && !!job.messages?.some((m) => m.role === "SYSTEM" && m.content.startsWith(BASELINE_OK_PREFIX));
  if (baselineDone) step = { title: job.status === "APPROVED" ? "Update wird vorbereitet" : "Build und Tests laufen", detail: "Mit dem Update, ohne Update war der Stand schon in der Analyse grün. Dauert meist 3 bis 8 Minuten, das Fenster darf zu." };
  if (step) {
    const claimed = !!job.workerLockedUntil && job.workerLockedUntil > now;
    // RUNNING setzt der Worker selbst, dort ist er per Definition schon dran.
    // Beim Deploy hält der Worker den Job zwischen den Prüfungen per Lock zurück.
    if (claimed || job.status === "RUNNING" || job.status === "VERIFYING") return { actor: "worker", ...step, since: seen ? new Date(seen.createdAt) : job.workerAttemptAt ?? job.updatedAt };
    // Der Worker arbeitet einen Job nach dem anderen ab: steckt er in einem
    // anderen, ist das eine Schlange und kein Ausfall.
    if (workerBusy && workerBusy.jobId !== job.id) {
      return { actor: "waiting", title: "Wartet in der Schlange", detail: `Der Worker arbeitet gerade an ${workerBusyText(workerBusy, now)}. Danach ist dieser Job dran, das Fenster darf zu.`, since: job.updatedAt };
    }
    if (now.getTime() - job.updatedAt.getTime() > WORKER_PICKUP_MS) {
      const last = workerLastSeen ? ` Zuletzt hat er vor ${elapsed(workerLastSeen, now)} einen Job angefasst.` : " Er hat noch nie einen Job angefasst.";
      return { actor: "stalled", title: "Worker antwortet nicht", detail: `Gerade läuft kein Job, und dieser wurde nicht übernommen.${last} Läuft die Worker-Ressource in Coolify? Im Log steht pro Job eine Zeile.`, since: job.updatedAt };
    }
    return { actor: "waiting", title: "Wartet auf den Worker", detail: "Wird in wenigen Sekunden übernommen.", since: job.updatedAt };
  }
  switch (job.status) {
    case "DRAFT":
    case "AWAITING_CLAUDE":
      return { actor: "user", title: "Du bist dran", detail: "Analyse starten. Claude liest dann Release Notes und Repo, gepusht wird dabei nichts.", since: null };
    case "AWAITING_NODE":
      return { actor: "waiting", title: "Wartet auf deine lokale Node", detail: "Dein Mac übernimmt, sobald Alerd Node läuft. Ob sie verbunden ist, steht unter Einstellungen → Zugänge → Lokale Analyse-Node.", since: job.updatedAt };
    case "READY_FOR_REVIEW":
      return { actor: "user", title: "Du bist dran", detail: "Analyse lesen. Nachfragen oder das Update vorbereiten lassen.", since: null };
    case "READY_TO_PUSH":
      return hasPublish
        ? { actor: "user", title: "Du bist dran", detail: "Alles grün. Mit Commit & Push deployt Coolify die App.", since: null }
        : { actor: "user", title: "GitHub-Schreibzugang fehlt", detail: "Unter Einstellungen → Zugänge hinterlegen, danach Commit & Push freigeben.", since: null };
    case "PUSHED":
      return { actor: "done", title: "Gepusht", detail: "Coolify deployt jetzt. Unter Versionen siehst du, wann die neue Version live ist.", since: null };
    case "LIVE":
      return { actor: "done", title: "Live bestätigt", detail: `Der Monitor meldet die neue Version. Das Fazit von ${engineLabel(job.engine)} steht im Chat.`, since: null };
    case "LIVE_UNVERIFIED":
      return { actor: "done", title: "Gepusht, live nicht geprüft", detail: "Kein verknüpfter Monitor meldet den Commit oder eines der Pakete live. Meldet die Spec-Health runtime.commit, bestätigt Alerd Updates künftig exakt.", since: null };
    case "DEPLOY_FAILED":
      return { actor: "failed", title: "Deploy nicht angekommen", detail: job.lastError ?? "Die neue Version wurde nicht live gemeldet.", since: null };
    case "CANCELLED":
      return { actor: "failed", title: "Abgebrochen", detail: "Mit „Neu analysieren“ startet ein neuer Versuch.", since: null };
    default:
      return { actor: "failed", title: "Fehlgeschlagen", detail: job.lastError ?? "Unbekannter Fehler.", since: null };
  }
}

export function elapsed(since: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Grobe relative Zeit für Listen: „gerade“, „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“.
export function ago(since: Date, now: Date): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - since.getTime()) / 60_000);
  if (minutes < 1) return "gerade";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

export type StepState = "todo" | "current" | "running" | "done" | "failed";
export const STEP_LABELS = ["Analyse", "Update", "Push", "Live"] as const;

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
const RECOMMENDATION = /^(#{1,6}\s*|\*\*)\s*Empfehlung/i;

export function analysisRisk(text: string): string | null {
  const risk = text.match(/Risiko:?\**\s*\**\s*([A-Za-zäöüÄÖÜ]+)/);
  return risk ? risk[1].toLowerCase() : null;
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

export function retryStep(job: { status: string; approvalAt?: Date | string | null; diffHash?: string | null; publishApprovalAt?: Date | string | null; publishedAt?: Date | string | null }): RetryStep | null {
  if (job.status !== "FAILED" && job.status !== "DEPLOY_FAILED") return null;
  if (job.publishedAt) return { status: "DEPLOYING", label: "Deploy erneut prüfen" };
  if (job.diffHash && job.publishApprovalAt) return { status: "PUBLISHING", label: "Push erneut versuchen" };
  if (job.approvalAt) return { status: "APPROVED", label: "Vorbereitung wiederholen" };
  return { status: "ANALYZING", label: "Analyse wiederholen" };
}
