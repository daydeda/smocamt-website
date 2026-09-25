"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";

// Tiny client island so the report page itself can stay a server component
// (it reads the DB and writes the export audit log).
export default function PrintButton() {
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
    <button
      onClick={handlePrint}
      disabled={preparing}
      className="flex shrink-0 items-center gap-2 rounded-lg bg-neutral-900 text-sm font-semibold text-white shadow-sm hover:bg-neutral-700 disabled:opacity-60"
      // Inline padding: globals.css's unlayered `* { padding: 0 }` reset beats Tailwind's px-*/py-*.
      style={{ padding: "10px 16px" }}
    >
      {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      {preparing ? "กำลังโหลดรูป…" : "พิมพ์ / บันทึกเป็น PDF"}
    </button>
  );
}
