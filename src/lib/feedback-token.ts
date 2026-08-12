// Pure logic for the Anonymous Feedback & Complaints feature: tracking-code
// generation/hashing and the keyed-hash "submitter reference" that stands in
// for a raw user FK. See docs/features/feedback-complaints.md §5 for the full
// design rationale — this file implements the mechanics that make the
// anonymity guarantee architectural rather than a role-based UI mask.
//
// No DB/React dependencies here so it can run in a pure Vitest unit test
// (per this project's convention — see CLAUDE.md "Commands").
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const FEEDBACK_CATEGORIES = [
  "event",
  "staff_conduct",
  "harassment_safety",
  "house_points",
  "shop_order",
  "technical",
  "facility",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_SEVERITIES = ["low", "normal", "urgent"] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export const FEEDBACK_STATUSES = ["new", "in_review", "resolved", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// Default severity per category (docs §4). harassment_safety is LOCKED to
// 'urgent' at creation — the submit route must always use this map rather
// than accept a client-supplied severity, so a submitter (or a compromised
// client) can never under-flag a harassment report. Only an admin may
// downgrade afterward, via the admin update path, which audit-logs it.
export const CATEGORY_DEFAULT_SEVERITY: Record<FeedbackCategory, FeedbackSeverity> = {
  event: "normal",
  staff_conduct: "normal",
  harassment_safety: "urgent",
  house_points: "normal",
  shop_order: "normal",
  technical: "low",
  facility: "low",
  other: "low",
};

// Unambiguous alphabet — excludes 0/O, 1/I/L — so a submitter can read the
// code back off a screen or write it down without transcription errors.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

/**
 * Crypto-random tracking code shown to the submitter exactly once at
 * creation. Never persisted in plaintext anywhere — only hashTrackingCode's
 * output is stored (same principle as a password-reset token). Combined with
 * IP rate-limiting on the lookup route (not this function's job), a 10-char
 * draw from a 32-symbol alphabet is impractical to brute-force at the rate a
 * rate-limited endpoint allows.
 */
export function generateTrackingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** sha256 hex of a tracking code (case/whitespace-normalized) — the ONLY form ever stored. */
export function hashTrackingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}

/** Timing-safe compare of two hex hash strings — cheap defense in depth on
 * top of the DB equality lookup. */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Keyed-hash abuse-control reference for a userId — NOT reversible to a
 * userId without FEEDBACK_HMAC_SECRET. This is the anonymity boundary itself
 * (see schema.ts's feedbackComplaints.submitterRef comment): it supports
 * "has this account submitted N times recently" equality queries and nothing
 * else. Application code must NEVER select/return the raw submitterRef
 * column in an admin-facing response, and this function must NEVER be
 * exposed to a client — it only ever runs server-side against the logged-in
 * user's own session id.
 *
 * Throws if the secret isn't configured. Unlike the SMTP notification vars
 * (which fail open — a missing notification channel must never block a
 * submission), a missing HMAC secret must fail LOUD: silently falling back
 * to an empty/guessable key would turn this column into a plain
 * re-identifiable reference, defeating the entire feature.
 */
export function computeSubmitterRef(userId: string): string {
  const secret = process.env.FEEDBACK_HMAC_SECRET;
  if (!secret) {
    throw new Error("FEEDBACK_HMAC_SECRET is not configured — cannot compute submitter reference");
  }
  return createHmac("sha256", secret).update(userId, "utf8").digest("hex");
}
