"use client";

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
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [state, action, pending] = useActionState<ActionState, FormData>(addServices, {});
  const added = useRef(onAdded);
  added.current = onAdded;
  useEffect(() => { if (state.ok && state.ids) added.current(state.ids); }, [state]);
  const q = query.trim().toLowerCase();
  const visible = pool.filter((p) => !q || `${p.name} ${p.domain ?? ""} ${p.repository ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.name.localeCompare(b.name, "de"));
  const toggle = (id: string) => setPicked((list) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return <article className="panel service-panel" aria-label="Dienst anlegen">
    <header className="service-panel-head flex items-start justify-between gap-3">
      <div><h2>Dienst anlegen</h2><p className="service-meta">Aus Coolify übernehmen</p></div>
      {onCancel && <button type="button" className="icon-button" aria-label="Schließen" onClick={onCancel}><Icon name="close" size={18} /></button>}
    </header>
    {!connections.length ? <div className="service-section"><p className="service-hint">Noch keine Coolify-Verbindung.</p><Link href="/settings/access" className="btn">Coolify verbinden</Link></div> : <div className="service-section">
    <form action={action} className="grid gap-3">
      <div className="flex items-center gap-2">
        <label className="inventory-search"><Icon name="search" /><input type="search" aria-label="Apps durchsuchen" placeholder="Apps durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {!pool.length && <p className="service-hint">Alle Apps aus Coolify sind schon Dienste.</p>}
      {pool.length > 0 && !visible.length && <p className="service-hint">Keine App für diese Suche.</p>}
      <ul className="service-pool">{visible.map((p) => <li key={p.id}>
        <label className={picked.includes(p.id) ? "is-picked" : undefined}>
          <input type="checkbox" name="applicationId" value={p.id} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
          <span className="min-w-0 flex-1"><span className="service-pool-name">{p.name}{p.isNew && <span className="service-chip service-chip--update">neu</span>}</span><span className="service-meta">{p.domain ?? "Keine Domain"}{connections.length > 1 ? ` · ${p.connectionLabel}` : ""}</span></span>
        </label>
      </li>)}</ul>
      <button className="btn w-fit" disabled={pending || !picked.length}>{pending ? "Lege an …" : picked.length > 1 ? `${picked.length} Dienste anlegen` : "Dienst anlegen"}</button>
      {state.message && !state.ok && <p role="status" className="service-error">{state.message}</p>}
    </form>
    {/* Eigene Formulare, deshalb außerhalb der Auswahl: keine verschachtelten Forms. */}
    <div className="service-sync flex flex-wrap items-center gap-2 border-t border-[var(--fg-faint)] pt-3"><span className="service-hint mr-auto">App fehlt?</span>{connections.map((c) => <SyncForm key={c.id} id={c.id} />)}</div>
  </div>}
  </article>;
}
