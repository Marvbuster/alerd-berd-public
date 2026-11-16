"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useState } from "react";

// Kopier-Button ohne sichtbaren Wert: kopiert den Wert (Link oder Key) in die
// Zwischenablage. Wird für Invite-/Reset-Links und API-Keys verwendet.
export function CopyField({ value, label: labelProp }: { value: string; label?: string }) {
  const _locale = _useLocale();
  const label = labelProp ?? _t(_locale, "CopyField.mdb17ead3ed");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard-API nicht verfügbar (z. B. kein HTTPS): als Fallback zum
      // manuellen Kopieren anzeigen, damit der Wert nie verloren geht.
      window.prompt(_t(_locale, "CopyField.m203c9613a9"), value);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn--ghost shrink-0 !text-[var(--fg-dim)]"
      aria-label={label}
    >
      {copied ? _t(_locale, "common.copied") : label}
    </button>
  );
}
