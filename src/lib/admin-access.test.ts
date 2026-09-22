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
  canAwardPrizes,
  canManagePrizes,
  canExportPrizeReport,
  PRIZES_HREF,
  adminLandingHref,
  adminLandingHrefForRoles,
  isShopFinancePosition,
  isEventUnscopedStaff,
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

describe("prize claim predicates", () => {
  it("lets smo award a prize", () => {
    // Deliberate: the prize table is staffed like the scanner, and awarding is
    // one student at a time with that student standing there.
    expect(canAwardPrizes(["smo"])).toBe(true);
  });

  it("does NOT let smo configure a prize or pull the dean report", () => {
    // The report is every winner's name + รหัสนักศึกษา + face photo in one
    // forwardable file — same "ask an admin for the file" split the event
    // export already applies to smo.
    expect(canManagePrizes(["smo"])).toBe(false);
    expect(canExportPrizeReport(["smo"])).toBe(false);
  });

  it("lets the full admin roles do everything", () => {
    for (const role of ["super_admin", "admin", "organizer"]) {
      expect(canAwardPrizes([role])).toBe(true);
      expect(canManagePrizes([role])).toBe(true);
      expect(canExportPrizeReport([role])).toBe(true);
    }
  });

  it("lets club/major presidents award and manage (scoped server-side)", () => {
    for (const role of ["club_president", "major_president"]) {
      expect(canAwardPrizes([role])).toBe(true);
      expect(canManagePrizes([role])).toBe(true);
    }
  });

  it("keeps plain students and shop sellers out entirely", () => {
    for (const role of ["student", "anusmo", "shop_seller"]) {
      expect(canAwardPrizes([role])).toBe(false);
      expect(canManagePrizes([role])).toBe(false);
    }
  });

  it("honours a secondary role from roles[]", () => {
    // A president whose PRIMARY role resolves to anusmo must still be able to
    // award — the whole reason these predicates take the role SET.
    expect(canAwardPrizes(["anusmo", "club_president"])).toBe(true);
  });

  it("admits scanner-only roles to the prizes page", () => {
    expect(isScannerOnlyAllowedPath(PRIZES_HREF, ["smo"])).toBe(true);
    expect((SCANNER_ONLY_PAGES as readonly string[])).toContain(PRIZES_HREF);
  });

  it("still keeps a seller-only account out of the prizes page", () => {
    // shop_seller is confined to /admin/shop; a prize is not a shop item.
    expect(isScannerOnlyAllowedPath(PRIZES_HREF, ["shop_seller"])).toBe(false);
  });

  it("never lets someone export who cannot manage", () => {
    // The two are the same set TODAY and kept as separate predicates so they can
    // diverge. Export must never be the WIDER of the two.
    for (const roles of [["smo"], ["student"], ["admin"], ["club_president"], ["shop_seller"]]) {
      if (canExportPrizeReport(roles)) expect(canManagePrizes(roles)).toBe(true);
    }
  });
});

describe("isEventUnscopedStaff", () => {
  it("treats a bare smo as unscoped", () => {
    expect(isEventUnscopedStaff(["smo"])).toBe(true);
  });

  it("keeps smo unscoped even when the SAME account also holds a president role", () => {
    // The regression this predicate exists to fix: every event-scoped route used
    // to inline its own role list that omitted "smo", so the moment an smo also
    // held club_president/major_president, the president scope won and hid every
    // SMO-run event from them.
    expect(isEventUnscopedStaff(["smo", "club_president"])).toBe(true);
    expect(isEventUnscopedStaff(["smo", "major_president"])).toBe(true);
    expect(isEventUnscopedStaff(["smo", "club_president", "major_president"])).toBe(true);
  });

  it("scopes a plain president (no smo) as before", () => {
    expect(isEventUnscopedStaff(["club_president"])).toBe(false);
    expect(isEventUnscopedStaff(["major_president", "club_president"])).toBe(false);
  });

  it("treats every staff role as unscoped", () => {
    for (const role of ["super_admin", "admin", "registration", "organizer"]) {
      expect(isEventUnscopedStaff([role])).toBe(true);
    }
  });

  it("treats a GLOBAL registration position (smo/anusmo) as unscoped", () => {
    expect(isEventUnscopedStaff(["smo"], "registration")).toBe(true);
    expect(isEventUnscopedStaff(["anusmo"], undefined, "registration")).toBe(true);
  });

  it("does NOT treat an unrelated staff position as unscoped", () => {
    expect(isEventUnscopedStaff(["anusmo"], undefined, "secretary")).toBe(false);
    expect(isEventUnscopedStaff(["anusmo"])).toBe(false);
  });

  it("keeps plain students and shop sellers scoped out", () => {
    expect(isEventUnscopedStaff(["student"])).toBe(false);
    expect(isEventUnscopedStaff(["shop_seller"])).toBe(false);
    expect(isEventUnscopedStaff([])).toBe(false);
  });
});
