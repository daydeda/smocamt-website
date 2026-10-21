import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { effectiveRoles } from "@/lib/access/admin-access";
import { isShopManager } from "@/lib/shop/shop-auth";
import { availableScanModes, scansTagAsStaff } from "@/lib/qr/scan-modes";
import ScanClient from "./ScanClient";

export const dynamic = "force-dynamic";

// The one in-app scanner. What it offers depends on the role set, computed here
// from the session; each mode's API re-checks the role itself, so this decides
// what is SHOWN, never what is allowed.
export default async function ScanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const roles = effectiveRoles(session.user.role, session.user.roles);
  const modes = availableScanModes({
    roles,
    shopManager: isShopManager(session),
    hasStaffPosition: session.user.hasStaffPosition,
  });

  return <ScanClient modes={modes} staffTag={scansTagAsStaff(roles)} />;
}
