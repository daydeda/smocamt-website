"use client";

import { Award, Briefcase, Shield, ShieldCheck, User as UserIcon } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { StatusBadge, type Tone } from "@/components/admin/ui";

const STAFF_ROLES = ["staff", "professor", "officer"];

/** Role pills next to a student's name. Plain "student" shows nothing, as before. */
export function RoleBadges({ roles }: { roles: string[] }) {
  const { t } = useLanguage();
  const config: Record<string, { tone: Tone; icon: React.ReactNode; label: string }> = {
    super_admin: { tone: "danger", icon: <Shield size={12} />, label: t.roleSuperAdmin },
    admin: { tone: "warning", icon: <ShieldCheck size={12} />, label: t.roleAdmin },
    registration: { tone: "info", icon: <UserIcon size={12} />, label: t.roleRegistration },
    organizer: { tone: "success", icon: <Award size={12} />, label: t.roleOrganizer },
    smo: { tone: "accent", icon: <Award size={12} />, label: t.roleSMO },
    anusmo: { tone: "accent", icon: <Award size={12} />, label: t.roleANUSMO },
    club_president: { tone: "warning", icon: <Award size={12} />, label: t.roleClubPresident },
    major_president: { tone: "info", icon: <Award size={12} />, label: t.roleMajorPresident },
  };
  return (
    <>
      {roles.map((r, idx) => {
        const c = config[r];
        if (c) return <StatusBadge key={`${r}-${idx}`} tone={c.tone} icon={c.icon}>{c.label}</StatusBadge>;
        if (STAFF_ROLES.includes(r)) {
          return <StatusBadge key={`${r}-${idx}`} tone="neutral" icon={<Briefcase size={12} />}>{t.roleStaff}</StatusBadge>;
        }
        return null;
      })}
    </>
  );
}
