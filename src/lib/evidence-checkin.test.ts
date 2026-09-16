import { describe, it, expect } from "vitest";
import {
  normalizeNonce,
  nonceMatches,
  getEvidenceWindowStatus,
  checkEvidenceEligibility,
  EVIDENCE_GRACE_MS,
} from "@/lib/evidence-checkin";

describe("normalizeNonce / nonceMatches", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(normalizeNonce("  Sabai  ")).toBe("sabai");
    expect(nonceMatches("SABAI", "sabai")).toBe(true);
    expect(nonceMatches(" sabai ", "Sabai")).toBe(true);
  });

  it("collapses internal whitespace", () => {
    expect(nonceMatches("ก้าว  เดิน", "ก้าว เดิน")).toBe(true);
  });

  it("rejects a mismatched code", () => {
    expect(nonceMatches("wrong", "sabai")).toBe(false);
  });

  it("never matches an unconfigured (null) session code", () => {
    expect(nonceMatches("anything", null)).toBe(false);
    expect(nonceMatches("", undefined)).toBe(false);
  });
});

describe("getEvidenceWindowStatus", () => {
  const session = { startTime: "2026-09-20T00:00:00Z", endTime: "2026-09-20T17:00:00Z", evidenceNonce: "sabai" };

  it("is upcoming before the session starts", () => {
    expect(getEvidenceWindowStatus(session, new Date("2026-09-19T23:00:00Z"))).toBe("upcoming");
  });

  it("is open during the session", () => {
    expect(getEvidenceWindowStatus(session, new Date("2026-09-20T10:00:00Z"))).toBe("open");
  });

  it("stays open through the grace period after endTime", () => {
    const justAfterEnd = new Date(new Date(session.endTime).getTime() + 1000);
    expect(getEvidenceWindowStatus(session, justAfterEnd)).toBe("open");
    const withinGrace = new Date(new Date(session.endTime).getTime() + EVIDENCE_GRACE_MS - 1000);
    expect(getEvidenceWindowStatus(session, withinGrace)).toBe("open");
  });

  it("closes once the grace period elapses", () => {
    const pastGrace = new Date(new Date(session.endTime).getTime() + EVIDENCE_GRACE_MS + 1000);
    expect(getEvidenceWindowStatus(session, pastGrace)).toBe("closed");
  });
});

describe("checkEvidenceEligibility", () => {
  const session = { startTime: "2026-09-20T00:00:00Z", endTime: "2026-09-20T17:00:00Z", evidenceNonce: "sabai" };
  const now = new Date("2026-09-20T10:00:00Z");

  it("rejects when the event isn't in evidence mode", () => {
    expect(checkEvidenceEligibility({ event: { checkInMode: "qr" }, session, submittedNonce: "sabai", now }))
      .toEqual({ ok: false, reason: "wrong_mode" });
  });

  it("rejects when the session has no code word configured", () => {
    expect(checkEvidenceEligibility({
      event: { checkInMode: "evidence" },
      session: { ...session, evidenceNonce: null },
      submittedNonce: "sabai",
      now,
    })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("rejects before the window opens", () => {
    expect(checkEvidenceEligibility({
      event: { checkInMode: "evidence" }, session, submittedNonce: "sabai", now: new Date("2026-09-19T00:00:00Z"),
    })).toEqual({ ok: false, reason: "upcoming" });
  });

  it("rejects after the window (+ grace) closes", () => {
    const late = new Date(new Date(session.endTime).getTime() + EVIDENCE_GRACE_MS + 1000);
    expect(checkEvidenceEligibility({ event: { checkInMode: "evidence" }, session, submittedNonce: "sabai", now: late }))
      .toEqual({ ok: false, reason: "closed" });
  });

  it("rejects a wrong code within an otherwise-open window", () => {
    expect(checkEvidenceEligibility({ event: { checkInMode: "evidence" }, session, submittedNonce: "nope", now }))
      .toEqual({ ok: false, reason: "invalid_code" });
  });

  it("accepts a correct code within the open window", () => {
    expect(checkEvidenceEligibility({ event: { checkInMode: "evidence" }, session, submittedNonce: " Sabai ", now }))
      .toEqual({ ok: true });
  });
});
