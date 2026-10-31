"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { effectiveRoles } from "@/lib/access/admin-access";
import { ProposeEventSection } from "../_propose-event/ProposeEventSection";
import { MajorTeamSection } from "./MajorTeamSection";
import { ALL_MAJORS } from "../events/_lib/event-model";
import { EventFeedbackFormsShortcut } from "@/components/admin/EventFeedbackFormsShortcut";
import { EmptyState, Field, LoadingState, PageHeader, StatusBadge, Toolbar } from "@/components/admin/ui";
import { GraduationCap } from "lucide-react";

// Majors page. Two audiences:
// - a major_president sees THEIR OWN users.major: team roster + propose-event.
//   `major` isn't on the NextAuth session (see src/types/next-auth.d.ts), so
//   it's fetched from GET /api/profile (self-access to one's own record).
// - super_admin/admin (like /admin/clubs) may pick any major to see its team.
//   They create events directly, so the propose section stays president-only.
// The member/medical/export APIs under /api/admin/majors/[code] already gate
// this server-side (admin roles, or a president for their own major).
export default function MajorsPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const userRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const isMajorPresident = userRoles.includes("major_president");
  const isAdmin = userRoles.some((r) => r === "super_admin" || r === "admin");

  const [ownMajor, setOwnMajor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
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
        .then((d) => setOwnMajor(d?.major || null))
        .catch(() => setOwnMajor(null))
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMajorPresident]);

  // A president starts on their own major; an admin starts on the first one.
  const major = picked ?? (isMajorPresident && ownMajor ? ownMajor : isAdmin ? ALL_MAJORS[0] : null);
  const presidingHere = isMajorPresident && !!ownMajor && major === ownMajor;

  return (
    <div className="animate-fade-in-up pb-24">
      <PageHeader
        title={t.manageMajors || "My Major"}
        description={isAdmin ? t.adminCmMajorsDescAdmin : t.adminCmMajorsDesc}
        meta={
          !loading && presidingHere && major ? (
            <StatusBadge tone="accent" icon={<GraduationCap size={12} />}>
              {t.adminCmYourMajor.replace("{major}", major)}
            </StatusBadge>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingState label={t.adminCmLoadingMajor} />
      ) : major && (isAdmin || presidingHere) ? (
        <>
          {isAdmin && (
            <Toolbar>
              <div style={{ width: "100%", maxWidth: 240 }}>
              <Field label={t.adminCmPickMajor}>
                {(p) => (
                  <select {...p} className="input" value={major} onChange={(e) => setPicked(e.target.value)}>
                    {ALL_MAJORS.map((m) => (
                      <option key={m} value={m}>{m}{m === ownMajor ? ` (${t.adminCmYourMajorShort})` : ""}</option>
                    ))}
                  </select>
                )}
              </Field>
              </div>
            </Toolbar>
          )}
          {presidingHere && <EventFeedbackFormsShortcut scope="major" />}
          {/* key: reset the roster state when the admin switches major. */}
          <MajorTeamSection key={major} major={major} />
          {presidingHere && <ProposeEventSection scope={{ kind: "major", major }} />}
        </>
      ) : (
        <EmptyState
          icon={<GraduationCap size={24} />}
          title={isMajorPresident ? t.adminCmNoMajorTitle : t.adminCmNotMajorPresidentTitle}
          description={isMajorPresident ? t.adminCmNoMajorBody : t.adminCmNotMajorPresidentBody}
        />
      )}
    </div>
  );
}
