"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { saveRepository, scanRepositoryNow } from "@/app/coolify/repository-actions";
import type { CoolifyActionState } from "@/app/coolify/actions";

function Result({ state }: { state: CoolifyActionState }) {
  return state.message ? <p role="status" className="mt-3 text-xs" style={{ color: state.ok ? "var(--up)" : "var(--amber)" }}>{state.message}</p> : null;
}

export interface RepoConfig { repository: string; branch: string; manifestPath: string; lockfilePath: string }

function RepositoryForm({ applicationId, defaults, configured, onClose }: { applicationId: string; defaults: RepoConfig; configured: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(async (previous: CoolifyActionState, form: FormData) => {
    const result = await saveRepository(applicationId, previous, form);
    if (result.ok) onClose();
    return result;
  }, {});
  return <form action={action} className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-300">GitHub-Repository<input name="repository" required defaultValue={defaults.repository} placeholder="owner/repo" readOnly={pending} /></label>
      <label className="text-xs text-slate-300">Branch<input name="branch" required defaultValue={defaults.branch} placeholder="main" readOnly={pending} /></label>
      <label className="text-xs text-slate-300">Manifest ab Repo-Wurzel<input name="manifestPath" required defaultValue={defaults.manifestPath} readOnly={pending} /></label>
      <label className="text-xs text-slate-300">npm-Lockfile ab Repo-Wurzel<input name="lockfilePath" required defaultValue={defaults.lockfilePath} readOnly={pending} /></label>
    </div>
    <p className="text-xs leading-relaxed text-slate-400">Pfade ab Repo-Wurzel, z. B. apps/web/package.json. Das Lockfile kann an der Repo-Wurzel liegen. Nach dem Speichern die Versionen neu prüfen.</p>
    <div className="flex flex-wrap gap-2"><button disabled={pending} className="btn">{pending ? "speichere …" : configured ? "Änderungen speichern" : "Einrichtung speichern"}</button><button type="button" disabled={pending} className="btn btn--ghost" onClick={onClose}>Abbrechen</button></div><Result state={state} />
  </form>;
}

function RepositoryScanForm({ id, lastError, onEdit }: { id: string; lastError: string | null; onEdit: () => void }) {
  const [state, action, pending] = useActionState(scanRepositoryNow.bind(null, id), {});
  return <div className="repository-actions"><form action={action}><button className="btn" disabled={pending}>{pending ? "prüfe Versionen …" : "Versionen prüfen"}</button>{!state.ok && state.message !== lastError && <Result state={state} />}</form><button type="button" className="repository-edit" disabled={pending} onClick={onEdit}>Git-Einstellungen bearbeiten</button></div>;
}

export function RepositoryPanel({ applicationId, watchId, defaults, lastError, readOnly, children }: {
  applicationId: string; watchId?: string; defaults: RepoConfig; lastError: string | null; readOnly: boolean; children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  return <div>
    {children}
    {editing ? <div id={editorId} className="repository-editor">
      <h4 className="mb-4 text-sm font-medium text-slate-200">{watchId ? "Git-Einstellungen" : "Versionsüberwachung"}</h4>
      <RepositoryForm applicationId={applicationId} defaults={defaults} configured={!!watchId} onClose={() => setEditing(false)} />
    </div> : !readOnly && (watchId ? <RepositoryScanForm id={watchId} lastError={lastError} onEdit={() => setEditing(true)} /> : <div className="repository-setup"><button type="button" className="btn btn--ghost" aria-controls={editorId} aria-expanded={false} onClick={() => setEditing(true)}>Versionsüberwachung aktivieren</button></div>)}
  </div>;
}
