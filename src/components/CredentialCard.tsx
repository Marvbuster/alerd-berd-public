"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

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
  const _locale = _useLocale();
  const [editing, setEditing] = useState(false);
  const open = !configured || editing;
  return <section className={`credential-card${configured ? " credential-card--active" : ""}`}>
    <div className="credential-head">
      <span className="credential-icon"><Icon name={icon} size={18} /></span>
      <div className="min-w-0 flex-1">
        <h3>{title}</h3>
        {configured
          ? <p className="credential-meta"><span className={`led ${warn ? "led--degraded" : "led--up"}`} />{_t(_locale, "CredentialCard.m8163454f37")}{meta ? ` · ${meta}` : ""}</p>
          : <p className="credential-hint">{hint}</p>}
      </div>
      {configured && <button type="button" className="credential-toggle" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? _t(_locale, "CredentialCard.mb808f6e970") : _t(_locale, "CredentialCard.mea5e3417aa")}</button>}
    </div>
    {open && <div className="credential-body">
      {configured && <p className="credential-hint mb-3">{hint}</p>}
      {children ?? (save && <TokenForm save={save} label={inputLabel ?? "Token"} maxLength={maxLength} disabled={disabled} configured={configured} onSaved={() => setEditing(false)} />)}
      {configured && remove && <form action={remove} className="mt-3" onSubmit={(event) => { if (removeConfirm && !confirm(removeConfirm)) event.preventDefault(); }}><button className="credential-remove">{_t(_locale, "CredentialCard.mda394e2d97")}</button></form>}
    </div>}
  </section>;
}

function TokenForm({ save, label, maxLength, disabled, configured, onSaved }: { save: SaveAction; label: string; maxLength: number; disabled: boolean; configured: boolean; onSaved: () => void }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState(save, {});
  const saved = useRef(onSaved);
  saved.current = onSaved;
  // Nur auf ein neues Ergebnis reagieren, nicht auf jedes Re-Render.
  useEffect(() => { if (state.ok) saved.current(); }, [state]);
  return <form action={action} className="credential-form">
    <label className="sr-only" htmlFor={`token-${label}`}>{label}</label>
    <input id={`token-${label}`} name="token" type="password" autoComplete="new-password" placeholder={label} required maxLength={maxLength} disabled={disabled} readOnly={pending} />
    <button className="btn" disabled={disabled || pending}>{pending ? _t(_locale, "CredentialCard.mb5a728f06d") : configured ? _t(_locale, "common.replace") : _t(_locale, "CredentialCard.mf6b2ff39f5")}</button>
    {state.message && !state.ok && <p role="status" className="credential-error">{_message(_locale, state.message)}</p>}
  </form>;
}
