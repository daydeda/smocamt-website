import { describe, expect, it } from "vitest";
import { classifySlip, hashSlip, isVerifyUrl, signSlipMeta, verifySlipMeta } from "./shop-slip-verify";

// signSlipMeta/verifySlipMeta read AUTH_SECRET lazily inside slipMetaSecret(),
// so setting it here (before any test runs) is enough — no dynamic-import
// dance needed, unlike qr-token.test.ts's module-level TOTP grid setup.
process.env.AUTH_SECRET = "test-secret-do-not-use-in-prod";

describe("hashSlip", () => {
  it("is deterministic for identical bytes", () => {
    const a = Buffer.from("same slip bytes");
    const b = Buffer.from("same slip bytes");
    expect(hashSlip(a)).toBe(hashSlip(b));
  });

  it("differs for different bytes", () => {
    expect(hashSlip(Buffer.from("slip A"))).not.toBe(hashSlip(Buffer.from("slip B")));
  });
});

describe("classifySlip", () => {
  it("returns null (clean) when nothing matches and a QR was found", () => {
    const flag = classifySlip(
      { slipHash: "hash-new", slipQrPayload: "https://bank.example/verify/new" },
      [{ slipHash: "hash-old", slipQrPayload: "https://bank.example/verify/old" }]
    );
    expect(flag).toBeNull();
  });

  it("flags an exact image reuse as duplicate_image", () => {
    const flag = classifySlip(
      { slipHash: "hash-reused", slipQrPayload: "https://bank.example/verify/x" },
      [{ slipHash: "hash-reused", slipQrPayload: "https://bank.example/verify/other" }]
    );
    expect(flag).toBe("duplicate_image");
  });

  it("flags a reused QR payload (different photo of the same slip) as duplicate_qr", () => {
    const flag = classifySlip(
      { slipHash: "hash-different", slipQrPayload: "https://bank.example/verify/shared-ref" },
      [{ slipHash: "hash-original", slipQrPayload: "https://bank.example/verify/shared-ref" }]
    );
    expect(flag).toBe("duplicate_qr");
  });

  it("prefers duplicate_image over duplicate_qr when both match", () => {
    const flag = classifySlip(
      { slipHash: "hash-same", slipQrPayload: "https://bank.example/verify/same" },
      [{ slipHash: "hash-same", slipQrPayload: "https://bank.example/verify/same" }]
    );
    expect(flag).toBe("duplicate_image");
  });

  it("flags a missing QR as no_qr when there's no duplicate", () => {
    const flag = classifySlip({ slipHash: "hash-blurry", slipQrPayload: null }, []);
    expect(flag).toBe("no_qr");
  });

  it("does not treat two null QR payloads as a duplicate match", () => {
    const flag = classifySlip(
      { slipHash: "hash-a", slipQrPayload: null },
      [{ slipHash: "hash-b", slipQrPayload: null }]
    );
    expect(flag).toBe("no_qr");
  });

  it("ignores rejected/withdrawn prior slips the caller already filtered out", () => {
    // classifySlip trusts its input list as-is; this documents that the caller
    // (order creation) is responsible for excluding rejected orders so a
    // resubmitted slip after a rejection isn't flagged forever.
    const flag = classifySlip({ slipHash: "hash-x", slipQrPayload: "https://bank.example/y" }, []);
    expect(flag).toBeNull();
  });
});

describe("isVerifyUrl", () => {
  it("accepts https and http payloads", () => {
    expect(isVerifyUrl("https://bank.example/verify/abc")).toBe(true);
    expect(isVerifyUrl("http://bank.example/verify/abc")).toBe(true);
  });

  it("rejects null, non-URL text, and non-http(s) schemes", () => {
    expect(isVerifyUrl(null)).toBe(false);
    expect(isVerifyUrl("not a url")).toBe(false);
    expect(isVerifyUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("signSlipMeta / verifySlipMeta", () => {
  const slipPath = "abc-123-def.webp";

  it("round-trips the hash and QR payload it was signed with", () => {
    const token = signSlipMeta(slipPath, "hash-abc", "https://bank.example/verify/1");
    expect(verifySlipMeta(slipPath, token)).toEqual({ slipHash: "hash-abc", slipQrPayload: "https://bank.example/verify/1" });
  });

  it("round-trips a null QR payload (no QR found on the slip)", () => {
    const token = signSlipMeta(slipPath, "hash-abc", null);
    expect(verifySlipMeta(slipPath, token)).toEqual({ slipHash: "hash-abc", slipQrPayload: null });
  });

  it("rejects a missing token (caller must fall back to re-deriving)", () => {
    expect(verifySlipMeta(slipPath, null)).toBeNull();
    expect(verifySlipMeta(slipPath, undefined)).toBeNull();
    expect(verifySlipMeta(slipPath, "")).toBeNull();
  });

  it("rejects a token signed for a DIFFERENT slipPath (can't be replayed onto another upload)", () => {
    const token = signSlipMeta(slipPath, "hash-abc", null);
    expect(verifySlipMeta("some-other-path.webp", token)).toBeNull();
  });

  it("rejects a tampered hash even though the signature format still parses", () => {
    const token = signSlipMeta(slipPath, "hash-abc", null);
    const forged = token.replace("hash-abc", "hash-evil");
    expect(verifySlipMeta(slipPath, forged)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySlipMeta(slipPath, "not-a-real-token")).toBeNull();
    expect(verifySlipMeta(slipPath, "a|b|c")).toBeNull();
  });
});
