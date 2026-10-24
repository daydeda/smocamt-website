import { describe, expect, it } from "vitest";
import { emergencyContactColumns, emergencyContactHeaders, relationshipLabel } from "./emergency-contacts";

describe("relationshipLabel", () => {
  it("labels known keys, strips the Other: prefix and keeps legacy text", () => {
    expect(relationshipLabel("Father")).toBe("บิดา (Father)");
    expect(relationshipLabel("Other:ลุง")).toBe("ลุง");
    expect(relationshipLabel("บิดา")).toBe("บิดา");
    expect(relationshipLabel(undefined)).toBe("");
  });
});

describe("emergencyContactColumns", () => {
  const raw = [
    { name: "สมศักดิ์ ใจดี", nickname: "ศักดิ์", relationship: "Father", phone: "0812345678" },
    { name: "สมหญิง ใจดี", relationship: "Other:ป้า", phone: "0898765432" },
  ];
  it("splits each contact into name/relationship/phone columns", () => {
    expect(emergencyContactColumns(raw, true)).toEqual({
      "Emergency Contact 1 Name": "สมศักดิ์ ใจดี",
      "Emergency Contact 1 Nickname": "ศักดิ์",
      "Emergency Contact 1 Relationship": "บิดา (Father)",
      "Emergency Contact 1 Phone": "081-234-5678",
      "Emergency Contact 2 Name": "สมหญิง ใจดี",
      "Emergency Contact 2 Nickname": "",
      "Emergency Contact 2 Relationship": "ป้า",
      "Emergency Contact 2 Phone": "089-876-5432",
    });
  });
  it("omits names for the redacted tier and keeps headers aligned", () => {
    const cols = emergencyContactColumns(raw, false);
    expect(Object.keys(cols)).toEqual(emergencyContactHeaders(false));
    expect(Object.values(cols).join("|")).not.toContain("สมศักดิ์");
    expect(Object.values(cols).join("|")).not.toContain("ศักดิ์");
  });
  it("yields empty cells for missing contacts", () => {
    expect(emergencyContactColumns(null, false)["Emergency Contact 2 Phone"]).toBe("");
  });
});

import { sanitizeAdminContacts } from "./emergency-contacts";

describe("sanitizeAdminContacts", () => {
  const good = { firstName: "สมศักดิ์", lastName: "ใจดี", relationship: "Father", phone: "081-234-5678" };
  it("normalises, composes the display name and drops an empty card", () => {
    const r = sanitizeAdminContacts([{ ...good, middleName: " กุมาร ", nickname: "ศักดิ์" }, {}]);
    expect(r).toEqual({
      contacts: [{ name: "สมศักดิ์ กุมาร ใจดี", firstName: "สมศักดิ์", middleName: "กุมาร", lastName: "ใจดี", nickname: "ศักดิ์", relationship: "Father", phone: "0812345678" }],
    });
  });
  it("marks a Latin-script contact as confirmed so the student is not blocked later", () => {
    const r = sanitizeAdminContacts([{ ...good, firstName: "John", lastName: "Smith" }]);
    expect(r).toMatchObject({ contacts: [{ latinNameConfirmed: true }] });
  });
  it("rejects missing names, bad characters, bad phones and more than two contacts", () => {
    expect(sanitizeAdminContacts([{ ...good, lastName: "" }])).toEqual({ error: "nameRequired" });
    expect(sanitizeAdminContacts([{ ...good, firstName: "สม*ชาย" }])).toEqual({ error: "nameInvalidChars" });
    expect(sanitizeAdminContacts([{ ...good, nickname: "ชาย1" }])).toEqual({ error: "nameInvalidChars" });
    expect(sanitizeAdminContacts([{ ...good, phone: "12345" }])).toEqual({ error: "contactInvalid" });
    expect(sanitizeAdminContacts([{ ...good, relationship: "Other:" }])).toEqual({ error: "contactInvalid" });
    expect(sanitizeAdminContacts([good, good, good])).toEqual({ error: "contactInvalid" });
    expect(sanitizeAdminContacts("nope")).toEqual({ error: "contactInvalid" });
  });
  it("allows clearing all contacts", () => {
    expect(sanitizeAdminContacts([])).toEqual({ contacts: [] });
  });
});
