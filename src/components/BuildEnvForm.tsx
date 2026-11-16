"use client";

import { useActionState, useState, useTransition } from "react";
import { saveBuildEnv, suggestBuildEnv } from "@/app/coolify/repository-actions";
import type { CoolifyActionState } from "@/app/coolify/actions";

// Platzhalter für den Build in der Sandbox. Echte Werte aus Coolify kommen nie
// hierher, Alerd holt nur die Namen.
export function BuildEnvForm({ applicationId, initial }: { applicationId: string; initial: string }) {
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
    <summary>Build-Variablen{count > 0 && <span className="ml-2 text-[var(--fg-dim)]">{count}</span>}</summary>
    <form action={action} className="disclosure-content grid gap-3">
      <textarea name="buildEnv" rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} value={text} onChange={(e) => { setText(e.target.value); setHint({}); }}
        spellCheck={false} className="font-mono text-xs" placeholder={"DATABASE_URI=mongodb://dummy@localhost/dummy\nPAYLOAD_SECRET=dummy-build-placeholder"} aria-label="Build-Variablen" />
      <p className="service-hint">Nur Platzhalter, keine echten Zugangsdaten. DATABASE_URL setzt Alerd selbst.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={pending}>{pending ? "Speichere …" : "Speichern"}</button>
        <button type="button" className="btn btn--ghost" disabled={loading} onClick={suggest}>{loading ? "Hole Namen …" : "Namen aus Coolify"}</button>
      </div>
      {message && <p role="status" className="text-xs" style={{ color: (hint.message ? hint.ok : state.ok) ? "var(--up)" : "var(--amber)" }}>{message}</p>}
    </form>
  </details>;
}
