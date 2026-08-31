import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import {
  isShopAdmin,
  isShopManager,
  isProductOwnedByScope,
  filterProductsByScope,
  isOwnerAssignmentWithinScope,
  type ShopScope,
} from "@/lib/shop-auth";

// Minimal session stub — only session.user.role / session.user.roles matter here.
const sess = (roles: string[]): Session =>
  ({ user: { roles } } as unknown as Session);

describe("isShopAdmin", () => {
  it("is true only for super_admin / admin", () => {
    expect(isShopAdmin(sess(["super_admin"]))).toBe(true);
    expect(isShopAdmin(sess(["admin"]))).toBe(true);
    expect(isShopAdmin(sess(["admin", "club_president"]))).toBe(true);
  });
  it("is false for presidents, scanner-only, and non-staff", () => {
    for (const r of ["club_president", "major_president", "smo", "organizer", "registration", "student"]) {
      expect(isShopAdmin(sess([r]))).toBe(false);
    }
    expect(isShopAdmin(null)).toBe(false);
    expect(isShopAdmin({ user: {} } as Session)).toBe(false);
  });
});

describe("isShopManager", () => {
  it("admits full admins AND club/major presidents", () => {
    for (const r of ["super_admin", "admin", "club_president", "major_president"]) {
      expect(isShopManager(sess([r]))).toBe(true);
    }
  });
  it("rejects smo, organizer, registration, student, and no session", () => {
    for (const r of ["smo", "organizer", "registration", "student", "anusmo"]) {
      expect(isShopManager(sess([r]))).toBe(false);
    }
    expect(isShopManager(null)).toBe(false);
  });
});

const scope: ShopScope = { clubIds: ["club-a", "club-b"], majors: ["SE"] };

describe("isProductOwnedByScope", () => {
  it("matches on the club axis", () => {
    expect(isProductOwnedByScope({ ownerClubIds: ["club-a"], ownerMajors: [] }, scope)).toBe(true);
  });
  it("matches on the major axis", () => {
    expect(isProductOwnedByScope({ ownerClubIds: [], ownerMajors: ["SE"] }, scope)).toBe(true);
  });
  it("a central product (no owner) is owned by nobody", () => {
    expect(isProductOwnedByScope({ ownerClubIds: [], ownerMajors: [] }, scope)).toBe(false);
    expect(isProductOwnedByScope({}, scope)).toBe(false);
  });
  it("a foreign owner does not match", () => {
    expect(isProductOwnedByScope({ ownerClubIds: ["club-x"], ownerMajors: ["ANI"] }, scope)).toBe(false);
  });
});

describe("filterProductsByScope", () => {
  it("keeps only owned products, drops central + foreign", () => {
    const products = [
      { id: "1", ownerClubIds: ["club-a"], ownerMajors: [] },
      { id: "2", ownerClubIds: [], ownerMajors: ["SE"] },
      { id: "3", ownerClubIds: [], ownerMajors: [] }, // central
      { id: "4", ownerClubIds: ["club-x"], ownerMajors: [] }, // foreign
    ];
    expect(filterProductsByScope(products, scope).map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("isOwnerAssignmentWithinScope", () => {
  it("requires at least one owner (a president can't make a central product)", () => {
    expect(isOwnerAssignmentWithinScope([], [], scope)).toBe(false);
  });
  it("accepts owners entirely inside the scope", () => {
    expect(isOwnerAssignmentWithinScope(["club-a", "club-b"], ["SE"], scope)).toBe(true);
    expect(isOwnerAssignmentWithinScope(["club-a"], [], scope)).toBe(true);
  });
  it("rejects any owner outside the scope", () => {
    expect(isOwnerAssignmentWithinScope(["club-a", "club-x"], [], scope)).toBe(false);
    expect(isOwnerAssignmentWithinScope([], ["ANI"], scope)).toBe(false);
  });
});
