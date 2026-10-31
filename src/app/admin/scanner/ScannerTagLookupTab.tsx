"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { QrCode, Tag } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const TagScanDialog = dynamic(() => import("@/app/dashboard/items/TagScanDialog"), { ssr: false });

// The scanner's "Tags" tab for staff who can't manage property tags
// (presidents, sellers): scan a tag to see who owns it — the same owner pop-up
// students get on /dashboard/scan. Staff who manage tags get ScannerPropertyTab.
//
// Like the other own-camera tabs, the parent page stops its camera while this
// tab is active, and the dialog opens only when the user asks for it.
export default function ScannerTagLookupTab() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
      <div className="stat-card" style={{ padding: "18px 20px" }}>
        <p style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
          <Tag size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          {t.itemsScanHint}
        </p>
      </div>

      <button className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start", minHeight: 52 }} onClick={() => setOpen(true)}>
        <QrCode size={18} /> {t.itemsScanBtn}
      </button>

      {open && <TagScanDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
