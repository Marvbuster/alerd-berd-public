"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useId, useState, type ReactNode } from "react";
import { saveRepository, scanRepositoryNow } from "@/app/coolify/repository-actions";
import type { CoolifyActionState } from "@/app/coolify/actions";

function Result({ state }: { state: CoolifyActionState }) {
  const _locale = _useLocale();
  return state.message ? <p role="status" className="mt-3 text-xs" style={{ color: state.ok ? "var(--up)" : "var(--amber)" }}>{_message(_locale, state.message)}</p> : null;
}

export interface RepoConfig { repository: string; branch: string; manifestPath: string; lockfilePath: string }

function RepositoryForm({ applicationId, defaults, configured, onClose }: { applicationId: string; defaults: RepoConfig; configured: boolean; onClose: () => void }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(async (previous: CoolifyActionState, form: FormData) => {
    const result = await saveRepository(applicationId, previous, form);
    if (result.ok) onClose();
    return result;
  }, {});
  return <form action={action} className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-300">{_t(_locale, "RepositoryForms.md913c50e96")}<input name="repository" required defaultValue={defaults.repository} placeholder={_t(_locale, "RepositoryForms.m65e817eec8")} readOnly={pending} /></label>
      <label className="text-xs text-slate-300">{_t(_locale, "RepositoryForms.m52656e8104")}<input name="branch" required defaultValue={defaults.branch} placeholder={_t(_locale, "RepositoryForms.m0d6e4079e3")} readOnly={pending} /></label>
      <label className="text-xs text-slate-300">{_t(_locale, "RepositoryForms.mad6865142d")}<input name="manifestPath" required defaultValue={defaults.manifestPath} readOnly={pending} /></label>
      <label className="text-xs text-slate-300">{_t(_locale, "RepositoryForms.m7cb021511d")}<input name="lockfilePath" required defaultValue={defaults.lockfilePath} readOnly={pending} /></label>
    </div>
    <p className="text-xs leading-relaxed text-slate-400">{_t(_locale, "RepositoryForms.me93eedc3ec")}</p>
    <div className="flex flex-wrap gap-2"><button disabled={pending} className="btn">{pending ? _t(_locale, "RepositoryForms.medc3749a59") : configured ? _t(_locale, "RepositoryForms.m6c86b99088") : _t(_locale, "RepositoryForms.mf120d1f71e")}</button><button type="button" disabled={pending} className="btn btn--ghost" onClick={onClose}>{_t(_locale, "RepositoryForms.mf7ff1178af")}</button></div><Result state={state} />
  </form>;
}

function RepositoryScanForm({ id, lastError, onEdit }: { id: string; lastError: string | null; onEdit: () => void }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(scanRepositoryNow.bind(null, id), {});
  return <div className="repository-actions"><form action={action}><button className="btn" disabled={pending}>{pending ? _t(_locale, "RepositoryForms.me8ad65c63a") : _t(_locale, "RepositoryForms.m987e262976")}</button>{!state.ok && state.message !== lastError && <Result state={state} />}</form><button type="button" className="repository-edit" disabled={pending} onClick={onEdit}>{_t(_locale, "RepositoryForms.m0eab2cc94a")}</button></div>;
}

export function RepositoryPanel({ applicationId, watchId, defaults, lastError, readOnly, children }: {
  applicationId: string; watchId?: string; defaults: RepoConfig; lastError: string | null; readOnly: boolean; children: ReactNode;
}) {
  const _locale = _useLocale();
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  return <div>
    {children}
    {editing ? <div id={editorId} className="repository-editor">
      <h4 className="mb-4 text-sm font-medium text-slate-200">{watchId ? _t(_locale, "RepositoryForms.mb22d16d692") : _t(_locale, "RepositoryForms.mb2c85af28c")}</h4>
      <RepositoryForm applicationId={applicationId} defaults={defaults} configured={!!watchId} onClose={() => setEditing(false)} />
    </div> : !readOnly && (watchId ? <RepositoryScanForm id={watchId} lastError={lastError} onEdit={() => setEditing(true)} /> : <div className="repository-setup"><button type="button" className="btn btn--ghost" aria-controls={editorId} aria-expanded={false} onClick={() => setEditing(true)}>{_t(_locale, "RepositoryForms.m790afa136c")}</button></div>)}
  </div>;
}
