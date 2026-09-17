"use client";

import { useEffect } from "react";

// Registers the installability-only service worker (public/sw.js). Skipped
// in dev so a stale worker never masks live-reloaded changes behind a cached
// tab; production is the only place installability matters anyway.
export function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  return null;
}
