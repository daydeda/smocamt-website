"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { StudentNav } from "@/components/layout/StudentNav";
import { StudentFooter } from "@/components/layout/StudentFooter";
import type { RestrictionKey } from "@/lib/events/restriction-summary";
import { loginHref } from "@/lib/util/safe-callback-url";

export type RestrictedEventInfo = {
  title: string;
  /** Requirements the event sets, with names already resolved. */
  nationality: "thai" | "intl" | null;
  roles: string[];
  majors: string[];
  clubNames: string[];
  years: number[];
  /** Requirements this visitor fails. Empty for a guest, who can't be checked. */
  unmet: RestrictionKey[];
  signedIn: boolean;
  /** This page's own path, so sign-in returns the visitor here. */
  returnPath: string;
};

export function RestrictedEventView({ event }: { event: RestrictedEventInfo }) {
  const { t } = useLanguage();
  const row = (key: RestrictionKey, label: string, value: string) => {
    const isUnmet = event.unmet.includes(key);
    return (
      <div key={key} style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
        padding: "12px 16px", borderRadius: 14,
        background: "var(--bg-elevated)",
        border: `1px solid ${isUnmet ? "var(--red-500)" : "var(--border-subtle)"}`,
      }}>
        <span style={{ fontWeight: 700, color: "var(--text-muted)", fontSize: 14 }}>{label}</span>
        <span style={{ textAlign: "right", fontWeight: 700, fontSize: 14 }}>
          {value}
          {isUnmet && (
            <span style={{ display: "block", fontSize: 12, color: "var(--red-500)", marginTop: 2 }}>
              {t.restrictedNotMet}
            </span>
          )}
        </span>
      </div>
    );
  };

  const rows: React.ReactNode[] = [];
  if (event.nationality) {
    rows.push(row("nationality", t.restrictedNationality,
      event.nationality === "thai" ? t.restrictedNationalityThai : t.restrictedNationalityIntl));
  }
  if (event.roles.length) {
    const names = event.roles.map((r) => r === "student" ? t.restrictedRoleStudent : r === "staff" ? t.restrictedRoleStaff : r);
    rows.push(row("roles", t.restrictedRoles, names.join(", ")));
  }
  if (event.years.length) {
    const names = event.years.map((y) => t.restrictedYearN.replace("{n}", String(y)));
    rows.push(row("years", t.restrictedYears, names.join(", ")));
  }
  if (event.majors.length) {
    rows.push(row("majors", t.restrictedMajors, event.majors.join(", ")));
  }
  if (event.clubNames.length) {
    rows.push(row("clubs", t.restrictedClubs, event.clubNames.join(", ")));
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <StudentNav />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 48px" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgb(var(--red-500-rgb) / 0.1)", color: "var(--red-500)", marginBottom: 20,
        }}>
          <Lock size={26} />
        </div>
        <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text-muted)", marginBottom: 6 }}>{event.title}</p>
        <h1 style={{ fontSize: "clamp(26px, 5vw, 34px)", fontWeight: 900, lineHeight: 1.2, marginBottom: 12 }}>{t.restrictedTitle}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)", marginBottom: 28 }}>
          {event.signedIn ? t.restrictedIntroSignedIn : t.restrictedIntroGuest}
        </p>

        {rows.length > 0 && (
          <section>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{t.restrictedRequirements}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{rows}</div>
          </section>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 28 }}>
          {!event.signedIn && (
            <Link href={loginHref(event.returnPath)} style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              height: 48, padding: "0 24px", borderRadius: 16, fontWeight: 800,
              background: "var(--accent-primary)", color: "#fff", textDecoration: "none",
            }}>
              {t.publicEventSignIn}
            </Link>
          )}
          <Link href="/dashboard" style={{ color: "var(--accent-primary)", fontWeight: 700 }}>{t.publicEventBrowse}</Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 32 }}>{t.restrictedContact}</p>
      </main>
      <StudentFooter />
    </div>
  );
}
