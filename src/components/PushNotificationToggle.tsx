"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { PUSH_TEST_TYPES, pushTestLabel, type PushTestType } from "@/lib/push/push-test-samples";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  canRequestPushPermission,
  disablePushNotifications,
  enablePushNotifications,
  getExistingPushSubscription,
  isPushSupported,
  needsIosInstall,
} from "@/lib/push/push-client";

type Status = "loading" | "unsupported" | "ios-not-installed" | "denied" | "off" | "on";

/**
 * A single on/off toggle — no per-category preferences (Phase 1 scope, see
 * docs/features/push-notifications.md). Never calls requestPermission() on
 * mount; only from this component's own click handler, since browsers
 * penalise (and iOS Safari silently no-ops) a permission prompt not tied to
 * a user gesture.
 */
export function PushNotificationToggle({ showTest = false }: { showTest?: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Before the support check: an iPhone Safari tab reports no push support at all, but
      // the right message there is "add to home screen first", not nothing.
      if (needsIosInstall()) {
        if (!cancelled) setStatus("ios-not-installed");
        return;
      }
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
    // A network or service-worker error must not leave the button stuck on busy.
    const result = await enablePushNotifications().catch((err) => {
      console.warn("[push] enable failed:", err);
      return { ok: false as const, reason: "save-failed" as const };
    });
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
    // Inline on purpose: the profile page's .form-card styles are scoped to that page file
    // and never reached this component, so the card rendered bare and touched the next section.
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 24,
        padding: "24px 20px",
        marginBottom: 32,
        boxShadow: "0 10px 30px rgb(var(--shadow-rgb) / 0.04)",
      }}
    >
      <h2
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 18,
          fontWeight: 800,
          margin: "0 0 8px",
          textTransform: "none",
          letterSpacing: "normal",
          color: "var(--text-primary)",
        }}
      >
        <Bell size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
        {t.pushNotifTitle}
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>{t.pushNotifDesc}</p>

      {status === "ios-not-installed" && (
        <p style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-elevated)", padding: 12, borderRadius: "var(--radius-md)" }}>
          {t.pushNotifIOSInstallFirst}
        </p>
      )}

      {status === "denied" && (
        <p style={{ fontSize: 13, color: "var(--red-500)" }}>{t.pushNotifDenied}</p>
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

      {error && <p style={{ fontSize: 13, color: "var(--red-500)", marginTop: 8 }}>{t.pushNotifError}</p>}

      {showTest && status === "on" && <PushTestPanel />}
    </div>
  );
}

type TestOutcome =
  | { kind: "ok"; devices: number; results: { deviceId: string; ok: boolean; statusCode?: number; message?: string }[] }
  | { kind: "error"; message: string };

/**
 * Admin-only diagnostic: sends a sample of any notification type to THIS user's own
 * devices and shows what each device returned. See POST /api/notifications/push/test.
 */
function PushTestPanel() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const uiLang = th ? "th" : "en";
  const [type, setType] = useState<PushTestType>("basic");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  async function send() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/notifications/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = Array.isArray(data.missing) && data.missing.length ? ` (${data.missing.join(", ")})` : "";
        setOutcome({ kind: "error", message: `${data.error ?? `HTTP ${res.status}`}${missing}` });
      } else {
        setOutcome({ kind: "ok", devices: data.devices ?? 0, results: data.results ?? [] });
      }
    } catch {
      setOutcome({ kind: "error", message: th ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" : "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 4px" }}>
        {th ? "ทดสอบการแจ้งเตือน (แอดมิน)" : "Test notifications (admin)"}
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
        {th
          ? "ส่งตัวอย่างการแจ้งเตือนไปยังอุปกรณ์ของคุณเองเท่านั้น ไม่ส่งถึงผู้อื่น"
          : "Sends a sample to your own devices only. Nobody else is notified."}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PushTestType)}
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 14, maxWidth: "100%" }}
        >
          {PUSH_TEST_TYPES.map((tp) => (
            <option key={tp} value={tp}>{pushTestLabel(tp, uiLang)}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {th ? "ส่งทดสอบ" : "Send test"}
        </button>
      </div>

      {outcome?.kind === "error" && (
        <p style={{ fontSize: 13, color: "var(--red-500)", marginTop: 10 }}>{outcome.message}</p>
      )}
      {outcome?.kind === "ok" && (
        <div style={{ fontSize: 13, marginTop: 10, color: "var(--text-secondary)" }}>
          {outcome.devices === 0 ? (
            <p style={{ color: "var(--red-500)", margin: 0 }}>
              {th ? "ไม่พบอุปกรณ์ที่สมัครรับการแจ้งเตือนของบัญชีนี้ในเซิร์ฟเวอร์ ลองปิดแล้วเปิดการแจ้งเตือนใหม่" : "The server has no subscribed device for this account. Switch notifications off and on again."}
            </p>
          ) : (
            outcome.results.map((r, i) => (
              <p key={r.deviceId} style={{ margin: "0 0 4px", color: r.ok ? "var(--emerald-500)" : "var(--red-500)" }}>
                {th ? "อุปกรณ์" : "Device"} {i + 1}:{" "}
                {r.ok
                  ? th ? "ส่งแล้ว ควรเห็นการแจ้งเตือนภายในไม่กี่วินาที" : "sent, the notification should appear within seconds"
                  : `${th ? "ล้มเหลว" : "failed"}${r.statusCode ? ` (${r.statusCode})` : ""}${r.message ? `: ${r.message}` : ""}`}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}
