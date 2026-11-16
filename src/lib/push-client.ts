import { messageCode as _code, translate } from "@/i18n/translate";
// Web Push im Browser: Berechtigung abfragen, Service Worker registrieren,
// Abo beim Server speichern. Genutzt von den Einstellungen und der Glocke.

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Ist dieses Gerät abonniert? Fragt nie nach einer Berechtigung.
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

export async function subscribePush(locale = "de"): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) return { ok: false, message: _code("actions.md8c983d9b3") };
  const { key } = await fetch("/api/push/public-key").then((r) => r.json());
  if (!key) return { ok: false, message: _code("actions.m6dc0ad18ed") };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, message: perm === "denied" ? _code("actions.mf8c683d2dd") : _code("actions.m3a2cd6347c") };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) as BufferSource });
  const res = await fetch("/api/push/subscribe", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub, label: translate(locale, "actions.pushLabel", { device: navigator.platform || translate(locale, "common.device") }) }),
  });
  return res.ok ? { ok: true, message: _code("actions.mccb114067d") } : { ok: false, message: _code("actions.mf5dae288d9") };
}
