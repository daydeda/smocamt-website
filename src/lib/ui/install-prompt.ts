// Pure logic for the "add to home screen + turn on notifications" pop-up
// (src/components/pwa/InstallPushPrompt.tsx, plan in docs/features/plan-home-screen.md).
// Browser state is read by the caller and passed in, so this stays unit-testable.
import { isIOSUserAgent } from "@/lib/ui/pwa-standalone";

export type InstallPromptScreen =
  | "ios-install" // iPhone/iPad Safari tab: walk through Share > Add to Home Screen
  | "in-app-browser" // LINE / Facebook / Instagram webview: can't install or get pushes
  | "android-install" // Chrome/Edge offered beforeinstallprompt: install button
  | "enable-push" // installed (or a browser that allows push in a tab): one tap to turn on
  | "denied"; // permission blocked: only the user can undo it in settings

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface InstallPromptInput {
  userAgent: string;
  /** `navigator.maxTouchPoints`: tells an iPad (desktop-style "Macintosh" user agent) from a Mac. */
  maxTouchPoints?: number;
  standalone: boolean;
  pushSupported: boolean;
  permission: PushPermission;
  hasSubscription: boolean;
  /** A beforeinstallprompt event was captured, so an "Install app" button can work. */
  canInstall: boolean;
}

const IN_APP_BROWSER = /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|TikTok|Twitter/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER.test(userAgent);
}

/** Which screen to show, or null when there is nothing this device can (or needs to) do. */
export function pickInstallScreen(input: InstallPromptInput): InstallPromptScreen | null {
  if (input.hasSubscription && input.permission === "granted") return null;
  if (isInAppBrowser(input.userAgent)) return "in-app-browser";
  if (isIOSUserAgent(input.userAgent, input.maxTouchPoints) && !input.standalone) return "ios-install";
  // Old iOS (below 16.4), desktop Safari before Web Push, and so on.
  if (!input.pushSupported) return null;
  if (input.permission === "denied") return "denied";
  if (!input.standalone && input.canInstall) return "android-install";
  return "enable-push";
}

// ── How often (per device, kept in localStorage) ────────────────────────────

export const INSTALL_PROMPT_STORAGE_KEY = "activecamt.installPrompt";
export const SNOOZE_LATER_MS = 3 * 24 * 60 * 60 * 1000;
export const SNOOZE_NEVER_MS = 14 * 24 * 60 * 60 * 1000;
/** "Don't ask again" is offered from the third time the pop-up is shown. */
export const DONT_ASK_FROM_SHOW = 3;

export interface InstallPromptMemory {
  shownCount: number;
  snoozedUntil: number;
}

export const EMPTY_MEMORY: InstallPromptMemory = { shownCount: 0, snoozedUntil: 0 };

export function parseMemory(raw: string | null): InstallPromptMemory {
  if (!raw) return EMPTY_MEMORY;
  try {
    const value = JSON.parse(raw) as Partial<InstallPromptMemory>;
    const shownCount = Number.isFinite(value.shownCount) ? Math.max(0, Number(value.shownCount)) : 0;
    const snoozedUntil = Number.isFinite(value.snoozedUntil) ? Number(value.snoozedUntil) : 0;
    return { shownCount, snoozedUntil };
  } catch {
    return EMPTY_MEMORY;
  }
}

export function isSnoozed(memory: InstallPromptMemory, now: number): boolean {
  return memory.snoozedUntil > now;
}

export function recordShown(memory: InstallPromptMemory): InstallPromptMemory {
  return { ...memory, shownCount: memory.shownCount + 1 };
}

export function snooze(memory: InstallPromptMemory, now: number, kind: "later" | "never"): InstallPromptMemory {
  return { ...memory, snoozedUntil: now + (kind === "never" ? SNOOZE_NEVER_MS : SNOOZE_LATER_MS) };
}

/** Call after recordShown: true on the third showing and later. */
export function offersDontAsk(memory: InstallPromptMemory): boolean {
  return memory.shownCount >= DONT_ASK_FROM_SHOW;
}

// ── Dev-only preview (?pwa-preview=<name>) ──────────────────────────────────
// Fakes the device state so every screen can be checked on a laptop. The
// component only reads the query param when NODE_ENV !== "production".

const PREVIEW_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const PREVIEW_IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const PREVIEW_ANDROID_TABLET_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const PREVIEW_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

const BASE_PREVIEW: InstallPromptInput = {
  userAgent: PREVIEW_ANDROID_UA,
  standalone: false,
  pushSupported: true,
  permission: "default",
  hasSubscription: false,
  canInstall: false,
};

export const INSTALL_PREVIEWS = {
  "ios-safari": { ...BASE_PREVIEW, userAgent: PREVIEW_IPHONE_UA, pushSupported: false },
  "ios-installed": { ...BASE_PREVIEW, userAgent: PREVIEW_IPHONE_UA, standalone: true },
  "ipad-safari": { ...BASE_PREVIEW, userAgent: PREVIEW_IPAD_DESKTOP_UA, maxTouchPoints: 5, pushSupported: false },
  "ipad-installed": { ...BASE_PREVIEW, userAgent: PREVIEW_IPAD_DESKTOP_UA, maxTouchPoints: 5, standalone: true },
  "android-tablet": { ...BASE_PREVIEW, userAgent: PREVIEW_ANDROID_TABLET_UA, maxTouchPoints: 5, canInstall: true },
  "mac-safari": { ...BASE_PREVIEW, userAgent: PREVIEW_IPAD_DESKTOP_UA, maxTouchPoints: 0 },
  "android-chrome": { ...BASE_PREVIEW, canInstall: true },
  "android-installed": { ...BASE_PREVIEW, standalone: true },
  "in-app": { ...BASE_PREVIEW, userAgent: `${PREVIEW_IPHONE_UA} Line/14.3.0`, pushSupported: false },
  denied: { ...BASE_PREVIEW, permission: "denied" },
  subscribed: { ...BASE_PREVIEW, permission: "granted", hasSubscription: true },
} satisfies Record<string, InstallPromptInput>;

export type InstallPreviewName = keyof typeof INSTALL_PREVIEWS;

export function parseInstallPreview(value: string | null): InstallPreviewName | null {
  return value && Object.hasOwn(INSTALL_PREVIEWS, value) ? (value as InstallPreviewName) : null;
}
