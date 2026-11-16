"use client";

import { intlLocale } from "@/i18n/locale";

import { localizedTitle } from "@/i18n/data";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { type VizNode, type HistoryPoint, STATUS_COLOR, localizedSTATUS_LABEL as STATUS_LABEL, historyPointKind, WATCH_COLOR, localizedWATCH_LABEL as WATCH_LABEL, healthColor, liveUptimeMs, metricSeverity } from "@/lib/viz";

function fmtDur(ms: number | null, _locale: string = "de"): string {
  if (ms == null) return "—";
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return _t(_locale, "MonitorDetail.m8f29caf41b", { value0: Math.floor(h), value1: Math.floor(m % 60) });
  return _t(_locale, "MonitorDetail.m4e62faea22", { value0: Math.floor(h / 24), value1: Math.floor(h % 24) });
}

// Label-Abstand für die Zeitachse: ~10 Ticks-Fenster → schöner Zeitschritt.
// (1m,5m,15m,30m,1h,2h,6h,12h,1d) — bei 60s-Intervall/47min ergibt das 5min.
function pickLabelStepSec(spanSec: number): number {
  const steps = [60, 300, 900, 1800, 3600, 7200, 21600, 43200, 86400];
  const target = spanSec / 10;
  for (const s of steps) if (s >= target) return s;
  return steps[steps.length - 1];
}

