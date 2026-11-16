"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type State = { ok?: boolean; message?: string };
type SaveAction = (state: State, form: FormData) => Promise<State>;

// Ein Zugang, eine Karte. Ist er hinterlegt, bleibt die Karte zu und zeigt
// nur „Aktiv“; ersetzen oder entfernen liegt hinter „Ändern“. Fehlt er, steht
// das Eingabefeld direkt offen, mit genau einem Satz Erklärung.
export function CredentialCard({ title, icon, hint, configured, meta, warn = false, save, remove, removeConfirm, inputLabel, maxLength = 2000, disabled = false, children }: {
  title: string; icon: IconName; hint: ReactNode; configured: boolean; meta?: string | null; warn?: boolean;
  save?: SaveAction; remove?: () => Promise<void>; removeConfirm?: string;
  inputLabel?: string; maxLength?: number; disabled?: boolean; children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const open = !configured || editing;
  return <section className={`credential-card${configured ? " credential-card--active" : ""}`}>
    <div className="credential-head">
      <span className="credential-icon"><Icon name={icon} size={18} /></span>
      <div className="min-w-0 flex-1">
        <h3>{title}</h3>
        {configured
          ? <p className="credential-meta"><span className={`led ${warn ? "led--degraded" : "led--up"}`} />Aktiv{meta ? ` · ${meta}` : ""}</p>
          : <p className="credential-hint">{hint}</p>}
      </div>
      {configured && <button type="button" className="credential-toggle" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? "Schließen" : "Ändern"}</button>}
    </div>
    {open && <div className="credential-body">
      {configured && <p className="credential-hint mb-3">{hint}</p>}
      {children ?? (save && <TokenForm save={save} label={inputLabel ?? "Token"} maxLength={maxLength} disabled={disabled} configured={configured} onSaved={() => setEditing(false)} />)}
      {configured && remove && <form action={remove} className="mt-3" onSubmit={(event) => { if (removeConfirm && !confirm(removeConfirm)) event.preventDefault(); }}><button className="credential-remove">Zugang entfernen</button></form>}
    </div>}
  </section>;
}

function TokenForm({ save, label, maxLength, disabled, configured, onSaved }: { save: SaveAction; label: string; maxLength: number; disabled: boolean; configured: boolean; onSaved: () => void }) {
  const [state, action, pending] = useActionState(save, {});
  const saved = useRef(onSaved);
  saved.current = onSaved;
  // Nur auf ein neues Ergebnis reagieren, nicht auf jedes Re-Render.
  useEffect(() => { if (state.ok) saved.current(); }, [state]);
  return <form action={action} className="credential-form">
    <label className="sr-only" htmlFor={`token-${label}`}>{label}</label>
    <input id={`token-${label}`} name="token" type="password" autoComplete="new-password" placeholder={label} required maxLength={maxLength} disabled={disabled} readOnly={pending} />
    <button className="btn" disabled={disabled || pending}>{pending ? "Speichere …" : configured ? "Ersetzen" : "Speichern"}</button>
    {state.message && !state.ok && <p role="status" className="credential-error">{state.message}</p>}
  </form>;
}
