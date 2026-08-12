// Pure logic for the Anonymous Feedback & Complaints feature: the keyed-hash
// "submitter reference" that stands in for a raw user FK. See
// docs/features/feedback-complaints.md §5 for the full design rationale —
// this file implements the mechanic that makes the anonymity guarantee
// architectural rather than a role-based UI mask.
//
// This file used to also hold one-time tracking-code generation/hashing
// (password-reset-token pattern) for a public, no-login status-lookup path.
// Dropped 2026-08-13 (§7.0/§8 in the docs) once self-service lookup via the
// submitter's own account (GET /api/feedback/mine, built on computeSubmitterRef
// below) made it redundant — submission already requires login, so the code
// wasn't buying additional anonymity, just UX/security surface (a code to
// save, a public no-auth lookup route to rate-limit and defend).
//
// No DB/React dependencies here so it can run in a pure Vitest unit test
// (per this project's convention — see CLAUDE.md "Commands").
import { createHmac } from "crypto";

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

/**
 * Keyed-hash abuse-control + self-service-lookup reference for a userId —
 * NOT reversible to a userId without FEEDBACK_HMAC_SECRET. This is the
 * anonymity boundary itself (see schema.ts's feedbackComplaints.submitterRef
 * comment): it supports (a) "has this account submitted N times recently"
 * abuse-control equality queries, and (b) a submitter's own self-service
 * status lookup (GET /api/feedback/mine) — nothing admin-facing. Application
 * code must NEVER select/return the raw submitterRef column in an
 * admin-facing response, and this function must NEVER be called with
 * anything other than the CALLER'S OWN session id — passing any
 * client-supplied id here would turn a self-service lookup into a lookup of
 * someone else's submissions.
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
