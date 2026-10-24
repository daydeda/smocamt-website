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
