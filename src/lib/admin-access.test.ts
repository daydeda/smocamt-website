import { describe, it, expect } from "vitest";
import {
  ADMIN_ENTRY_ROLES,
  SCANNER_ONLY_ROLES,
  SCORING_ROLES,
  SCANNER_HREF,
  SCANNER_ONLY_PAGES,
  isScannerOnlyAllowedPath,
  canEnterAdmin,
  isScannerOnlyRole,
  canGiveIndividualScore,
  adminLandingHref,
  adminLandingHrefForRoles,
  isShopFinancePosition,
} from "@/lib/admin-access";

// Every role the live model defines (users.role / users.roles[]), per CLAUDE.md +
// the source constants. The role matrix is the single source of truth for who may
// enter admin and where they land; pinning every role x predicate prevents another
// scanner-loop regression where one of the four gating layers drifts.
const ALL_ROLES = [
  "student",
  "smo",
  "anusmo",
  "registration",
  "organizer",
  "admin",
  "super_admin",
  "club_president",
  "major_president",
  "shop_seller",
] as const;

// Non-role inputs the predicates must treat as "no access".
const NON_ROLES: (string | null | undefined)[] = [undefined, null, "", "Admin", "SUPER_ADMIN", "guest", "root"];

describe("admin-access constants (source of truth)", () => {
  it("scanner-only roles include the shop-confined seller capability", () => {
    expect([...SCANNER_ONLY_ROLES].sort()).toEqual(["club_president", "major_president", "shop_seller", "smo"]);
  });

  it("every scanner-only role is also an admin-entry role", () => {
    for (const role of SCANNER_ONLY_ROLES) {
      expect(ADMIN_ENTRY_ROLES).toContain(role);
    }
  });

  it("the president scanner-only roles are NOT scoring roles (check-in only)", () => {
    expect(SCORING_ROLES).not.toContain("club_president");
    expect(SCORING_ROLES).not.toContain("major_president");
  });

  it("smo is a scoring role (full scanner: check-in + scoring)", () => {
    expect(SCORING_ROLES).toContain("smo");
  });

  it("student is in no privileged constant", () => {
    expect(ADMIN_ENTRY_ROLES).not.toContain("student" as never);
    expect(SCANNER_ONLY_ROLES).not.toContain("student" as never);
    expect(SCORING_ROLES).not.toContain("student" as never);
  });

  it("SCANNER_HREF is the canonical scanner path and a scanner-only page", () => {
    expect(SCANNER_HREF).toBe("/admin/scanner");
    expect(SCANNER_ONLY_PAGES).toContain(SCANNER_HREF);
  });
});

describe("canEnterAdmin", () => {
  for (const role of ALL_ROLES) {
    const expected = (ADMIN_ENTRY_ROLES as readonly string[]).includes(role);
    it(`${role} -> ${expected}`, () => {
      expect(canEnterAdmin(role)).toBe(expected);
    });
  }

  it("student cannot enter admin (load-bearing invariant)", () => {
    expect(canEnterAdmin("student")).toBe(false);
  });

  it("anusmo cannot enter admin", () => {
    expect(canEnterAdmin("anusmo")).toBe(false);
  });

  for (const role of NON_ROLES) {
    it(`non-role ${JSON.stringify(role)} -> false`, () => {
      expect(canEnterAdmin(role)).toBe(false);
    });
  }
});

describe("isScannerOnlyRole", () => {
  for (const role of ALL_ROLES) {
    const expected = (SCANNER_ONLY_ROLES as readonly string[]).includes(role);
    it(`${role} -> ${expected}`, () => {
      expect(isScannerOnlyRole(role)).toBe(expected);
    });
  }

  it("smo / club_president / major_president are scanner-only (load-bearing invariant)", () => {
    expect(isScannerOnlyRole("smo")).toBe(true);
    expect(isScannerOnlyRole("club_president")).toBe(true);
    expect(isScannerOnlyRole("major_president")).toBe(true);
    expect(isScannerOnlyRole("shop_seller")).toBe(true);
  });

  it("full admin roles are NOT scanner-only", () => {
    expect(isScannerOnlyRole("admin")).toBe(false);
    expect(isScannerOnlyRole("super_admin")).toBe(false);
    expect(isScannerOnlyRole("registration")).toBe(false);
    expect(isScannerOnlyRole("organizer")).toBe(false);
  });

  for (const role of NON_ROLES) {
    it(`non-role ${JSON.stringify(role)} -> false`, () => {
      expect(isScannerOnlyRole(role)).toBe(false);
    });
  }
});

