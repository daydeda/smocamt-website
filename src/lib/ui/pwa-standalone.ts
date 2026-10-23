// Pure predicates for the iOS Web Push restriction: Safari only allows
// Notification.requestPermission() from a PWA the user has added to their
// home screen — calling it from a normal Safari tab fails silently (no
// prompt, no error). Kept pure (inputs passed in, no `navigator`/`window`
// reads inside) so the logic is unit-testable; callers read the actual
// browser state and pass it in.

/**
 * @param maxTouchPoints `navigator.maxTouchPoints`. Since iPadOS 13, iPad Safari asks for the
 *   desktop site by default and sends a "Macintosh" user agent, so the only tell is a Mac
 *   that has a touch screen (no Mac does). Omitted in callers that only have a user agent.
 */
export function isIOSUserAgent(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * @param standalone Whether the page is currently running installed/standalone —
 *   the caller derives this from
 *   `window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.
 */
export function isPushPermissionRequestable(userAgent: string, standalone: boolean, maxTouchPoints = 0): boolean {
  if (!isIOSUserAgent(userAgent, maxTouchPoints)) return true;
  return standalone;
}
