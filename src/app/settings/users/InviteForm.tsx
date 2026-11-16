"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState } from "react";
import { createInvite, type InviteState } from "./actions";
import { CopyField } from "@/components/CopyField";

const field =
  "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

export function InviteForm() {
  const _locale = _useLocale();
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvite, {});

  return (
    <div className="panel mt-4 p-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            {_t(_locale, "settings_users.m0066b72943")}</label>
          <input id="email" name="email" type="email" required placeholder={_t(_locale, "settings_users.m4323686a7e")} className={field} />
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            {_t(_locale, "settings_users.m6609bf5d76")}</label>
          <select id="role" name="role" defaultValue="USER" className={field}>
            <option value="USER">{_t(_locale, "settings_users.m92b7b42199")}</option>
            <option value="ADMIN">{_t(_locale, "settings_users.m835d6dc88b")}</option>
          </select>
        </div>
        <button type="submit" disabled={pending} className="btn">
          {pending ? "…" : _t(_locale, "common.invite")}
        </button>
      </form>

      {state.error && <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>{_message(_locale, state.error)}</p>}
      {state.link && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-xs text-[var(--up)]">{_t(_locale, "settings_users.m356eba34ab")}</p>
          <CopyField value={state.link} label={_t(_locale, "settings_users.mf7ed2c34d0")} />
        </div>
      )}
    </div>
  );
}
