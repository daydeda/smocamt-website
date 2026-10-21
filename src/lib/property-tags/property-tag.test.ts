import { describe, expect, it } from "vitest";
import {
  formatTagLabel,
  generateTagCode,
  labelGridForPerPage,
  maskPhone,
  MAX_TAGS_PER_PAGE,
  normalizeSeries,
  normalizeTagCode,
  seriesRoleMismatch,
  TAG_CODE_ALPHABET,
  TAG_CODE_LENGTH,
  tagUrl,
} from "./property-tag";

describe("generateTagCode", () => {
  it("produces a code of the right length from the Crockford alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateTagCode();
      expect(code).toHaveLength(TAG_CODE_LENGTH);
      for (const ch of code) expect(TAG_CODE_ALPHABET).toContain(ch);
    }
  });

  it("maps each byte's low 5 bits onto the alphabet", () => {
    const code = generateTagCode((n) => new Uint8Array(n).map((_, i) => i + 32));
    expect(code).toBe("0123456789");
  });

  it("round-trips through normalizeTagCode", () => {
    const code = generateTagCode();
    expect(normalizeTagCode(code)).toBe(code);
  });
});

describe("normalizeTagCode", () => {
  it("extracts the code from the printed URL", () => {
    expect(normalizeTagCode("https://activecamt.example/t/K7M2QX9TPA")).toBe("K7M2QX9TPA");
    expect(normalizeTagCode("https://activecamt.example/t/K7M2QX9TPA?utm=x")).toBe("K7M2QX9TPA");
  });

  it("accepts hand-typed codes: case, spaces, dashes, O/I/L lookalikes", () => {
    expect(normalizeTagCode(" k7m2-qx9t pa ")).toBe("K7M2QX9TPA");
    expect(normalizeTagCode("O0ILl12345")).toBe("0011112345");
  });

  it("rejects wrong length or characters outside the alphabet", () => {
    expect(normalizeTagCode("")).toBeNull();
    expect(normalizeTagCode(null)).toBeNull();
    expect(normalizeTagCode("K7M2QX9TP")).toBeNull();
    expect(normalizeTagCode("K7M2QX9TPAA")).toBeNull();
    expect(normalizeTagCode("K7M2QX9TPU")).toBeNull();
    // A student attendance QR token must never parse as a tag.
    expect(normalizeTagCode("eyJhbGciOiJIUzI1NiJ9.abc.def")).toBeNull();
  });
});

describe("labels and series", () => {
  it("formats SERIES-NNN and grows past 999", () => {
    expect(formatTagLabel("SMO", 14)).toBe("SMO-014");
    expect(formatTagLabel("STU", 1234)).toBe("STU-1234");
  });

  it("normalizes series to 1–8 uppercase letters/digits", () => {
    expect(normalizeSeries(" smo ")).toBe("SMO");
    expect(normalizeSeries("")).toBeNull();
    expect(normalizeSeries("S-MO")).toBeNull();
    expect(normalizeSeries("ABCDEFGHI")).toBeNull();
  });

  it("flags a role-hinting series only when the owner lacks that role", () => {
    expect(seriesRoleMismatch("SMO", ["student"])).toBe("smo");
    expect(seriesRoleMismatch("SMO", ["student", "smo"])).toBeNull();
    expect(seriesRoleMismatch("ANU", ["student"])).toBe("anusmo");
    expect(seriesRoleMismatch("STU", ["student"])).toBeNull();
  });

  it("builds the tag URL without a double slash", () => {
    expect(tagUrl("https://x.test/", "K7M2QX9TPA")).toBe("https://x.test/t/K7M2QX9TPA");
  });

  it("masks a phone to its last 4 digits", () => {
    expect(maskPhone("081-234-5678")).toBe("•••5678");
    expect(maskPhone("12")).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });
});

describe("labelGridForPerPage", () => {
  it("always fits the requested count", () => {
    for (const n of [1, 6, 12, 24, 35, 40, 63, MAX_TAGS_PER_PAGE]) {
      const g = labelGridForPerPage(n);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
      expect(g.qrMm).toBeGreaterThan(0);
      expect(g.qrMm).toBeLessThanOrEqual(g.cellWidthMm);
    }
  });

  it("shrinks the QR as more labels share a page", () => {
    expect(labelGridForPerPage(12).qrMm).toBeGreaterThan(labelGridForPerPage(40).qrMm);
  });

  it("clamps out-of-range input", () => {
    expect(labelGridForPerPage(0).cols * labelGridForPerPage(0).rows).toBeGreaterThanOrEqual(1);
    const capped = labelGridForPerPage(10_000);
    expect(capped.cols * capped.rows).toBeLessThan(MAX_TAGS_PER_PAGE * 2);
  });
});
