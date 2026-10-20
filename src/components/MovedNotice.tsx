/**
 * Full-page "we've moved" gate for the retired Vercel deployment.
 *
 * The app is now self-hosted at activecamt.camt.cmu.ac.th with its own database.
 * The Vercel deployment still points at a *separate* (now stale) Supabase DB, so
 * we must stop people from using it — any write here would diverge from the live
 * data. This screen REPLACES the entire app on Vercel (see src/app/layout.tsx),
 * so the old UI never renders and no stale writes are possible.
 *
 * Self-contained on purpose: it renders outside the LanguageProvider/SessionProvider,
 * so it carries its own bilingual (TH/EN) copy and inline styles and depends on nothing.
 */

const NEW_URL = "https://activecamt.camt.cmu.ac.th/dashboard";
const ACCENT = "var(--accent-primary)";

export function MovedNotice() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "32px 24px",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ maxWidth: 460, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/smocamt-logo-icon.png" alt="ActiveCAMT" width={72} height={72} style={{ borderRadius: 18 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2, margin: 0 }}>
            เราย้ายบ้านใหม่แล้ว 🚚
          </h1>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-secondary)", margin: 0 }}>
            We&rsquo;ve moved to a new home
          </p>
        </div>

        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)", margin: 0 }}>
          ActiveCAMT ได้ย้ายไปยังเซิร์ฟเวอร์ใหม่ของมหาวิทยาลัยแล้ว
          กรุณาเข้าใช้งานและบันทึกลิงก์ใหม่นี้
          <br />
          <br />
          ActiveCAMT now runs on the university server. Please use and bookmark the
          new address below — this old site is no longer active.
        </p>

        <a
          href={NEW_URL}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "14px 20px",
            borderRadius: 14,
            background: ACCENT,
            color: "var(--text-on-color)",
            fontSize: 16,
            fontWeight: 800,
            textDecoration: "none",
            boxShadow: "0 4px 14px rgb(var(--accent-rgb) / 0.35)",
          }}
        >
          ไปยังเว็บไซต์ใหม่ / Go to the new site →
        </a>

        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, wordBreak: "break-all" }}>
          activecamt.camt.cmu.ac.th
        </p>
      </div>
    </main>
  );
}
