"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { type VizNode, STATUS_COLOR } from "@/lib/viz";
import { useLiveNodes } from "@/components/useLiveNodes";
import { DetailPanel } from "./DetailPanel";

const Scene = dynamic(() => import("./Scene").then((m) => m.Scene), {
  ssr: false,
  loading: LoadingScene,
});

function LoadingScene() {
  const _locale = _useLocale();
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-[var(--fg-dim)]">
      <span>
        {_t(_locale, "sphere_SphereView.m6b4f87bbea")}</span>
    </div>
  );
}

export function SphereView({ nodes: initial, canEdit, backHref = "/", backLabel: backLabelProp }: { nodes: VizNode[]; canEdit: boolean; backHref?: string; backLabel?: string }) {
  const _locale = _useLocale();
  const backLabel = backLabelProp ?? _t(_locale, "sphere_SphereView.m5a65514d86");
  const nodes = useLiveNodes(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sel = nodes.find((n) => n.id === selectedId) ?? null;

  const counts = {
    up: nodes.filter((n) => n.status === "UP").length,
    degraded: nodes.filter((n) => n.status === "DEGRADED").length,
    down: nodes.filter((n) => n.status === "DOWN").length,
    unknown: nodes.filter((n) => n.status === "UNKNOWN").length,
  };

  return (
    <div className="relative h-[calc(100dvh-132px)] min-h-[540px] w-full overflow-hidden bg-[#102035]">
      <Scene nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />

      <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-2 text-xs">
        <div className="pointer-events-auto flex items-center gap-3">
          <span className="font-medium text-[var(--fg)]">{_t(_locale, "sphere_SphereView.m94b6ef8b1d")}</span>
          <Link href={backHref} className="btn btn--ghost">{backLabel}</Link>
        </div>
        <div className="panel flex items-center gap-x-4 px-3 py-2">
          <span><span className="led led--up mr-1.5 align-middle" />{counts.up}</span>
          <span><span className="led led--degraded mr-1.5 align-middle" />{counts.degraded}</span>
          <span className={counts.down > 0 ? "text-[var(--down)]" : ""}>
            <span className="led led--down mr-1.5 align-middle" />{counts.down}
          </span>
          <span className="text-[var(--fg-dim)]"><span className="led led--unknown mr-1.5 align-middle" />{counts.unknown}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-medium text-[var(--fg-dim)]">
        {sel ? _t(_locale, "sphere_SphereView.ma8f7887449") : _t(_locale, "sphere_SphereView.m0bcb41e595")}
      </div>

      {sel && <DetailPanel node={sel} canEdit={canEdit} onClose={() => setSelectedId(null)} />}

      {/* Legende für die Statusfarben (dezent) */}
      <div className="pointer-events-none absolute bottom-3 right-4 hidden gap-3 text-[10px] text-[var(--fg-dim)] sm:flex">
        {(["UP", "DEGRADED", "DOWN", "UNKNOWN"] as const).map((s) => (
          <span key={s}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: STATUS_COLOR[s] }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
