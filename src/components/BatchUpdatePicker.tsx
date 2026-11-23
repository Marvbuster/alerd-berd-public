"use client";

import { translate as _t, translateMessage as _message } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./Icon";
import { EngineChip } from "./DependencyAssistant";
import { createDependencyBatch, type BatchActionState } from "@/app/coolify/dependency-actions";
import type { UpdateCandidate } from "@/lib/dependency-target";

export type BatchService = { applicationId: string; name: string; candidates: UpdateCandidate[] };

// Sammel-Update starten, im selben Fenster wie der Update-Chat: alle Dienste mit
// Updates ohne offenen Chat. Majors fehlen hier ganz (sie bleiben Einzelarbeit im
// Chat), vorausgewählt ist alles ohne bekanntes Problem am Ziel. Nach dem Start
// geht es auf die Seite des Laufs (/batch/<id>), dort folgen die Sammelfreigaben.
export function BatchUpdatePicker({ services, manualDeploy = [], hasClaude, hasLocalNode, localNodeOnline, onCancel }: {
  services: BatchService[]; manualDeploy?: string[]; hasClaude: boolean; hasLocalNode: boolean; localNodeOnline: boolean; onCancel: () => void;
}) {
  const _locale = _useLocale();
  const key = (s: BatchService, c: UpdateCandidate) => `${s.applicationId}|${c.name}`;
  const [picked, setPicked] = useState<string[]>(() => services.flatMap((s) => s.candidates.filter((c) => !c.knownIssues?.length && !c.recommended?.hold).map((c) => key(s, c))));
  const [engine, setEngine] = useState<"CLAUDE" | "LOCAL_NODE">(hasClaude ? "CLAUDE" : "LOCAL_NODE");
  const [state, action, pending] = useActionState<BatchActionState, FormData>(createDependencyBatch, {});
  const router = useRouter();
  // Gestartet oder schon ein Lauf offen: auf dessen Seite. Wurde etwas übersprungen,
  // erst zeigen was und warum, die Seite des Laufs kennt die Gründe nicht.
  const go = !!state.batchId && (!state.ok || !state.skipped?.length);
  useEffect(() => { if (go && state.batchId) router.push(`/batch/${state.batchId}`); }, [go, state.batchId, router]);
  const toggle = (k: string) => setPicked((list) => list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const toggleService = (s: BatchService) => {
    const keys = s.candidates.map((c) => key(s, c));
    const all = keys.every((k) => picked.includes(k));
    setPicked((list) => all ? list.filter((k) => !keys.includes(k)) : [...new Set([...list, ...keys])]);
  };
  const chosen = services.filter((s) => s.candidates.some((c) => picked.includes(key(s, c)))).length;

  const close = <button type="button" className="icon-button" aria-label={_t(_locale, "BatchUpdate.close")} onClick={onCancel}><Icon name="close" size={18} /></button>;
  const skipped = !!state.skipped?.length && <div className="batch-skipped"><p className="service-meta">{_t(_locale, "BatchUpdate.skipped")}</p>
    <ul>{state.skipped.map((s) => <li key={s.name}><strong>{s.name}</strong> {_message(_locale, s.message)}</li>)}</ul></div>;

  return <div className="dependency-modal-backdrop" role="presentation" onMouseDown={onCancel}><section className="dependency-modal" role="dialog" aria-modal="true" aria-label={_t(_locale, "BatchUpdate.title")} onMouseDown={(event) => event.stopPropagation()}>
    <div className="dependency-modal-header">
      <div><h2>{_t(_locale, "BatchUpdate.title")}</h2><p className="service-meta mt-1">{_t(_locale, "BatchUpdate.intro")}</p></div>
      {close}
    </div>
    <div className="mt-5">
      {state.ok && state.batchId && !go ? <div className="grid gap-3">
        <p>{_message(_locale, state.message)}</p>
        {skipped}
        <Link href={`/batch/${state.batchId}`} className="btn w-fit">{_t(_locale, "BatchUpdate.toBatch")}</Link>
      </div> : !hasClaude && !hasLocalNode ? <p className="service-hint"><Link href="/settings/access">{_t(_locale, "BatchUpdate.noEngine")}</Link></p> : <form action={action} className="grid gap-4">
        <input type="hidden" name="engine" value={engine} />
        {services.map((s) => {
          const keys = s.candidates.map((c) => key(s, c));
          const some = keys.some((k) => picked.includes(k));
          return <section key={s.applicationId} className="batch-service">
            <label className="batch-service-head">
              <input type="checkbox" checked={some} ref={(el) => { if (el) el.indeterminate = some && !keys.every((k) => picked.includes(k)); }} onChange={() => toggleService(s)} />
              <span className="service-pool-name">{s.name}</span>
            </label>
            <ul className="service-pool service-pool--compact">{s.candidates.map((c) => {
              const k = key(s, c);
              return <li key={k}><label className={picked.includes(k) ? "is-picked" : undefined}>
                <input type="checkbox" name="package" value={`${s.applicationId}|${c.name}@${c.to}`} checked={picked.includes(k)} onChange={() => toggle(k)} />
                <span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs">{c.name}</span><span className="service-meta font-mono">{c.from} → {c.to}</span></span>
                {c.critical ? <span className="service-chip service-chip--danger">{_t(_locale, "DependencyAssistant.m411a681ffe")}</span> : c.security && <span className="service-chip service-chip--danger">{_t(_locale, "DependencyAssistant.m4474c75260")}</span>}
                {!!c.knownIssues?.length && <span className="service-chip service-chip--warn" title={c.knownIssues.map((i) => _locale === "en" && i.titleEn ? i.titleEn : i.title).join("\n")}>{_t(_locale, "DependencyAssistant.m971e520695")}</span>}
                {c.jump === "minor" && <span className="service-chip" title={_t(_locale, "DependencyAssistant.m7dc84baaeb")}>{_t(_locale, "DependencyAssistant.m5717c39b81")}</span>}
              </label></li>;
            })}</ul>
          </section>;
        })}
        {hasClaude && hasLocalNode ? <fieldset className="dependency-engine"><legend>{_t(_locale, "BatchUpdate.engine")}</legend>
          <label><input type="radio" checked={engine === "CLAUDE"} onChange={() => setEngine("CLAUDE")} /> {_t(_locale, "DependencyAssistant.m016b1f9fe9")}<span>{_t(_locale, "DependencyAssistant.m63b2e0c81b")}</span></label>
          <label><input type="radio" checked={engine === "LOCAL_NODE"} onChange={() => setEngine("LOCAL_NODE")} /> {_t(_locale, "DependencyAssistant.m5befa82e03")}<span>{localNodeOnline ? _t(_locale, "DependencyAssistant.m9277d08150") : _t(_locale, "DependencyAssistant.m4e82364d40")}</span></label>
        </fieldset> : <p className="text-xs text-[var(--fg-dim)]">{_t(_locale, "DependencyAssistant.m107596f9d8")}<EngineChip engine={engine} /></p>}
        {manualDeploy.length > 0 && <p className="service-hint">{_t(_locale, "BatchUpdate.manualDeployHint", { count: manualDeploy.length, names: manualDeploy.join(", ") })}</p>}
        <p className="service-hint">{_t(_locale, "BatchUpdate.how")}</p>
        <button className="btn w-fit" disabled={pending || !chosen}>{pending ? _t(_locale, "BatchUpdate.starting") : _t(_locale, "BatchUpdate.start", { count: chosen })}</button>
        {state.message && !state.ok && <p role="status" className="service-error">{_message(_locale, state.message)}</p>}
        {skipped}
      </form>}
    </div>
  </section></div>;
}
