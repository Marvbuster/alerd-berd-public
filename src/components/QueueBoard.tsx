"use client";

import { intlLocale } from "@/i18n/locale";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Queue, QueueEntry } from "@/lib/dependency-queue";
import { WorkerProgress } from "./WorkerProgress";
import { localizedACTOR_LABEL as ACTOR_LABEL, ago, dependencySteps, elapsed, localizedSTEP_LABELS as STEP_LABELS } from "@/lib/dependency-phase";

const POLL_MS = 5_000;

export function StateChip({ actor }: { actor: QueueEntry["actor"] }) {
  const _locale = _useLocale();
  return <span className={`state-chip state-chip--${actor}`}><i />{ACTOR_LABEL(_locale)[actor]}</span>;
}

// Eigene Jobs öffnen den Update-Chat direkt hier, nicht unter Dienste.
export function queueChatHref(applicationId: string) { return `/queue?chat=${encodeURIComponent(applicationId)}`; }

function Title({ entry }: { entry: QueueEntry }) {
  const _locale = _useLocale();
  const name = <><strong>{entry.applicationName}</strong><span className="queue-label">{entry.label}</span></>;
  return <span className="queue-title">
    {entry.own ? <Link href={queueChatHref(entry.applicationId)} scroll={false}>{name}</Link> : name}
    {!entry.own && <span className="queue-owner">{_t(_locale, "QueueBoard.m16b4d3e5ce")}{entry.owner}</span>}
  </span>;
}

function Steps({ status }: { status: string }) {
  const _locale = _useLocale();
  const states = dependencySteps(status);
  return <ol className="dependency-steps queue-steps" aria-label={_t(_locale, "QueueBoard.mabfc3f29bb")}>{STEP_LABELS(_locale).map((label, i) => <li key={label} className={`dependency-step dependency-step--${states[i]}`}>
    <span className="dependency-step-mark">{states[i] === "done" ? "✓" : states[i] === "failed" ? "!" : i + 1}</span>{label}
  </li>)}</ol>;
}

function Running({ entry, now }: { entry: QueueEntry; now: Date }) {
  const _locale = _useLocale();
  // Die Teilschritte zeigen, was gerade läuft. Erklärtext und letzte Meldung nur,
  // wenn es keine Teilschritte gibt, sonst steht alles doppelt.
  const steps = entry.progress.length > 0;
  return <article className={`panel queue-now queue-now--${entry.actor}`}>
    <div className="queue-now-head"><StateChip actor={entry.actor} /><Title entry={entry} />{entry.since && <span className="queue-clock">{elapsed(new Date(entry.since), now)}</span>}</div>
    <p className="queue-now-step">{entry.title}</p>
    {!steps && entry.detail && <p className="queue-now-detail">{entry.detail}</p>}
    <Steps status={entry.status} />
    <WorkerProgress steps={entry.progress} now={now} />
    {!steps && entry.latest && <p className="queue-latest"><span>{_t(_locale, "QueueBoard.m9739a50cf0")}{entry.latestAt ? `, ${ago(new Date(entry.latestAt), now, _locale)}` : ""}</span>{entry.latest}</p>}
  </article>;
}

function Row({ entry, now, position, note }: { entry: QueueEntry; now: Date; position?: number; note?: string }) {
  const _locale = _useLocale();
  return <li className={`queue-row queue-row--${entry.actor}`}>
    {position !== undefined && <span className="queue-pos" aria-label={_t(_locale, "QueueBoard.m75a9533f28", { value0: position })}>{position}</span>}
    <div className="min-w-0 flex-1">
      <Title entry={entry} />
      {note && <span className="queue-sub">{note}</span>}
    </div>
    <StateChip actor={entry.actor} />
    <span className="queue-time" title={new Date(entry.changedAt).toLocaleString(intlLocale(_locale))}>{ago(new Date(entry.changedAt), now, _locale)}</span>
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
  const _locale = _useLocale();
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

  const lastSeen = queue.workerLastSeen ? _t(_locale, "QueueBoard.mc60ca6fc36", { value0: ago(new Date(queue.workerLastSeen), now, _locale) }) : _t(_locale, "QueueBoard.m1f898f6631");
  const stalled = !queue.running.length && queue.next.some((e) => e.actor === "stalled");

  return <div className="queue-board">
    {stale && <p className="queue-stale">{_t(_locale, "QueueBoard.m4bcb7ab377")}</p>}
    <section className="queue-section">
      <h2>{_t(_locale, "QueueBoard.m43c73f447c")}</h2>
      {queue.running.length
        ? queue.running.map((e) => <Running key={e.jobId} entry={e} now={now} />)
        : <div className={`panel queue-idle${stalled ? " queue-idle--stalled" : ""}`}>
          {stalled ? <StateChip actor="stalled" /> : <span className="state-chip state-chip--idle"><i />{_t(_locale, "QueueBoard.m3b09eed1e0")}</span>}
          <span>{stalled ? _t(_locale, "QueueBoard.m90ff89d6a5", { value0: lastSeen }) : _t(_locale, "QueueBoard.md06839dbcc", { value0: lastSeen })}</span>
        </div>}
    </section>
    <Section title={_t(_locale, "QueueBoard.m7d75c06611")} empty={_t(_locale, "QueueBoard.m142a200d64")}>
      {queue.next.map((e, i) => <Row key={e.jobId} entry={e} now={now} position={i + 1} />)}
    </Section>
    <Section title={_t(_locale, "QueueBoard.mf4c1634ff6")}>
      {queue.deploying.map((e) => {
        const left = e.lockedUntil ? Math.max(0, Math.round((new Date(e.lockedUntil).getTime() - now.getTime()) / 1000)) : null;
        return <Row key={e.jobId} entry={e} now={now} note={left !== null ? (left ? _t(_locale, "QueueBoard.m54ba8822b4", { value0: left }) : _t(_locale, "QueueBoard.m8dbab7f916")) : undefined} />;
      })}
    </Section>
    <Section title={_t(_locale, "QueueBoard.m6f6a95ae88")}>
      {queue.node.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
    <Section title={_t(_locale, "QueueBoard.md3b54f17ff")}>
      {queue.yours.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
    <Section title={_t(_locale, "QueueBoard.mfffc76e80a")}>
      {queue.recent.map((e) => <Row key={e.jobId} entry={e} now={now} />)}
    </Section>
  </div>;
}
