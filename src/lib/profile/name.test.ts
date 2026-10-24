import { describe, expect, it } from "vitest";
import { composeFullName, hasInvalidNameChars, sanitizeNameInput, contactHasName, contactNeedsLatinConfirm, prefillContactParts, withComposedName, customRelationshipText, isThaiNameValue, partsHaveLatin, prefillNameParts, splitLegacyName, validateNameParts } from "./name";

describe("composeFullName", () => {
  it("joins parts and skips an empty middle name", () => {
    expect(composeFullName({ firstName: "สมชาย", middleName: "", lastName: "ใจดี" })).toBe("สมชาย ใจดี");
    expect(composeFullName({ firstName: " สมชาย ", middleName: "กุมาร", lastName: "ใจดี" })).toBe("สมชาย กุมาร ใจดี");
  });
});

describe("splitLegacyName", () => {
  it("splits exactly two tokens", () => {
    expect(splitLegacyName("สมชาย  ใจดี")).toEqual({ firstName: "สมชาย", lastName: "ใจดี" });
  });
  it("refuses one token or three+ tokens", () => {
    expect(splitLegacyName("สมชาย")).toBeNull();
    expect(splitLegacyName("สมชาย กุมาร ใจดี")).toBeNull();
    expect(splitLegacyName("")).toBeNull();
    expect(splitLegacyName(null)).toBeNull();
  });
});

describe("isThaiNameValue / partsHaveLatin", () => {
  it("accepts Thai and rejects Latin or digits", () => {
    expect(isThaiNameValue("สมชาย")).toBe(true);
    expect(isThaiNameValue("Somchai")).toBe(false);
    expect(isThaiNameValue("สมชาย1")).toBe(false);
    expect(partsHaveLatin({ firstName: "สมชาย", lastName: "Jaidee" })).toBe(true);
    expect(partsHaveLatin({ firstName: "สมชาย", lastName: "ใจดี" })).toBe(false);
  });
});

describe("validateNameParts", () => {
  it("requires first and last", () => {
    expect(validateNameParts({ firstName: "สมชาย", lastName: " " }, false)).toBe("nameRequired");
  });
  it("blocks Latin unless confirmed", () => {
    expect(validateNameParts({ firstName: "John", lastName: "Smith" }, false)).toBe("nameThaiOnly");
    expect(validateNameParts({ firstName: "John", lastName: "Smith" }, true)).toBeNull();
    expect(validateNameParts({ firstName: "สมชาย", lastName: "ใจดี" }, false)).toBeNull();
  });
});

describe("prefillNameParts", () => {
  it("suggests first/middle/last from a legacy name", () => {
    expect(prefillNameParts("สมชาย")).toEqual({ firstName: "สมชาย", middleName: "", lastName: "" });
    expect(prefillNameParts("สมชาย ใจดี")).toEqual({ firstName: "สมชาย", middleName: "", lastName: "ใจดี" });
    expect(prefillNameParts("สมชาย กุมาร ใจดี")).toEqual({ firstName: "สมชาย", middleName: "กุมาร", lastName: "ใจดี" });
    expect(prefillNameParts(null)).toEqual({ firstName: "", middleName: "", lastName: "" });
  });
});

describe("emergency contact Thai rule", () => {
  const thai = { name: "สมศักดิ์ ใจดี", relationship: "Father" };
  it("passes Thai contacts and known relationship keys", () => {
    expect(contactNeedsLatinConfirm(thai, false)).toBe(false);
  });
  it("flags a Latin name or custom relationship for a Thai student", () => {
    expect(contactNeedsLatinConfirm({ name: "Somsak Jaidee", relationship: "Mother" }, false)).toBe(true);
    expect(contactNeedsLatinConfirm({ name: "สมศักดิ์", relationship: "Other:uncle" }, false)).toBe(true);
  });
  it("is satisfied by a per-contact confirmation or an international student", () => {
    expect(contactNeedsLatinConfirm({ name: "John Smith", relationship: "Father", latinNameConfirmed: true }, false)).toBe(false);
    expect(contactNeedsLatinConfirm({ name: "John Smith", relationship: "Father" }, true)).toBe(false);
  });
  it("reads the custom relationship text", () => {
    expect(customRelationshipText("Other:ลุง")).toBe("ลุง");
    expect(customRelationshipText("Father")).toBe("");
    expect(customRelationshipText("ลุง")).toBe("ลุง");
  });
});

describe("emergency contact name parts", () => {
  it("needs first AND last when split, any name when legacy", () => {
    expect(contactHasName({ name: "", firstName: "สมศักดิ์", lastName: "" })).toBe(false);
    expect(contactHasName({ name: "x", firstName: "สมศักดิ์", lastName: "ใจดี" })).toBe(true);
    expect(contactHasName({ name: "สมศักดิ์ ใจดี" })).toBe(true);
    expect(contactHasName({ name: " " })).toBe(false);
  });
  it("rebuilds the display name from the parts", () => {
    expect(withComposedName({ name: "", firstName: "สมศักดิ์", middleName: "", lastName: "ใจดี" }).name).toBe("สมศักดิ์ ใจดี");
    expect(withComposedName({ name: "legacy" }).name).toBe("legacy");
  });
  it("prefills a legacy contact and checks Latin in any part", () => {
    expect(prefillContactParts({ name: "สมศักดิ์ ใจดี" })).toMatchObject({ firstName: "สมศักดิ์", lastName: "ใจดี" });
    expect(contactNeedsLatinConfirm({ name: "", firstName: "Somsak", lastName: "ใจดี", relationship: "Father" }, false)).toBe(true);
  });
});

describe("letters-only names", () => {
  it("allows letters in any script, spaces, hyphen, apostrophe and period", () => {
    for (const ok of ["สมชาย", "ใจดี ๆ", "Mary-Ann", "O'Brien", "Jr.", "José", "王小明", "ဝင်း"]) {
      expect(hasInvalidNameChars(ok)).toBe(false);
    }
  });
  it("rejects digits (Arabic and Thai) and symbols", () => {
    for (const bad of ["สมชาย1", "สมชาย๕", "a*b", "a&b", "a,b", "a/b", "a|b", "a}b", "a_b", "a@b", "a#b"]) {
      expect(hasInvalidNameChars(bad)).toBe(true);
    }
  });
  it("sanitizes input by dropping what is not allowed", () => {
    expect(sanitizeNameInput("สม1ชาย๕*&,/|}")).toBe("สมชาย");
    expect(sanitizeNameInput("Mary-Ann O'Brien Jr.")).toBe("Mary-Ann O'Brien Jr.");
  });
  it("rejects invalid characters before the script check", () => {
    expect(validateNameParts({ firstName: "สมชาย2", lastName: "ใจดี" }, false)).toBe("nameInvalidChars");
    expect(validateNameParts({ firstName: "John*", lastName: "Smith" }, true)).toBe("nameInvalidChars");
  });
});
