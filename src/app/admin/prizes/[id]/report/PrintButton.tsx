"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

// Tiny client island so the report page itself can stay a server component
// (it reads the DB and writes the export audit log).
export default function PrintButton() {
  const { t } = useLanguage();
  const [preparing, setPreparing] = useState(false);

  // Proof photos stream through an auth-guarded route and can still be loading
  // when staff hit Print — a PDF saved then has blank boxes where the evidence
  // should be. Wait for every photo to settle (loaded or failed) first.
  const handlePrint = async () => {
    setPreparing(true);
    const photos = Array.from(document.querySelectorAll<HTMLImageElement>("img.claim-photo"));
    await Promise.all(photos.map((img) => (img.complete ? null : img.decode().catch(() => null))));
    setPreparing(false);
    window.print();
  };

  return (
    <button onClick={handlePrint} disabled={preparing} className="btn btn-primary" style={{ flexShrink: 0 }}>
      {preparing ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Printer size={18} aria-hidden="true" />}
      {preparing ? t.adminPtPrzPrintPreparing : t.adminPtPrzPrintBtn}
    </button>
  );
}
