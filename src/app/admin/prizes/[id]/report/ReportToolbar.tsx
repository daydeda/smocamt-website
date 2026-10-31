"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import PrintButton from "./PrintButton";

// Screen-only chrome above the report paper (the page hides it with .no-print
// when printing). The report itself stays Thai and server-rendered; only this
// toolbar follows the admin's language.
export default function ReportToolbar() {
  const { t } = useLanguage();
  return (
    <>
      <Link href="/admin/prizes" className="adm-back-link pr-back">
        <ArrowLeft size={16} aria-hidden="true" /> {t.adminPtPrzReportBack}
      </Link>
      <p className="pr-hint">{t.adminPtPrzReportHint}</p>
      <PrintButton />
    </>
  );
}
