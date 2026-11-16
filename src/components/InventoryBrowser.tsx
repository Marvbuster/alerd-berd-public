"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface InventoryItem {
  id: string; name: string; domains: string | null; status: string | null;
  group: "linked" | "unlinked" | "missing"; monitorNames: string[];
  hidden: boolean;
  repository: string | null;
  version: string | null; comparison: "match" | "mismatch" | "unknown" | null;
  detail: ReactNode;
}
const views = [
  { id: "all", label: "Apps", tab: "Alle", icon: "grid" },
  { id: "linked", label: "Verknüpft", tab: "Verknüpft", icon: "link" },
  { id: "unlinked", label: "Ohne Monitor", tab: "Ohne Monitor", icon: "monitor" },
  { id: "missing", label: "Nicht gefunden", tab: "Nicht gefunden", icon: "alert" },
  { id: "hidden", label: "Ausgeblendet", tab: "Ausgeblendet", icon: "eyeOff" },
] as const;
type View = typeof views[number]["id"];

export function applicationStatus(status: string | null, missing: boolean) {
  if (missing) return { label: "Nicht gefunden", cls: "unknown" };
  if (status === "running:healthy" || status === "running" || status === "running:unknown") return { label: "Online", cls: "up" };
  if (status?.startsWith("running") || status?.startsWith("starting") || status?.startsWith("restarting")) return { label: "Prüfen", cls: "degraded" };
  if (status?.startsWith("exited") || status?.startsWith("stopped")) return { label: "Offline", cls: "down" };
  return { label: "Unbekannt", cls: "unknown" };
}

