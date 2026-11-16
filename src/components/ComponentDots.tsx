"use client";

import { useEffect, useState } from "react";
import { type HealthComponent, healthColor } from "@/lib/viz";

// Kompakte Komponenten-Ampeln mit Tooltip (Desktop: Hover, Mobile: Tap) —
// zeigt Name, Status und Detail des jeweiligen Spec-Health-Checks.
export function ComponentDots({ components }: { components: HealthComponent[] }) {
  const [open, setOpen] = useState<number | null>(null);

  // Außerhalb tippen/klicken schließt den (Mobile-)Tooltip wieder.
  useEffect(() => {
    if (open == null) return;
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  if (components.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {components.map((c, i) => {
        const cc = healthColor(c.status);
        return (
          <span
            key={c.name}
            className="relative inline-flex"
            onMouseEnter={() => setOpen(i)}
            onMouseLeave={() => setOpen((o) => (o === i ? null : o))}
          >
            <button
              type="button"
              aria-label={`${c.name}: ${c.status}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen((o) => (o === i ? null : i));
              }}
              className="block h-2.5 w-2.5 rounded-full"
              style={{ background: cc, boxShadow: `0 0 5px ${cc}` }}
            />
            {open === i && (
              <span
                role="tooltip"
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[240px] -translate-x-1/2 rounded border border-[var(--fg-faint)] bg-[var(--bg-panel)] px-2 py-1.5 text-[10px] leading-snug text-[var(--fg)]"
                style={{ textShadow: "none" }}
              >
                <span className="font-mono">{c.name}</span>
                <span className="ml-1.5 font-medium" style={{ color: cc }}>{c.status}</span>
                {c.detail && <span className="mt-0.5 block text-[var(--fg-dim)]">{c.detail}</span>}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
