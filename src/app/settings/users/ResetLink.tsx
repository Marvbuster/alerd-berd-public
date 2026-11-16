"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState } from "react";
import { createPasswordReset, type ResetState } from "./actions";
import { CopyField } from "@/components/CopyField";

// Reset-Link für einen bestehenden User erzeugen. Der Link wird einmalig
// zurückgegeben und kopierbar angezeigt; der Admin verschickt ihn selbst.
export function ResetLink({ userId }: { userId: string }) {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState<ResetState, FormData>(createPasswordReset, {});

  return (
    <div className="mt-2">
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button type="submit" disabled={pending} className="btn btn--ghost !text-[var(--fg-dim)]">
          {pending ? "…" : "reset-link"}
        </button>
      </form>

      {state.error && <p className="mt-2 text-xs" style={{ color: "var(--down)" }}>{_message(_locale, state.error)}</p>}
      {state.link && (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-xs text-[var(--up)]">{_t(_locale, "settings_users.m86399f67cf")}</p>
          <CopyField value={state.link} label={_t(_locale, "settings_users.m321163768a")} />
        </div>
      )}
    </div>
  );
}
