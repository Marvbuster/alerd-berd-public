// Alerd Berd Service Worker — zeigt Push-Benachrichtigungen an.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Alerd Berd", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Alerd Berd";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      tag: data.tag || undefined,
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
      badge: undefined,
      requireInteraction: data.status === "DOWN",
    }),
  );
});

// Klick öffnet das Ziel der Meldung (etwa Dienst und Update-Chat) im offenen
// Fenster oder in einem neuen. Nur eigene Pfade, keine fremden URLs.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("navigate" in c && new URL(c.url).origin === self.location.origin) return c.focus().then(() => c.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});
