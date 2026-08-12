import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CATEGORY_DEFAULT_SEVERITY, FEEDBACK_CATEGORIES, computeSubmitterRef } from "@/lib/feedback-token";

describe("computeSubmitterRef", () => {
  const ORIGINAL_SECRET = process.env.FEEDBACK_HMAC_SECRET;

  beforeEach(() => {
    process.env.FEEDBACK_HMAC_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    process.env.FEEDBACK_HMAC_SECRET = ORIGINAL_SECRET;
  });

  it("throws when FEEDBACK_HMAC_SECRET is not configured", () => {
    delete process.env.FEEDBACK_HMAC_SECRET;
    expect(() => computeSubmitterRef("user-1")).toThrow(/FEEDBACK_HMAC_SECRET/);
  });

  it("is deterministic for the same userId + secret", () => {
    expect(computeSubmitterRef("user-1")).toBe(computeSubmitterRef("user-1"));
  });

  it("differs across userIds (so the abuse-control equality query actually discriminates accounts)", () => {
    expect(computeSubmitterRef("user-1")).not.toBe(computeSubmitterRef("user-2"));
  });

  it("differs when the secret changes (the anonymity/abuse-control boundary itself)", () => {
    const refWithSecretA = computeSubmitterRef("user-1");
    process.env.FEEDBACK_HMAC_SECRET = "a-different-secret";
    const refWithSecretB = computeSubmitterRef("user-1");
    expect(refWithSecretA).not.toBe(refWithSecretB);
  });

  it("is not the raw userId or a trivially reversible transform of it", () => {
    const ref = computeSubmitterRef("user-1");
    expect(ref).not.toContain("user-1");
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("CATEGORY_DEFAULT_SEVERITY", () => {
  it("locks harassment_safety to urgent", () => {
    expect(CATEGORY_DEFAULT_SEVERITY.harassment_safety).toBe("urgent");
  });

  it("has an entry for every category (no silent gaps if a category is ever added)", () => {
    for (const category of FEEDBACK_CATEGORIES) {
      expect(CATEGORY_DEFAULT_SEVERITY[category]).toBeDefined();
    }
  });
});
