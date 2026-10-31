"use client";

import { PageHeader, TabPanel } from "@/components/admin/ui";
import ScannerPrizeTab from "./ScannerPrizeTab";
import ScannerShopTab from "./ScannerShopTab";
import ScannerPropertyTab from "./ScannerPropertyTab";
import ScannerTagLookupTab from "./ScannerTagLookupTab";
import { useScannerScreen } from "./_lib/useScannerScreen";
import { ScanModeTabs, SCANNER_TABS_ID } from "./_components/ScanModeTabs";
import { ScannerMainColumn } from "./_components/ScannerMainColumn";
import { ScannerSideColumn } from "./_components/ScannerSideColumn";
import { ScanResultModal } from "./_components/ScanResultModal";

// The one staff scanner, shared by /admin/scanner and /dashboard/scan
// (`embedded`: the student shell supplies its own page title). Change it here
// and both places follow.
export default function ScannerScreen({ embedded = false }: { embedded?: boolean }) {
  const ctx = useScannerScreen({ embedded });
  const { eventId, scanMode, selectedEvent, t } = ctx;

  const body = scanMode === "prize" ? (
    <ScannerPrizeTab eventId={eventId} eventTitle={selectedEvent?.title ?? null} />
  ) : scanMode === "shop" ? (
    <ScannerShopTab />
  ) : scanMode === "property" ? (
    <ScannerPropertyTab />
  ) : scanMode === "lookup" ? (
    <ScannerTagLookupTab />
  ) : (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6 items-start">
      {/* Camera, current event and live status */}
      <ScannerMainColumn ctx={ctx} />

      {/* Manual lookup fallback */}
      <ScannerSideColumn ctx={ctx} />
    </div>
  );

  return (
    <div className="animate-fade-in">
      {!embedded && <PageHeader title={t.qrScanner} description={t.adminScnPageDesc} />}
      {/* Each tab is gated by its own predicate; check-in is the default. */}
      <ScanModeTabs ctx={ctx} />

      <TabPanel idBase={SCANNER_TABS_ID} id={scanMode}>{body}</TabPanel>

      {/* Result sheet */}
      <ScanResultModal ctx={ctx} />
    </div>
  );
}
