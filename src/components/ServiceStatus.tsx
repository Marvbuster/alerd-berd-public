"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { VizNode } from "@/lib/viz";
import { CHECK_KIND_LABEL, SPEC_PATHS, STATUS_META } from "@/lib/service-logic";
import { HistoryMini } from "./RegistryLive";
import { CopyField } from "./CopyField";
import { genHealthToken } from "@/lib/health-token";
import { toggleMonitor } from "@/lib/actions";
import { linkMonitor, unlinkMonitor } from "@/app/coolify/actions";
import { createServiceMonitor, suggestMonitoring, type SuggestState } from "@/app/services/actions";

function MergeButton({ applicationId, monitorId, name }: { applicationId: string; monitorId: string; name: string }) {
  const [state, action, pending] = useActionState(linkMonitor.bind(null, applicationId), {});
  return <form action={action} className="service-merge">
    <input type="hidden" name="monitorId" value={monitorId} />
    <span className="min-w-0 flex-1">Bestehender Monitor passt: <b>{name}</b></span>
    <button className="btn btn--ghost" disabled={pending}>{pending ? "Übernehme …" : "Übernehmen"}</button>
    {state.message && !state.ok && <p role="status" className="service-error">{state.message}</p>}
  </form>;
}

type Kind = "HEALTH" | "HTTP" | "PUSH";
const KINDS: { id: Kind; label: string }[] = [{ id: "HEALTH", label: "Spec-Health" }, { id: "HTTP", label: "Erreichbarkeit" }, { id: "PUSH", label: "Push" }];

