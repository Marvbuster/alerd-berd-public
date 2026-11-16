"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

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
function views(_locale: string = "de") { return ([
  { id: "all", label: _t(_locale, "InventoryBrowser.m89dd748442"), tab: _t(_locale, "InventoryBrowser.m3801a35c51"), icon: "grid" },
  { id: "linked", label: _t(_locale, "InventoryBrowser.mbced59c1e0"), tab: _t(_locale, "InventoryBrowser.mbced59c1e0"), icon: "link" },
  { id: "unlinked", label: _t(_locale, "InventoryBrowser.m84d966d03f"), tab: _t(_locale, "InventoryBrowser.m84d966d03f"), icon: "monitor" },
  { id: "missing", label: _t(_locale, "InventoryBrowser.m621ca4c037"), tab: _t(_locale, "InventoryBrowser.m621ca4c037"), icon: "alert" },
  { id: "hidden", label: _t(_locale, "InventoryBrowser.m51101450d9"), tab: _t(_locale, "InventoryBrowser.m51101450d9"), icon: "eyeOff" },
] as const); }
type View = ReturnType<typeof views>[number]["id"];

export function applicationStatus(status: string | null, missing: boolean, _locale: string = "de") {
  if (missing) return { label: _t(_locale, "InventoryBrowser.m621ca4c037"), cls: "unknown" };
  if (status === "running:healthy" || status === "running" || status === "running:unknown") return { label: _t(_locale, "InventoryBrowser.m0d21bd5202"), cls: "up" };
  if (status?.startsWith("running") || status?.startsWith("starting") || status?.startsWith("restarting")) return { label: _t(_locale, "InventoryBrowser.ma1ca135759"), cls: "degraded" };
  if (status?.startsWith("exited") || status?.startsWith("stopped")) return { label: _t(_locale, "InventoryBrowser.ma1794783aa"), cls: "down" };
  return { label: _t(_locale, "InventoryBrowser.m276ffa1fb4"), cls: "unknown" };
}

