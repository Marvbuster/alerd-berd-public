"use client";

import { useState } from "react";
import Link from "next/link";
import { type VizNode, type VizStatus } from "@/lib/viz";
import { toggleMonitor, checkNow } from "@/lib/actions";
import { ComponentDots } from "@/components/ComponentDots";
import { PackageBadge } from "@/components/PackageBadge";
import { useLiveNodes } from "@/components/useLiveNodes";
import { PageHeader } from "./PageHeader";
import { Icon } from "./Icon";
import { AlerdLogo } from "./AlerdLogo";

const STATUS_META: Record<VizStatus, { label: string; cls: string }> = {
  UP: { label: "Online", cls: "up" }, DEGRADED: { label: "Eingeschränkt", cls: "degraded" },
  DOWN: { label: "Offline", cls: "down" }, UNKNOWN: { label: "Unbekannt", cls: "unknown" },
};

export function HistoryMini({ node }: { node: VizNode }) {
  const points = node.history.slice(-16);
  if (!points.length) return <span className="text-[var(--fg-dim)]">—</span>;
  return <div className="history-mini" role="img" aria-label={`Status der letzten ${points.length} Checks`}>{points.map((p, i) => {
    const meta = STATUS_META[p.status ?? (p.ms === null ? "UNKNOWN" : "UP")];
    return <span key={`${p.t}-${i}`} style={{ background: `var(--${meta.cls})`, opacity: node.enabled ? .9 : .35 }} title={`${new Date(p.t).toLocaleString("de-DE")}: ${meta.label}${p.ms === null ? "" : ` · ${p.ms} ms`}`} />;
  })}</div>;
}

