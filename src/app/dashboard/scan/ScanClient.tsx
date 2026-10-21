"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { QrCode } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { ScanModeId } from "@/lib/qr/scan-modes";
import ScannerPrizeTab from "@/app/admin/scanner/ScannerPrizeTab";
import ScannerShopTab from "@/app/admin/scanner/ScannerShopTab";

// These two open a camera dialog on first render (createPortal into
// document.body), so they must never be server-rendered.
const TagScanDialog = dynamic(() => import("../items/TagScanDialog"), { ssr: false });
// The full admin check-in screen, embedded (title + tab row hidden). Browser-only:
// it touches the camera and window on mount.
const ScannerScreen = dynamic(() => import("@/app/admin/scanner/ScannerScreen"), { ssr: false });
const ScannerPropertyTab = dynamic(() => import("@/app/admin/scanner/ScannerPropertyTab"), { ssr: false });

// The staff modes reuse the exact panels the admin scanner mounts (same
// components, same /api/admin routes and role checks) — only one is mounted at
// a time because each runs its own camera. Check-in embeds the admin scanner
// screen itself (ScannerScreen, embedded) rather than a copy, so its medical
// warnings, walk-in rules and evidence photos can't drift.
export default function ScanClient({ modes, staffTag }: { modes: ScanModeId[]; staffTag: boolean }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<ScanModeId>("tag");
  const [studentCameraOpen, setStudentCameraOpen] = useState(true);

  const label: Record<ScanModeId, string> = {
    tag: t.scanModeTag,
    checkin: t.scanModeCheckin,
    prize: t.scanModePrize,
    shop: t.scanModeShop,
  };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <StudentNav />

      <main className="page-container" style={{ marginTop: 48, paddingBottom: 100 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "clamp(30px,6vw,40px)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: 10 }}>{t.scanPageTitle}</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 16, fontWeight: 500 }}>{t.scanPageSubtitle}</p>
        </div>

        {modes.length > 1 && (
          <div role="group" style={{ display: "inline-flex", maxWidth: "100%", overflowX: "auto", background: "var(--bg-elevated)", padding: 4, borderRadius: 12, border: "1px solid var(--border-subtle)", marginBottom: 24 }}>
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  border: "none",
                  cursor: "pointer",
                  background: mode === m ? "var(--bg-surface)" : "transparent",
                  color: mode === m ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: mode === m ? "0 4px 12px rgb(var(--shadow-rgb) / 0.05)" : "none",
                }}
              >
                {label[m]}
              </button>
            ))}
          </div>
        )}

        {mode === "tag" && staffTag && <ScannerPropertyTab />}

        {mode === "tag" && !staffTag && (
          <>
            <button className="btn btn-primary btn-lg" onClick={() => setStudentCameraOpen(true)}>
              <QrCode size={18} /> {t.itemsScanBtn}
            </button>
            {studentCameraOpen && <TagScanDialog onClose={() => setStudentCameraOpen(false)} />}
          </>
        )}

        {mode === "checkin" && <ScannerScreen embedded />}

        {mode === "prize" && <ScannerPrizeTab eventId="" eventTitle={null} />}
        {mode === "shop" && <ScannerShopTab />}
      </main>
    </div>
  );
}