// Monitor anlegen, direkt im Panel. Alerd probiert vorab die Health-Routen der
// Domain und füllt das Formular vor; du bestätigst oder wählst etwas anderes.
function MonitorCreate({ applicationId, hasRepo, hasWatch, onDone }: { applicationId: string; hasRepo: boolean; hasWatch: boolean; onDone: () => void }) {
  const [probe, setProbe] = useState<SuggestState | null>(null);
  const [probing, startProbe] = useTransition();
  const [kind, setKind] = useState<Kind>("HEALTH");
  // Token für Spec-Health: immer einer zur Hand, außer die App hat schon einen
  // eigenen (401/403), dann fügt man den ein oder erzeugt bewusst einen neuen.
  const [token, setToken] = useState("");
  const [state, action, creating] = useActionState(createServiceMonitor.bind(null, applicationId), {});
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => { startProbe(async () => {
    const result = await suggestMonitoring(applicationId);
    setProbe(result);
    if (result.suggestion) setKind(result.suggestion.kind);
    const sug = result.suggestion?.kind === "HEALTH" ? result.suggestion : null;
    setToken(sug?.generatedToken ?? (sug?.token === "needed" ? "" : genHealthToken()));
  }); }, [applicationId]);
  useEffect(() => { if (state.ok) done.current(); }, [state]);

  if (probing || !probe) return <div className="service-setup"><p className="service-hint">Suche Health-Route …</p></div>;
  const s = probe.suggestion;
  const origins = probe.origins ?? [];
  const spec = s?.kind === "HEALTH" ? s : null;
  return <form action={action} className="service-setup">
    <div className="view-toggle" role="radiogroup" aria-label="Art">{KINDS.map((k) => <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} aria-current={kind === k.id ? "true" : undefined} onClick={() => setKind(k.id)}>{k.label}</button>)}</div>
    <input type="hidden" name="kind" value={kind} />
    {kind !== "PUSH" && (origins.length ? <label className="service-field">Domain
      <select name="origin" defaultValue={s?.origin ?? origins[0]}>{origins.map((o) => <option key={o} value={o}>{o.replace("https://", "")}</option>)}</select>
    </label> : <p className="service-error">Keine öffentliche https-Domain in Coolify hinterlegt.</p>)}
    {kind === "HEALTH" && <>
      <label className="service-field">Pfad
        <select name="healthPath" defaultValue={spec?.healthPath ?? "/health"}>{SPEC_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </label>
      <div className="service-field">Token
        <div className="service-token-row">
          <input name="bearerToken" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Token der App einfügen" readOnly={creating} />
          <button type="button" className="btn btn--ghost" disabled={creating} onClick={() => setToken(genHealthToken())}>{token ? "neu" : "generieren"}</button>
          {token && <CopyField value={token} label="kopieren" />}
        </div>
        <span className="service-hint">{spec?.token === "needed"
          ? "Die App erwartet schon einen Token. Den hier einfügen, oder einen neuen erzeugen und in Coolify ersetzen."
          : "Kopieren, in Coolify bei der App als SPEC_HEALTH_TOKEN setzen und neu deployen."}</span>
      </div>
      {!hasWatch && <label className="service-check"><input type="checkbox" name="versionWatch" defaultChecked={hasRepo} disabled={!hasRepo} />Versionsüberwachung aktivieren{!hasRepo && <span className="service-hint"> · kein GitHub-Repo in Coolify</span>}</label>}
    </>}
    {kind === "HTTP" && <>
      <label className="service-field">Pfad
        <input name="httpPath" defaultValue={s?.httpPath ?? "/"} placeholder="/" maxLength={200} autoComplete="off" readOnly={creating} />
      </label>
      <p className="service-hint">Prüft jede Minute, ob die App unter diesem Pfad antwortet. Eine eigene Route braucht es dafür nicht, die Startseite <code>/</code> reicht.</p>
    </>}
    {kind === "PUSH" && <p className="service-hint">Die Ingest-URL steht nach dem Anlegen im Monitor.</p>}
    {kind !== "PUSH" && <p className="service-hint">{spec ? `Gefunden: Spec-Health unter ${spec.healthPath}${spec.token === "needed" ? ", geschützt" : spec.token === "generated" ? ", Token fehlt in der App" : ""}.` : s?.found === "liveness" ? "Gefunden: keine Spec-Health, aber eine Liveness unter /api/health." : s?.found === "reachable" ? "Gefunden: keine Health-Route, die Startseite antwortet." : origins.length ? "Keine Health-Route gefunden, und die Startseite antwortet gerade nicht." : ""}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" disabled={creating || (kind !== "PUSH" && !origins.length)}>{creating ? "Lege an …" : "Monitor anlegen"}</button>
      <button type="button" className="service-link" disabled={creating} onClick={onDone}>Abbrechen</button>
    </div>
    {state.message && !state.ok && <p role="status" className="service-error">{state.message}</p>}
  </form>;
}

export function ServiceStatusSection({ applicationId, monitors, mergeMonitors, readOnly, hasRepo, hasWatch }: {
  applicationId: string; monitors: VizNode[]; mergeMonitors: { id: string; name: string }[]; readOnly: boolean; hasRepo: boolean; hasWatch: boolean;
}) {
  const [creating, setCreating] = useState(false);
  return <section className="service-section">
    <h3>Monitore</h3>
    {monitors.length > 0 && <ul className="service-checks">{monitors.map((m) => {
      const meta = m.enabled ? STATUS_META[m.status] : STATUS_META.PAUSED;
      const bad = m.components.filter((c) => c.status.toLowerCase() !== "ok");
      return <li key={m.id} className={m.enabled ? "" : "opacity-60"}>
        <span className={`led led--${meta.cls}`} title={meta.label} />
        <Link href={`/monitors/${m.id}`} className="service-check-name">{m.label}</Link>
        <span className="tag">{CHECK_KIND_LABEL[m.kind] ?? m.kind}</span>
        <span className="service-check-ms">{m.responseMs != null ? `${m.responseMs} ms` : "—"}</span>
        <Link href={`/monitors/${m.id}`} className="service-check-history" aria-label={`Verlauf von ${m.label}`}><HistoryMini node={m} /></Link>
        {!readOnly && <span className="service-check-actions">
          <form action={toggleMonitor.bind(null, m.id, !m.enabled)}><button className="service-link" aria-label={`${m.label} ${m.enabled ? "pausieren" : "aktivieren"}`}>{m.enabled ? "Pausieren" : "Aktivieren"}</button></form>
          <form action={unlinkMonitor.bind(null, applicationId, m.id)}><button className="service-link" aria-label={`${m.label} vom Dienst lösen`}>Lösen</button></form>
        </span>}
        {bad.length > 0 && m.enabled && m.status !== "DOWN" && <ul className="service-components">{bad.map((c) => <li key={c.name}><span className={`led led--${c.status.toLowerCase() === "degraded" ? "degraded" : "down"}`} />{c.name}{c.detail ? <span className="service-meta"> · {c.detail}</span> : null}</li>)}</ul>}
      </li>;
    })}</ul>}
    {!readOnly && mergeMonitors.map((m) => <MergeButton key={m.id} applicationId={applicationId} monitorId={m.id} name={m.name} />)}
    {!readOnly && (creating
      ? <MonitorCreate applicationId={applicationId} hasRepo={hasRepo} hasWatch={hasWatch} onDone={() => setCreating(false)} />
      : <button type="button" className={monitors.length || mergeMonitors.length ? "service-link" : "btn"} onClick={() => setCreating(true)}>{monitors.length ? "+ Monitor anlegen" : "Monitor anlegen"}</button>)}
  </section>;
}
