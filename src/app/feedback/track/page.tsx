"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { FEEDBACK_SEVERITY_META, FEEDBACK_STATUS_META, categoryMeta } from "@/lib/feedback-ui";
import type { FeedbackCategory, FeedbackSeverity, FeedbackStatus } from "@/lib/feedback-token";

interface TrackedComplaint {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  adminReply: string | null;
  createdAt: string;
  repliedAt: string | null;
}

// Public page, deliberately no auth (see src/proxy.ts's isPublicPath and
// docs/features/feedback-complaints.md §5.1) — the tracking code IS the
// credential, so a submitter can check back without ever logging in or
// revealing which account sent the original report.
export default function FeedbackTrackPage() {
  const { t } = useLanguage();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [complaint, setComplaint] = useState<TrackedComplaint | null>(null);

  const lookup = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setNotFound(false);
    setComplaint(null);
    try {
      const res = await fetch(`/api/feedback/track/${encodeURIComponent(trimmed)}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      if (res.ok) setComplaint(data.complaint);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const cat = complaint ? categoryMeta(complaint.category) : null;
  const statusMeta = complaint ? FEEDBACK_STATUS_META[complaint.status] : null;
  const severityMeta = complaint ? FEEDBACK_SEVERITY_META[complaint.severity] : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Link href="/feedback/new" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, fontWeight: 600, marginBottom: 16, textDecoration: "none" }}>
          <ArrowLeft size={16} /> {tt("back", "Back")}
        </Link>

        <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 6px" }}>
          {tt("feedbackTrackTitle", "Check status")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.6 }}>
          {tt("feedbackTrackIntro", "Enter the tracking code you saved when you submitted feedback or a complaint.")}
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            style={{ fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}
            placeholder={tt("feedbackTrackInputPlaceholder", "e.g. AB7KQ92XPM")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            maxLength={16}
          />
          <button type="button" className="btn btn-primary" onClick={lookup} disabled={loading || !code.trim()} style={{ height: 44, borderRadius: 10, padding: "0 18px", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {tt("feedbackTrackBtn", "Check")}
          </button>
        </div>

        {notFound && (
          <p style={{ marginTop: 16, fontSize: 13, color: "#dc2626" }}>
            {tt("feedbackTrackNotFound", "No complaint found for that code. Double-check it and try again.")}
          </p>
        )}

        {complaint && cat && statusMeta && severityMeta && (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                <cat.icon size={16} /> {tt(cat.i18nKey, cat.fallback)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99, color: statusMeta.color, background: statusMeta.bg }}>
                {tt(statusMeta.i18nKey, statusMeta.fallback)}
              </span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99, color: severityMeta.color, background: severityMeta.bg, alignSelf: "flex-start" }}>
              {tt(severityMeta.i18nKey, severityMeta.fallback)}
            </span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 6px" }}>
                {tt("feedbackTrackReplyLabel", "Staff reply")}
              </p>
              {complaint.adminReply ? (
                <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>{complaint.adminReply}</p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{tt("feedbackTrackNoReplyYet", "No reply yet — check back later.")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
