"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type VizNode, STATUS_COLOR } from "@/lib/viz";
import { MonitorDetail } from "@/components/MonitorDetail";

// Sphere-View: dieselbe Detail-Basis (MonitorDetail) wie die Detail-Seite,
// hier nur in eine animierte, glasige Overlay-Karte gewickelt.
export function DetailPanel({ node, canEdit, onClose }: { node: VizNode; canEdit: boolean; onClose: () => void }) {
  const color = STATUS_COLOR[node.status];
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false); // nach der Anim: transform:none → scharfer Text

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    // z-index über der Sticky-Leiste (z 60), wie die anderen Dialoge. Auf dem Handy
    // oben ausgerichtet, damit lange Inhalte im Panel scrollen statt unter der Leiste zu verschwinden.
    <div className="fixed inset-0 z-[85] grid place-items-start justify-items-center overflow-y-auto bg-[#06111b80] p-3 pt-[max(12px,env(safe-area-inset-top))] sm:place-items-center sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={(e) => e.propertyName === "transform" && setSettled(true)}
        className="w-full max-w-[960px] overflow-y-auto overscroll-contain rounded-2xl p-5 sm:w-[68vw] sm:p-7"
        style={{
          maxHeight: "calc(100dvh - 24px)",
          background: "rgba(25,45,68,0.95)",
          backdropFilter: "blur(10px)",
          border: `1px solid ${color}`,
          boxShadow: `0 0 80px -24px ${color}, inset 0 0 40px -30px ${color}`,
          // Nach der Einblend-Animation transform:none — ein bleibendes scale()
          // rastert den Text in einer GPU-Ebene (mit backdrop-filter) unscharf.
          transform: settled ? "none" : `scale(${shown ? 1 : 0.94})`,
          opacity: shown ? 1 : 0,
          transition: "transform 320ms cubic-bezier(0.2,0.8,0.2,1), opacity 260ms ease",
        }}
      >
        <MonitorDetail
          node={node}
          live={false}
          footerActions={
            <>
              {canEdit && (
                <Link href={`/monitors/${node.id}/edit`} className="btn btn--ghost">Bearbeiten</Link>
              )}
              <button onClick={onClose} className="btn btn--ghost">Schließen</button>
            </>
          }
        />
      </div>
    </div>
  );
}
