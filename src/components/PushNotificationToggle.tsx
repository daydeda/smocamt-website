"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  canRequestPushPermission,
  disablePushNotifications,
  enablePushNotifications,
  getExistingPushSubscription,
  isPushSupported,
} from "@/lib/push-client";

type Status = "loading" | "unsupported" | "ios-not-installed" | "denied" | "off" | "on";

/**
 * A single on/off toggle — no per-category preferences (Phase 1 scope, see
 * docs/features/push-notifications.md). Never calls requestPermission() on
 * mount; only from this component's own click handler, since browsers
 * penalise (and iOS Safari silently no-ops) a permission prompt not tied to
 * a user gesture.
 */
export function PushNotificationToggle() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      if (!canRequestPushPermission()) {
        if (!cancelled) setStatus("ios-not-installed");
        return;
      }
      const existing = await getExistingPushSubscription();
      if (!cancelled) setStatus(existing ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError(false);
    const result = await enablePushNotifications();
    setBusy(false);
    if (result.ok) {
      setStatus("on");
      return;
    }
    if (result.reason === "denied") {
      setStatus("denied");
    } else if (result.reason === "ios-not-installed") {
      setStatus("ios-not-installed");
    } else {
      setError(true);
    }
  }

  async function handleDisable() {
    setBusy(true);
    await disablePushNotifications();
    setBusy(false);
    setStatus("off");
  }

  if (status === "loading" || status === "unsupported") return null;

  return (
    <div className="form-card">
      <h2 className="section-title">
        <Bell size={18} />
        {t.pushNotifTitle}
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 16px" }}>{t.pushNotifDesc}</p>

      {status === "ios-not-installed" && (
        <p style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-elevated)", padding: 12, borderRadius: "var(--radius-md)" }}>
          {t.pushNotifIOSInstallFirst}
        </p>
      )}

      {status === "denied" && (
        <p style={{ fontSize: 13, color: "#ef4444" }}>{t.pushNotifDenied}</p>
      )}

      {status === "off" && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleEnable}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
          {t.pushNotifEnable}
        </button>
      )}

      {status === "on" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{t.pushNotifEnabled}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={handleDisable}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
            {t.pushNotifDisable}
          </button>
        </div>
      )}

      {error && <p style={{ fontSize: 13, color: "#ef4444", marginTop: 8 }}>{t.pushNotifError}</p>}
    </div>
  );
}