// „vor X" kompakt für Achsen-Labels (Vielfache der Zeitschritte → meist ganzzahlig).
function fmtAgo(sec: number, _locale = "de"): string {
  if (sec <= 0) return _t(_locale, "common.now");
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = sec / 3600;
    return Number.isInteger(h) ? `${h}h` : `${h.toLocaleString(intlLocale(_locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
  }
  const d = sec / 86400;
  return Number.isInteger(d) ? `${d}d` : `${d.toLocaleString(intlLocale(_locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}d`;
}

// Runde einen Wert auf eine „schöne" 1/2/5-Obergrenze auf (für die Y-Achse).
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

function Graph({ points, color, max }: { points: HistoryPoint[]; color: string; max: number }) {
  const _locale = _useLocale();
  const W = 900, H = 200, pad = 6;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const span = Math.max(1, tMax - tMin); // ms; nach ECHTER Zeit skaliert (nicht Index)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const x = (t: number) => pad + ((t - tMin) / span) * (W - pad * 2);

  // Nur DOWN unterbricht die Linie und wird rot markiert. Events ohne
  // Antwortzeit (Push) bekommen einen kurzen Strich in ihrer Statusfarbe.
  let line = "";
  let started = false;
  const gaps: number[] = [];
  const events: HistoryPoint[] = [];
  points.forEach((p) => {
    const kind = historyPointKind(p);
    if (kind === "outage") {
      started = false;
      gaps.push(p.t);
      return;
    }
    if (kind === "event" || p.ms == null) {
      events.push(p);
      return;
    }
    line += started ? ` L${x(p.t).toFixed(1)} ${y(p.ms).toFixed(1)}` : `M${x(p.t).toFixed(1)} ${y(p.ms).toFixed(1)}`;
    started = true;
  });
  // Fläche unter der Linie bis zum ersten Ausfall, nur über gemessene Punkte.
  const firstOutage = points.findIndex((p) => historyPointKind(p) === "outage");
  const measured = (firstOutage === -1 ? points : points.slice(0, firstOutage)).filter((p) => p.ms != null);
  let area = "";
  if (measured.length > 1) {
    area = `M${x(measured[0].t)} ${H - pad}`;
    for (const p of measured) area += ` L${x(p.t).toFixed(1)} ${y(p.ms ?? 0).toFixed(1)}`;
    area += ` L${x(measured[measured.length - 1].t)} ${H - pad} Z`;
  }

  // X-Achsen-Ticks relativ zum neuesten Punkt (tMax≈jetzt), Label im ~5min-Raster.
  const spanSec = Math.max(1, Math.round(span / 1000));
  const labelStepSec = pickLabelStepSec(spanSec);
  const tickStepSec = Math.max(1, Math.round(labelStepSec / 5));
  const ticks: { t: number; label: string | null }[] = [];
  for (let s = 0; s <= spanSec + 0.5; s += tickStepSec) {
    ticks.push({ t: tMax - s * 1000, label: Math.round(s) % labelStepSec === 0 ? fmtAgo(s, _locale) : null });
  }

  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetT = tMin + frac * span;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.t - targetT);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? points[hover] : undefined;
  const hpKind = hp ? historyPointKind(hp) : null;
  const hoverTop = hp ? (hp.ms != null ? y(hp.ms) : hpKind === "event" ? H - pad - 7 : H / 2) : 0;
  const hoverLeftPct = hp ? (x(hp.t) / W) * 100 : 0;
  const tipAbove = hoverTop > 44;
  const hoverColor = !hp ? color : hpKind === "outage" ? "var(--down)" : hpKind === "event" ? STATUS_COLOR[hp.status ?? "UNKNOWN"] : color;
  const hoverTime = hp
    ? new Date(hp.t).toLocaleTimeString(intlLocale(_locale), { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div>
      <div
        className="relative touch-none"
        style={{ height: H }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="rgba(120,150,135,0.12)" strokeWidth={1} />
          ))}
          {area && <path d={area} fill={color} opacity={0.12} />}
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {gaps.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={pad} y2={H - pad} stroke="var(--down)" strokeWidth={1.5} strokeDasharray="3 4" opacity={0.6} />
          ))}
          {events.map((p) => (
            <line key={`e${p.t}`} x1={x(p.t)} x2={x(p.t)} y1={H - pad - 14} y2={H - pad} stroke={STATUS_COLOR[p.status ?? "UNKNOWN"]} strokeWidth={2} opacity={0.75} />
          ))}
          {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={0} y2={H} stroke={color} strokeWidth={1} opacity={0.35} />}
        </svg>

        {hp && (
          <>
            <span
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${hoverLeftPct}%`, top: hoverTop, background: hoverColor, boxShadow: `0 0 8px ${hoverColor}` }}
            />
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-[var(--fg-faint)] bg-[var(--bg-panel)] px-2 py-1 text-[10px] tabular-nums text-[var(--fg)]"
              style={{
                left: `${hoverLeftPct}%`,
                top: tipAbove ? hoverTop - 8 : hoverTop + 8,
                transform: `translateX(${hoverLeftPct >= 88 ? "-100%" : hoverLeftPct <= 12 ? "0" : "-50%"}) translateY(${tipAbove ? "-100%" : "0"})`,
              }}
            >
              {hoverTime} · {hpKind === "outage" ? _t(_locale, "common.outage") : hpKind === "event" ? _t(_locale, "MonitorDetail.m65313d3c62", { value0: STATUS_LABEL(_locale)[hp.status ?? "UNKNOWN"] }) : _t(_locale, "MonitorDetail.m33f3d582fe", { value0: hp.ms })}
            </div>
          </>
        )}
      </div>

      {/* X-Achse: Minutenstriche, Label im ~5min-Raster (nach echter Zeit) */}
      <div className="relative mt-1 h-5 text-[9px] tabular-nums text-[var(--fg-dim)]">
        {ticks.map((tk, idx) => {
          const leftPct = Math.max(0, Math.min(100, (x(tk.t) / W) * 100));
          return (
            <span key={idx}>
              <span
                className="absolute top-0 block w-px bg-[var(--fg-faint)]"
                style={{ left: `${leftPct}%`, height: tk.label ? 6 : 3, transform: "translateX(-50%)" }}
              />
              {tk.label && (
                <span
                  className="absolute top-[8px] whitespace-nowrap"
                  style={{
                    left: `${leftPct}%`,
                    transform: leftPct >= 99 ? "translateX(-100%)" : leftPct <= 1 ? "none" : "translateX(-50%)",
                  }}
                >
                  {tk.label}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="rounded-md border border-[var(--fg-faint)] bg-[var(--bg-raised)] px-4 py-3">
      <div className="mb-1 text-[10px] font-medium text-[var(--fg-dim)]">{k}</div>
      <div className="text-lg" style={color ? { color } : undefined}>{v}</div>
    </div>
  );
}

// Gemeinsamer Detail-Inhalt für ALLE Views (Sphere-Modal + Detail-Seite):
// Status, Kennzahlen, Antwortzeit-Graph, Spec-Health-Komponenten + -Metriken.
// footerActions = view-spezifische Buttons (Modal: edit/close; Seite: edit/back).
export function MonitorDetail({
  node: initial,
  footerActions,
  live = true,
}: {
  node: VizNode;
  footerActions?: ReactNode;
  live?: boolean; // false: Parent liefert Updates (z.B. Sphere via All-Nodes-Stream)
}) {
  const _locale = _useLocale();
  // Live: Erst-Daten vom Server, dann per SSE aktualisiert (neuer Check → Push).
  const [node, setNode] = useState(initial);
  useEffect(() => setNode(initial), [initial]); // Prop-Update (Monitorwechsel/Parent) → übernehmen
  useEffect(() => {
    if (!live) return; // Updates kommen per Prop vom Parent
    const es = new EventSource(`/api/monitors/${initial.id}/stream`);
    es.onmessage = (e) => {
      try {
        setNode(JSON.parse(e.data) as VizNode);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [initial.id, live]);

  const color = STATUS_COLOR[node.status];
  const data = node.history;
  const hasGraph = data.length >= 2;
  // Push misst keine Antwortzeit. Ohne einen einzigen Messwert wäre der Graph leer.
  const pushOnly = node.kind === "PUSH" && !data.some((p) => p.ms != null);
  const axisMax = niceCeil(Math.max(...data.map((p) => p.ms ?? 0), 1));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000); // „vor Xs" tickt
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-2 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight break-words [overflow-wrap:anywhere] sm:text-3xl">{node.label}</h1>
            <div className="mt-1 text-xs text-[var(--fg-dim)]">
              {liveUptimeMs(node, now) != null && <>{_t(_locale, "MonitorDetail.mfc5403a45f")}{fmtDur(liveUptimeMs(node, now), _locale)} · </>}
              {_t(_locale, "MonitorDetail.mee573bfff4")}{fmtDur(node.stateSinceMs != null ? now - node.stateSinceMs : null, _locale)} {_t(_locale, "MonitorDetail.m5658e78370")}{" "}
              {node.lastCheckedMs != null ? _t(_locale, "MonitorDetail.ma4c2973d4a", { value0: fmtDur(now - node.lastCheckedMs, _locale) }) : "—"}
              {node.version && <> {_t(_locale, "MonitorDetail.m63e470a096")}{node.version}</>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tag">{node.kind}</span>
          <span
            className="rounded px-2.5 py-1 text-xs font-medium"
            style={{ color, border: `1px solid ${color}` }}
          >
            {STATUS_LABEL(_locale)[node.status]}
          </span>
        </div>
      </div>

      {/* Kennzahlen */}
      <div className="mb-5 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-cyan-200">{_t(_locale, "MonitorDetail.me0df3f010e")}</div>
        {node.coolifyApps.length ? <div className="flex flex-wrap gap-2">{node.coolifyApps.map((app) => <Link key={app.id} href={`/services#app-${app.id}`} className="connection-badge connection-badge--linked">↔ {app.name} · {app.missing ? _t(_locale, "MonitorDetail.mdffddcba6d") : app.connectionLabel}</Link>)}</div> : <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400"><span>{_t(_locale, "MonitorDetail.mc244ef9563")}</span><Link href={`/services#mon-${node.id}`}>{_t(_locale, "MonitorDetail.ma2e974eeb6")}</Link></div>}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k={_t(_locale, "common.responseTime")} v={node.responseMs != null ? `${node.responseMs} ms` : "—"} />
        <Stat k={_t(_locale, "common.interval")} v={`${node.intervalSec}s`} />
        {node.status !== "UP" ? (
          <Stat k={_t(_locale, "common.lastOk")} v={node.lastUpMs != null ? _t(_locale, "MonitorDetail.ma4c2973d4a", { value0: fmtDur(now - node.lastUpMs, _locale) }) : "—"} color={STATUS_COLOR.UP} />
        ) : (
          <Stat k={_t(_locale, "common.state")} v={_t(_locale, "common.stable")} color={STATUS_COLOR.UP} />
        )}
        <Stat k={_t(_locale, "common.active")} v={node.enabled ? _t(_locale, "common.yes") : _t(_locale, "common.paused")} />
      </div>

      {/* Antwortzeit-Verlauf */}
      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[10px] font-medium text-[var(--fg)]">{_t(_locale, "MonitorDetail.m6daa700674")}</span>
          <span className="text-[10px] text-[var(--fg-dim)]">{_t(_locale, "MonitorDetail.mcd79cc95ad")}{data.length} {pushOnly ? "Events" : "Checks"}</span>
        </div>
        {pushOnly ? (
          <div className="grid h-[120px] place-items-center rounded-md border border-dashed border-[var(--fg-faint)] px-4 text-center text-xs text-[var(--fg-dim)]">
            {_t(_locale, "MonitorDetail.m5f0e8993e6")}</div>
        ) : hasGraph ? (
          <div className="flex gap-2">
            {/* Y-Achse: Antwortzeit in ms */}
            <div className="flex h-[200px] flex-col justify-between py-[5px] text-right text-[9px] tabular-nums text-[var(--fg-dim)]">
              <span>{axisMax} {_t(_locale, "MonitorDetail.m20249a0dcc")}</span>
              <span>{Math.round(axisMax / 2)} {_t(_locale, "MonitorDetail.m20249a0dcc")}</span>
              <span>0</span>
            </div>
            <div className="min-w-0 flex-1">
              <Graph points={data} color={color} max={axisMax} />
            </div>
          </div>
        ) : (
          <div className="grid h-[200px] place-items-center rounded-md border border-dashed border-[var(--fg-faint)] text-xs text-[var(--fg-dim)]">
            {_t(_locale, "MonitorDetail.m49275cf643")}</div>
        )}
      </div>

      {/* Komponenten (aus dem letzten Spec-Health-Payload) */}
      {node.components.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-[10px] font-medium text-[var(--fg)]">{_t(_locale, "MonitorDetail.m8934293b94")}</div>
          <div className="grid gap-1.5">
            {node.components.map((c) => {
              const cc = healthColor(c.status);
              return (
                <div
                  key={c.name}
                  className="flex items-center gap-2.5 rounded-md border border-[var(--fg-faint)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
                >
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cc, boxShadow: `0 0 8px ${cc}` }} />
                  <span className="shrink-0 font-mono">{c.name}</span>
                  {c.detail && <span className="min-w-0 truncate text-xs text-[var(--fg-dim)]">{c.detail}</span>}
                  <span className="ml-auto shrink-0 text-[10px] font-medium" style={{ color: cc }}>
                    {c.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metriken (aus dem letzten Spec-Health-Payload) */}
      {node.metrics.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-[10px] font-medium text-[var(--fg)]">{_t(_locale, "MonitorDetail.mef5189cc1f")}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {node.metrics.map((m) => {
              const sev = metricSeverity(m);
              const mc = sev === "ok" ? undefined : healthColor(sev);
              return (
                <div
                  key={m.name}
                  className="flex items-baseline justify-between gap-2 rounded-md border border-[var(--fg-faint)] bg-[var(--bg-raised)] px-4 py-3 sm:block"
                  style={mc ? { borderColor: mc } : undefined}
                >
                  <div className="min-w-0 break-words [overflow-wrap:anywhere] font-mono text-[11px] text-[var(--fg-dim)] sm:mb-1">{m.name}</div>
                  <div className="shrink-0 text-lg" style={mc ? { color: mc } : undefined}>
                    {m.value.toLocaleString(intlLocale(_locale))}
                    {m.unit ? ` ${m.unit}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Versionswächter (live gemeldete Pakete aus runtime.packages) */}
      {node.packages.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-[10px] font-medium text-[var(--fg)]">{_t(_locale, "MonitorDetail.med902d245f")}</div>
          <div className="grid gap-1.5">
            {node.packages.map((p) => {
              const pc = WATCH_COLOR[p.level];
              return (
                <div key={p.name} className="rounded-md border border-[var(--fg-faint)] bg-[var(--bg-raised)] px-3 py-2 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pc, boxShadow: `0 0 8px ${pc}` }} />
                    <span className="shrink-0 font-mono">{p.name} {p.version ?? "?"}</span>
                    <span className="min-w-0 truncate text-xs text-[var(--fg-dim)]">
                      {p.version == null
                        ? _t(_locale, "MonitorDetail.m949d8a7d33")
                        : `${p.latest ? _t(_locale, "MonitorDetail.mc8ac4a29d8", { value0: p.latest }) : _t(_locale, "MonitorDetail.m9bd362acdb")}${p.sinceMs != null ? _t(_locale, "MonitorDetail.m9991c9b443", { value0: fmtDur(now - p.sinceMs, _locale) }) : ""}`}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] font-medium" style={{ color: pc }}>
                      {WATCH_LABEL(_locale)[p.level]}
                    </span>
                  </div>
                  {p.findings.length > 0 && (
                    <ul className="mt-1.5 grid gap-1 pl-5 text-xs">
                      {p.findings.map((f, i) => (
                        <li key={i} className="flex gap-2" style={{ color: WATCH_COLOR[f.level] }}>
                          <span className="shrink-0">›</span>
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                            {f.ghsaId && (f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline">{f.ghsaId}</a> : f.ghsaId)}
                            {f.severity && <> ({f.severity})</>}
                            {f.ghsaId && ": "}
                            {localizedTitle(f, _locale)}
                            {f.fixedIn && <> {_t(_locale, "MonitorDetail.mbccb769eca")}{f.fixedIn}</>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer — Ziel + view-spezifische Aktionen */}
      <div className="flex flex-col gap-3 border-t border-[var(--fg-faint)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0 break-all font-mono text-xs text-[var(--fg-dim)]">{node.target}</span>
        {footerActions && <div className="flex shrink-0 items-center gap-2">{footerActions}</div>}
      </div>
    </div>
  );
}
