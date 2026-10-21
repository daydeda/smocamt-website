"use client";

import ScannerPrizeTab from "./ScannerPrizeTab";
import ScannerShopTab from "./ScannerShopTab";
import ScannerPropertyTab from "./ScannerPropertyTab";
import { useScannerScreen } from "./_lib/useScannerScreen";
import { ScanModeTabs } from "./_components/ScanModeTabs";
import { ScannerMainColumn } from "./_components/ScannerMainColumn";
import { ScannerSideColumn } from "./_components/ScannerSideColumn";
import { ScanResultModal } from "./_components/ScanResultModal";

export default function ScannerScreen({ embedded = false }: { embedded?: boolean }) {
  const ctx = useScannerScreen({ embedded });
  const { eventId, scanMode, selectedEvent, t } = ctx;

  return (
    <div className="animate-fade-in">
      {!embedded && (
      <div className="mb-10" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <h1 style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.3 }}>{t.qrScanner}</h1>
        
        {/* Mode Selector — each tab gated by its own predicate; hidden entirely
            when check-in is the only mode this role has. */}
        <ScanModeTabs ctx={ctx} />
      </div>
      )}

      {scanMode === "prize" ? (
        <ScannerPrizeTab eventId={eventId} eventTitle={selectedEvent?.title ?? null} />
      ) : scanMode === "shop" ? (
        <ScannerShopTab />
      ) : scanMode === "property" ? (
        <ScannerPropertyTab />
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6 items-start">
        
        {/* Left: Main Scanner Area */}
        <ScannerMainColumn ctx={ctx} />

        {/* Right: Manual Override & Stats */}
        <ScannerSideColumn ctx={ctx} />
      </div>
      )}

      {/* Result Modal */}
      <ScanResultModal ctx={ctx} />
    </div>
  );
}
