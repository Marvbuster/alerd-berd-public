"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { PageHeader } from "./PageHeader";
import { useLiveNodes } from "./useLiveNodes";
import { ServiceStatusSection } from "./ServiceStatus";
import { ServicePicker } from "./ServicePicker";
import { BatchUpdatePicker, type BatchService } from "./BatchUpdatePicker";
import { CHAT_SUFFIX } from "./DependencyAssistant";
import { liveUptimeMs, type VizNode, type WatchLevel } from "@/lib/viz";
import type { PoolApp } from "@/lib/services";
import { aggregateStatus, localizedCHECK_KIND_LABEL as CHECK_KIND_LABEL, checkTally, matchesFilter, matchesQuery, localizedSERVICE_GROUPS as SERVICE_GROUPS, serviceGroup, localizedSTATUS_META as STATUS_META, STATUS_ORDER, type ServiceFilter } from "@/lib/service-logic";

// Abstand des klebenden Panels unter der Kopfleiste (wie .service-panel top im CSS).
const STICKY_TOP = 112;
export type ServiceItem = {
  id: string; name: string; domain: string | null; checkIds: string[]; applicationId: string; missing: boolean; meta: string;
  liveNext: string | null; watchLevel: WatchLevel | null; updateTarget: string | null; jobActive: boolean; search: string;
  alertLevel: WatchLevel | null; packageUpdates: number; updateLabel: string | null;
  jobActor: "user" | "worker" | "waiting" | "stalled" | "done" | "failed" | null;
  hasRepo: boolean; hasWatch: boolean;
  mergeMonitors: { id: string; name: string }[];
  detail: ReactNode;
};

function FILTERS(_locale: string = "de"): { id: ServiceFilter; label: string }[] { return ([
  { id: "all", label: _t(_locale, "ServicesBrowser.m3801a35c51") },
  { id: "attention", label: _t(_locale, "ServicesBrowser.me05ab9f529") },
  { id: "updates", label: _t(_locale, "ServicesBrowser.m22e2bada8f") },
  { id: "unmonitored", label: _t(_locale, "ServicesBrowser.m3d28c2e598") },
]); }
const isFilter = (value: string | null, _locale: string = "de"): value is ServiceFilter => FILTERS(_locale).some((f) => f.id === value);