export function RegistryLive({ initial, showAlerting, canEdit }: { initial: VizNode[]; showAlerting: boolean; canEdit: boolean }) {
  const nodes = useLiveNodes(initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const active = nodes.filter((n) => n.enabled);
  const counts = Object.fromEntries(Object.keys(STATUS_META).map((status) => [status, active.filter((n) => n.status === status).length]));
  const visible = nodes.filter((n) => `${n.label} ${n.target}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || (status === "paused" ? !n.enabled : n.enabled && n.status === status)));
  const summaryStatus = active.some((n) => n.status === "DOWN") ? "down" : active.some((n) => n.status === "DEGRADED") ? "degraded" : active.length && active.every((n) => n.status === "UP") ? "up" : "unknown";
  return <>
    <PageHeader title="Monitore" description="Verfügbarkeit deiner Anwendungen im Überblick." icon="monitor" actions={canEdit && <><form action={checkNow}><button className="btn btn--ghost"><Icon name="refresh" size={17} />Jetzt prüfen</button></form><Link href="/monitors/new" className="btn"><Icon name="plus" size={18} />Monitor hinzufügen</Link></>} />
    <div className="summary-strip monitor-summary"><div><Icon name="monitor" size={23} /><span><strong>{nodes.length}</strong> Monitore</span></div>{Object.entries(STATUS_META).map(([key, meta]) => <div key={key}><span className={`led led--${meta.cls}`} /><span><strong>{counts[key]}</strong> {meta.label}</span></div>)}</div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="flex items-center gap-2 text-[var(--fg-dim)]"><span className={`led led--${summaryStatus}`} />{!active.length ? "Keine aktiven Monitore" : active.every((n) => n.status === "UP") ? "Alle überwachten Systeme verfügbar" : "Einige Dienste benötigen Aufmerksamkeit"}</p><div className="flex items-center gap-4 text-xs text-[var(--fg-dim)]">{nodes.some((n) => !n.enabled) && <span>{nodes.filter((n) => !n.enabled).length} pausiert</span>}{showAlerting && <Link href="/settings">Benachrichtigungen verwalten ↗</Link>}</div></div>
    <section className="panel overflow-hidden" aria-label="Monitorliste">
      <div className="inventory-toolbar"><label className="inventory-search max-w-md"><Icon name="search" /><input type="search" aria-label="Monitore durchsuchen" placeholder="Monitore durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label className="ml-auto"><span className="sr-only">Status filtern</span><select className="!mt-0 !w-auto min-w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Alle Status</option>{Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}<option value="paused">Pausiert</option></select></label></div>
      {!visible.length ? <div className="px-6 py-12 text-center">{!nodes.length && <AlerdLogo size={90} className="mx-auto mb-5" />}<p className="text-[var(--fg-dim)]">{nodes.length ? "Keine Monitore für diesen Filter." : "Noch keine Monitore eingerichtet."}</p>{!nodes.length && canEdit && <Link href="/monitors/new" className="btn mt-4">Ersten Monitor hinzufügen</Link>}</div> : <table className="monitor-table"><thead><tr><th>Monitor</th><th>Status</th><th className="monitor-type">Typ</th><th className="monitor-package">Version</th><th className="monitor-response">Antwortzeit</th><th className="monitor-history">Verlauf</th>{canEdit && <th><span className="sr-only">Aktionen</span></th>}</tr></thead><tbody>{visible.map((n) => {
        const s = n.enabled ? STATUS_META[n.status] : { label: "Pausiert", cls: "unknown" };
        const issues = n.components.filter((c) => c.status.toLowerCase() !== "ok");
        return <tr key={n.id} className={`monitor-row ${n.enabled ? "" : "opacity-60"}`}>
          <td><div className="flex items-center gap-3"><span className="inventory-app-icon"><Icon name={n.kind === "PUSH" ? "layers" : n.kind === "HTTP" ? "globe" : "monitor"} size={21} /></span><div className="min-w-0"><Link href={`/monitors/${n.id}`} className="monitor-name">{n.label}</Link><p className="mt-0.5 break-all text-xs text-[var(--fg-dim)]">{n.target.replace(/^https?:\/\//, "")}</p><div className="mt-2 flex flex-wrap items-center gap-2">{n.coolifyApps.length ? <Link href={`/coolify#app-${n.coolifyApps[0].id}`} className="connection-badge connection-badge--linked" title={n.coolifyApps.map((a) => a.name).join(", ")}>↔ Coolify{n.coolifyApps.length > 1 ? ` · ${n.coolifyApps.length}` : ""}</Link> : <span className="text-[11px] text-[var(--fg-dim)]">Ohne Coolify-Verknüpfung</span>}{issues.length > 0 && <><Link href={`/monitors/${n.id}`} className="text-xs text-[var(--amber)]">{issues.length} {issues.length === 1 ? "auffälliger Check" : "auffällige Checks"}</Link><ComponentDots components={issues} /></>}</div></div></div></td>
          <td><span className="inline-flex items-center gap-2 whitespace-nowrap text-xs"><span className={`led led--${s.cls}`} />{s.label}</span></td>
          <td className="monitor-type"><span className="tag">{n.kind === "HEALTH" ? "Health" : n.kind === "PUSH" ? "Push" : n.kind}</span></td>
          <td className="monitor-package"><div className="flex flex-wrap gap-1">{n.packages.length ? n.packages.map((p) => <PackageBadge key={p.name} pkg={p} />) : <span className="text-[var(--fg-dim)]">—</span>}</div>{n.version && <span className="mt-1 block text-[11px] text-[var(--fg-dim)]">App v{n.version}</span>}</td>
          <td className="monitor-response tabular-nums text-sm">{n.responseMs != null ? `${n.responseMs} ms` : "—"}</td>
          <td className="monitor-history"><Link href={`/monitors/${n.id}`} aria-label={`Check-Verlauf von ${n.label}`}><HistoryMini node={n} /></Link></td>
          {canEdit && <td className="monitor-actions"><div className="flex justify-end gap-2"><form action={toggleMonitor.bind(null, n.id, !n.enabled)}><button className="icon-button" title={n.enabled ? "Pausieren" : "Aktivieren"} aria-label={`${n.label} ${n.enabled ? "pausieren" : "aktivieren"}`}><span aria-hidden>{n.enabled ? "Ⅱ" : "▶"}</span></button></form><Link href={`/monitors/${n.id}/edit`} className="icon-button" title="Bearbeiten" aria-label={`${n.label} bearbeiten`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m16 3 5 5L8 21H3v-5L16 3Zm-3 3 5 5" /></svg></Link></div></td>}
        </tr>;
      })}</tbody></table>}
    </section>
    <div className="mt-5 flex flex-wrap items-start justify-between gap-4 text-xs text-[var(--fg-dim)]"><p>Live aktualisiert · Komponenten-Checks werden bei Auffälligkeiten eingeblendet.<br />Alle Details per Klick auf den Monitor.</p><Link href="/sphere" className="inline-flex items-center gap-2"><Icon name="globe" size={16} />Live Sphere öffnen ↗</Link></div>
  </>;
}
