/* Neon Lobby Chat — background notification helper.
   Keep this file next to chat.html (index.html) on the same folder/domain. */
const TAG = "neon-lobby";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = list.some((c) => c.visibilityState === "visible");
    if (visible) return; // the page is open and will handle it itself
    await self.registration.showNotification("New message", {
      body: "Someone messaged you in Neon Lobby Chat.",
      tag: TAG,
      renotify: true,
      icon: "icon-192.png",
      badge: "icon-192.png",
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) return c.focus();
    }
    return self.clients.openWindow("./");
  })());
});
