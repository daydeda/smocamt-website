"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { AlertTriangle, CheckCircle2, LogIn, Tag, UserRound } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

export type TagViewState =
  | { kind: "signed_out" }
  | { kind: "needs_profile" }
  | { kind: "invalid" }
  | { kind: "unassigned" }
  | { kind: "rate_limited" }
  | { kind: "error" }
  | {
      kind: "assigned";
      isMine: boolean;
      owner: { name: string; studentId: string | null; major: string | null; year: number | null };
    };

// The pop-up a student sees after scanning a sticker with their phone camera.
// Shows exactly the four agreed fields and nothing else.
export default function TagView({ state, callbackUrl }: { state: TagViewState; callbackUrl: string }) {
  const { t } = useLanguage();

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        background: "var(--bg-base)",
      }}
    >
      <div
        className="animate-fade-in-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-title"
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 24,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 24px 60px rgb(var(--shadow-rgb) / 0.18)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/smocamt-logo-icon.png" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
            <h1 id="tag-title" style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{t.tagPageTitle}</h1>
          </div>
          <LanguageSwitcher />
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <Body state={state} callbackUrl={callbackUrl} />
        </div>
      </div>
    </main>
  );
}

function Body({ state, callbackUrl }: { state: TagViewState; callbackUrl: string }) {
  const { t } = useLanguage();

  if (state.kind === "assigned") {
    const { owner } = state;
    const rows: [string, string][] = [
      [t.tagFieldName, owner.name],
      [t.tagFieldStudentId, owner.studentId ?? "—"],
      [t.tagFieldMajor, owner.major ?? "—"],
      [t.tagFieldYear, owner.year ? t.tagYearValue.replace("{n}", String(owner.year)) : "—"],
    ];
    return (
      <>
        {state.isMine ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "rgb(var(--green-500-rgb) / 0.12)", color: "var(--teal-600)", fontWeight: 800, fontSize: 16 }}>
            <CheckCircle2 size={22} /> {t.tagIsYours}
          </div>
        ) : (
          <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            <UserRound size={16} /> {t.tagOwnerHeading}
          </p>
        )}
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 16, rowGap: 12, margin: 0 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>{label}</dt>
              <dd style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{value}</dd>
            </div>
          ))}
        </dl>
        {!state.isMine && (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{t.tagFoundHint}</p>
        )}
        <HomeLink />
      </>
    );
  }

  if (state.kind === "signed_out") {
    return (
      <>
        <Message icon={<LogIn size={22} />} text={t.tagSignInPrompt} />
        <button className="btn btn-primary btn-lg btn-full" onClick={() => signIn("google", { callbackUrl })}>
          {t.tagSignInBtn}
        </button>
      </>
    );
  }

  if (state.kind === "needs_profile") {
    return (
      <>
        <Message icon={<UserRound size={22} />} text={t.tagFinishProfile} />
        <Link href="/onboarding" className="btn btn-primary btn-lg btn-full">{t.tagFinishProfileBtn}</Link>
      </>
    );
  }

  const text =
    state.kind === "unassigned" ? t.tagUnassigned
      : state.kind === "rate_limited" ? t.tagRateLimited
        : state.kind === "invalid" ? t.tagInvalid
          : t.tagError;
  return (
    <>
      <Message icon={state.kind === "unassigned" ? <Tag size={22} /> : <AlertTriangle size={22} />} text={text} />
      <HomeLink />
    </>
  );
}

function Message({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, color: "var(--text-primary)" }}>
      <span style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function HomeLink() {
  const { t } = useLanguage();
  return (
    <Link href="/dashboard" className="btn btn-ghost btn-full">{t.tagGoHome}</Link>
  );
}
