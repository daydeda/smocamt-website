import { createHash, createHmac, timingSafeEqual } from "crypto";

const WINDOW_MS = 5 * 60 * 1000;
// 32 hex chars = 128 bits of the HMAC — the floor for not worrying about
// brute-force, while keeping the QR payload small enough to scan fast.
// Bumping this invalidates in-flight tokens for at most one 5-min window.
const SIG_LEN = 32;
// Accept a token for a short grace period past its expiry. A student's screen
// shows a code that expires at the window boundary; a scan begun a second before
// expiry can reach the server just after it. Without grace, verification fails and
// the lookup falls through to legacy resolution, surfacing the confusing "Student
// not found" error. 30s comfortably covers scan + network latency.
const GRACE_MS = 30 * 1000;
// Separates the two components of a combined QR value (see signCombinedQrToken) —
// never appears inside either sub-token (both are HMAC hex/digits/dots/emails).
const COMBINED_SEP = "~";

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

// Cross-app verification secret: a DIFFERENT, dedicated shared secret already
// configured on both ActiveCAMT and songsue for their service-to-service sync
// endpoints (src/lib/integration-auth.ts) — deliberately NOT AUTH_SECRET, which
// must stay app-local (see songsue's docs/songsue-deploy.md: sharing it would
// let a session token replay across apps). Reusing the sync secret here only
// extends its EXISTING cross-app trust boundary to one more purpose, rather
// than standing up a new one.
function crossAppSecret(): string | null {
  return process.env.ACTIVECAMT_SYNC_SECRET || null;
}

/**
 * Per-subject shift of the window grid. Without this, every client's token
 * expires at the same wall-clock second and hundreds of dashboards refetch
 * simultaneously (thundering herd on the token endpoint at large events).
 */
function windowOffset(subject: string): number {
  return createHash("sha256").update(subject).digest().readUInt32BE(0) % WINDOW_MS;
}

/**
 * Signs `{subject}.{exp}.{hmac}` — a short-lived, TOTP-style token (see
 * signQrToken's doc comment for the window/refresh semantics). `subject` may
 * itself contain dots (an email address) — verify() below parses from the END
 * of the string, not by naive `.split(".")`, so that's safe.
 */
function sign(subject: string, secret: string): { token: string; expiresAt: number } {
  const offset = windowOffset(subject);
  const exp = (Math.floor((Date.now() - offset) / WINDOW_MS) + 1) * WINDOW_MS + offset;
  const payload = `${subject}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex").slice(0, SIG_LEN);
  return { token: `${payload}.${sig}`, expiresAt: exp };
}

/**
 * Verifies signature and expiry, returning `subject` on success or null
 * otherwise. Parses from the end (last two dots), not `split(".")`, so a
 * dotted subject (email) round-trips correctly — `split(".")` would shatter
 * "firstname.lastname@cmu.ac.th" into extra parts and always fail.
 */
function verify(token: string, secret: string): string | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const secondLastDot = token.lastIndexOf(".", lastDot - 1);
  if (secondLastDot < 0) return null;

  const subject = token.slice(0, secondLastDot);
  const expStr = token.slice(secondLastDot + 1, lastDot);
  const sig = token.slice(lastDot + 1);

  const exp = Number(expStr);
  if (!subject || isNaN(exp) || Date.now() > exp + GRACE_MS) return null;
  const payload = `${subject}.${exp}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex").slice(0, SIG_LEN);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return subject;
}

/**
 * Returns a short-lived token: `{userId}.{exp}.{hmac24}`.
 * Expiry snaps to a fixed 5-minute window boundary (TOTP-style), so every
 * request within the same window yields the identical token — and all copies
 * of it expire together the instant the window rolls over. A page refresh
 * therefore cannot leave a still-valid "old" QR behind, and multiple open
 * tabs/devices all display the same code. The grid is offset per user so
 * refetches spread evenly across the window instead of spiking together.
 */
export function signQrToken(userId: string): { token: string; expiresAt: number } {
  return sign(userId, authSecret());
}

/**
 * Verifies signature and expiry. Returns the userId on success, null otherwise.
 * Uses timing-safe comparison to prevent side-channel attacks.
 */
export function verifyQrToken(token: string): string | null {
  return verify(token, authSecret());
}

/**
 * Cross-app companion token: same TOTP-style scheme as signQrToken, but keyed
 * by EMAIL (the one identifier both ActiveCAMT's and songsue's independently-
 * generated user tables share) and signed with the cross-app secret instead of
 * this app's own AUTH_SECRET — so the SIBLING app's scanner can verify it
 * without ever needing this app's session-signing key. Returns null (not a
 * token) when the cross-app secret isn't configured, matching every other
 * cross-app sync helper's "optional, no-ops when unset" convention.
 */
export function signCrossAppQrToken(email: string): { token: string; expiresAt: number } | null {
  const secret = crossAppSecret();
  if (!secret) return null;
  return sign(email.toLowerCase(), secret);
}

/** Verifies a cross-app token (see signCrossAppQrToken). Returns the email on success. */
export function verifyCrossAppQrToken(token: string): string | null {
  const secret = crossAppSecret();
  if (!secret) return null;
  return verify(token, secret);
}

/**
 * Combines a same-app token and an (optional) cross-app companion token into
 * the single string actually encoded in the QR — see signCombinedQrToken/
 * splitCombinedQrToken. `~` never appears in either sub-token.
 */
export function signCombinedQrToken(userId: string, email: string): { token: string; expiresAt: number } {
  const local = signQrToken(userId);
  const cross = signCrossAppQrToken(email);
  return {
    token: cross ? `${local.token}${COMBINED_SEP}${cross.token}` : local.token,
    expiresAt: local.expiresAt,
  };
}

/**
 * Splits a scanned QR value into its same-app and (optional) cross-app parts.
 * A token with no `~` is either a legacy single-part token or one signed
 * before the cross-app secret was configured — `cross` is simply absent, and
 * every existing single-token code path is unaffected.
 */
export function splitCombinedQrToken(token: string): { local: string; cross: string | null } {
  const sepIdx = token.indexOf(COMBINED_SEP);
  if (sepIdx === -1) return { local: token, cross: null };
  return { local: token.slice(0, sepIdx), cross: token.slice(sepIdx + 1) };
}
