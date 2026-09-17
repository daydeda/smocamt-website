"use client";

// Client-side Web Push helpers: permission request, subscribe/unsubscribe,
// and the sign-out cleanup hook. Kept separate from pwa-standalone.ts (the
// pure iOS predicate) so that file stays unit-testable without touching
// `navigator`/`window`/`fetch`.
import { isPushPermissionRequestable } from "@/lib/pwa-standalone";

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-not-installed" | "denied" | "dismissed" | "not-configured" | "save-failed" };

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** Whether requestPermission() can even be called right now — false only for iOS not-yet-installed (see pwa-standalone.ts). */
export function canRequestPushPermission(): boolean {
  if (!isPushSupported()) return false;
  return isPushPermissionRequestable(navigator.userAgent, isStandalone());
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Must be called from a click handler — Notification.requestPermission() requires a user gesture. */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  if (!canRequestPushPermission()) return { ok: false, reason: "ios-not-installed" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  const keyRes = await fetch("/api/notifications/push/vapid-key");
  if (!keyRes.ok) return { ok: false, reason: "not-configured" };
  const { publicKey } = await keyRes.json();

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const saveRes = await fetch("/api/notifications/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saveRes.ok) return { ok: false, reason: "save-failed" };
  return { ok: true };
}

async function unsubscribeCurrentDevice(): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await fetch("/api/notifications/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

export async function disablePushNotifications(): Promise<void> {
  await unsubscribeCurrentDevice();
}

/**
 * Call from every sign-out click handler BEFORE next-auth's signOut() runs —
 * the unsubscribe API call needs the still-authenticated session, and this
 * must be a shared-device hygiene step, not a fire-and-forget afterthought.
 * See docs/features/push-notifications.md "Sign-out cleanup — design correction".
 */
export async function unsubscribePushBeforeSignOut(): Promise<void> {
  try {
    await unsubscribeCurrentDevice();
  } catch {
    // never block sign-out on this
  }
}
