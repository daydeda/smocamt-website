"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell, Check, Copy, Download, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  enablePushNotifications,
  getExistingPushSubscription,
  isPushSupported,
  isStandalone,
} from "@/lib/push/push-client";
import { isIOSUserAgent, isIPadUserAgent } from "@/lib/ui/pwa-standalone";
import {
  INSTALL_PREVIEWS,
  INSTALL_PROMPT_STORAGE_KEY,
  isSnoozed,
  offersDontAsk,
  parseInstallPreview,
  parseMemory,
  pickInstallScreen,
  recordShown,
  snooze,
  type InstallPreviewName,
  type InstallPromptMemory,
  type InstallPromptScreen,
  type PushPermission,
} from "@/lib/ui/install-prompt";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readMemory(): InstallPromptMemory {
  try {
    return parseMemory(localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY));
  } catch {
    return parseMemory(null);
  }
}

function writeMemory(memory: InstallPromptMemory) {
  try {
    localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // private mode: the pop-up just comes back next visit
  }
}

/**
 * Dev only: `?pwa-preview=ios-safari` (see INSTALL_PREVIEWS) fakes the device so every
 * screen can be checked on a laptop. Ignores the snooze, never writes it, and fakes the
 * "Turn on" result. Always null in a production build.
 */
function readPreview(): InstallPreviewName | null {
  return parseInstallPreview(new URLSearchParams(window.location.search).get("pwa-preview"));
}

function readPermission(): PushPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/**
 * Asks signed-in, onboarded users (every role) to add ActiveCAMT to their home screen
 * and turn on notifications. Mounted once in the root layout, so it shows on every page
 * after login except the two scanners (/dashboard/scan, /admin/scanner). Browsers never
 * let a site install itself or prompt without a tap, so this is a repeated nudge, not a
 * lock. Shows right away, on top of any other dialog. Per-device snooze in localStorage; see docs/features/plan-home-screen.md.
 */
