"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useState } from "react";
import { subscribePush } from "@/lib/push-client";

export function PushButton() {
  const _locale = _useLocale();
  const [state, setState] = useState<string>("");
  async function subscribe() {
    setState("…");
    try { setState((await subscribePush(_locale)).message); } catch (e) { setState(_t(_locale, "PushButton.m8aa3e152ad", { value0: String(e) })); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={subscribe} className="btn">
        {_t(_locale, "PushButton.m4b2a7ceb16")}</button>
      {state && <span className="text-xs text-[var(--fg-dim)]">{_message(_locale, state)}</span>}
    </div>
  );
}
