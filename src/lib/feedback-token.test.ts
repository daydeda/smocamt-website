import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CATEGORY_DEFAULT_SEVERITY,
  FEEDBACK_CATEGORIES,
  computeSubmitterRef,
  generateTrackingCode,
  hashTrackingCode,
  hashesMatch,
} from "@/lib/feedback-token";

const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

describe("generateTrackingCode", () => {
  it("returns a 10-character code from the unambiguous alphabet", () => {
    const code = generateTrackingCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(CODE_ALPHABET);
  });

  it("never contains ambiguous characters (0/O, 1/I/L)", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateTrackingCode();
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("is different across calls (not a fixed/predictable value)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateTrackingCode()));
    expect(codes.size).toBe(20);
  });
});

describe("hashTrackingCode", () => {
  it("is deterministic for the same code", () => {
    const code = generateTrackingCode();
    expect(hashTrackingCode(code)).toBe(hashTrackingCode(code));
  });

  it("normalizes case and surrounding whitespace before hashing", () => {
    expect(hashTrackingCode("ab7kq92xpm")).toBe(hashTrackingCode("AB7KQ92XPM"));
    expect(hashTrackingCode("  AB7KQ92XPM  ")).toBe(hashTrackingCode("AB7KQ92XPM"));
  });

  it("produces different hashes for different codes", () => {
    expect(hashTrackingCode("AB7KQ92XPM")).not.toBe(hashTrackingCode("ZZ7KQ92XPM"));
  });

  it("returns a 64-char hex string (sha256)", () => {
    expect(hashTrackingCode("AB7KQ92XPM")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashesMatch", () => {
  it("true for identical hashes", () => {
    const h = hashTrackingCode("AB7KQ92XPM");
    expect(hashesMatch(h, h)).toBe(true);
  });

  it("false for different hashes", () => {
    expect(hashesMatch(hashTrackingCode("AB7KQ92XPM"), hashTrackingCode("ZZ7KQ92XPM"))).toBe(false);
  });

  it("false for mismatched lengths (never throws)", () => {
    expect(hashesMatch("ab", "abcd")).toBe(false);
  });
});

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