const subscribeMobile = (callback: () => void) => {
  const query = window.matchMedia("(max-width: 800px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

type SortKey = "name" | "status" | "update";
const updateRank = (s: { jobActive: boolean; watchLevel: WatchLevel | null; updateTarget: string | null }) =>
  s.jobActive ? 0 : s.watchLevel === "red" || s.watchLevel === "orange" ? 1 : s.updateTarget ? 2 : 3;
function compareBy(key: SortKey, a: ServiceItem & { status: keyof typeof STATUS_ORDER }, b: ServiceItem & { status: keyof typeof STATUS_ORDER }, locale: string) {
  if (key === "name") return a.name.localeCompare(b.name, locale);
  if (key === "status") return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return updateRank(a) - updateRank(b);
}

function UpdateChip({ item }: { item: ServiceItem }) {
  const _locale = _useLocale();
  // Gleiche Sprache wie Glocke und Update-Chat: wer ist gerade dran?
  if (item.jobActive && item.jobActor === "user") return <span className="service-chip service-chip--update">{_t(_locale, "ServicesBrowser.md3b54f17ff")}</span>;
  if (item.jobActive && item.jobActor === "stalled") return <span className="service-chip service-chip--danger">{_t(_locale, "ServicesBrowser.mf3e40a52e0")}</span>;
  if (item.jobActive) return <span className="service-chip service-chip--busy">{_t(_locale, "ServicesBrowser.m2443ef5976")}</span>;
  if (item.alertLevel === "red" || item.alertLevel === "orange") return <span className="service-chip service-chip--danger">{_t(_locale, "ServicesBrowser.m4474c75260")}</span>;
  if (item.updateLabel) return <span className="service-chip service-chip--update">↑ {item.updateLabel}</span>;
  return <span className="text-[var(--fg-dim)]">—</span>;
}

const duration = (ms: number, _locale: string = "de") => {
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? _t(_locale, "ServicesBrowser.mabfadad08a", { value0: d, value1: h % 24 }) : h ? _t(_locale, "ServicesBrowser.m2e98a98d9f", { value0: h, value1: m % 60 }) : _t(_locale, "ServicesBrowser.m570ce99302", { value0: Math.max(1, m) });
};

// Laufzeit seit dem letzten Start oder Deploy (vom Dienst gemeldet) und wie
// lange der Status schon so ist. Zählt live mit.
function ServiceTimes({ monitors }: { monitors: VizNode[] }) {
  const _locale = _useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const active = monitors.filter((m) => m.enabled);
  const uptimes = active.map((m) => liveUptimeMs(m, now)).filter((v): v is number => v != null);
  const since = active.map((m) => m.stateSinceMs).filter((v): v is number => v != null);
  if (!uptimes.length && !since.length) return null;
  const status = aggregateStatus(active);
  return <p className="service-times">
    {uptimes.length > 0 && <span>{_t(_locale, "ServicesBrowser.mfc5403a45f")}<b>{duration(Math.min(...uptimes), _locale)}</b></span>}
    {since.length > 0 && <span>{status === "UP" ? "Online" : STATUS_META(_locale)[status].label} {_t(_locale, "ServicesBrowser.mfdc3dcf756")}<b>{duration(now - Math.max(...since), _locale)}</b></span>}
  </p>;
}

// Monitore ohne Coolify-App: schlicht unter der Liste, eine Zeile je Monitor,
// Klick führt auf die Monitor-Seite. Kein Panel, keine Version, kein Update.
function OtherMonitors({ monitors, always = false }: { monitors: VizNode[]; always?: boolean }) {
  const _locale = _useLocale();
  if (!monitors.length && !always) return null;
  return <section className="service-others" aria-label={_t(_locale, "ServicesBrowser.md17feaf2b6")}>
    <div className="inventory-group flex items-center justify-between gap-3"><span>{_t(_locale, "ServicesBrowser.m249ac04af0")}{monitors.length}</span><Link href="/monitors/new" className="service-link">{_t(_locale, "ServicesBrowser.md02f982634")}</Link></div>
    {monitors.map((m) => {
      const meta = m.enabled ? STATUS_META(_locale)[m.status] : STATUS_META(_locale).PAUSED;
      const tally = checkTally([m]);
      return <Link key={m.id} href={`/monitors/${m.id}`} className="service-row service-row--other">
        <span className="inventory-row-name"><span className="inventory-app-icon"><Icon name="monitor" size={18} /></span><span className="min-w-0"><span className="inventory-row-title">{m.label}</span><span className="inventory-row-domain">{CHECK_KIND_LABEL(_locale)[m.kind] ?? m.kind} · {m.target.replace(/^https?:\/\//, "")}</span></span></span>
        <span className="inventory-row-status"><span className={`led led--${meta.cls}`} />{meta.label}{tally && m.enabled && <span className={`service-tally service-tally--${tally.level}`}>{tally.ok}/{tally.total}</span>}</span>
        <span className="text-[var(--fg-dim)]">↗</span>
      </Link>;
    })}
  </section>;
}

export function ServicesBrowser({ items, pool, otherIds, connections, nodes: initialNodes, batch, initialFilter, initialQuery }: {
  items: ServiceItem[]; pool: PoolApp[]; otherIds: string[]; connections: { id: string; label: string }[]; nodes: VizNode[]; initialFilter: string; initialQuery: string;
  batch: { services: BatchService[]; manualDeploy: string[]; hasClaude: boolean; hasLocalNode: boolean; localNodeOnline: boolean; activeId: string | null };
}) {
  const _locale = _useLocale();
  const nodes = useLiveNodes(initialNodes);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [filter, setFilter] = useState<ServiceFilter>(isFilter(initialFilter, _locale) ? initialFilter : "all");
  const [query, setQuery] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState("");
  // Auf dem Handy klappt ein Dienst nur nach Antippen oder per Link auf, nie von selbst.
  const [picked, setPicked] = useState(false);
  // Rechts entweder der gewählte Dienst oder „Dienst anlegen“. Ohne Dienste gleich der Dialog.
  const [adding, setAdding] = useState(items.length === 0);
  // „Alle aktualisieren“ startet in einem eigenen Fenster, die Sidebar bleibt beim Dienst.
  const [batchOpen, setBatchOpen] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia("(max-width: 800px)").matches, () => false);
  const newCount = pool.filter((p) => p.isNew).length;
  // Weitere Monitore nur im Filter „Alle“, die Suche gilt auch für sie.
  const q = query.trim().toLowerCase();
  const others = otherIds.map((id) => byId.get(id)).filter((n): n is VizNode => !!n)
    .filter((n) => filter === "all" && (!q || `${n.label} ${n.target}`.toLowerCase().includes(q)));

  const services = useMemo(() => items.map((item) => {
    const monitors = item.checkIds.map((id) => byId.get(id)).filter((n): n is VizNode => !!n);
    const status = item.missing ? "UNKNOWN" as const : aggregateStatus(monitors);
    const update = item.jobActive || item.packageUpdates > 0 || item.alertLevel === "red" || item.alertLevel === "orange";
    return { ...item, monitors, status, update, group: serviceGroup(monitors), tally: checkTally(monitors) };
  }), [items, byId]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });
  // Nicht mehr in Coolify gefundene Apps stehen immer am Ende.
  const sorted = useMemo(() => [...services].sort((a, b) => Number(a.missing) - Number(b.missing) || sort.dir * compareBy(sort.key, a, b, _locale) || a.name.localeCompare(b.name, _locale)), [services, sort, _locale]);
  const counts = Object.fromEntries(FILTERS(_locale).map((f) => [f.id, services.filter((s) => matchesFilter(s, f.id)).length])) as Record<ServiceFilter, number>;
  // Sortierung gilt innerhalb der Gruppen, die Gruppen selbst stehen fest.
  const visible = SERVICE_GROUPS(_locale).flatMap((g) => sorted.filter((s) => s.group === g.id && matchesFilter(s, filter) && matchesQuery(s, query)));
  const selected = visible.find((s) => s.id === selectedId) ?? visible[0];

  // Das rechte Panel klebt unter der Kopfleiste. Ist es höher als das Fenster,
  // darf es aus dem Viewport laufen: top wird so weit negativ, dass es erst klebt,
  // wenn sein unteres Ende den Fensterrand erreicht. Eine Scrollbar, die der Seite.
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = detailRef.current;
    if (!wrap) return;
    const panel = wrap.firstElementChild as HTMLElement | null;
    if (!panel) return;
    const fit = () => {
      const top = Math.min(STICKY_TOP, window.innerHeight - panel.offsetHeight - 16);
      wrap.style.setProperty("--panel-sticky-top", `${top}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(panel);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [adding, selected?.id, mobile]);

  // Auswahl aus der URL nur beim Laden und bei echten Hash-Wechseln (Glocke,
  // Links) übernehmen, nicht bei jedem Daten-Refresh: der Update-Chat lädt alle
  // 4 Sekunden neu und hätte sonst immer wieder einen alten Hash angewendet.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Hash aus der URL, dessen Auswahl noch nicht gerendert ist. Bis dahin die URL
  // nicht umschreiben, sonst überschreibt der zuvor gezeigte Dienst den Hash samt
  // ~chat, bevor der Update-Chat des Ziels ihn lesen kann (Glocke, Warteschlange).
  const pendingHash = useRef<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1).split("~")[0];
      if (hash && itemsRef.current.some((i) => i.id === hash)) { pendingHash.current = hash; setSelectedId(hash); setPicked(true); setAdding(false); }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Auswahl und offener Chat leben nur im Hash. Query-Parameter werden nie
  // umgeschrieben: Ändern sie sich, baut Next die Seite beim nächsten Server-
  // Refresh neu auf (siehe DependencyAssistant), und die Auswahl ginge verloren.
  const hashFor = (id: string | null | undefined) => {
    if (!id) return "";
    return window.location.hash === `#${id}${CHAT_SUFFIX}` ? `#${id}${CHAT_SUFFIX}` : `#${id}`;
  };
  const writeHash = (id: string | null | undefined) => {
    const next = `${window.location.pathname}${window.location.search}${hashFor(id)}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  };
  const shownId = !adding && (picked || !mobile) ? selected?.id : null;
  useEffect(() => {
    if (pendingHash.current && pendingHash.current !== shownId && visible.some((s) => s.id === pendingHash.current)) return;
    pendingHash.current = null;
    writeHash(shownId);
  }, [items, shownId]);
  const choose = (nextFilter: ServiceFilter, nextQuery = query) => { setFilter(nextFilter); setQuery(nextQuery); };
  const select = (id: string) => { pendingHash.current = null; setSelectedId(id); setPicked(true); setAdding(false); writeHash(id); };
  // Handy: Tipp auf den offenen Dienst klappt ihn zu. Beim Wechsel klappt der
  // vorige zu und alles darunter rutscht hoch, deshalb die angetippte Zeile
  // danach direkt unter die Kopfleiste holen.
  const scrollTarget = useRef<string | null>(null);
  const tapRow = (id: string, active: boolean) => {
    if (mobile && active) { pendingHash.current = null; setPicked(false); writeHash(null); return; }
    if (mobile) scrollTarget.current = id;
    select(id);
  };
  useEffect(() => {
    const id = scrollTarget.current;
    if (!id) return;
    scrollTarget.current = null;
    const row = document.querySelector<HTMLElement>(`[data-service-row="${id}"]`);
    if (!row) return;
    const bar = document.querySelector(".app-topbar")?.getBoundingClientRect().height ?? 0;
    const top = row.getBoundingClientRect().top + window.scrollY - bar - 8;
    // Nur korrigieren, wenn die Zeile weggerutscht ist, nicht bei jedem Tipp springen.
    if (row.getBoundingClientRect().top < bar || row.getBoundingClientRect().top > window.innerHeight * 0.6) window.scrollTo({ top, behavior: "smooth" });
  }, [shownId]);

  const picker = <ServicePicker pool={pool} connections={connections} onCancel={items.length ? () => setAdding(false) : null}
    onAdded={(ids) => { setAdding(false); setFilter("all"); setSelectedId(`app-${ids[0]}`); setPicked(true); }} />;
  const panel = (s: (typeof services)[number]) => <article id={s.id} className="panel service-panel" aria-label={_t(_locale, "ServicesBrowser.m0d7024677d", { value0: s.name })}>
    <header className="service-panel-head">
      <h2>{s.name}</h2>
      <p className="service-meta">{s.domain ? <a href={`https://${s.domain}`} target="_blank" rel="noreferrer">{s.domain} ↗</a> : _t(_locale, "ServicesBrowser.m6e1bd4fbc6")} · {s.meta}</p>
      <ServiceTimes monitors={s.monitors} />
    </header>
    <ServiceStatusSection applicationId={s.applicationId} monitors={s.monitors} mergeMonitors={s.mergeMonitors} readOnly={s.missing} hasRepo={s.hasRepo} hasWatch={s.hasWatch} />
    {s.detail}
  </article>;

  return <>
    {batchOpen && <BatchUpdatePicker services={batch.services} manualDeploy={batch.manualDeploy} hasClaude={batch.hasClaude} hasLocalNode={batch.hasLocalNode} localNodeOnline={batch.localNodeOnline} onCancel={() => setBatchOpen(false)} />}
    <PageHeader title={_t(_locale, "ServicesBrowser.ma6f5acc69d")} description={_t(_locale, "ServicesBrowser.m39f9bd86e2")} icon="layers" actions={<>
      <nav className="view-toggle" aria-label={_t(_locale, "ServicesBrowser.ma6d6105cf9")}><Link href="/services" aria-current="page">{_t(_locale, "ServicesBrowser.m7343841e72")}</Link><Link href="/services?view=sphere">{_t(_locale, "ServicesBrowser.mc9e8a01ef4")}</Link></nav>
      {batch.activeId ? <Link href={`/batch/${batch.activeId}`} className="btn btn--ghost"><Icon name="refresh" size={18} />{_t(_locale, "BatchUpdate.running")}</Link>
        : batch.services.length > 0 && <button type="button" className="btn btn--ghost" onClick={() => setBatchOpen(true)}><Icon name="refresh" size={18} />{_t(_locale, "BatchUpdate.button")}<span className="service-new-count">{batch.services.length}</span></button>}
      <button type="button" className="btn" onClick={() => { setAdding(true); setPicked(true); }}><Icon name="plus" size={18} />{_t(_locale, "ServicesBrowser.m99645c3124")}{newCount > 0 && <span className="service-new-count">{newCount} {_t(_locale, "ServicesBrowser.m9897e61a32")}</span>}</button>
    </>} />
    {!items.length ? <div className="inventory-workspace">
      <div className="grid content-start gap-5">
        <section className="panel service-empty"><Icon name="layers" size={34} /><h2>{_t(_locale, "ServicesBrowser.maa42243de2")}</h2><p>{_t(_locale, "ServicesBrowser.m11771fce23")}</p>{mobile && picker}</section>
        {(others.length > 0 || !connections.length) && <div className="panel inventory-list"><OtherMonitors monitors={others} always /></div>}
      </div>
      {!mobile && picker}
    </div> : <div className="inventory-workspace">
      <section className="panel inventory-list" aria-label={_t(_locale, "ServicesBrowser.ma6f5acc69d")}>
        {mobile && adding && picker}
        <div className="inventory-toolbar">
          <label className="inventory-search"><Icon name="search" /><input type="search" aria-label={_t(_locale, "ServicesBrowser.m9c5d49669c")} placeholder={_t(_locale, "ServicesBrowser.m787d7e3b4c")} value={query} onChange={(e) => choose(filter, e.target.value)} /></label>
          <nav className="inventory-tabs" aria-label={_t(_locale, "ServicesBrowser.m638e249f4a")}>{FILTERS(_locale).map((f) => <a key={f.id} href={`?filter=${f.id}`} aria-current={filter === f.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); choose(f.id); }}>{f.label} <span className="ml-1">{counts[f.id]}</span></a>)}</nav>
        </div>
        <div className="service-row service-columns" role="row">{([["name", _t(_locale, "ServicesBrowser.mecc4f77cf2"), ""], ["status", _t(_locale, "ServicesBrowser.m920e413c7d"), ""], ["update", "Update", ""]] as const).map(([key, label, cls]) =>
          <button key={key} type="button" role="columnheader" className={`service-sort ${cls}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
            onClick={() => setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }))}>
            {label}{sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
          </button>)}</div>
        {!visible.length && !others.length && <p className="p-8 text-center text-sm text-[var(--fg-dim)]">{_t(_locale, "ServicesBrowser.mbf7582ae25")}</p>}
        {visible.map((s, index) => {
          const meta = STATUS_META(_locale)[s.status];
          const groupStart = index === 0 || visible[index - 1].group !== s.group;
          const groupSize = groupStart ? visible.filter((v) => v.group === s.group).length : 0;
          const active = !adding && selected?.id === s.id && (picked || !mobile);
          return <Fragment key={s.id}>
            {groupStart && <div className="inventory-group service-group" role="presentation">{SERVICE_GROUPS(_locale).find((g) => g.id === s.group)?.label.toUpperCase()} · {groupSize}</div>}
            <a href={`#${s.id}`} className={`service-row${s.missing ? " service-row--missing" : ""}`} aria-current={active ? "true" : undefined} aria-label={_t(_locale, "ServicesBrowser.m0d7024677d", { value0: s.name })}
              data-service-row={s.id} aria-expanded={mobile ? active : undefined}
              onClick={(e) => { e.preventDefault(); tapRow(s.id, active); }}>
              <span className="inventory-row-name"><span className="inventory-app-icon"><Icon name="layers" size={19} /></span><span className="min-w-0"><span className="inventory-row-title">{s.name}</span><span className="inventory-row-domain">{s.missing ? _t(_locale, "ServicesBrowser.mdffddcba6d") : s.domain ?? _t(_locale, "ServicesBrowser.m6e1bd4fbc6")}</span></span></span>
              <span className="inventory-row-status"><span className={`led led--${meta.cls}`} />{meta.label}
                {s.tally && <span className={`service-tally service-tally--${s.tally.level}`} title={_t(_locale, "ServicesBrowser.md73ff0c8de", { value0: s.tally.ok, value1: s.tally.total })}>{s.tally.ok}/{s.tally.total}</span>}</span>
              <span><UpdateChip item={s} /></span>
            </a>
            {mobile && active && <div className="inventory-mobile-detail">{panel(s)}</div>}
          </Fragment>;
        })}
        <OtherMonitors monitors={others} />
      </section>
      {!mobile && (adding ? <div ref={detailRef} className="inventory-desktop-detail">{picker}</div> : selected && <div key={selected.id} ref={detailRef} className="inventory-desktop-detail">{panel(selected)}</div>)}
    </div>}
  </>;
}
