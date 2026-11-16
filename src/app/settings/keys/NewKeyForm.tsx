"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState } from "react";
import { createApiKey, type NewKeyState } from "./actions";

const field =
  "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

export function NewKeyForm() {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState<NewKeyState, FormData>(createApiKey, {});

  return (
    <div className="panel mt-4 p-4">
      <form action={action} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            {_t(_locale, "settings_keys.m2b7cc4677d")}</label>
          <input id="name" name="name" placeholder={_t(_locale, "settings_keys.m22ac9bd0e3")} className={field} />
        </div>
        <button type="submit" disabled={pending} className="btn">
          {pending ? "…" : _t(_locale, "common.create")}
        </button>
      </form>

      {state.error && <p className="mt-4 text-xs" style={{ color: "var(--down)" }}>{_message(_locale, state.error)}</p>}
      {state.key && (
        <p className="mt-4 text-xs text-[var(--up)]">{_t(_locale, "settings_keys.mdd315c2e64")}</p>
      )}
    </div>
  );
}
