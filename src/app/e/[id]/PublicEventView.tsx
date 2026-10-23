"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import type { PublicEvent } from "@/lib/events/public-event";
import { googleCalendarUrl, outlookCalendarUrl, type CalItem } from "@/lib/calendar/ical";
import { loginHref } from "@/lib/util/safe-callback-url";

const LOCALE_TAG = { en: "en-GB", th: "th-TH", mm: "my-MM", cn: "zh-CN" } as const;

export function PublicEventView({ event }: { event: PublicEvent }) {
  const { t, lang } = useLanguage();
  const locale = LOCALE_TAG[lang as keyof typeof LOCALE_TAG] ?? "en-GB";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const cover = event.imageUrls[0];
  const calItem: CalItem = {
    uid: `event-${event.id}`,
    title: event.title,
    description: event.description,
    location: event.location,
    start: new Date(event.startTime),
    end: new Date(event.endTime),
  };
  const seatsLabel = event.quota
    ? `${event.registeredCount} / ${event.quota}`
    : `${event.registeredCount}`;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px" }}>
        <Link href="/dashboard" style={{ fontWeight: 800, color: "var(--text-primary)", textDecoration: "none" }}>ActiveCAMT</Link>
        <LanguageSwitcher />
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "8px 16px 48px" }}>
        {cover && (
          <img
            src={cover}
            alt={event.title}
            style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 20, marginBottom: 20 }}
          />
        )}
        <h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 900, lineHeight: 1.15, marginBottom: 16 }}>{event.title}</h1>

        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 16px", fontSize: 15, marginBottom: 24 }}>
          <dt style={{ fontWeight: 700, color: "var(--text-muted)" }}>{t.publicEventWhen}</dt>
          <dd>{fmt(event.startTime)} – {fmt(event.endTime)}</dd>
          {event.location && (
            <>
              <dt style={{ fontWeight: 700, color: "var(--text-muted)" }}>{t.publicEventWhere}</dt>
              <dd>{event.location}</dd>
            </>
          )}
          {event.registrationOpenTime && (
            <>
              <dt style={{ fontWeight: 700, color: "var(--text-muted)" }}>{t.publicEventRegOpen}</dt>
              <dd>{fmt(event.registrationOpenTime)}</dd>
            </>
          )}
          <dt style={{ fontWeight: 700, color: "var(--text-muted)" }}>{t.publicEventSeats}</dt>
          <dd>{seatsLabel}</dd>
        </dl>

        {event.walkInsOnly && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>{t.publicEventWalkIn}</p>
        )}

        <Link
          href={loginHref(`/dashboard?event=${encodeURIComponent(event.id)}`)}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            height: 48, padding: "0 24px", borderRadius: 16, fontWeight: 800,
            background: "var(--accent-primary)", color: "#fff", textDecoration: "none",
          }}
        >
          {t.publicEventSignIn}
        </Link>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 20, fontSize: 14 }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.calendarAddToCalendar}</span>
          <a href={googleCalendarUrl(calItem)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Google</a>
          <a href={outlookCalendarUrl(calItem)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Outlook</a>
        </div>

        {event.description && (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.publicEventAbout}</h2>
            <p style={{ whiteSpace: "pre-line", lineHeight: 1.7, color: "var(--text-secondary)" }}>{event.description}</p>
          </section>
        )}

        <p style={{ marginTop: 40 }}>
          <Link href="/dashboard" style={{ color: "var(--accent-primary)", fontWeight: 700 }}>{t.publicEventBrowse}</Link>
        </p>
      </main>
    </div>
  );
}
