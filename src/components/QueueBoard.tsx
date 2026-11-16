"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Queue, QueueEntry } from "@/lib/dependency-queue";
import { WorkerProgress } from "./WorkerProgress";
import { currentStep } from "@/lib/dependency-progress";
import { ACTOR_LABEL, ago, dependencySteps, elapsed, STEP_LABELS } from "@/lib/dependency-phase";

const POLL_MS = 5_000;

export function StateChip({ actor }: { actor: QueueEntry["actor"] }) {
  return <span className={`state-chip state-chip--${actor}`}><i />{ACTOR_LABEL[actor]}</span>;
}

// Eigene Jobs öffnen den Update-Chat direkt hier, nicht unter Dienste.
export function queueChatHref(applicationId: string) { return `/queue?chat=${encodeURIComponent(applicationId)}`; }

function Title({ entry }: { entry: QueueEntry }) {
  const name = <><strong>{entry.applicationName}</strong><span className="queue-label">{entry.label}</span></>;
  return <span className="queue-title">
    {entry.own ? <Link href={queueChatHref(entry.applicationId)} scroll={false}>{name}</Link> : name}
    {!entry.own && <span className="queue-owner">von {entry.owner}</span>}
  </span>;
}

function Steps({ status }: { status: string }) {
  const states = dependencySteps(status);
  return <ol className="dependency-steps queue-steps" aria-label="Fortschritt">{STEP_LABELS.map((label, i) => <li key={label} className={`dependency-step dependency-step--${states[i]}`}>
    <span className="dependency-step-mark">{states[i] === "done" ? "✓" : states[i] === "failed" ? "!" : i + 1}</span>{label}
  </li>)}</ol>;
}

function Running({ entry, now }: { entry: QueueEntry; now: Date }) {
  const current = currentStep(entry.progress);
  return <article className={`panel queue-now queue-now--${entry.actor}`}>
    <div className="queue-now-head"><StateChip actor={entry.actor} /><Title entry={entry} />{entry.since && <span className="queue-clock">{elapsed(new Date(entry.since), now)}</span>}</div>
    <p className="queue-now-step">{entry.title}</p>
    {current && <p className="queue-now-current">Gerade: <strong>{current.label}</strong> seit {elapsed(new Date(current.startedAt), now)}</p>}
    {entry.detail && <p className="queue-now-detail">{entry.detail}</p>}
    <Steps status={entry.status} />
    <WorkerProgress steps={entry.progress} now={now} />
    {entry.latest && <p className="queue-latest"><span>Letzte Meldung{entry.latestAt ? `, ${ago(new Date(entry.latestAt), now)}` : ""}</span>{entry.latest}</p>}
  </article>;
}

function Row({ entry, now, position, note }: { entry: QueueEntry; now: Date; position?: number; note?: string }) {
  return <li className={`queue-row queue-row--${entry.actor}`}>
    {position !== undefined && <span className="queue-pos" aria-label={`Platz ${position}`}>{position}</span>}
    <div className="min-w-0 flex-1">
      <Title entry={entry} />
      <span className="queue-sub">{entry.title}{note ? ` · ${note}` : ""}</span>
    </div>
    <StateChip actor={entry.actor} />
    <span className="queue-time" title={new Date(entry.changedAt).toLocaleString("de-DE")}>{ago(new Date(entry.changedAt), now)}</span>
  </li>;
}

function Section({ title, hint, children, empty }: { title: string; hint?: string; children: React.ReactNode[]; empty?: string }) {
  if (!children.length && !empty) return null;
  return <section className="queue-section">
    <h2>{title}{children.length > 0 && <span className="queue-count">{children.length}</span>}</h2>
    {hint && <p className="queue-hint">{hint}</p>}
    {children.length ? <ul className="panel queue-list">{children}</ul> : <p className="queue-empty">{empty}</p>}
  </section>;
}

export function QueueBoard({ initial }: { initial: Queue }) {
  const [queue, setQueue] = useState(initial);
  const [now, setNow] = useState(() => new Date());
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/queue", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setQueue(await response.json() as Queue);
      setStale(false);
    } catch { setStale(true); }
  }, []);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const poll = window.setInterval(tick, POLL_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(poll); window.clearInterval(clock); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  const lastSeen = queue.workerLastSeen ? `Zuletzt hat er ${ago(new Date(queue.workerLastSeen), now)} einen Job angefasst.` : "Er hat noch keinen Job angefasst.";
  const stalled = !queue.running.length && queue.next.some((e) => e.actor === "stalled");

  return <div className="queue-board">
    {stale && <p className="queue-stale">Verbindung weg, die Ansicht ist gerade nicht aktuell.</p>}
    <section className="queue-section">
      <h2>Jetzt</h2>
      {queue.running.length
        ? queue.running.map((e) => <Running key={e.jobId} entry={e} now={now} />)
        : <div className={`panel queue-idle${stalled ? " queue-idle--stalled" : ""}`}>
          {stalled ? <StateChip actor="stalled" /> : <span className="state-chip state-chip--idle"><i />Frei</span>}
          <span>{stalled ? `Der Worker übernimmt keine Jobs. ${lastSeen} Läuft die Worker-Ressource in Coolify?` : `Der Worker ist frei. ${lastSeen}`}</span>
        </div>}
    </section>
    <Section title="Als Nächstes" hint="Der Worker nimmt immer den Job, der am längsten wartet." empty="Nichts in der Schlange.">
      {queue.next.map((e, i) => <Row key={e.jobId} entry={e} now={now} position={i + 1} />)}
    </Section>
    <Section title="Deploy wird beobachtet" hint="Alerd prüft alle 30 Sekunden, ob die neue Version live ist. Der Worker ist dazwischen frei.">
      {queue.deploying.map((e) => {
        const left = e.lockedUntil ? Math.max(0, Math.round((new Date(e.lockedUntil).getTime() - now.getTime()) / 1000)) : null;
        return <Row key={e.jobId} entry={e} now={now} note={left !== null ? (left ? `nächste Prüfung in ${left} s` : "wird gerade geprüft") : undefined} />;
      })}
    </Section>
    <Section title="Bei deiner lokalen Node">
      {queue.node.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
    <Section title="Du bist dran">
      {queue.yours.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
    <Section title="Zuletzt fertig" hint="Die letzten 24 Stunden.">
      {queue.recent.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
  </div>;
}
