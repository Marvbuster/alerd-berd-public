"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { pushState, subscribePush, type PushState } from "@/lib/push-client";
import { markDependencySeen } from "@/app/coolify/dependency-actions";
import type { DependencyNotification } from "@/lib/dependency-notifications";
import { ago, CHAT_SUFFIX, elapsed } from "@/lib/dependency-phase";
import { StateChip } from "./QueueBoard";

// Andere Komponenten (Update-Chat) melden hierüber, dass sich etwas geändert hat.
export const NOTIFICATIONS_EVENT = "alerd:notifications";
const BUSY = new Set(["worker", "waiting"]);

export function NotificationHub({ initial }: { initial: DependencyNotification[] }) {
  const _locale = _useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const unreadRef = useRef(initial.filter((i) => i.unread).length);
  const busy = items.some((i) => BUSY.has(i.actor));
  const unread = items.filter((i) => i.unread).length;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { items: DependencyNotification[] };
      const next = data.items.filter((i) => i.unread).length;
      // Neue ungelesene Meldung: Glocke kurz anschlagen lassen.
      if (next > unreadRef.current) { setRing(true); window.setTimeout(() => setRing(false), 1_200); }
      unreadRef.current = next;
      setItems(data.items);
    } catch { /* offline: beim nächsten Poll erneut */ }
  }, []);

  // Schnell pollen, solange etwas läuft, sonst gemächlich; im Hintergrund-Tab gar nicht.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(tick, busy ? 5_000 : 30_000);
    window.addEventListener(NOTIFICATIONS_EVENT, tick);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); window.removeEventListener(NOTIFICATIONS_EVENT, tick); document.removeEventListener("visibilitychange", tick); };
  }, [busy, load]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), busy ? 1_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [open, busy]);

  // Zähler im Tab-Titel, damit man ihn auch im Hintergrund-Tab sieht. Next
  // setzt den Titel bei Navigation und Metadata-Streaming neu, daher beobachten.
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\) /, "");
      const next = unread ? `(${unread}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [unread, pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const go = async (item: DependencyNotification) => {
    setOpen(false);
    setItems((list) => list.map((i) => i.jobId === item.jobId ? { ...i, unread: false } : i));
    unreadRef.current = Math.max(0, unreadRef.current - (item.unread ? 1 : 0));
    void markDependencySeen([item.jobId]);
    // Schon auf /services: nur den Hash setzen. Das löst ein echtes hashchange aus,
    // Liste und Update-Chat reagieren darauf. router.push mit gleichem Pfad lädt
    // dagegen nur neu, ohne Dienst und Modal zu wechseln.
    // In der Warteschlange bleiben und den Chat dort öffnen.
    if (window.location.pathname === "/queue") { router.push(`/queue?chat=${encodeURIComponent(item.applicationId)}`, { scroll: false }); return; }
    const hash = `#app-${item.applicationId}${CHAT_SUFFIX}`;
    if (window.location.pathname === "/services") {
      if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
      else window.location.hash = hash;
    } else router.push(`/services${hash}`);
  };
  const markAll = () => {
    const ids = items.filter((i) => i.unread).map((i) => i.jobId);
    setItems((list) => list.map((i) => ({ ...i, unread: false })));
    unreadRef.current = 0;
    void markDependencySeen(ids);
  };

  // Web Push auf diesem Gerät: Angebot unten im Panel, solange es aus ist.
  const [push, setPush] = useState<PushState | null>(null);
  const [pushMessage, setPushMessage] = useState("");
  useEffect(() => { if (open && push === null) void pushState().then(setPush).catch(() => setPush("unsupported")); }, [open, push]);
  const enablePush = async () => {
    setPushMessage("…");
    try {
      const result = await subscribePush(_locale);
      setPushMessage(result.ok ? "" : result.message);
      if (result.ok) setPush("on"); else if (Notification.permission === "denied") setPush("denied");
    } catch (e) { setPushMessage(String(e)); }
  };

  return <div className="notification-hub" ref={rootRef}>
    <button type="button" className={`icon-button notification-bell${ring ? " notification-bell--ring" : ""}`} aria-label={unread ? _t(_locale, "NotificationHub.m08a2d5226e", { value0: unread }) : _t(_locale, "common.notifications")} aria-expanded={open} onClick={() => { setOpen((v) => !v); if (!open) void load(); }}>
      <Icon name="bell" size={18} />
      {unread > 0 && <span className="notification-badge">{unread}</span>}
      {!unread && busy && <span className="notification-busy" />}
    </button>
    <div className={`notification-panel${open ? " notification-panel--open" : ""}`} role="dialog" aria-label={_t(_locale, "NotificationHub.me6a6654d17")} aria-hidden={!open}>
      <div className="notification-panel-head"><span>{_t(_locale, "NotificationHub.m22e2bada8f")}</span>{unread > 0 && <button type="button" onClick={markAll}>{_t(_locale, "NotificationHub.mfbaa45b3e5")}</button>}</div>
      {items.length === 0
        ? <p className="notification-empty">{_t(_locale, "NotificationHub.m6f4eb2f576")}</p>
        : <>{[{ title: _t(_locale, "NotificationHub.md9b1e13f3b"), list: items.filter((i) => i.unread) }, { title: _t(_locale, "NotificationHub.mc1b3878473"), list: items.filter((i) => !i.unread) }].map(({ title, list }) => list.length > 0 && <div key={title}>
          {/* Überschriften nur, wenn es beides gibt, sonst sagt der Zustand alles. */}
          {unread > 0 && unread < items.length && <p className="notification-section">{title}</p>}
          <ul>{list.map((item) => <li key={item.jobId}>
            <button type="button" className={`notification-item${item.unread ? " notification-item--unread" : ""}`} tabIndex={open ? 0 : -1} onClick={() => go(item)}>
              <span className="min-w-0 flex-1">
                <span className="notification-app"><span>{item.applicationName}</span>{item.unread && <span className="notification-new">{_t(_locale, "NotificationHub.md9b1e13f3b")}</span>}</span>
                <span className="notification-title">{item.label ?? _t(_locale, "NotificationHub.mc661b3d464", { value0: item.targetVersion })} · {item.current ?? item.title} · {BUSY.has(item.actor) && item.since ? elapsed(new Date(item.since), now) : ago(new Date(item.changedAt), now, _locale)}</span>
              </span>
              <StateChip actor={item.actor} />
            </button>
          </li>)}</ul>
        </div>)}</>}
      <Link href="/queue" className="notification-foot" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>{_t(_locale, "NotificationHub.mefe2001afd")}</Link>
      {(push === "off" || push === "denied") && <div className="notification-push">
        {push === "off"
          ? <><span>{_t(_locale, "NotificationHub.ma7be7035de")}</span><button type="button" tabIndex={open ? 0 : -1} onClick={enablePush}>{_t(_locale, "NotificationHub.mcfc6942928")}</button></>
          : <span>{_t(_locale, "NotificationHub.m0cc683db31")}</span>}
        {pushMessage && pushMessage !== "…" && <span className="notification-push-error">{pushMessage}</span>}
      </div>}
    </div>
  </div>;
}
