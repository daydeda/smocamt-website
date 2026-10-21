"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, QrCode, Tag } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import PropertyTagPanel from "../property-tags/PropertyTagPanel";

// The scanner's "Tags" tab — assign or check a property tag without leaving
// the scanner. It only opens the same PropertyTagPanel (and the same
// /api/admin/property-tags routes) as /admin/property-tags.
//
// Like the Prize/Shop tabs, the parent page stops its own camera while this
// tab is active — the panel runs its own html5-qrcode instance.
export default function ScannerPropertyTab() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(true);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
      <div className="stat-card" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <p style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
          <Tag size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          {t.scannerPropertyHint}
        </p>
        <Link href="/admin/property-tags" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--accent-primary)" }}>
          {t.scannerPropertyManageLink} <ArrowRight size={14} />
        </Link>
      </div>

      <button className="btn btn-success-solid btn-lg" style={{ alignSelf: "flex-start", minHeight: 52 }} onClick={() => setOpen(true)}>
        <QrCode size={18} /> {t.adminPtScanAssign}
      </button>

      {open && <PropertyTagPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
