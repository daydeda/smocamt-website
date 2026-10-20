"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";
import {
  PRIVACY_COPY,
  PRIVACY_UPDATED,
  PrivacySections,
  privacyCard,
  privacyLangFor,
} from "@/components/PrivacyPolicyContent";

export default function PrivacyClient() {
  const { lang, setLang } = useLanguage();
  const active = privacyLangFor(lang);
  const c = PRIVACY_COPY[active];

  return (
    <main style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 16px 64px" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none" }}>
            ← {c.back}
          </Link>
          <div
            role="group"
            aria-label="Language"
            style={{ display: "inline-flex", padding: 3, gap: 2, background: "var(--bg-elevated)", borderRadius: 999 }}
          >
            {(["en", "th"] as const).map((l) => {
              const on = active === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={on}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    padding: "6px 16px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                    background: on ? "var(--accent-primary)" : "transparent",
                    color: on ? "var(--text-on-color)" : "var(--text-secondary)",
                  }}
                >
                  {l === "en" ? "EN" : "ไทย"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Header */}
        <header style={{ marginBottom: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/smocamt-logo.png" alt="SMO CAMT" style={{ height: 44, width: "auto", marginBottom: 18 }} />
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.2, marginBottom: 8 }}>
            {c.pageTitle}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {c.updated}: {PRIVACY_UPDATED}
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.75, color: "var(--text-secondary)" }}>{c.intro}</p>
        </header>

        {/* Table of contents */}
        <nav aria-label={c.onThisPage} style={{ ...privacyCard, marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            {c.onThisPage}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {c.sections.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  textDecoration: "none",
                }}
              >
                {i + 1}. {s.title}
              </a>
            ))}
          </div>
        </nav>

        <PrivacySections lang={active} />
      </div>
    </main>
  );
}