export function InstallPushPrompt() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { t } = useLanguage();
  const [screen, setScreen] = useState<InstallPromptScreen | null>(null);
  const [offerNever, setOfferNever] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const installEvent = useRef<BeforeInstallPromptEvent | null>(null);
  // Shown or ruled out once per page load; snooze covers later visits.
  const settled = useRef(false);
  const [preview, setPreview] = useState<InstallPreviewName | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvent.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const onboarded = status === "authenticated" && session?.user?.profileCompleted === true;

  useEffect(() => {
    if (!onboarded || settled.current) return;
    if (pathname?.startsWith("/dashboard/scan") || pathname?.startsWith("/admin/scanner")) return;
    let cancelled = false;
    (async () => {
      // Written inline (not via a helper) so the production build drops this block.
      const previewName = process.env.NODE_ENV === "production" ? null : readPreview();
      if (previewName) {
        settled.current = true;
        const next = pickInstallScreen(INSTALL_PREVIEWS[previewName]);
        if (!next) console.info(`[pwa-preview] ${previewName}: nothing to show on this device`);
        setPreview(previewName);
        setOfferNever(true);
        setScreen(next);
        return;
      }
      const memory = readMemory();
      if (isSnoozed(memory, Date.now())) {
        settled.current = true;
        return;
      }
      const subscription = await getExistingPushSubscription().catch(() => null);
      if (cancelled) return;
      settled.current = true;
      const next = pickInstallScreen({
        userAgent: navigator.userAgent,
        standalone: isStandalone(),
        pushSupported: isPushSupported(),
        permission: readPermission(),
        hasSubscription: subscription !== null,
        maxTouchPoints: navigator.maxTouchPoints,
        canInstall: installEvent.current !== null,
      });
      if (!next) return;
      const shown = recordShown(memory);
      writeMemory(shown);
      setOfferNever(offersDontAsk(shown));
      setScreen(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [onboarded, pathname]);

  useEffect(() => {
    if (!screen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("later");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // close() only reads `preview`, which is set together with `screen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, preview]);

  function close(kind: "later" | "never" | "done") {
    if (kind !== "done" && !preview) writeMemory(snooze(readMemory(), Date.now(), kind));
    setScreen(null);
  }

  async function turnOnPush() {
    setBusy(true);
    setError(false);
    if (preview) {
      // Preview only: no real permission prompt or subscription.
      setTimeout(() => {
        setBusy(false);
        setDone(true);
      }, 600);
      return;
    }
    const result = await enablePushNotifications().catch((err) => {
      console.warn("[push] enable failed:", err);
      return { ok: false as const, reason: "save-failed" as const };
    });
    setBusy(false);
    if (result.ok) {
      setDone(true);
      setTimeout(() => close("done"), 1800);
    } else if (result.reason === "denied") {
      setScreen("denied");
    } else if (result.reason === "ios-not-installed") {
      setScreen("ios-install");
    } else if (result.reason === "no-service-worker") {
      console.warn("[pwa] No service worker on this page. On the dev server set NEXT_PUBLIC_ENABLE_SW_IN_DEV=true in .env.local and restart it.");
      setError(true);
    } else if (result.reason !== "dismissed") {
      console.warn("[push] enable failed:", result.reason);
      setError(true);
    }
  }

  async function install() {
    const ev = installEvent.current;
    if (!ev) {
      setScreen("enable-push");
      return;
    }
    setBusy(true);
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      // the dialog can only be shown once per event
    }
    installEvent.current = null;
    setBusy(false);
    setScreen("enable-push");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!screen) return null;

  const previewInput = process.env.NODE_ENV !== "production" && preview ? INSTALL_PREVIEWS[preview] : null;
  const isIOS = isIOSUserAgent(
    previewInput ? previewInput.userAgent : navigator.userAgent,
    previewInput ? previewInput.maxTouchPoints : navigator.maxTouchPoints,
  );
  const isIPad = isIPadUserAgent(
    previewInput ? previewInput.userAgent : navigator.userAgent,
    previewInput ? previewInput.maxTouchPoints : navigator.maxTouchPoints,
  );
  const title =
    screen === "ios-install"
      ? t.installPromptIosTitle
      : screen === "in-app-browser"
        ? t.installPromptInAppTitle
        : screen === "android-install"
          ? t.installPromptInstallTitle
          : screen === "denied"
            ? t.installPromptDeniedTitle
            : t.installPromptPushTitle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-prompt-title"
      style={{
        position: "fixed",
        inset: 0,
        // Above the other dashboard dialogs (profile check-in, notices at 2000): this one
        // shows immediately and covers them until answered.
        zIndex: 2100,
        background: "rgb(var(--scrim-rgb) / 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          width: "min(100%, 420px)",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          borderRadius: 28,
          padding: "28px 20px 20px",
          boxShadow: "0 30px 70px rgb(var(--shadow-rgb) / 0.35)",
          border: "1px solid var(--accent-primary)33",
        }}
      >
        {process.env.NODE_ENV !== "production" && preview && (
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "center", margin: "0 0 8px" }}>
            DEV PREVIEW: {preview}
          </p>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt=""
          width={56}
          height={56}
          style={{ display: "block", margin: "0 auto 12px", borderRadius: 14 }}
        />
        <h2 id="install-prompt-title" style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px", textAlign: "center" }}>
          {title}
        </h2>
        {screen !== "denied" && (
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px", textAlign: "center" }}>
            {screen === "android-install" ? t.installPromptInstallDesc : t.installPromptWhy}
          </p>
        )}

        {screen === "ios-install" && (
          <IosSteps
            ipad={isIPad}
            shareLabel={t.installPromptIosShareLabel}
            addLabel={t.installPromptIosAddLabel}
            steps={
              isIPad
                ? [t.installPromptIpadStep1, t.installPromptIpadStep2, t.installPromptIpadStep3, t.installPromptIosStep4]
                : [t.installPromptIosStep1, t.installPromptIosStep2, t.installPromptIosStep3, t.installPromptIosStep4]
            }
            note={isIPad ? t.installPromptIpadNote : t.installPromptIosNote}
          />
        )}

        {screen === "in-app-browser" && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 16px", textAlign: "center" }}>
            {t.installPromptInAppDesc}
          </p>
        )}

        {screen === "denied" && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 16px", textAlign: "center", background: "var(--bg-elevated)", padding: 12, borderRadius: 14 }}>
            {isIOS ? t.installPromptDeniedIos : t.installPromptDeniedOther}
          </p>
        )}

        {done && (
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--emerald-500)", margin: "0 0 12px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Check size={16} />
            {t.installPromptPushDone}
          </p>
        )}
        {error && (
          <p style={{ fontSize: 13, color: "var(--red-500)", fontWeight: 600, margin: "0 0 12px", textAlign: "center" }}>{t.pushNotifError}</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {screen === "ios-install" && (
            <button type="button" className="btn btn-primary" onClick={() => close("later")}>
              {t.installPromptIosDone}
            </button>
          )}
          {screen === "in-app-browser" && (
            <button type="button" className="btn btn-primary" onClick={copyLink}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t.installPromptCopied : t.installPromptCopyLink}
            </button>
          )}
          {screen === "android-install" && (
            <>
              <button type="button" className="btn btn-primary" onClick={install} disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {t.installPromptInstallBtn}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setScreen("enable-push")} disabled={busy}>
                {t.installPromptSkipInstall}
              </button>
            </>
          )}
          {screen === "enable-push" && !done && (
            <button type="button" className="btn btn-primary" onClick={turnOnPush} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
              {t.installPromptPushBtn}
            </button>
          )}
          {!done && (
            <button type="button" className="btn btn-ghost" onClick={() => close("later")} disabled={busy}>
              {t.installPromptLater}
            </button>
          )}
          {!done && offerNever && (
            <button
              type="button"
              onClick={() => close("never")}
              disabled={busy}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: 4 }}
            >
              {t.installPromptNever}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── iPhone steps, drawn inline so they follow the light/dark theme ──────────
// Modeled on current Safari: the floating address bar has a page-menu icon (two lines)
// on its left, the menu has "Share", and "Add to Home Screen" sits lower in the share sheet.

const stroke = { stroke: "var(--text-muted)", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const accentStroke = { ...stroke, stroke: "var(--accent-primary)" } as const;
const panel = { fill: "var(--bg-elevated)", stroke: "var(--border-subtle)", strokeWidth: 1 } as const;
const highlight = { fill: "var(--accent-primary)", fillOpacity: 0.14, stroke: "var(--accent-primary)", strokeWidth: 1.5 } as const;
const bar = { fill: "var(--text-muted)", opacity: 0.3 } as const;
const label = { fill: "var(--text-primary)", fontSize: 7.5, fontWeight: 700 } as const;
const artSvg = { width: "100%", height: "auto", display: "block" } as const;

function IosSteps({ steps, note, addLabel, shareLabel, ipad }: { steps: string[]; note: string; addLabel: string; shareLabel: string; ipad: boolean }) {
  const art = ipad
    ? [<IpadShareArt key="1" />, <ViewMoreArt key="2" />, <ShareSheetArt key="3" label={addLabel} />, <HomeScreenArt key="4" />]
    : [<PageMenuArt key="1" />, <MenuShareArt key="2" label={shareLabel} />, <ShareSheetArt key="3" label={addLabel} />, <HomeScreenArt key="4" />];
  return (
    <div style={{ marginBottom: 16 }}>
      <ol style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((text, i) => (
          <li
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 10 }}
          >
            <div style={{ flex: "0 0 36%", maxWidth: 112 }} aria-hidden="true">
              {art[i]}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--accent-primary)", marginRight: 4 }}>{i + 1}.</strong>
              {text}
            </p>
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, textAlign: "center" }}>{note}</p>
    </div>
  );
}

/** Step 1: floating address bar with the two-line page-menu icon highlighted on its left. */
function PageMenuArt() {
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <circle cx="12" cy="32" r="9" style={panel} />
      <path d="M14 29l-4 3 4 3" style={{ ...stroke, strokeWidth: 1.6 }} />
      <rect x="26" y="19" width="62" height="26" rx="13" style={panel} />
      <circle cx="39" cy="32" r="10" style={highlight} />
      <rect x="33.5" y="27" width="4.5" height="4.5" rx="1.1" style={{ ...accentStroke, strokeWidth: 1.3 }} />
      <path d="M41 29.3h4M33.5 34.5h11.5M33.5 38h11.5" style={{ ...accentStroke, strokeWidth: 1.4 }} />
      <rect x="53" y="30" width="22" height="4" rx="2" style={bar} />
      <path d="M80 30.5a4.5 4.5 0 1 0 1.2 3.4M81 28.5v3h-3" style={{ ...stroke, strokeWidth: 1.4 }} />
      <circle cx="100" cy="32" r="9" style={panel} />
      <rect x="95.5" y="28" width="7" height="7" rx="1.6" style={{ ...stroke, strokeWidth: 1.4 }} />
    </svg>
  );
}

