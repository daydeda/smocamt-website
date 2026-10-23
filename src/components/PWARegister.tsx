"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { resyncPushSubscription } from "@/lib/push/push-client";

// Don't hit the server on every tab switch: at most once per half hour.
const RESYNC_MIN_INTERVAL_MS = 30 * 60 * 1000;

// Registers the installability-only service worker (public/sw.js). Skipped
// in dev so a stale worker never masks live-reloaded changes behind a cached
// tab; production is the only place installability matters anyway.
//
// Also keeps a signed-in user's push subscription alive on the server: it is
// re-sent when the app opens and each time it returns to the foreground (see
// resyncPushSubscription for why iOS needs this).
export function PWARegister() {
  const { status } = useSession();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (status !== "authenticated") return;

    let lastRun = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastRun < RESYNC_MIN_INTERVAL_MS) return;
      lastRun = now;
      void resyncPushSubscription();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status]);

  return null;
}
