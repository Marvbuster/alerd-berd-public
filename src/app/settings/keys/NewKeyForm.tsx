"use client";

import { useActionState } from "react";
import { createApiKey, type NewKeyState } from "./actions";

const field =
  "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

export function NewKeyForm() {
  const [state, action, pending] = useActionState<NewKeyState, FormData>(createApiKey, {});

  return (
    <div className="panel mt-4 p-4">
      <form action={action} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            neuen Key anlegen
          </label>
          <input id="name" name="name" placeholder="z. B. Laptop-Agent" className={field} />
        </div>
        <button type="submit" disabled={pending} className="btn">
          {pending ? "…" : "erzeugen"}
        </button>
      </form>

      {state.error && <p className="mt-4 text-xs" style={{ color: "var(--down)" }}>{state.error}</p>}
      {state.key && (
        <p className="mt-4 text-xs text-[var(--up)]">Key erzeugt — steht oben in der Liste und bleibt dort kopierbar.</p>
      )}
    </div>
  );
}