/** iPad step 1: Safari toolbar with the Share button highlighted at the top right. */
function IpadShareArt() {
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <rect x="2" y="12" width="108" height="40" rx="10" style={panel} />
      <circle cx="14" cy="32" r="6" style={{ ...panel, opacity: 0.7 }} />
      <rect x="26" y="26" width="38" height="12" rx="6" style={bar} />
      <circle cx="80" cy="32" r="6" style={{ ...panel, opacity: 0.7 }} />
      <circle cx="98" cy="32" r="11" style={highlight} />
      <g style={{ ...accentStroke, strokeWidth: 1.5 }}>
        <path d="M98 36v-9M95 29.5l3-3 3 3" />
        <path d="M94.5 31H94a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 94 38h8a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 102 31h-.5" />
      </g>
    </svg>
  );
}

/** iPad step 2: the share sheet with the "View More" arrow highlighted. */
function ViewMoreArt() {
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <rect x="2" y="2" width="108" height="60" rx="10" style={panel} />
      <rect x="8" y="8" width="12" height="12" rx="3" style={{ fill: "var(--text-muted)", opacity: 0.25 }} />
      <rect x="24" y="10" width="40" height="4" rx="2" style={bar} />
      {[10, 30, 50].map((x) => (
        <circle key={x} cx={x + 4} cy="34" r="7" style={{ fill: "var(--text-muted)", opacity: 0.22 }} />
      ))}
      <circle cx="94" cy="34" r="11" style={highlight} />
      <path d="M88.5 36.5l5.5-5 5.5 5" style={{ ...accentStroke, strokeWidth: 2 }} />
      <rect x="10" y="50" width="92" height="6" rx="3" style={{ ...bar, opacity: 0.16 }} />
    </svg>
  );
}

