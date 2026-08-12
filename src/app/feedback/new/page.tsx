"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Loader2,
  MessageSquareWarning,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { FEEDBACK_CATEGORY_META, categoryMeta } from "@/lib/feedback-ui";
import type { FeedbackCategory } from "@/lib/feedback-token";

type Step = "category" | "message" | "review" | "done";

const MESSAGE_MIN = 10;
// A generous technical backstop, not a practical limit — no legitimate
// complaint should ever get close to it. High enough that it's never a UX
// constraint (a detailed harassment report with dates/context easily runs
// past a tight cap like the old 3000), just a ceiling so a single submission
// can't blow up the notification email (feedback-notify.ts) or the admin
// list render. Must match the Zod schema in src/app/api/feedback/route.ts.
const MESSAGE_MAX = 10000;
const CONTACT_MAX = 200;

export default function FeedbackNewPage() {
  const { t } = useLanguage();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [contactOptIn, setContactOptIn] = useState(false);
  const [contactInfo, setContactInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectCategory = (id: FeedbackCategory) => {
    setCategory(id);
    setStep("message");
  };

  const canContinueFromMessage = message.trim().length >= MESSAGE_MIN;

  const submit = async () => {
    if (!category) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          contactOptIn,
          contactInfo: contactOptIn ? contactInfo.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to submit");
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const cat = category ? categoryMeta(category) : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 80px" }}>
        {step !== "done" && (
          <Link
            href="/dashboard"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, fontWeight: 600, marginBottom: 16, textDecoration: "none" }}
          >
            <ArrowLeft size={16} /> {tt("back", "Back")}
          </Link>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <MessageSquareWarning size={24} color="var(--accent-primary)" />
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
            {tt("vocFeedback", "Feedback & Complaints")}
          </h1>
        </div>

        {/* Deliberately its own full-width row, separate from the heading
            above — an earlier version crammed this into the header as a
            small pill next to the title and it read as ambiguous/easy to
            miss. Always reachable (not just right after submitting), so
            navigating away and coming back later still has a way in. */}
        {step !== "done" && (
          <Link
            href="/feedback/track"
            className="btn btn-ghost btn-full"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12, marginBottom: 20, fontSize: 14, fontWeight: 700 }}
          >
            <Search size={16} /> {tt("feedbackGoToTrack", "Check status")}
          </Link>
        )}

        {step === "category" && (
          <>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.6 }}>
              {tt(
                "feedbackNewIntro",
                "Your account is not shown to anyone reviewing this — not even senior admins. What they see is your message, category, and any attachment. There's no button in the system that lets anyone look up who sent it.",
              )}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {FEEDBACK_CATEGORY_META.map((c) => {
                const Icon = c.icon;
                const urgent = c.id === "harassment_safety";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCategory(c.id)}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8,
                      padding: 14, borderRadius: 14, textAlign: "left", cursor: "pointer",
                      background: urgent ? "rgba(239,68,68,0.06)" : "var(--bg-surface)",
                      border: `1px solid ${urgent ? "rgba(239,68,68,0.25)" : "var(--border-subtle)"}`,
                    }}
                  >
                    <Icon size={20} color={urgent ? "#dc2626" : "var(--accent-primary)"} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{tt(c.i18nKey, c.fallback)}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{tt(c.descI18nKey, c.descFallback)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "message" && cat && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              {/* Static tag, not clickable — reads as "this is your selection", not
                  as part of the action next to it (see the confusion this fixed:
                  "Category — Change category" read as one long descriptive line
                  with no visible affordance that the second half was a button). */}
              <span
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                  color: "var(--text-primary)", padding: "6px 12px", borderRadius: 99,
                  background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
                }}
              >
                <cat.icon size={16} color="var(--accent-primary)" /> {tt(cat.i18nKey, cat.fallback)}
              </span>
              {/* The actual action: a real button (pill, bordered, own icon) so it
                  visibly affords a tap, distinct from the tag above. */}
              <button
                type="button"
                onClick={() => setStep("category")}
                className="btn btn-ghost btn-sm"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 99 }}
              >
                <ArrowLeftRight size={14} /> {tt("feedbackBackToCategories", "Change category")}
              </button>
            </div>

            {category === "harassment_safety" && (
              <div style={{ display: "flex", gap: 10, padding: 12, borderRadius: 12, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                <ShieldAlert size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, margin: 0 }}>
                  {tt(
                    "feedbackSafetyNotice",
                    "If you're in immediate danger, please contact campus security or emergency services first — this form is reviewed by staff, not monitored in real time.",
                  )}
                </p>
              </div>
            )}
            {category === "house_points" && (
              <div style={{ display: "flex", gap: 10, padding: 12, borderRadius: 12, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                <Sparkles size={18} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, margin: 0 }}>
                  {tt("feedbackHousePointsHint", "Missed an event and want to appeal a no-show strike? Use the Appeal option on your ")}
                  <Link href="/dashboard" style={{ color: "var(--accent-primary)", fontWeight: 700 }}>{tt("upcomingEvents", "Dashboard")}</Link>
                  {tt("feedbackHousePointsHintSuffix", " instead — it's faster and this category is for other scoring disputes.")}
                </p>
              </div>
            )}

            <div>
              <label className="label" style={{ display: "block", marginBottom: 6 }}>
                {tt("feedbackMessageLabel", "What happened?")}
              </label>
              <textarea
                className="input"
                rows={7}
                maxLength={MESSAGE_MAX}
                placeholder={tt("feedbackMessagePlaceholder", "Describe what happened, when, and any other details that would help staff understand and act on this.")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{ resize: "vertical" }}
              />
              {/* No "X/MAX" counter here on purpose — a visible countdown
                  toward a cap reads as a constraint even when the cap itself
                  (MESSAGE_MAX) is a generous technical backstop nobody
                  should ever hit. Only the minimum is worth surfacing, since
                  that one's an actual quality bar (long enough to act on). */}
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {tt("feedbackMessageMinHint", `At least ${MESSAGE_MIN} characters`)}
              </span>
            </div>

            <div style={{ padding: 14, borderRadius: 12, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={contactOptIn}
                  onChange={(e) => setContactOptIn(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--accent-primary)", cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
                  {tt("feedbackContactOptInLabel", "I want staff to be able to reach me directly about this (optional — leaving this off keeps you fully anonymous).")}
                </span>
              </label>
              {contactOptIn && (
                <input
                  className="input"
                  style={{ marginTop: 10 }}
                  maxLength={CONTACT_MAX}
                  placeholder={tt("feedbackContactInfoPlaceholder", "Line ID, email, or another way to reach you")}
                  value={contactInfo}
                  onChange={(e) => setContactInfo(e.target.value)}
                />
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-full"
              disabled={!canContinueFromMessage}
              onClick={() => setStep("review")}
              style={{ height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {tt("feedbackContinueToReview", "Review before sending")} <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === "review" && cat && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
              {tt("feedbackReviewTitle", "Review before sending")}
            </h2>
            <div style={{ padding: 16, borderRadius: 14, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  <cat.icon size={16} /> {tt(cat.i18nKey, cat.fallback)}
                </span>
                <button type="button" onClick={() => setStep("category")} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}>
                  {tt("edit", "Edit")}
                </button>
              </div>
              <div>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>{message.trim()}</p>
                <button type="button" onClick={() => setStep("message")} style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {tt("edit", "Edit")}
                </button>
              </div>
              {contactOptIn && contactInfo.trim() && (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {tt("feedbackReviewContactPrefix", "Follow-up contact: ")}<span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{contactInfo.trim()}</span>
                </div>
              )}
            </div>

            {error && <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{error}</p>}

            <button
              type="button"
              className="btn btn-primary btn-full"
              disabled={submitting}
              onClick={submit}
              style={{ height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {submitting ? tt("submitting", "Sending…") : tt("feedbackSubmitBtn", "Send")}
            </button>
          </div>
        )}

        {step === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", paddingTop: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(20,184,166,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Check size={28} color="#0d9488" />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
              {tt("feedbackConfirmTitle", "Sent — thank you")}
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 440, lineHeight: 1.6, margin: 0 }}>
              {tt("feedbackConfirmBody", "Staff will review this. You can check its status and any reply anytime under My Feedback, from this account.")}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Link href="/feedback/track" className="btn btn-ghost" style={{ height: 42, borderRadius: 12, padding: "0 18px", display: "flex", alignItems: "center" }}>
                {tt("feedbackGoToTrack", "Check status")}
              </Link>
              <Link href="/dashboard" className="btn btn-primary" style={{ height: 42, borderRadius: 12, padding: "0 18px", display: "flex", alignItems: "center" }}>
                {tt("feedbackBackToDashboard", "Back to Dashboard")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
