// Pure predicates for the iOS Web Push restriction: Safari only allows
// Notification.requestPermission() from a PWA the user has added to their
// home screen — calling it from a normal Safari tab fails silently (no
// prompt, no error). Kept pure (inputs passed in, no `navigator`/`window`
// reads inside) so the logic is unit-testable; callers read the actual
// browser state and pass it in.

export function isIOSUserAgent(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent);
}

/**
 * @param standalone Whether the page is currently running installed/standalone —
 *   the caller derives this from
 *   `window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.
 */
export function isPushPermissionRequestable(userAgent: string, standalone: boolean): boolean {
  if (!isIOSUserAgent(userAgent)) return true;
  return standalone;
}
