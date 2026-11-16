"use client";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useState, useTransition } from "react";
import { saveBuildEnv, suggestBuildEnv } from "@/app/coolify/repository-actions";
import type { CoolifyActionState } from "@/app/coolify/actions";

// Platzhalter für den Build in der Sandbox. Echte Werte aus Coolify kommen nie
// hierher, Alerd holt nur die Namen.
export function BuildEnvForm({ applicationId, initial }: { applicationId: string; initial: string }) {
  const _locale = _useLocale();
  const [text, setText] = useState(initial);
  const [state, action, pending] = useActionState<CoolifyActionState, FormData>(saveBuildEnv.bind(null, applicationId), {});
  const [hint, setHint] = useState<CoolifyActionState>({});
  const [loading, startLoading] = useTransition();
  const count = initial.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  const suggest = () => startLoading(async () => {
    const result = await suggestBuildEnv(applicationId, text);
    if (result.text !== undefined) setText(result.text);
    setHint({ ok: result.ok, message: result.message });
  });
  const message = hint.message ?? state.message;
  return <details className="disclosure mt-4">
    <summary>{_t(_locale, "BuildEnvForm.m822d39370e")}{count > 0 && <span className="ml-2 text-[var(--fg-dim)]">{count}</span>}</summary>
    <form action={action} className="disclosure-content grid gap-3">
      <textarea name="buildEnv" rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} value={text} onChange={(e) => { setText(e.target.value); setHint({}); }}
        spellCheck={false} className="font-mono text-xs" placeholder={"DATABASE_URI=mongodb://dummy@localhost/dummy\nPAYLOAD_SECRET=dummy-build-placeholder"} aria-label={_t(_locale, "BuildEnvForm.m822d39370e")} />
      <p className="service-hint">{_t(_locale, "BuildEnvForm.m7ed5c7d056")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={pending}>{pending ? _t(_locale, "BuildEnvForm.mb5a728f06d") : _t(_locale, "BuildEnvForm.mf6b2ff39f5")}</button>
        <button type="button" className="btn btn--ghost" disabled={loading} onClick={suggest}>{loading ? _t(_locale, "BuildEnvForm.m88bf53b3de") : _t(_locale, "BuildEnvForm.m054acee559")}</button>
      </div>
      {message && <p role="status" className="text-xs" style={{ color: (hint.message ? hint.ok : state.ok) ? "var(--up)" : "var(--amber)" }}>{_message(_locale, message)}</p>}
    </form>
  </details>;
}
