"use client";

import { useCallback, useRef, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import type { NotifItem } from "@/components/NotificationToasts";

/**
 * Shared client logic for live check-in / score pop-ups. Polls
 * `/api/notifications` for anything recorded since our per-user last-seen marker
 * (stored in localStorage so a page reload doesn't replay history) and returns
 * the not-yet-seen items plus a `dismiss`.
 *
 * `intervalMs` sets the cadence per surface: the Digital ID page (where the
 * student presents their QR to be scanned) polls fast so the modal feels
 * immediate; the main dashboard reuses its gentle 60s tick. `seenRef` dedups
 * across the overlapping immediate / on-focus / interval ticks so a row never
 * pops twice.
 */
export function useNotifications(userId: string | undefined, intervalMs: number) {
  const [items, setItems] = useState<NotifItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const key = userId ? `activecamt:notif-seen:${userId}` : null;

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  usePolling((signal) => {
    if (!key) return Promise.resolve();
    const since = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return fetch(`/api/notifications${qs}`, { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.notifications)) return;
        const fresh: NotifItem[] = [];
        for (const n of d.notifications) {
          if (seenRef.current.has(n.id)) continue;
          seenRef.current.add(n.id);
          fresh.push({
            id: n.id,
            type: n.type,
            eventTitle: n.eventTitle,
            points: n.points,
            link: n.link,
            songsueLinked: n.songsueLinked,
          });
        }
        if (fresh.length > 0) setItems((prev) => [...prev, ...fresh]);
        if (typeof d.serverTime === "string" && typeof window !== "undefined") {
          window.localStorage.setItem(key, d.serverTime);
        }
      })
      .catch(() => {});
  }, intervalMs);

  return { items, dismiss };
}