const subscribeMobile = (callback: () => void) => {
  const query = window.matchMedia("(max-width: 800px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

export function InventoryBrowser({ items, initialView, initialQuery }: { items: InventoryItem[]; initialView: string; initialQuery: string }) {
  const _locale = _useLocale();
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [view, setView] = useState<View>(views(_locale).some((v) => v.id === initialView) ? initialView as View : "all");
  const [query, setQuery] = useState(initialQuery);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia("(max-width: 800px)").matches, () => false);
  useEffect(() => {
    setView(views(_locale).some((v) => v.id === initialView) ? initialView as View : "all");
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
      setView(views(_locale).some((v) => v.id === nextView) ? nextView as View : "all");
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
    <nav className="summary-strip" aria-label={_t(_locale, "InventoryBrowser.mf2d96aafe0")}>{views(_locale).filter((v) => v.id !== "hidden").map((v) => <a key={v.id} href={url(v.id)} aria-current={view === v.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); filter(v.id); }}><Icon name={v.icon} size={23} /><span><strong>{counts[v.id]}</strong> {v.label}</span></a>)}</nav>
    <div className="inventory-workspace">
      <section className="panel inventory-list" aria-label={_t(_locale, "InventoryBrowser.m39e6791e0c")}>
        <div className="inventory-toolbar"><label className="inventory-search"><Icon name="search" /><input type="search" aria-label={_t(_locale, "InventoryBrowser.m9a36bc84e6")} placeholder={_t(_locale, "InventoryBrowser.mf04fd2133a")} value={query} onChange={(e) => filter(view, e.target.value)} /></label><nav className="inventory-tabs" aria-label={_t(_locale, "InventoryBrowser.m8271625f21")}>{views(_locale).filter((v) => (v.id !== "missing" && v.id !== "hidden") || counts[v.id] || view === v.id).map((v) => <a key={v.id} href={url(v.id)} aria-current={view === v.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); filter(v.id); }}>{v.tab} <span className="ml-1">{counts[v.id]}</span></a>)}</nav></div>
        <div className="inventory-columns" aria-hidden="true"><span>{_t(_locale, "InventoryBrowser.m239a8e5faf")}</span><span>{_t(_locale, "InventoryBrowser.m920e413c7d")}</span><span className="inventory-monitor-column">{_t(_locale, "InventoryBrowser.m4c2e1df457")}</span><span>{_t(_locale, "InventoryBrowser.m30b7f8482c")}</span></div>
        {!visible.length && <p className="p-8 text-center text-sm text-[var(--fg-dim)]">{view === "hidden" && !counts.hidden ? _t(_locale, "InventoryBrowser.ma872064d66") : view !== "hidden" && !active.length && counts.hidden ? _t(_locale, "InventoryBrowser.m590b2aef6d") : items.length ? _t(_locale, "InventoryBrowser.ma3ff6aa2b1") : _t(_locale, "InventoryBrowser.m078874dd51")}</p>}
        {visible.map((item, index) => {
          const status = applicationStatus(item.status, item.group === "missing", _locale);
          const active = selected?.id === item.id;
          return <Fragment key={item.id}>
            {(index === 0 || view !== "hidden" && visible[index - 1].group !== item.group) && <div className="inventory-group">{view === "hidden" ? _t(_locale, "common.hidden") : item.group === "linked" ? _t(_locale, "InventoryBrowser.md6b5095f8e") : item.group === "unlinked" ? _t(_locale, "InventoryBrowser.m08b2b4358d") : _t(_locale, "InventoryBrowser.mfcb9431830")} · {view === "hidden" ? counts.hidden : counts[item.group]}</div>}
            <a href={url(view, query, item.id)} className={`inventory-row inventory-row--${item.group}`} aria-label={_t(_locale, "InventoryBrowser.m0d7024677d", { value0: item.name })} aria-current={active ? "true" : undefined} aria-controls={active ? `app-${item.id}` : undefined} onClick={(e) => { e.preventDefault(); setSelectedId(item.id); window.history.replaceState(window.history.state, "", url(view, query, item.id)); }}>
              <span className="inventory-row-name"><span className="inventory-app-icon"><Icon name={item.group === "linked" ? "layers" : "monitor"} size={20} /></span><span className="min-w-0"><span className="inventory-row-title">{item.name}</span><span className="inventory-row-domain">{item.domains?.replace(/https?:\/\//g, "") || _t(_locale, "InventoryBrowser.m6e1bd4fbc6")}</span></span></span>
              <span className="inventory-row-status" title={item.status ?? _t(_locale, "InventoryBrowser.m719ae8c499")}><span className={`led led--${status.cls}`} />{status.label}</span>
              <span className="inventory-monitor-column break-words text-[var(--fg-dim)]">{item.monitorNames.length ? item.monitorNames.join(", ") : _t(_locale, "InventoryBrowser.me65dd53409")}</span>
              <span className={item.comparison === "match" ? "text-[var(--up)]" : item.comparison === "mismatch" ? "text-[var(--amber)]" : "text-[var(--fg-dim)]"} title={item.comparison === "match" ? _t(_locale, "InventoryBrowser.m250fa2ae97") : item.comparison === "mismatch" ? _t(_locale, "InventoryBrowser.m8fed6cec0c") : _t(_locale, "common.runtimeVersion")}>{item.version ?? "—"}{item.comparison === "match" ? " ✓" : item.comparison === "mismatch" ? " !" : ""}</span>
            </a>
            {mobile && active && <div className="inventory-mobile-detail">{item.detail}</div>}
          </Fragment>;
        })}
      </section>
      {!mobile && selected && <div key={selected.id} className="inventory-desktop-detail sticky top-5">{selected.detail}</div>}
    </div>
  </>;
}
