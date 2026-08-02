import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { createHmac } from "crypto";

// qr-token reads AUTH_SECRET/ACTIVECAMT_SYNC_SECRET lazily inside their
// respective secret() getters; set deterministic test secrets BEFORE
// importing the module. Never read .env / never hit prod.
const TEST_SECRET = "test-secret-do-not-use-in-prod";
const TEST_CROSS_SECRET = "test-cross-app-secret-do-not-use-in-prod";

let signQrToken: typeof import("@/lib/qr-token").signQrToken;
let verifyQrToken: typeof import("@/lib/qr-token").verifyQrToken;
let signCrossAppQrToken: typeof import("@/lib/qr-token").signCrossAppQrToken;
let verifyCrossAppQrToken: typeof import("@/lib/qr-token").verifyCrossAppQrToken;
let signCombinedQrToken: typeof import("@/lib/qr-token").signCombinedQrToken;
let splitCombinedQrToken: typeof import("@/lib/qr-token").splitCombinedQrToken;

const WINDOW_MS = 5 * 60 * 1000;
const GRACE_MS = 30 * 1000;
const SIG_LEN = 32;

beforeAll(async () => {
  process.env.AUTH_SECRET = TEST_SECRET;
  process.env.ACTIVECAMT_SYNC_SECRET = TEST_CROSS_SECRET;
  const mod = await import("@/lib/qr-token");
  signQrToken = mod.signQrToken;
  verifyQrToken = mod.verifyQrToken;
  signCrossAppQrToken = mod.signCrossAppQrToken;
  verifyCrossAppQrToken = mod.verifyCrossAppQrToken;
  signCombinedQrToken = mod.signCombinedQrToken;
  splitCombinedQrToken = mod.splitCombinedQrToken;
});

// Fixed point in time so window math is fully deterministic.
const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signQrToken", () => {
  it("returns a 3-part token of the form userId.exp.sig", () => {
    const { token } = signQrToken("user-1");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("user-1");
    expect(Number(parts[1])).toBeGreaterThan(NOW);
    expect(parts[2]).toHaveLength(SIG_LEN);
  });

  it("expiresAt is in the future and aligned to a per-user window boundary", () => {
    const { expiresAt } = signQrToken("user-1");
    expect(expiresAt).toBeGreaterThan(NOW);
    expect(expiresAt - NOW).toBeLessThanOrEqual(WINDOW_MS);
  });

  it("is TOTP-style: every call within the same window yields the identical token", () => {
    const a = signQrToken("user-1");
    vi.setSystemTime(NOW + 1000);
    const b = signQrToken("user-1");
    expect(b.token).toBe(a.token);
    expect(b.expiresAt).toBe(a.expiresAt);
  });

  it("offsets the window grid per user (different users expire at different instants)", () => {
    const a = signQrToken("user-aaaa");
    const b = signQrToken("user-zzzz");
    // Same wall clock, but per-user offset should (very likely) differ.
    expect(a.expiresAt).not.toBe(b.expiresAt);
  });
});

describe("verifyQrToken — happy path", () => {
  it("a freshly signed token round-trips back to the userId", () => {
    const { token } = signQrToken("user-42");
    expect(verifyQrToken(token)).toBe("user-42");
  });

  it("verifies anywhere inside the active window", () => {
    const { token, expiresAt } = signQrToken("user-42");
    vi.setSystemTime(expiresAt - 1); // one ms before boundary
    expect(verifyQrToken(token)).toBe("user-42");
  });

  it("verifies within the 30s grace period past expiry", () => {
    const { token, expiresAt } = signQrToken("user-42");
    vi.setSystemTime(expiresAt + GRACE_MS - 1);
    expect(verifyQrToken(token)).toBe("user-42");
  });
});

describe("verifyQrToken — expiry", () => {
  it("rejects a token once past expiry + grace", () => {
    const { token, expiresAt } = signQrToken("user-42");
    vi.setSystemTime(expiresAt + GRACE_MS + 1);
    expect(verifyQrToken(token)).toBeNull();
  });

  it("rejects exactly at the grace boundary edge (> comparison)", () => {
    const { token, expiresAt } = signQrToken("user-42");
    // Date.now() > exp + GRACE_MS rejects; so exp+GRACE+1 must fail.
    vi.setSystemTime(expiresAt + GRACE_MS + 1);
    expect(verifyQrToken(token)).toBeNull();
  });

  it("rejects a far-future token signed long ago (window rolled over)", () => {
    const { token, expiresAt } = signQrToken("user-42");
    vi.setSystemTime(expiresAt + WINDOW_MS * 10);
    expect(verifyQrToken(token)).toBeNull();
  });
});

