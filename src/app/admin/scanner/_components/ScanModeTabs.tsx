"use client";

import { Award, Gift, QrCode, ShoppingBag, Tag } from "lucide-react";
import { Tabs, type TabItem } from "@/components/admin/ui";
import type { ScanMode } from "./scanner-parts";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

/** Shared with the <TabPanel> in ScannerScreen. */
export const SCANNER_TABS_ID = "scn";

// One tab bar for /admin/scanner and /dashboard/scan. "Tags" is always there:
// tag managers get the assign/check panel, everyone else the owner lookup.
export function ScanModeTabs({ ctx }: { ctx: ScannerScreenCtx }) {
  const { canPrize, canProperty, canScore, canShop, scanMode, selectMode, t } = ctx;

  const tabs: (TabItem<ScanMode> & { show: boolean })[] = [
    { id: "checkin", label: t.scanModeCheckin, icon: <QrCode size={16} />, show: true },
    { id: "score", label: t.scanModeScore, icon: <Award size={16} />, show: canScore },
    { id: "prize", label: t.scanModePrize, icon: <Gift size={16} />, show: canPrize },
    { id: "shop", label: t.scanModeShop, icon: <ShoppingBag size={16} />, show: canShop },
    { id: canProperty ? "property" : "lookup", label: t.scanModeProperty, icon: <Tag size={16} />, show: true },
  ];

  return (
    <Tabs<ScanMode>
      tabs={tabs.filter((x) => x.show).map(({ id, label, icon }) => ({ id, label, icon }))}
      value={scanMode}
      onChange={selectMode}
      ariaLabel={t.adminScnModesLabel}
      idBase={SCANNER_TABS_ID}
    />
  );
}
