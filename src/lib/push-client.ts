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

export async function subscribePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) return { ok: false, message: "Browser unterstützt kein Web Push" };
  const { key } = await fetch("/api/push/public-key").then((r) => r.json());
  if (!key) return { ok: false, message: "VAPID nicht konfiguriert (VAPID_PUBLIC_KEY setzen)" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, message: perm === "denied" ? "Im Browser blockiert, in den Website-Einstellungen erlauben" : "Benachrichtigungen nicht erlaubt" };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) as BufferSource });
  const res = await fetch("/api/push/subscribe", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub, label: `Push (${navigator.platform || "Gerät"})` }),
  });
  return res.ok ? { ok: true, message: "Dieses Gerät ist abonniert" } : { ok: false, message: "Fehler beim Speichern" };
}
