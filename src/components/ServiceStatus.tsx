"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { VizNode } from "@/lib/viz";
import { localizedCHECK_KIND_LABEL as CHECK_KIND_LABEL, SPEC_PATHS, localizedSTATUS_META as STATUS_META } from "@/lib/service-logic";
import { HistoryMini } from "./RegistryLive";
import { CopyField } from "./CopyField";
import { genHealthToken } from "@/lib/health-token";
import { toggleMonitor } from "@/lib/actions";
import { linkMonitor, unlinkMonitor } from "@/app/coolify/actions";
import { createServiceMonitor, suggestMonitoring, type SuggestState } from "@/app/services/actions";

function MergeButton({ applicationId, monitorId, name }: { applicationId: string; monitorId: string; name: string }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(linkMonitor.bind(null, applicationId), {});
  return <form action={action} className="service-merge">
    <input type="hidden" name="monitorId" value={monitorId} />
    <span className="min-w-0 flex-1">{_t(_locale, "ServiceStatus.mb51deb334d")}<b>{name}</b></span>
    <button className="btn btn--ghost" disabled={pending}>{pending ? _t(_locale, "ServiceStatus.mc28f2ad420") : _t(_locale, "ServiceStatus.m936378b371")}</button>
    {state.message && !state.ok && <p role="status" className="service-error">{_message(_locale, state.message)}</p>}
  </form>;
}

type Kind = "HEALTH" | "HTTP" | "PUSH";
function KINDS(_locale: string = "de"): { id: Kind; label: string }[] { return ([{ id: "HEALTH", label: _t(_locale, "ServiceStatus.me6f5858c68") }, { id: "HTTP", label: _t(_locale, "ServiceStatus.mbecf4edf10") }, { id: "PUSH", label: _t(_locale, "ServiceStatus.m731ce7ed80") }]); }

