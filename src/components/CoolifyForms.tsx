"use client";

import { useActionState } from "react";
import { Icon } from "./Icon";
import { saveConnection, syncConnection, linkMonitor, deleteConnection, setApplicationHidden, type CoolifyActionState } from "@/app/coolify/actions";

function Result({ state }: { state: CoolifyActionState }) {
  return state.message ? <p role="status" className="mt-2 text-xs" style={{ color: state.ok ? "var(--up)" : "var(--down)" }}>{state.message}</p> : null;
}

export function ConnectionForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(saveConnection, {});
  return <form action={action} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs">Name<input name="label" required maxLength={100} placeholder="Mein Coolify" disabled={disabled} readOnly={pending} /></label>
      <label className="block text-xs">Coolify-URL<input name="baseUrl" type="url" required placeholder="https://coolify.example.com" disabled={disabled} readOnly={pending} /></label>
    </div>
    <label className="block text-xs">API-Token (nur read)<input name="token" type="password" autoComplete="new-password" required maxLength={2000} disabled={disabled} readOnly={pending} /></label>
    <button className="btn" disabled={disabled || pending}>{pending ? "prüfe Verbindung …" : "prüfen und verbinden"}</button>
    <Result state={state} />
  </form>;
}

export function SyncForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(syncConnection.bind(null, id), {});
  return <form action={action}><button className="btn" disabled={pending}><Icon name="refresh" size={18} />{pending ? "Synchronisiere …" : "Synchronisieren"}</button><Result state={state} /></form>;
}

export function ApplicationVisibilityForm({ applicationId, hidden }: { applicationId: string; hidden: boolean }) {
  const [state, action, pending] = useActionState(setApplicationHidden.bind(null, applicationId, !hidden), {});
  return <form action={action}><button className="btn btn--ghost" disabled={pending}><Icon name={hidden ? "eye" : "eyeOff"} size={17} />{pending ? "Speichere …" : hidden ? "Wieder einblenden" : "App ausblenden"}</button><Result state={state} /></form>;
}

export function LinkMonitorForm({ applicationId, monitors }: { applicationId: string; monitors: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(linkMonitor.bind(null, applicationId), {});
  return <form action={action} className="mt-3">
    <div className="flex flex-wrap gap-2">
      <select name="monitorId" required disabled={pending || !monitors.length} aria-label="Monitor auswählen" defaultValue="">
        <option value="" disabled>Monitor auswählen</option>
        {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button className="btn" disabled={pending || !monitors.length}>verknüpfen</button>
    </div><Result state={state} />
  </form>;
}

export function DisconnectForm({ id, label }: { id: string; label: string }) {
  return <form action={deleteConnection.bind(null, id)} onSubmit={(e) => {
    if (!confirm(`Verbindung „${label}“ und importierte Zuordnungen entfernen? Die Monitore bleiben erhalten.`)) e.preventDefault();
  }}><button className="btn btn--ghost">Verbindung entfernen</button></form>;
}
