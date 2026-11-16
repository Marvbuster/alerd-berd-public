"use client";

import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    // Lokale Zeit des Browsers (nicht UTC) — läuft client-seitig, also die
    // Zeitzone des Betrachters, unabhängig von der Container-TZ.
    const tick = () =>
      setNow(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span suppressHydrationWarning>{now}</span>;
}
