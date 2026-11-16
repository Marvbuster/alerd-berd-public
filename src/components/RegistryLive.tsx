"use client";

import { intlLocale } from "@/i18n/locale";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

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

function STATUS_META(_locale: string = "de"): Record<VizStatus, { label: string; cls: string }> { return ({
  UP: { label: _t(_locale, "RegistryLive.m0d21bd5202"), cls: "up" }, DEGRADED: { label: _t(_locale, "RegistryLive.m55b60500c7"), cls: "degraded" },
  DOWN: { label: _t(_locale, "RegistryLive.ma1794783aa"), cls: "down" }, UNKNOWN: { label: _t(_locale, "RegistryLive.m276ffa1fb4"), cls: "unknown" },
}); }

export function HistoryMini({ node }: { node: VizNode }) {
  const _locale = _useLocale();
  const points = node.history.slice(-16);
  if (!points.length) return <span className="text-[var(--fg-dim)]">—</span>;
  return <div className="history-mini" role="img" aria-label={_t(_locale, "RegistryLive.m5f8297615f", { value0: points.length })}>{points.map((p, i) => {
    const meta = STATUS_META(_locale)[p.status ?? (p.ms === null ? "UNKNOWN" : "UP")];
    return <span key={`${p.t}-${i}`} style={{ background: `var(--${meta.cls})`, opacity: node.enabled ? .9 : .35 }} title={`${new Date(p.t).toLocaleString(intlLocale(_locale))}: ${meta.label}${p.ms === null ? "" : _t(_locale, "RegistryLive.m3c2005670e", { value0: p.ms })}`} />;
  })}</div>;
}