// Monitor anlegen, direkt im Panel. Alerd probiert vorab die Health-Routen der
// Domain und füllt das Formular vor; du bestätigst oder wählst etwas anderes.
function MonitorCreate({ applicationId, hasRepo, hasWatch, onDone }: { applicationId: string; hasRepo: boolean; hasWatch: boolean; onDone: () => void }) {
  const _locale = _useLocale();
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

  if (probing || !probe) return <div className="service-setup"><p className="service-hint">{_t(_locale, "ServiceStatus.m9e7e3012fd")}</p></div>;
  const s = probe.suggestion;
  const origins = probe.origins ?? [];
  const spec = s?.kind === "HEALTH" ? s : null;
  return <form action={action} className="service-setup">
    <div className="view-toggle" role="radiogroup" aria-label={_t(_locale, "ServiceStatus.m75df3579c7")}>{KINDS(_locale).map((k) => <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} aria-current={kind === k.id ? "true" : undefined} onClick={() => setKind(k.id)}>{k.label}</button>)}</div>
    <input type="hidden" name="kind" value={kind} />
    {kind !== "PUSH" && (origins.length ? <label className="service-field">{_t(_locale, "ServiceStatus.m79fa33618d")}<select name="origin" defaultValue={s?.origin ?? origins[0]}>{origins.map((o) => <option key={o} value={o}>{o.replace("https://", "")}</option>)}</select>
    </label> : <p className="service-error">{_t(_locale, "ServiceStatus.mc22a4464ca")}</p>)}
    {kind === "HEALTH" && <>
      <label className="service-field">{_t(_locale, "ServiceStatus.mbe2fbefc5c")}<select name="healthPath" defaultValue={spec?.healthPath ?? "/health"}>{SPEC_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </label>
      <div className="service-field">{_t(_locale, "ServiceStatus.md2089be672")}<div className="service-token-row">
          <input name="bearerToken" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={_t(_locale, "ServiceStatus.m17459ee0fc")} readOnly={creating} />
          <button type="button" className="btn btn--ghost" disabled={creating} onClick={() => setToken(genHealthToken())}>{token ? _t(_locale, "common.new") : _t(_locale, "common.generate")}</button>
          {token && <CopyField value={token} label={_t(_locale, "ServiceStatus.mdb17ead3ed")} />}
        </div>
        <span className="service-hint">{spec?.token === "needed"
          ? _t(_locale, "ServiceStatus.m86616db329")
          : _t(_locale, "ServiceStatus.me5a44ca1a4")}</span>
      </div>
      {!hasWatch && <label className="service-check"><input type="checkbox" name="versionWatch" defaultChecked={hasRepo} disabled={!hasRepo} />{_t(_locale, "ServiceStatus.m790afa136c")}{!hasRepo && <span className="service-hint"> {_t(_locale, "ServiceStatus.me1eb46be4f")}</span>}</label>}
    </>}
    {kind === "HTTP" && <>
      <label className="service-field">{_t(_locale, "ServiceStatus.mbe2fbefc5c")}<input name="httpPath" defaultValue={s?.httpPath ?? "/"} placeholder={_t(_locale, "ServiceStatus.m8a5edab282")} maxLength={200} autoComplete="off" readOnly={creating} />
      </label>
      <p className="service-hint">{_t(_locale, "ServiceStatus.m6c0a3ef1ef")}<code>/</code> {_t(_locale, "ServiceStatus.m21e6e49100")}</p>
    </>}
    {kind === "PUSH" && <p className="service-hint">{_t(_locale, "ServiceStatus.m52952750d4")}</p>}
    {kind !== "PUSH" && <p className="service-hint">{spec ? _t(_locale, "ServiceStatus.md2b5fa917b", { value0: spec.healthPath, value1: spec.token === "needed" ? _t(_locale, "ServiceStatus.mda3017e79d") : spec.token === "generated" ? _t(_locale, "ServiceStatus.mfae3739383") : "" }) : s?.found === "liveness" ? _t(_locale, "ServiceStatus.m7e3fbf1015") : s?.found === "reachable" ? _t(_locale, "ServiceStatus.meabf51cbff") : origins.length ? _t(_locale, "ServiceStatus.mb76794a8c6") : ""}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" disabled={creating || (kind !== "PUSH" && !origins.length)}>{creating ? _t(_locale, "ServiceStatus.mc4fec48fe9") : _t(_locale, "ServiceStatus.mdd08c268b6")}</button>
      <button type="button" className="service-link" disabled={creating} onClick={onDone}>{_t(_locale, "ServiceStatus.mf7ff1178af")}</button>
    </div>
    {state.message && !state.ok && <p role="status" className="service-error">{_message(_locale, state.message)}</p>}
  </form>;
}

export function ServiceStatusSection({ applicationId, monitors, mergeMonitors, readOnly, hasRepo, hasWatch }: {
  applicationId: string; monitors: VizNode[]; mergeMonitors: { id: string; name: string }[]; readOnly: boolean; hasRepo: boolean; hasWatch: boolean;
}) {
  const _locale = _useLocale();
  const [creating, setCreating] = useState(false);
  return <section className="service-section">
    <h3>{_t(_locale, "ServiceStatus.m9cfe09ed1a")}</h3>
    {monitors.length > 0 && <ul className="service-checks">{monitors.map((m) => {
      const meta = m.enabled ? STATUS_META(_locale)[m.status] : STATUS_META(_locale).PAUSED;
      const bad = m.components.filter((c) => c.status.toLowerCase() !== "ok");
      return <li key={m.id} className={m.enabled ? "" : "opacity-60"}>
        <span className={`led led--${meta.cls}`} title={meta.label} />
        <Link href={`/monitors/${m.id}`} className="service-check-name">{m.label}</Link>
        <span className="tag">{CHECK_KIND_LABEL(_locale)[m.kind] ?? m.kind}</span>
        <span className="service-check-ms">{m.responseMs != null ? _t(_locale, "ServiceStatus.m33f3d582fe", { value0: m.responseMs }) : "—"}</span>
        <Link href={`/monitors/${m.id}`} className="service-check-history" aria-label={_t(_locale, "ServiceStatus.m16bf027c0f", { value0: m.label })}><HistoryMini node={m} /></Link>
        {!readOnly && <span className="service-check-actions">
          <form action={toggleMonitor.bind(null, m.id, !m.enabled)}><button className="service-link" aria-label={`${m.label} ${m.enabled ? _t(_locale, "common.pause") : _t(_locale, "common.activate")}`}>{m.enabled ? _t(_locale, "ServiceStatus.m75a303be13") : _t(_locale, "ServiceStatus.mcfc6942928")}</button></form>
          <form action={unlinkMonitor.bind(null, applicationId, m.id)}><button className="service-link" aria-label={_t(_locale, "ServiceStatus.m25c9a0d38b", { value0: m.label })}>{_t(_locale, "ServiceStatus.m889c343c56")}</button></form>
        </span>}
        {bad.length > 0 && m.enabled && m.status !== "DOWN" && <ul className="service-components">{bad.map((c) => <li key={c.name}><span className={`led led--${c.status.toLowerCase() === "degraded" ? "degraded" : "down"}`} />{c.name}{c.detail ? <span className="service-meta"> · {_message(_locale, c.detail)}</span> : null}</li>)}</ul>}
      </li>;
    })}</ul>}
    {!readOnly && mergeMonitors.map((m) => <MergeButton key={m.id} applicationId={applicationId} monitorId={m.id} name={m.name} />)}
    {!readOnly && (creating
      ? <MonitorCreate applicationId={applicationId} hasRepo={hasRepo} hasWatch={hasWatch} onDone={() => setCreating(false)} />
      : <button type="button" className={monitors.length || mergeMonitors.length ? "service-link" : "btn"} onClick={() => setCreating(true)}>{monitors.length ? _t(_locale, "ServiceStatus.m0f59ab2b80") : _t(_locale, "ServiceStatus.mdd08c268b6")}</button>)}
  </section>;
}