const subscribeMobile = (callback: () => void) => {
  const query = window.matchMedia("(max-width: 800px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

export function InventoryBrowser({ items, initialView, initialQuery }: { items: InventoryItem[]; initialView: string; initialQuery: string }) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [view, setView] = useState<View>(views.some((v) => v.id === initialView) ? initialView as View : "all");
  const [query, setQuery] = useState(initialQuery);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia("(max-width: 800px)").matches, () => false);
  useEffect(() => {
    setView(views.some((v) => v.id === initialView) ? initialView as View : "all");
    setQuery(initialQuery);
  }, [initialView, initialQuery]);
  useEffect(() => {
    const syncSelection = () => {
      if (window.location.hash.startsWith("#app-")) {
        const id = window.location.hash.slice(5);
        setSelectedId(id);
        if (itemsRef.current.find((item) => item.id === id)?.hidden) setView("hidden");
      }
    };
    const syncLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const nextView = params.get("view");
      setView(views.some((v) => v.id === nextView) ? nextView as View : "all");
      setQuery(params.get("q") ?? "");
      syncSelection();
    };
    syncSelection();
    window.addEventListener("hashchange", syncSelection);
    window.addEventListener("popstate", syncLocation);
    return () => { window.removeEventListener("hashchange", syncSelection); window.removeEventListener("popstate", syncLocation); };
  }, []);
  const visible = items.filter((item) => (view === "hidden" ? item.hidden : !item.hidden && (view === "all" || item.group === view)) && `${item.name} ${item.domains ?? ""} ${item.repository ?? ""} ${item.monitorNames.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  const active = items.filter((i) => !i.hidden);
  const counts = { all: active.length, linked: active.filter((i) => i.group === "linked").length, unlinked: active.filter((i) => i.group === "unlinked").length, missing: active.filter((i) => i.group === "missing").length, hidden: items.length - active.length };
  function url(nextView = view, nextQuery = query, id = selected?.id) {
    const params = new URLSearchParams();
    if (nextView !== "all") params.set("view", nextView);
    if (nextQuery) params.set("q", nextQuery);
    return `/coolify${params.size ? `?${params}` : ""}${id ? `#app-${id}` : ""}`;
  }
  // Ein offener Update-Chat (?update=<appId>) gehört zur gewählten App und
  // bleibt beim Umschreiben der URL erhalten. Nur clientseitig, nie im href.
  function keepChat(target: string, id = selected?.id) {
    const chat = new URLSearchParams(window.location.search).get("update");
    if (!chat || chat !== id) return target;
    const [path, hash = ""] = target.split("#");
    return `${path}${path.includes("?") ? "&" : "?"}update=${encodeURIComponent(chat)}${hash ? `#${hash}` : ""}`;
  }
  function filter(nextView: View, nextQuery = query) {
    setView(nextView); setQuery(nextQuery);
    window.history.replaceState(window.history.state, "", url(nextView, nextQuery));
  }
  // Revalidated server actions can restore the route's previous canonical URL.
  // Keep the current client selection and filters when refreshed items arrive.
  const selectedUrl = url();
  useEffect(() => {
    window.history.replaceState(window.history.state, "", keepChat(selectedUrl));
  }, [items, selectedUrl]);
  return <>
    <nav className="summary-strip" aria-label="Inventar filtern">{views.filter((v) => v.id !== "hidden").map((v) => <a key={v.id} href={url(v.id)} aria-current={view === v.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); filter(v.id); }}><Icon name={v.icon} size={23} /><span><strong>{counts[v.id]}</strong> {v.label}</span></a>)}</nav>
    <div className="inventory-workspace">
      <section className="panel inventory-list" aria-label="Anwendungen">
        <div className="inventory-toolbar"><label className="inventory-search"><Icon name="search" /><input type="search" aria-label="Apps oder Monitore suchen" placeholder="Apps durchsuchen …" value={query} onChange={(e) => filter(view, e.target.value)} /></label><nav className="inventory-tabs" aria-label="App-Ansicht">{views.filter((v) => (v.id !== "missing" && v.id !== "hidden") || counts[v.id] || view === v.id).map((v) => <a key={v.id} href={url(v.id)} aria-current={view === v.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); filter(v.id); }}>{v.tab} <span className="ml-1">{counts[v.id]}</span></a>)}</nav></div>
        <div className="inventory-columns" aria-hidden="true"><span>Anwendung</span><span>Status</span><span className="inventory-monitor-column">Monitor</span><span>Next.js</span></div>
        {!visible.length && <p className="p-8 text-center text-sm text-[var(--fg-dim)]">{view === "hidden" && !counts.hidden ? "Keine ausgeblendeten Apps." : view !== "hidden" && !active.length && counts.hidden ? "Alle Apps sind ausgeblendet. Unter „Ausgeblendet“ kannst du sie wieder einblenden." : items.length ? "Keine Apps für diesen Filter gefunden." : "Verbinde Coolify, um deine Apps zu importieren."}</p>}
        {visible.map((item, index) => {
          const status = applicationStatus(item.status, item.group === "missing");
          const active = selected?.id === item.id;
          return <Fragment key={item.id}>
            {(index === 0 || view !== "hidden" && visible[index - 1].group !== item.group) && <div className="inventory-group">{view === "hidden" ? "AUSGEBLENDET" : item.group === "linked" ? "VERKNÜPFTE APPS" : item.group === "unlinked" ? "OHNE MONITOR" : "NICHT MEHR GEFUNDEN"} · {view === "hidden" ? counts.hidden : counts[item.group]}</div>}
            <a href={url(view, query, item.id)} className={`inventory-row inventory-row--${item.group}`} aria-label={`Details zu ${item.name}`} aria-current={active ? "true" : undefined} aria-controls={active ? `app-${item.id}` : undefined} onClick={(e) => { e.preventDefault(); setSelectedId(item.id); window.history.replaceState(window.history.state, "", url(view, query, item.id)); }}>
              <span className="inventory-row-name"><span className="inventory-app-icon"><Icon name={item.group === "linked" ? "layers" : "monitor"} size={20} /></span><span className="min-w-0"><span className="inventory-row-title">{item.name}</span><span className="inventory-row-domain">{item.domains?.replace(/https?:\/\//g, "") || "Keine Domain"}</span></span></span>
              <span className="inventory-row-status" title={item.status ?? "Kein Coolify-Status"}><span className={`led led--${status.cls}`} />{status.label}</span>
              <span className="inventory-monitor-column break-words text-[var(--fg-dim)]">{item.monitorNames.length ? item.monitorNames.join(", ") : "Monitor zuordnen"}</span>
              <span className={item.comparison === "match" ? "text-[var(--up)]" : item.comparison === "mismatch" ? "text-[var(--amber)]" : "text-[var(--fg-dim)]"} title={item.comparison === "match" ? "Git und Runtime stimmen überein" : item.comparison === "mismatch" ? "Git und Runtime weichen ab" : "Runtime-Version"}>{item.version ?? "—"}{item.comparison === "match" ? " ✓" : item.comparison === "mismatch" ? " !" : ""}</span>
            </a>
            {mobile && active && <div className="inventory-mobile-detail">{item.detail}</div>}
          </Fragment>;
        })}
      </section>
      {!mobile && selected && <div key={selected.id} className="inventory-desktop-detail sticky top-5">{selected.detail}</div>}
    </div>
  </>;
}
