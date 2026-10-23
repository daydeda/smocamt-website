// Post-login return address. Only same-site absolute paths are honoured, so a
// crafted /login?callbackUrl=https://evil.example can never become an open redirect.

/** Returns the path if it is a safe same-site path, otherwise null. */
export function safeCallbackPath(value: string | null | undefined): string | null {
  if (!value) return null;
  // Must be a single-slash absolute path: rejects "//host", "/\host", "https://...", "javascript:".
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // No control characters or backslashes (browsers treat "\" like "/").
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  // Never bounce back to the login page itself.
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return null;
  return value;
}

/** Link to the login page that returns the visitor to `returnTo` afterwards. */
export function loginHref(returnTo: string): string {
  const safe = safeCallbackPath(returnTo);
  return safe ? `/login?callbackUrl=${encodeURIComponent(safe)}` : "/login";
}
