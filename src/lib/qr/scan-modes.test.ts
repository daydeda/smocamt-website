import { describe, expect, it } from "vitest";
import { availableScanModes, scansTagAsStaff } from "./scan-modes";

const modes = (roles: string[], shopManager = false, hasStaffPosition = false) =>
  availableScanModes({ roles, shopManager, hasStaffPosition });

describe("availableScanModes", () => {
  it("a plain student can only scan tags", () => {
    expect(modes(["student"])).toEqual(["tag"]);
  });

  it("smo gets tag, check-in and prize, but not shop unless a shop manager", () => {
    expect(modes(["smo"])).toEqual(["tag", "checkin", "prize"]);
    expect(modes(["smo"], true)).toEqual(["tag", "checkin", "prize", "shop"]);
  });

  it("admin and super_admin get every mode they manage", () => {
    expect(modes(["admin"], true)).toEqual(["tag", "checkin", "prize", "shop"]);
  });

  it("a shop seller sees shop only (plus tag): check-in would bounce off the admin proxy", () => {
    expect(modes(["student", "shop_seller"], true)).toEqual(["tag", "shop"]);
  });

  it("a staff position alone opens the check-in handoff but not prize", () => {
    expect(modes(["student"], false, true)).toEqual(["tag", "checkin"]);
  });
});

describe("scansTagAsStaff", () => {
  it("is true for the property-tag roles, false for students and presidents", () => {
    for (const r of ["super_admin", "admin", "registration", "organizer", "smo"]) expect(scansTagAsStaff([r])).toBe(true);
    for (const r of ["student", "anusmo", "club_president", "major_president", "shop_seller"]) expect(scansTagAsStaff([r])).toBe(false);
  });
});
