"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { SyncForm } from "./CoolifyForms";
import { addServices, type ActionState } from "@/app/services/actions";
import type { PoolApp } from "@/lib/services";

// „Dienst anlegen“: die von Coolify gelieferten Apps, die noch kein Dienst
// sind. Mehrere auswählen, einmal anlegen.
export function ServicePicker({ pool, connections, onAdded, onCancel }: {
  pool: PoolApp[]; connections: { id: string; label: string }[];
  onAdded: (applicationIds: string[]) => void; onCancel: (() => void) | null;
}) {
  const _locale = _useLocale();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [state, action, pending] = useActionState<ActionState, FormData>(addServices, {});
  const added = useRef(onAdded);
  added.current = onAdded;
  useEffect(() => { if (state.ok && state.ids) added.current(state.ids); }, [state]);
  const q = query.trim().toLowerCase();
  const visible = pool.filter((p) => !q || `${p.name} ${p.domain ?? ""} ${p.repository ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.name.localeCompare(b.name, _locale));
  const toggle = (id: string) => setPicked((list) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return <article className="panel service-panel" aria-label={_t(_locale, "ServicePicker.m99645c3124")}>
    <header className="service-panel-head flex items-start justify-between gap-3">
      <div><h2>{_t(_locale, "ServicePicker.m99645c3124")}</h2><p className="service-meta">{_t(_locale, "ServicePicker.me4ee1a39a3")}</p></div>
      {onCancel && <button type="button" className="icon-button" aria-label={_t(_locale, "ServicePicker.mb808f6e970")} onClick={onCancel}><Icon name="close" size={18} /></button>}
    </header>
    {!connections.length ? <div className="service-section"><p className="service-hint">{_t(_locale, "ServicePicker.m253e0d122f")}</p><Link href="/settings/access" className="btn">{_t(_locale, "ServicePicker.m663445e940")}</Link></div> : <div className="service-section">
    <form action={action} className="grid gap-3">
      <div className="flex items-center gap-2">
        <label className="inventory-search"><Icon name="search" /><input type="search" aria-label={_t(_locale, "ServicePicker.mfd461c23bc")} placeholder={_t(_locale, "ServicePicker.mf04fd2133a")} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {!pool.length && <p className="service-hint">{_t(_locale, "ServicePicker.m53d82feca8")}</p>}
      {pool.length > 0 && !visible.length && <p className="service-hint">{_t(_locale, "ServicePicker.m8006301488")}</p>}
      <ul className="service-pool">{visible.map((p) => <li key={p.id}>
        <label className={picked.includes(p.id) ? "is-picked" : undefined}>
          <input type="checkbox" name="applicationId" value={p.id} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
          <span className="min-w-0 flex-1"><span className="service-pool-name">{p.name}{p.isNew && <span className="service-chip service-chip--update">{_t(_locale, "ServicePicker.mb1688cbab7")}</span>}</span><span className="service-meta">{p.domain ?? _t(_locale, "ServicePicker.m6e1bd4fbc6")}{connections.length > 1 ? ` · ${p.connectionLabel}` : ""}</span></span>
        </label>
      </li>)}</ul>
      <button className="btn w-fit" disabled={pending || !picked.length}>{pending ? _t(_locale, "ServicePicker.mc4fec48fe9") : picked.length > 1 ? _t(_locale, "ServicePicker.mcb67ce8163", { value0: picked.length }) : _t(_locale, "ServicePicker.m99645c3124")}</button>
      {state.message && !state.ok && <p role="status" className="service-error">{_message(_locale, state.message)}</p>}
    </form>
    {/* Eigene Formulare, deshalb außerhalb der Auswahl: keine verschachtelten Forms. */}
    <div className="service-sync flex flex-wrap items-center gap-2 border-t border-[var(--fg-faint)] pt-3"><span className="service-hint mr-auto">{_t(_locale, "ServicePicker.m4e109ae4f4")}</span>{connections.map((c) => <SyncForm key={c.id} id={c.id} />)}</div>
  </div>}
  </article>;
}
