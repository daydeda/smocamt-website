"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { parseRichText } from "@/lib/ui/rich-text";
import type { PublicEvent } from "@/lib/events/public-event";

export type PublicHouse = { id: string; name: string; color: string; points: number };

const LOCALE_TAG = { en: "en-GB", th: "th-TH", mm: "my-MM", cn: "zh-CN" } as const;

// Logged-out landing page for "/". Signed-in users are redirected to /dashboard by
// the server page. Everything shown here is guest-safe: upcoming events open to
// guests, team totals (no student names), and the public announcement.
export function PublicHome({
  events,
  houses,
  announcementBody,
}: {
  events: PublicEvent[];
  houses: PublicHouse[];
  announcementBody: string | null;
}) {
  const { t, lang } = useLanguage();
  const locale = LOCALE_TAG[lang as keyof typeof LOCALE_TAG] ?? "en-GB";
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const steps = [t.publicHomeStep1, t.publicHomeStep2, t.publicHomeStep3];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 24px" }}>
        <span style={{ fontWeight: 900, fontSize: 18 }}>ActiveCAMT</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LanguageSwitcher />
          <Link href="/login" className="btn btn-primary">{t.publicHomeSignIn}</Link>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "16px 20px 64px", display: "flex", flexDirection: "column", gap: 40 }}>
        <section style={{ paddingTop: 24 }}>
          <h1 style={{ fontSize: "clamp(34px, 7vw, 60px)", fontWeight: 950, letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 16 }}>
            Experience <span className="gradient-text">ActiveCAMT</span>
          </h1>
          <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 600, marginBottom: 24 }}>{t.signInSub}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Link href="/login" className="btn btn-primary">{t.publicHomeSignIn}</Link>
            <Link href="/dashboard/calendar" className="btn btn-ghost">{t.calendar}</Link>
            <Link href="/dashboard/shop" className="btn btn-ghost">{t.shop}</Link>
          </div>
        </section>

        {announcementBody && (
          <section className="glass" style={{ padding: 20, borderRadius: 20 }}>
            <div style={{ lineHeight: 1.7, color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: parseRichText(announcementBody) }} />
          </section>
        )}

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>{t.publicHomeHowTitle}</h2>
          <ol style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, listStyle: "none", padding: 0, margin: 0 }}>
            {steps.map((step, i) => (
              <li key={i} className="glass" style={{ padding: 20, borderRadius: 20 }}>
                <span style={{ display: "inline-flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 999, background: "var(--accent-primary)", color: "#fff", fontWeight: 800, marginBottom: 12 }}>{i + 1}</span>
                <p style={{ fontWeight: 700 }}>{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>{t.publicHomeEventsTitle}</h2>
          {events.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>{t.publicHomeNoEvents}</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: 16 }}>
              {events.map((e) => (
                <Link key={e.id} href={`/e/${e.id}`} className="glass" style={{ display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", color: "inherit", textDecoration: "none" }}>
                  {e.imageUrls[0] ? (
                    <img src={e.imageUrls[0]} alt={e.title} style={{ width: "100%", height: 140, objectFit: "cover" }} />
                  ) : null}
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                    <strong style={{ fontSize: 16, lineHeight: 1.3 }}>{e.title}</strong>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{fmt(e.startTime)}</span>
                    {e.location && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{e.location}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {houses.length > 0 && (
          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900 }}>{t.publicHomeHousesTitle}</h2>
              <Link href="/dashboard/houses" style={{ color: "var(--accent-primary)", fontWeight: 700 }}>{t.publicHomeSeeAll}</Link>
            </div>
            <ol style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
              {houses.map((h, i) => (
                <li key={h.id} className="glass" style={{ padding: 16, borderRadius: 16, borderTop: `6px solid ${h.color}` }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>#{i + 1}</span>
                  <div style={{ fontWeight: 800 }}>{h.name}</div>
                  <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{h.points.toLocaleString(locale)}</div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>{t.publicHomeInstall}</p>
      </main>
    </div>
  );
}
