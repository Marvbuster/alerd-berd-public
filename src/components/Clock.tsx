"use client";

import { intlLocale } from "@/i18n/locale";
import { useLocale as _useLocale } from "next-intl";

import { useEffect, useState } from "react";

export function Clock() {
  const _locale = _useLocale();
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    // Lokale Zeit des Browsers (nicht UTC) — läuft client-seitig, also die
    // Zeitzone des Betrachters, unabhängig von der Container-TZ.
    const tick = () =>
      setNow(new Date().toLocaleTimeString(intlLocale(_locale), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [_locale]);
  return <span suppressHydrationWarning>{now}</span>;
}