/** Step 2: the page menu, with the "Share" row highlighted. */
function MenuShareArt({ label: text }: { label: string }) {
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <rect x="14" y="3" width="84" height="58" rx="10" style={panel} />
      <rect x="22" y="9" width="40" height="4" rx="2" style={bar} />
      <rect x="22" y="17" width="48" height="4" rx="2" style={bar} />
      <rect x="18" y="25" width="76" height="16" rx="6" style={highlight} />
      <g style={{ ...accentStroke, strokeWidth: 1.5 }}>
        <path d="M26 36.5v-8M23 31l3-3 3 3" />
        <path d="M22.5 31.5H22a1.5 1.5 0 0 0-1.5 1.5v4.5A1.5 1.5 0 0 0 22 39h8a1.5 1.5 0 0 0 1.5-1.5V33A1.5 1.5 0 0 0 30 31.5h-.5" />
      </g>
      <text x="37" y="36.5" style={label}>
        {text}
      </text>
      <rect x="22" y="46" width="44" height="4" rx="2" style={bar} />
      <rect x="22" y="53" width="36" height="4" rx="2" style={bar} />
    </svg>
  );
}

/** Step 3: the share sheet scrolled down, with "Add to Home Screen" highlighted. */
function ShareSheetArt({ label: text }: { label: string }) {
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <rect x="2" y="2" width="108" height="60" rx="10" style={panel} />
      <rect x="8" y="7" width="12" height="12" rx="3" style={{ fill: "var(--text-muted)", opacity: 0.25 }} />
      <rect x="24" y="9" width="40" height="4" rx="2" style={bar} />
      <rect x="24" y="15" width="26" height="3" rx="1.5" style={{ ...bar, opacity: 0.2 }} />
      <rect x="8" y="23" width="96" height="9" rx="3" style={{ ...bar, opacity: 0.16 }} />
      <rect x="6" y="35" width="100" height="16" rx="6" style={highlight} />
      <rect x="11" y="38.5" width="9" height="9" rx="2.2" style={{ ...accentStroke, strokeWidth: 1.4 }} />
      <path d="M15.5 40.8v4.4M13.3 43h4.4" style={{ ...accentStroke, strokeWidth: 1.4 }} />
      <text x="25" y="46" style={{ ...label, fontSize: 7 }}>
        {text}
      </text>
      <path d="M52 56l4 3 4-3" style={{ ...stroke, strokeWidth: 1.5, opacity: 0.6 }} />
    </svg>
  );
}

/** Step 4: the new icon on the home screen. */
function HomeScreenArt() {
  const clipId = useId();
  const cells = [14, 38, 62, 86];
  return (
    <svg viewBox="0 0 112 64" style={artSvg}>
      <defs>
        <clipPath id={clipId}>
          <rect x="62" y="34" width="18" height="18" rx="5" />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="108" height="60" rx="10" style={panel} />
      {cells.map((x) => (
        <rect key={`a${x}`} x={x} y="10" width="18" height="18" rx="5" style={{ fill: "var(--text-muted)", opacity: 0.22 }} />
      ))}
      {cells
        .filter((x) => x !== 62)
        .map((x) => (
          <rect key={`b${x}`} x={x} y="34" width="18" height="18" rx="5" style={{ fill: "var(--text-muted)", opacity: 0.22 }} />
        ))}
      <rect x="58" y="30" width="26" height="26" rx="8" style={highlight} />
      <image href="/icons/icon-192.png" x="62" y="34" width="18" height="18" clipPath={`url(#${clipId})`} />
    </svg>
  );
}