export function RegistryLive({ initial, showAlerting, canEdit }: { initial: VizNode[]; showAlerting: boolean; canEdit: boolean }) {
  const _locale = _useLocale();
  const nodes = useLiveNodes(initial);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const active = nodes.filter((n) => n.enabled);
  const counts = Object.fromEntries(Object.keys(STATUS_META(_locale)).map((status) => [status, active.filter((n) => n.status === status).length]));
  const visible = nodes.filter((n) => `${n.label} ${n.target}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || (status === "paused" ? !n.enabled : n.enabled && n.status === status)));
  const summaryStatus = active.some((n) => n.status === "DOWN") ? "down" : active.some((n) => n.status === "DEGRADED") ? "degraded" : active.length && active.every((n) => n.status === "UP") ? "up" : "unknown";
  return <>
    <PageHeader title={_t(_locale, "RegistryLive.m9cfe09ed1a")} description={_t(_locale, "RegistryLive.m3991a6528e")} icon="monitor" actions={canEdit && <><form action={checkNow}><button className="btn btn--ghost"><Icon name="refresh" size={17} />{_t(_locale, "RegistryLive.m0ceedfb0d6")}</button></form><Link href="/monitors/new" className="btn"><Icon name="plus" size={18} />{_t(_locale, "RegistryLive.m07fdf8b78d")}</Link></>} />
    <div className="summary-strip monitor-summary"><div><Icon name="monitor" size={23} /><span><strong>{nodes.length}</strong> {_t(_locale, "RegistryLive.mdb6f1a9fc2")}</span></div>{Object.entries(STATUS_META(_locale)).map(([key, meta]) => <div key={key}><span className={`led led--${meta.cls}`} /><span><strong>{counts[key]}</strong> {meta.label}</span></div>)}</div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="flex items-center gap-2 text-[var(--fg-dim)]"><span className={`led led--${summaryStatus}`} />{!active.length ? _t(_locale, "RegistryLive.m57efc2b743") : active.every((n) => n.status === "UP") ? _t(_locale, "RegistryLive.m77356b8723") : _t(_locale, "RegistryLive.ma3d979acaa")}</p><div className="flex items-center gap-4 text-xs text-[var(--fg-dim)]">{nodes.some((n) => !n.enabled) && <span>{nodes.filter((n) => !n.enabled).length} {_t(_locale, "RegistryLive.m32d9c9044e")}</span>}{showAlerting && <Link href="/settings">{_t(_locale, "RegistryLive.m3763e50513")}</Link>}</div></div>
    <section className="panel overflow-hidden" aria-label={_t(_locale, "RegistryLive.m28826847a9")}>
      <div className="inventory-toolbar"><label className="inventory-search max-w-md"><Icon name="search" /><input type="search" aria-label={_t(_locale, "RegistryLive.m52b1c9fbd1")} placeholder={_t(_locale, "RegistryLive.md8126f4af1")} value={query} onChange={(e) => setQuery(e.target.value)} /></label><label className="ml-auto"><span className="sr-only">{_t(_locale, "RegistryLive.m2febc9b206")}</span><select className="!mt-0 !w-auto min-w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">{_t(_locale, "RegistryLive.m23ee74c4a8")}</option>{Object.entries(STATUS_META(_locale)).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}<option value="paused">{_t(_locale, "RegistryLive.m02a733f164")}</option></select></label></div>
      {!visible.length ? <div className="px-6 py-12 text-center">{!nodes.length && <AlerdLogo size={90} className="mx-auto mb-5" />}<p className="text-[var(--fg-dim)]">{nodes.length ? _t(_locale, "RegistryLive.m3b8c0c1771") : _t(_locale, "RegistryLive.mfc5c342c4b")}</p>{!nodes.length && canEdit && <Link href="/monitors/new" className="btn mt-4">{_t(_locale, "RegistryLive.m53bee17182")}</Link>}</div> : <table className="monitor-table"><thead><tr><th>{_t(_locale, "RegistryLive.m4c2e1df457")}</th><th>{_t(_locale, "RegistryLive.m920e413c7d")}</th><th className="monitor-type">{_t(_locale, "RegistryLive.m1b024183cb")}</th><th className="monitor-package">{_t(_locale, "RegistryLive.mdd167905de")}</th><th className="monitor-response">{_t(_locale, "RegistryLive.m84a147f28c")}</th><th className="monitor-history">{_t(_locale, "RegistryLive.m5fd70311d1")}</th>{canEdit && <th><span className="sr-only">{_t(_locale, "RegistryLive.m5656f92db7")}</span></th>}</tr></thead><tbody>{visible.map((n) => {
        const s = n.enabled ? STATUS_META(_locale)[n.status] : { label: _t(_locale, "RegistryLive.m02a733f164"), cls: "unknown" };
        const issues = n.components.filter((c) => c.status.toLowerCase() !== "ok");
        return <tr key={n.id} className={`monitor-row ${n.enabled ? "" : "opacity-60"}`}>
          <td><div className="flex items-center gap-3"><span className="inventory-app-icon"><Icon name={n.kind === "PUSH" ? "layers" : n.kind === "HTTP" ? "globe" : "monitor"} size={21} /></span><div className="min-w-0"><Link href={`/monitors/${n.id}`} className="monitor-name">{n.label}</Link><p className="mt-0.5 break-all text-xs text-[var(--fg-dim)]">{n.target.replace(/^https?:\/\//, "")}</p><div className="mt-2 flex flex-wrap items-center gap-2">{n.coolifyApps.length ? <Link href={`/coolify#app-${n.coolifyApps[0].id}`} className="connection-badge connection-badge--linked" title={n.coolifyApps.map((a) => a.name).join(", ")}>{_t(_locale, "RegistryLive.m2807662a63")}{n.coolifyApps.length > 1 ? ` · ${n.coolifyApps.length}` : ""}</Link> : <span className="text-[11px] text-[var(--fg-dim)]">{_t(_locale, "RegistryLive.m89e3df8a82")}</span>}{issues.length > 0 && <><Link href={`/monitors/${n.id}`} className="text-xs text-[var(--amber)]">{issues.length} {issues.length === 1 ? _t(_locale, "RegistryLive.m1f13ce5ed6") : _t(_locale, "RegistryLive.m2e8017c60e")}</Link><ComponentDots components={issues} /></>}</div></div></div></td>
          <td><span className="inline-flex items-center gap-2 whitespace-nowrap text-xs"><span className={`led led--${s.cls}`} />{s.label}</span></td>
          <td className="monitor-type"><span className="tag">{n.kind === "HEALTH" ? "Health" : n.kind === "PUSH" ? "Push" : n.kind}</span></td>
          <td className="monitor-package"><div className="flex flex-wrap gap-1">{n.packages.length ? n.packages.map((p) => <PackageBadge key={p.name} pkg={p} />) : <span className="text-[var(--fg-dim)]">—</span>}</div>{n.version && <span className="mt-1 block text-[11px] text-[var(--fg-dim)]">{_t(_locale, "RegistryLive.m02f5dbdbc0")}{n.version}</span>}</td>
          <td className="monitor-response tabular-nums text-sm">{n.responseMs != null ? _t(_locale, "RegistryLive.m33f3d582fe", { value0: n.responseMs }) : "—"}</td>
          <td className="monitor-history"><Link href={`/monitors/${n.id}`} aria-label={_t(_locale, "RegistryLive.ma2e157b511", { value0: n.label })}><HistoryMini node={n} /></Link></td>
          {canEdit && <td className="monitor-actions"><div className="flex justify-end gap-2"><form action={toggleMonitor.bind(null, n.id, !n.enabled)}><button className="icon-button" title={n.enabled ? _t(_locale, "RegistryLive.m75a303be13") : _t(_locale, "RegistryLive.mcfc6942928")} aria-label={`${n.label} ${n.enabled ? _t(_locale, "common.pause") : _t(_locale, "common.activate")}`}><span aria-hidden>{n.enabled ? "Ⅱ" : "▶"}</span></button></form><Link href={`/monitors/${n.id}/edit`} className="icon-button" title={_t(_locale, "RegistryLive.m84e45ee734")} aria-label={_t(_locale, "RegistryLive.mb40c4fbf87", { value0: n.label })}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m16 3 5 5L8 21H3v-5L16 3Zm-3 3 5 5" /></svg></Link></div></td>}
        </tr>;
      })}</tbody></table>}
    </section>
    <div className="mt-5 flex flex-wrap items-start justify-between gap-4 text-xs text-[var(--fg-dim)]"><p>{_t(_locale, "RegistryLive.m62b8718c65")}<br />{_t(_locale, "RegistryLive.mb8f9ed821f")}</p><Link href="/sphere" className="inline-flex items-center gap-2"><Icon name="globe" size={16} />{_t(_locale, "RegistryLive.m0fb277f730")}</Link></div>
  </>;
}