describe("canGiveIndividualScore", () => {
  for (const role of ALL_ROLES) {
    const expected = (SCORING_ROLES as readonly string[]).includes(role);
    it(`${role} -> ${expected}`, () => {
      expect(canGiveIndividualScore(role)).toBe(expected);
    });
  }

  it("president roles may scan attendance but must NOT score individuals", () => {
    expect(canGiveIndividualScore("club_president")).toBe(false);
    expect(canGiveIndividualScore("major_president")).toBe(false);
  });

  it("smo and the full admin roles may score", () => {
    expect(canGiveIndividualScore("smo")).toBe(true);
    expect(canGiveIndividualScore("registration")).toBe(true);
    expect(canGiveIndividualScore("organizer")).toBe(true);
    expect(canGiveIndividualScore("admin")).toBe(true);
    expect(canGiveIndividualScore("super_admin")).toBe(true);
  });

  for (const role of NON_ROLES) {
    it(`non-role ${JSON.stringify(role)} -> false`, () => {
      expect(canGiveIndividualScore(role)).toBe(false);
    });
  }
});

describe("adminLandingHref", () => {
  it("scanner-only roles land on the scanner", () => {
    expect(adminLandingHref("smo")).toBe(SCANNER_HREF);
    expect(adminLandingHref("club_president")).toBe(SCANNER_HREF);
    expect(adminLandingHref("major_president")).toBe(SCANNER_HREF);
    expect(adminLandingHref("shop_seller")).toBe(SCANNER_HREF);
  });

  it("full admin roles land on the dashboard", () => {
    for (const role of ["admin", "super_admin", "registration", "organizer"]) {
      expect(adminLandingHref(role)).toBe("/admin/dashboard");
    }
  });

  it("unknown / non-roles fall through to the dashboard href (not scanner)", () => {
    // Note: adminLandingHref does NOT itself gate entry — canEnterAdmin does.
    // It only chooses scanner-vs-dashboard for an already-admitted user.
    for (const role of NON_ROLES) {
      expect(adminLandingHref(role)).toBe("/admin/dashboard");
    }
  });
});

describe("isScannerOnlyAllowedPath", () => {
  for (const page of SCANNER_ONLY_PAGES) {
    it(`allows ${page}`, () => {
      expect(isScannerOnlyAllowedPath(page)).toBe(true);
    });
  }

  it("allows /admin, /admin/scanner, /admin/events exactly", () => {
    expect(isScannerOnlyAllowedPath("/admin")).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/scanner")).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/events")).toBe(true);
  });

  it("denies sensitive admin pages for scanner-only roles", () => {
    expect(isScannerOnlyAllowedPath("/admin/dashboard")).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/users")).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/audit")).toBe(false);
  });

  it("is exact-match: no /admin/events/* sub-paths leak through", () => {
    expect(isScannerOnlyAllowedPath("/admin/events/123")).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/scanner/extra")).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/")).toBe(false);
  });

  it("confines a seller-only role to /admin/shop", () => {
    expect(isScannerOnlyAllowedPath("/admin/shop", ["student", "shop_seller"])).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/events", ["student", "shop_seller"])).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/scanner", ["student", "shop_seller"])).toBe(false);
    expect(adminLandingHrefForRoles(["student", "shop_seller"])).toBe("/admin/shop");
  });

  it("preserves the existing confined pages when a seller also holds a staff position", () => {
    expect(isScannerOnlyAllowedPath("/admin/events", ["student", "shop_seller"], true)).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/shop", ["student", "shop_seller"], true)).toBe(true);
  });
});

describe("isShopFinancePosition", () => {
  it("grants marketplace review only to an SMO finance holder", () => {
    expect(isShopFinancePosition(["smo"], "finance")).toBe(true);
    expect(isShopFinancePosition(["anusmo"], "finance")).toBe(false);
    expect(isShopFinancePosition(["smo"], "registration")).toBe(false);
    expect(isShopFinancePosition(["student"], "finance")).toBe(false);
  });
});
