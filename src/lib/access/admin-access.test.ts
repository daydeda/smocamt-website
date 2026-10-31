import { describe, it, expect } from "vitest";
import {
  ADMIN_ENTRY_ROLES,
  canCheckInEveryEvent,
  canEnterAdminAny,
  isAnusmoRegistration,
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
  canManagePropertyTags,
  PRIZES_HREF,
  adminLandingHref,
  adminLandingHrefForRoles,
  isShopFinancePosition,
  isEventUnscopedStaff,
  canEditEventDirectly,
  canGiveIndividualScoreAny,
  isScannerOnlyAny,
  isGlobalRegistrationPosition,
  EVENT_UNSCOPED_ROLES,
  EVENT_DIRECT_EDIT_ROLES,
  PRIZE_MANAGE_ROLES,
  PROPERTY_TAG_ROLES,
  PRIZE_AWARD_ROLES,
} from "@/lib/access/admin-access";

// Every role the live model defines (users.role / users.roles[]), per CLAUDE.md +
// the source constants. The role matrix is the single source of truth for who may
// enter admin and where they land; pinning every role x predicate prevents another
// scanner-loop regression where one of the four gating layers drifts.
const ALL_ROLES = [
  "student",
  "smo",
  "anusmo",
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
    for (const role of ["admin", "super_admin"]) {
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

  it("allows the property-tag group and print sub-pages, but nothing deeper", () => {
    expect(isScannerOnlyAllowedPath("/admin/property-tags")).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/property-tags/abc-123")).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/property-tags/abc-123/print")).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/property-tags/abc-123/other")).toBe(false);
    expect(isScannerOnlyAllowedPath("/admin/property-tags/abc-123", ["student", "shop_seller"])).toBe(false);
  });

  it("confines a seller-only role to /admin/shop", () => {
    expect(isScannerOnlyAllowedPath("/admin/shop", ["student", "shop_seller"])).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/shop/abc-123", ["student", "shop_seller"])).toBe(true);
    expect(isScannerOnlyAllowedPath("/admin/shop/abc/x", ["student", "shop_seller"])).toBe(false);
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
    for (const role of ["super_admin", "admin"]) {
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
    for (const role of ["super_admin", "admin", "smo"]) {
      expect(isEventUnscopedStaff([role])).toBe(true);
    }
  });

  it("treats a GLOBAL registration position (smo) as unscoped", () => {
    expect(isEventUnscopedStaff(["smo"], "registration")).toBe(true);
  });

  it("does NOT treat the ANUSMO registration desk as unscoped (check-in only)", () => {
    expect(isEventUnscopedStaff(["anusmo"], undefined, "registration")).toBe(false);
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

describe("canEditEventDirectly", () => {
  it("allows the roles that write an event's live columns", () => {
    for (const role of ["super_admin", "admin"]) {
      expect(canEditEventDirectly([role])).toBe(true);
    }
  });

  it("allows a GLOBAL registration position", () => {
    expect(canEditEventDirectly(["smo"], "registration")).toBe(true);
    expect(canEditEventDirectly(["anusmo"], null, "registration")).toBe(false);
  });

  it("denies plain smo, presidents, sellers and students", () => {
    // smo can see every event but not edit one; president edits go through
    // review — neither may move an event's start time directly ("Go live now").
    expect(canEditEventDirectly(["smo"])).toBe(false);
    expect(canEditEventDirectly(["smo"], "finance")).toBe(false);
    expect(canEditEventDirectly(["club_president"])).toBe(false);
    expect(canEditEventDirectly(["major_president", "smo"])).toBe(false);
    expect(canEditEventDirectly(["shop_seller"])).toBe(false);
    expect(canEditEventDirectly(["student"])).toBe(false);
  });
});

describe("canManagePropertyTags", () => {
  it("allows super_admin, admin and smo", () => {
    for (const r of ["super_admin", "admin", "smo"]) {
      expect(canManagePropertyTags([r])).toBe(true);
    }
  });

  it("denies students, anusmo, presidents and sellers", () => {
    for (const r of ["student", "anusmo", "club_president", "major_president", "shop_seller"]) {
      expect(canManagePropertyTags([r])).toBe(false);
    }
  });
});

// The `registration` and `organizer` ROLES are retired. The registration desk is
// `smo` + smoPosition "registration", which must get exactly what the old
// registration role got, while plain smo gets nothing new. `anusmo` +
// anusmoPosition "registration" is a check-in-only desk.
describe("retired registration/organizer roles", () => {
  const SMO_REG = ["smo"];
  const ANUSMO_REG = ["anusmo"];

  it("the retired roles are in no role list any more", () => {
    for (const list of [
      ADMIN_ENTRY_ROLES, SCANNER_ONLY_ROLES, SCORING_ROLES, PRIZE_AWARD_ROLES, PRIZE_MANAGE_ROLES,
      PROPERTY_TAG_ROLES, EVENT_UNSCOPED_ROLES, EVENT_DIRECT_EDIT_ROLES,
    ] as unknown as readonly string[][]) {
      expect(list).not.toContain("registration");
      expect(list).not.toContain("organizer");
    }
  });

  it("the retired role names no longer grant anything on their own", () => {
    for (const role of ["registration", "organizer"]) {
      expect(canEnterAdmin(role)).toBe(false);
      expect(canGiveIndividualScoreAny([role])).toBe(false);
      expect(canAwardPrizes([role])).toBe(false);
      expect(canManagePrizes([role])).toBe(false);
      expect(canManagePropertyTags([role])).toBe(false);
      expect(canEditEventDirectly([role])).toBe(false);
      expect(isEventUnscopedStaff([role])).toBe(false);
    }
  });

  it("smo + global registration position passes every predicate the old role passed", () => {
    expect(canEditEventDirectly(SMO_REG, "registration")).toBe(true);
    expect(canManagePrizes(SMO_REG, "registration")).toBe(true);
    expect(canExportPrizeReport(SMO_REG, "registration")).toBe(true);
    expect(canAwardPrizes(SMO_REG, "registration")).toBe(true);
    expect(canGiveIndividualScoreAny(SMO_REG)).toBe(true);
    expect(canManagePropertyTags(SMO_REG, "registration")).toBe(true);
    expect(isEventUnscopedStaff(SMO_REG, "registration")).toBe(true);
    expect(canEnterAdmin("smo")).toBe(true);
  });

  it("smo + global registration position is a full admin user, not scanner-only", () => {
    expect(isScannerOnlyAny(SMO_REG, true, "registration")).toBe(false);
    expect(adminLandingHrefForRoles(SMO_REG, true, "registration")).toBe("/admin/dashboard");
  });

  it("anusmo + registration position may check in at every event and nothing else", () => {
    expect(isAnusmoRegistration(ANUSMO_REG, "registration")).toBe(true);
    expect(canCheckInEveryEvent(ANUSMO_REG, null, "registration")).toBe(true);
    expect(canEnterAdminAny(ANUSMO_REG, true)).toBe(true);
    // confined to the scanner, like other scanner-only holders
    expect(isScannerOnlyAny(ANUSMO_REG, true, null, "registration")).toBe(true);
    expect(adminLandingHrefForRoles(ANUSMO_REG, true, null, "registration")).toBe(SCANNER_HREF);
    // none of the registration-desk breadth
    expect(isGlobalRegistrationPosition(ANUSMO_REG, undefined, "registration")).toBe(false);
    expect(isEventUnscopedStaff(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canEditEventDirectly(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canManagePrizes(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canExportPrizeReport(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canAwardPrizes(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canManagePropertyTags(ANUSMO_REG, null, "registration")).toBe(false);
    expect(canGiveIndividualScoreAny(ANUSMO_REG)).toBe(false);
  });

  it("check-in at every event needs the registration position or unscoped staff", () => {
    expect(canCheckInEveryEvent(["smo"])).toBe(true);
    expect(canCheckInEveryEvent(["anusmo"], null, "secretary")).toBe(false);
    expect(canCheckInEveryEvent(["anusmo"])).toBe(false);
    expect(canCheckInEveryEvent(["student"], null, "registration")).toBe(false);
    expect(canCheckInEveryEvent(["club_president"])).toBe(false);
  });

  it("plain smo (no registration position) gains nothing", () => {
    expect(canEditEventDirectly(SMO_REG)).toBe(false);
    expect(canManagePrizes(SMO_REG)).toBe(false);
    expect(canManagePrizes(SMO_REG, "finance")).toBe(false);
    expect(canExportPrizeReport(SMO_REG)).toBe(false);
    expect(isScannerOnlyAny(SMO_REG, true)).toBe(true);
    expect(adminLandingHrefForRoles(SMO_REG, true)).toBe(SCANNER_HREF);
  });

  it("anusmo without the registration position gains nothing", () => {
    expect(canManagePrizes(ANUSMO_REG, null, "secretary")).toBe(false);
    expect(canAwardPrizes(ANUSMO_REG)).toBe(false);
    expect(canManagePropertyTags(ANUSMO_REG, null, "secretary")).toBe(false);
  });

  it("a position held without the matching role does not pass", () => {
    expect(canManagePrizes(["student"], "registration")).toBe(false);
    expect(canManagePrizes(["anusmo"], "registration")).toBe(false);
    expect(canEditEventDirectly(["smo"], null, "registration")).toBe(false);
  });

  it("a club/major-scoped registration position never passes a global check", () => {
    // Club/major scope lives in club_members.position / users.majorPosition and is
    // resolved by EventScopeService; none of it reaches these role+smo/anusmo checks.
    for (const roles of [["student"], ["club_president"], ["major_president"]]) {
      expect(isGlobalRegistrationPosition(roles, null, null)).toBe(false);
      expect(canEditEventDirectly(roles)).toBe(false);
      expect(isEventUnscopedStaff(roles)).toBe(false);
    }
    expect(isScannerOnlyAny(["student"], true, null, null)).toBe(true);
  });
});