describe("verifyQrToken — tampering and garbage", () => {
  it("rejects a tampered signature", () => {
    const { token } = signQrToken("user-42");
    const [uid, exp, sig] = token.split(".");
    const flipped = sig[0] === "a" ? "b" : "a";
    const tampered = `${uid}.${exp}.${flipped}${sig.slice(1)}`;
    expect(verifyQrToken(tampered)).toBeNull();
  });

  it("rejects a tampered userId (signature no longer matches payload)", () => {
    const { token } = signQrToken("user-42");
    const [, exp, sig] = token.split(".");
    expect(verifyQrToken(`user-99.${exp}.${sig}`)).toBeNull();
  });

  it("rejects a tampered expiry (extending lifetime forges the payload)", () => {
    const { token, expiresAt } = signQrToken("user-42");
    const [uid, , sig] = token.split(".");
    const longer = expiresAt + WINDOW_MS * 100;
    expect(verifyQrToken(`${uid}.${longer}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", () => {
    const userId = "user-42";
    const exp = (Math.floor(NOW / WINDOW_MS) + 1) * WINDOW_MS;
    const payload = `${userId}.${exp}`;
    const wrongSig = createHmac("sha256", "the-wrong-secret").update(payload).digest("hex").slice(0, SIG_LEN);
    expect(verifyQrToken(`${payload}.${wrongSig}`)).toBeNull();
  });

  it("rejects malformed tokens (wrong part count / garbage)", () => {
    expect(verifyQrToken("")).toBeNull();
    expect(verifyQrToken("garbage")).toBeNull();
    expect(verifyQrToken("a.b")).toBeNull();
    expect(verifyQrToken("a.b.c.d")).toBeNull();
    expect(verifyQrToken("user.notanumber.sig")).toBeNull();
    expect(verifyQrToken("..")).toBeNull();
  });

  it("rejects a signature of the wrong length (timingSafeEqual throws -> null)", () => {
    const { token } = signQrToken("user-42");
    const [uid, exp] = token.split(".");
    expect(verifyQrToken(`${uid}.${exp}.short`)).toBeNull();
  });
});

describe("signCrossAppQrToken / verifyCrossAppQrToken", () => {
  it("round-trips a plain subject", () => {
    const { token } = signCrossAppQrToken("student@cmu.ac.th")!;
    expect(verifyCrossAppQrToken(token)).toBe("student@cmu.ac.th");
  });

  it("round-trips an email subject containing multiple dots — the whole point of\n     parsing from the end instead of a naive split(\".\")", () => {
    const email = "firstname.lastname@cmu.ac.th";
    const { token } = signCrossAppQrToken(email)!;
    expect(verifyCrossAppQrToken(token)).toBe(email);
  });

  it("lowercases the subject at sign time", () => {
    const { token } = signCrossAppQrToken("Student@CMU.ac.th")!;
    expect(verifyCrossAppQrToken(token)).toBe("student@cmu.ac.th");
  });

  it("returns null (not a token) when the cross-app secret is unset", () => {
    const prev = process.env.ACTIVECAMT_SYNC_SECRET;
    delete process.env.ACTIVECAMT_SYNC_SECRET;
    try {
      expect(signCrossAppQrToken("student@cmu.ac.th")).toBeNull();
    } finally {
      process.env.ACTIVECAMT_SYNC_SECRET = prev;
    }
  });

  it("verifyCrossAppQrToken also returns null when the secret is unset, even for an otherwise-valid token", () => {
    const { token } = signCrossAppQrToken("student@cmu.ac.th")!;
    const prev = process.env.ACTIVECAMT_SYNC_SECRET;
    delete process.env.ACTIVECAMT_SYNC_SECRET;
    try {
      expect(verifyCrossAppQrToken(token)).toBeNull();
    } finally {
      process.env.ACTIVECAMT_SYNC_SECRET = prev;
    }
  });

  it("a same-app token (signed with AUTH_SECRET) does not verify as a cross-app token", () => {
    const { token } = signQrToken("user-42");
    expect(verifyCrossAppQrToken(token)).toBeNull();
  });

  it("a cross-app token does not verify as a same-app token", () => {
    const { token } = signCrossAppQrToken("student@cmu.ac.th")!;
    expect(verifyQrToken(token)).toBeNull();
  });
});

describe("signCombinedQrToken / splitCombinedQrToken", () => {
  it("combines both parts, and each half verifies against its own scheme", () => {
    const { token } = signCombinedQrToken("user-1", "student@cmu.ac.th");
    const { local, cross } = splitCombinedQrToken(token);
    expect(verifyQrToken(local)).toBe("user-1");
    expect(cross).not.toBeNull();
    expect(verifyCrossAppQrToken(cross!)).toBe("student@cmu.ac.th");
  });

  it("omits the cross-app half when the cross-app secret is unset — the combined\n     token degrades to exactly the plain single-token format", () => {
    const prev = process.env.ACTIVECAMT_SYNC_SECRET;
    delete process.env.ACTIVECAMT_SYNC_SECRET;
    try {
      const { token } = signCombinedQrToken("user-1", "student@cmu.ac.th");
      const { local, cross } = splitCombinedQrToken(token);
      expect(cross).toBeNull();
      expect(local).toBe(token);
      expect(verifyQrToken(local)).toBe("user-1");
    } finally {
      process.env.ACTIVECAMT_SYNC_SECRET = prev;
    }
  });

  it("splitCombinedQrToken on a token with no separator returns it whole as `local`", () => {
    const { token } = signQrToken("user-1");
    expect(splitCombinedQrToken(token)).toEqual({ local: token, cross: null });
  });

  it("splitCombinedQrToken on a legacy/plain value (no dots, no separator) is a no-op", () => {
    expect(splitCombinedQrToken("some-legacy-id")).toEqual({ local: "some-legacy-id", cross: null });
  });
});
