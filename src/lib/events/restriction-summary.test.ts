import { describe, expect, it } from "vitest";
import { buildViewer } from "@/lib/access/event-access";
import { summarizeRestrictions, unmetRestrictions } from "./restriction-summary";

const base = { allowedRoles: null, allowedMajors: null, allowedClubs: null, targetThai: true, targetInternational: true, allowedYears: null, firstYearOnly: null };

describe("summarizeRestrictions", () => {
  it("reports no restriction for an open event", () => {
    expect(summarizeRestrictions(base)).toEqual({ nationality: null, roles: [], majors: [], clubIds: [], years: [] });
  });
  it("treats both-unchecked as open", () => {
    expect(summarizeRestrictions({ ...base, targetThai: false, targetInternational: false }).nationality).toBeNull();
  });
  it("reports a single nationality", () => {
    expect(summarizeRestrictions({ ...base, targetInternational: false }).nationality).toBe("thai");
    expect(summarizeRestrictions({ ...base, targetThai: false }).nationality).toBe("intl");
  });
});

describe("unmetRestrictions", () => {
  const viewer = (over: Partial<Parameters<typeof buildViewer>[0]> = {}) =>
    buildViewer({ roles: ["student"], studentId: "690000001", major: "SE", ...over });

  it("is empty when the viewer qualifies", () => {
    expect(unmetRestrictions({ ...base, allowedMajors: ["SE"] }, viewer())).toEqual([]);
  });
  it("lists every failed rule", () => {
    const item = { ...base, allowedMajors: ["DG"], allowedClubs: ["c1"], allowedYears: [2], targetThai: false };
    expect(unmetRestrictions(item, viewer({ major: "SE" }))).toEqual(["nationality", "majors", "clubs", "years"]);
  });
  it("lets admin roles through every rule", () => {
    expect(unmetRestrictions({ ...base, allowedMajors: ["DG"] }, viewer({ roles: ["admin"] }))).toEqual([]);
  });
});
