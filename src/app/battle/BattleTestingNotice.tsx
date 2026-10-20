"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/LanguageContext";

// Shown instead of a silent redirect when a role outside the staged rollout
// (see src/lib/battle-access.ts) opens /battle or a shared room/join link —
// a bounce to /dashboard reads as a broken link, this reads as "not yet".
export function BattleTestingNotice() {
  const { t } = useLanguage();

  return (
    <>
      <StudentNav />
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: "80px 24px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "var(--accent-glow)", color: "var(--accent-primary)", marginBottom: 20 }}>
          <FlaskConical size={40} />
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 10, letterSpacing: "-0.02em" }}>
          {t.battleTestingNoticeTitle}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: 420, marginBottom: 24 }}>
          {t.battleTestingNoticeDesc}
        </p>
        <Link href="/dashboard" className="btn" style={{ background: "var(--text-primary)", color: "var(--text-on-color)", height: 44, padding: "0 24px" }}>
          {t.backToDashboard}
        </Link>
      </main>
    </>
  );
}
