"use client";

import { Printer } from "lucide-react";

// Tiny client island so the report page itself can stay a server component
// (it reads the DB and writes the export audit log).
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex shrink-0 items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
    >
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
