"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useState, useTransition } from "react";
import { removeService } from "@/app/services/actions";

// Zweistufig im Panel statt confirm(): erst fragen, dann entfernen.
export function RemoveServiceButton({ applicationId, name }: { applicationId: string; name: string }) {
  const _locale = _useLocale();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) return <button type="button" className="service-link service-link--danger" onClick={() => setAsking(true)}>{_t(_locale, "RemoveServiceButton.m6bb84e24aa")}</button>;
  return <div className="service-confirm">
    <p>{name} {_t(_locale, "RemoveServiceButton.mb5b359205c")}</p>
    <div className="flex gap-3">
      <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => start(() => removeService(applicationId))}>{pending ? _t(_locale, "RemoveServiceButton.m8968f2d794") : "Entfernen"}</button>
      <button type="button" className="service-link" disabled={pending} onClick={() => setAsking(false)}>{_t(_locale, "RemoveServiceButton.mf7ff1178af")}</button>
    </div>
  </div>;
}
