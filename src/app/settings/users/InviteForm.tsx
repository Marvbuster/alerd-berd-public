"use client";

import { useActionState } from "react";
import { createInvite, type InviteState } from "./actions";
import { CopyField } from "@/components/CopyField";

const field =
  "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvite, {});

  return (
    <div className="panel mt-4 p-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            einladen (E-Mail)
          </label>
          <input id="email" name="email" type="email" required placeholder="kollege@example.com" className={field} />
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            rolle
          </label>
          <select id="role" name="role" defaultValue="USER" className={field}>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <button type="submit" disabled={pending} className="btn">
          {pending ? "…" : "einladen"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>{state.error}</p>}
      {state.link && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-xs text-[var(--up)]">Einladung angelegt — Link kopieren und dem Kollegen schicken:</p>
          <CopyField value={state.link} label="link kopieren" />
        </div>
      )}
    </div>
  );
}
