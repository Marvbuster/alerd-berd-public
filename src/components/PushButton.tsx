"use client";

import { useState } from "react";
import { subscribePush } from "@/lib/push-client";

export function PushButton() {
  const [state, setState] = useState<string>("");
  async function subscribe() {
    setState("…");
    try { setState((await subscribePush()).message); } catch (e) { setState(`Fehler: ${String(e)}`); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={subscribe} className="btn">
        Push auf diesem Gerät aktivieren
      </button>
      {state && <span className="text-xs text-[var(--fg-dim)]">{state}</span>}
    </div>
  );
}
