"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { effectiveRoles } from "@/lib/access/admin-access";
import { MajorProposeEventSection } from "./MajorProposeEventSection";
import { MajorTeamSection } from "./MajorTeamSection";
import { EventFeedbackFormsShortcut } from "@/components/admin/EventFeedbackFormsShortcut";
import { GraduationCap } from "lucide-react";

// major_president-only page — the major analogue of /admin/clubs's
// ProposeEventSection. A major has no roster/rename/archive/delete concept
// the way a club does (majors are a fixed code set, not a managed entity), so
// unlike ClubsPage this is a thin page: just the propose-event section, scoped
// to the signed-in president's OWN users.major. `major` isn't on the NextAuth
// session (see src/types/next-auth.d.ts), so it's fetched from GET /api/profile
// (self-access to one's own record — no cross-user PDPA exposure).
export default function MajorsPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const userRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const isMajorPresident = userRoles.includes("major_president");

  const [major, setMajor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Deferred via setTimeout so the setState calls fire after this render
    // commits, not synchronously within the effect — mirrors the pattern in
    // admin/clubs/page.tsx (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      if (!isMajorPresident) {
        setLoading(false);
        return;
      }
      fetch("/api/profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setMajor(d?.major || null))
        .catch(() => setMajor(null))
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMajorPresident]);

  return (
    <div className="animate-fade-in-up pb-24">
      <div style={{ marginBottom: 40 }}>
        <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">
          {t.manageMajors || "My Major"}
        </h1>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 100 }}>
          <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
        </div>
      ) : isMajorPresident && major ? (
        <>
          <EventFeedbackFormsShortcut scope="major" />
          <MajorTeamSection major={major} />
          <MajorProposeEventSection major={major} />
        </>
      ) : (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 40,
            padding: 100,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <GraduationCap size={40} style={{ color: "var(--text-muted)" }} />
          <p style={{ color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>
            {isMajorPresident
              ? "Your account has no major set yet — contact an admin."
              : "You haven't been assigned as a major president yet — contact an admin."}
          </p>
        </div>
      )}
    </div>
  );
}
