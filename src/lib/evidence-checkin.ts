// Pure rules for "evidence check-in" (events.checkInMode === 'evidence'): a
// student self-submits proof (a file + that day's code word) instead of being
// scanned in. This file holds only logic with no DB/network dependency so it
// stays fast and deterministic to test — the actual attendance row write +
// points award lives in src/modules/events/evidence-checkin.service.ts, which
// calls these functions rather than re-implementing the checks.
//
// See events.checkInMode / eventSessions.evidenceNonce+evidencePrompt /
// attendance.evidenceFileKey+evidenceNonceSubmitted in src/db/schema.ts.

// How long past a session's own end time a submission is still accepted —
// evidence for "today" usually gets uploaded that night, not always before
// the session's nominal end clock time. Generous but not unbounded: this is
// the anti-backdating knob (paired with the nonce) that stops "submit all 6
// days at once on day 6".
export const EVIDENCE_GRACE_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface EvidenceSessionShape {
  startTime: string | Date;
  endTime: string | Date;
  evidenceNonce: string | null;
}

export interface EvidenceEventShape {
  checkInMode: string | null;
}

export type EvidenceWindowStatus = "upcoming" | "open" | "closed";

// Trim + case-fold so "Sabai" / " sabai " / "SABAI" all match the same word —
// the code word is meant to be easy to type off a phone, not a strict secret.
export function normalizeNonce(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function nonceMatches(submitted: string, expected: string | null | undefined): boolean {
  if (!expected) return false; // an unconfigured session (no code word set) never matches
  return normalizeNonce(submitted) === normalizeNonce(expected);
}

export function getEvidenceWindow(session: EvidenceSessionShape): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(session.startTime);
  const closesAt = new Date(new Date(session.endTime).getTime() + EVIDENCE_GRACE_MS);
  return { opensAt, closesAt };
}

export function getEvidenceWindowStatus(session: EvidenceSessionShape, now: Date = new Date()): EvidenceWindowStatus {
  const { opensAt, closesAt } = getEvidenceWindow(session);
  if (now < opensAt) return "upcoming";
  if (now > closesAt) return "closed";
  return "open";
}

export type EvidenceEligibility =
  | { ok: true }
  | { ok: false; reason: "wrong_mode" | "not_configured" | "upcoming" | "closed" | "invalid_code" };

// The full "may this submission proceed" check, given a nonce the student
// typed. Order matters for the error the caller surfaces: mode/config
// problems are the organizer's fault and should be checked first, then
// timing, then the code word (so a late submission reads as "closed", not a
// confusing "invalid code" when the code was actually right).
export function checkEvidenceEligibility(params: {
  event: EvidenceEventShape;
  session: EvidenceSessionShape;
  submittedNonce: string;
  now?: Date;
}): EvidenceEligibility {
  const { event, session, submittedNonce, now = new Date() } = params;
  if (event.checkInMode !== "evidence") return { ok: false, reason: "wrong_mode" };
  if (!session.evidenceNonce) return { ok: false, reason: "not_configured" };
  const status = getEvidenceWindowStatus(session, now);
  if (status === "upcoming") return { ok: false, reason: "upcoming" };
  if (status === "closed") return { ok: false, reason: "closed" };
  if (!nonceMatches(submittedNonce, session.evidenceNonce)) return { ok: false, reason: "invalid_code" };
  return { ok: true };
}
