// Which things the student-side Scan page offers a given user. Pure, so the
// role rules are unit-tested; every mode's server route still re-checks the
// role (this only decides what the page SHOWS).
import {
  SCANNER_HREF,
  canAwardPrizes,
  canEnterAdminAny,
  canManagePropertyTags,
  isScannerOnlyAllowedPath,
  isScannerOnlyAny,
} from "@/lib/access/admin-access";

export type ScanModeId = "tag" | "checkin" | "prize" | "shop";

export interface ScanModeInput {
  roles: string[];
  /** isShopManager(session): shop admin, finance, president or approved seller. */
  shopManager: boolean;
  /** Any staff position (club/major/smo/anusmo) — grants confined admin entry. */
  hasStaffPosition?: boolean;
}

/**
 * Everyone gets "tag". Staff additionally get the modes they could already use
 * on /admin/scanner. Order matches that page (check-in, prize, shop).
 */
export function availableScanModes(input: ScanModeInput): ScanModeId[] {
  const modes: ScanModeId[] = ["tag"];
  // Check-in is a handoff to /admin/scanner, so offer it only to someone the
  // proxy will actually let through (a seller-only account is confined to /admin/shop).
  const canReachScanner =
    canEnterAdminAny(input.roles, input.hasStaffPosition) &&
    (!isScannerOnlyAny(input.roles, input.hasStaffPosition) ||
      isScannerOnlyAllowedPath(SCANNER_HREF, input.roles, input.hasStaffPosition));
  if (canReachScanner) modes.push("checkin");
  if (canAwardPrizes(input.roles)) modes.push("prize");
  if (input.shopManager) modes.push("shop");
  return modes;
}

/**
 * Staff who manage property tags assign owners when they scan one; everyone
 * else (students, presidents, sellers) just sees the owner pop-up.
 */
export function scansTagAsStaff(roles: string[]): boolean {
  return canManagePropertyTags(roles);
}
