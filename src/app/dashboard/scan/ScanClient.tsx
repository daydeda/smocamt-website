"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { QrCode } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { ScanModeId } from "@/lib/qr/scan-modes";
import ScannerShopTab from "@/app/admin/scanner/ScannerShopTab";

// These open a camera on mount, so they must never be server-rendered.
const TagScanDialog = dynamic(() => import("../items/TagScanDialog"), { ssr: false });
// The staff scanner shared with /admin/scanner (same tabs: Check-in, Scan
// Score, Prize, Shop, Tags — each shown only to roles allowed to use it).
// Embedded = this page supplies the title; everything else is identical.
const ScannerScreen = dynamic(() => import("@/app/admin/scanner/ScannerScreen"), { ssr: false });

// Three audiences:
// - staff who can reach the admin scanner (checkin mode): the shared ScannerScreen,
//   opening on Check-in so nobody is dropped into tag scanning;
// - a seller-only account (no check-in, confined to /admin/shop): Tag + Shop;
// - everyone else: the owner lookup for a property tag, nothing more.
export default function ScanClient({ modes }: { modes: ScanModeId[] }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<ScanModeId>("tag");
  const [studentCameraOpen, setStudentCameraOpen] = useState(true);
  const staffScanner = modes.includes("checkin");
  const otherModes = modes.filter((m) => m === "tag" || m === "shop");

  const label: Partial<Record<ScanModeId, string>> = { tag: t.scanModeTag, shop: t.scanModeShop };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <StudentNav />

      <main className="page-container" style={{ marginTop: 48, paddingBottom: 100 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: "clamp(30px,6vw,40px)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: 10 }}>{t.scanPageTitle}</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 16, fontWeight: 500 }}>{t.scanPageSubtitle}</p>
        </div>

        {staffScanner ? (
          <ScannerScreen embedded />
        ) : (
          <>
            {otherModes.length > 1 && (
              <div role="group" style={{ display: "inline-flex", maxWidth: "100%", overflowX: "auto", background: "var(--bg-elevated)", padding: 4, borderRadius: 12, border: "1px solid var(--border-subtle)", marginBottom: 24 }}>
                {otherModes.map((m) => (
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

            {mode === "tag" && (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => setStudentCameraOpen(true)}>
                  <QrCode size={18} /> {t.itemsScanBtn}
                </button>
                {studentCameraOpen && <TagScanDialog onClose={() => setStudentCameraOpen(false)} />}
              </>
            )}
            {mode === "shop" && <ScannerShopTab />}
          </>
        )}
      </main>
    </div>
  );
}
