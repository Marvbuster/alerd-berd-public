"use client";

import { useState, useTransition } from "react";
import { removeService } from "@/app/services/actions";

// Zweistufig im Panel statt confirm(): erst fragen, dann entfernen.
export function RemoveServiceButton({ applicationId, name }: { applicationId: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) return <button type="button" className="service-link service-link--danger" onClick={() => setAsking(true)}>Dienst entfernen</button>;
  return <div className="service-confirm">
    <p>{name} zurück in den Coolify-Vorrat legen? Die Monitore bleiben pausiert erhalten.</p>
    <div className="flex gap-3">
      <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => start(() => removeService(applicationId))}>{pending ? "Entferne …" : "Entfernen"}</button>
      <button type="button" className="service-link" disabled={pending} onClick={() => setAsking(false)}>Abbrechen</button>
    </div>
  </div>;
}
