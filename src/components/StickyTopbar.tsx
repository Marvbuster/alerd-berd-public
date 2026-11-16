"use client";

import { useEffect, useState, type ReactNode } from "react";

// Header bleibt oben kleben und wird beim Scrollen kompakter. Hysterese
// (an ab 48 px, aus unter 8 px), damit die Höhenänderung nicht flackert.
export function StickyTopbar({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCompact((current) => current ? window.scrollY > 8 : window.scrollY > 48);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  return <header className="app-topbar" data-compact={compact ? "" : undefined}>{children}</header>;
}
