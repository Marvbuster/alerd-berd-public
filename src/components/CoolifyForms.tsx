"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState } from "react";
import { Icon } from "./Icon";
import { saveConnection, syncConnection, linkMonitor, deleteConnection, setApplicationHidden, type CoolifyActionState } from "@/app/coolify/actions";

function Result({ state }: { state: CoolifyActionState }) {
  const _locale = _useLocale();
  return state.message ? <p role="status" className="mt-2 text-xs" style={{ color: state.ok ? "var(--up)" : "var(--down)" }}>{_message(_locale, state.message)}</p> : null;
}

export function ConnectionForm({ disabled }: { disabled: boolean }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(saveConnection, {});
  return <form action={action} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs">{_t(_locale, "CoolifyForms.mdcd1d5223f")}<input name="label" required maxLength={100} placeholder={_t(_locale, "CoolifyForms.m28e93ad365")} disabled={disabled} readOnly={pending} /></label>
      <label className="block text-xs">{_t(_locale, "CoolifyForms.mcdfc98d20c")}<input name="baseUrl" type="url" required placeholder={_t(_locale, "CoolifyForms.m9c5d050810")} disabled={disabled} readOnly={pending} /></label>
    </div>
    <label className="block text-xs">{_t(_locale, "CoolifyForms.m6f97ebb8ab")}<input name="token" type="password" autoComplete="new-password" required maxLength={2000} disabled={disabled} readOnly={pending} /></label>
    <button className="btn" disabled={disabled || pending}>{pending ? _t(_locale, "CoolifyForms.mcc20b5b2f2") : _t(_locale, "CoolifyForms.mfdce3dc7fd")}</button>
    <Result state={state} />
  </form>;
}

export function SyncForm({ id }: { id: string }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(syncConnection.bind(null, id), {});
  return <form action={action}><button className="btn" disabled={pending}><Icon name="refresh" size={18} />{pending ? _t(_locale, "CoolifyForms.mafcae9c98b") : "Synchronisieren"}</button><Result state={state} /></form>;
}

export function ApplicationVisibilityForm({ applicationId, hidden }: { applicationId: string; hidden: boolean }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(setApplicationHidden.bind(null, applicationId, !hidden), {});
  return <form action={action}><button className="btn btn--ghost" disabled={pending}><Icon name={hidden ? "eye" : "eyeOff"} size={17} />{pending ? _t(_locale, "CoolifyForms.mb5a728f06d") : hidden ? _t(_locale, "CoolifyForms.m68ba7612d5") : _t(_locale, "CoolifyForms.m25d4fe8cc3")}</button><Result state={state} /></form>;
}

export function LinkMonitorForm({ applicationId, monitors }: { applicationId: string; monitors: { id: string; name: string }[] }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(linkMonitor.bind(null, applicationId), {});
  return <form action={action} className="mt-3">
    <div className="flex flex-wrap gap-2">
      <select name="monitorId" required disabled={pending || !monitors.length} aria-label={_t(_locale, "CoolifyForms.m940a644f01")} defaultValue="">
        <option value="" disabled>{_t(_locale, "CoolifyForms.m940a644f01")}</option>
        {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button className="btn" disabled={pending || !monitors.length}>{_t(_locale, "CoolifyForms.m7239dd2dce")}</button>
    </div><Result state={state} />
  </form>;
}

export function DisconnectForm({ id, label }: { id: string; label: string }) {
  const _locale = _useLocale();
  return <form action={deleteConnection.bind(null, id)} onSubmit={(e) => {
    if (!confirm(_t(_locale, "CoolifyForms.mad83a048a3", { value0: label }))) e.preventDefault();
  }}><button className="btn btn--ghost">{_t(_locale, "CoolifyForms.me068d60e5e")}</button></form>;
}
