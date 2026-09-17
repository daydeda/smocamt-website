// Installability-only service worker — deliberately does NO caching.
//
// ActiveCAMT serves PDPA-sensitive data (medical detail, audit logs, payment
// slips) and a live attendance QR that must never be stale. Caching any of
// that in Cache Storage on a shared/lab device would be a PDPA exposure, so
// this worker exists only to make the app installable (Add to Home Screen,
// standalone window) — every request still goes straight to the network.
// If offline support for specific low-risk pages is ever wanted, add a
// narrow allow-list cache here rather than caching broadly.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// --- Web Push -----------------------------------------------------------
// Adds no caching (still installability-only per the comment above) — this
// just displays a notification and focuses/opens the app on click.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  // Always show SOMETHING — a push with no visible notification gets Chrome's
  // own generic "this site was updated in the background" banner instead.
  const title = data.title || "ActiveCAMT";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (new URL(client.url).pathname === targetUrl.pathname && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl.pathname + targetUrl.search);
      }
    })
  );
});

// Best-effort re-subscribe when the browser rotates a subscription on its own
// (key rotation, storage pressure). Fetches the public key from an endpoint
// instead of an inlined value because this is a static file, not processed
// by the Next.js build — it can't read env vars. Silently gives up on
// failure (e.g. the session has since expired); the next foreground visit's
// permission check can also resubscribe.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch("/api/notifications/push/vapid-key");
        if (!keyRes.ok) return;
        const { publicKey } = await keyRes.json();
        const newSubscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch("/api/notifications/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSubscription.toJSON()),
        });
      } catch {
        // best-effort only
      }
    })()
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
