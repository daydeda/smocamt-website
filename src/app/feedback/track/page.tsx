"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
  message: string;
  adminReply: string | null;
  createdAt: string;
  repliedAt: string | null;
}

// Shared detail block — used both for an expanded "my submissions" row and
// for a code-lookup result, so the two don't drift into two different
// layouts for the same information.
function ComplaintDetail({ complaint, tt }: { complaint: TrackedComplaint; tt: (key: string, fallback: string) => string }) {
  const cat = categoryMeta(complaint.category);
  const statusMeta = FEEDBACK_STATUS_META[complaint.status];
  const severityMeta = FEEDBACK_SEVERITY_META[complaint.severity];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          {tt("feedbackTrackYourMessageLabel", "What you sent")}
        </p>
        <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>{complaint.message}</p>
      </div>
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
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
  );
}

// Public page, no auth required at the route level (see src/proxy.ts's
// isPublicPath) — the tracking code is still a valid way to check a
// submission without being logged in. But when the visitor IS logged in, the
// page leads with their own submissions (via /api/feedback/mine, matched
// server-side against their own re-derived submitterRef — see
// src/modules/feedback/feedback.service.ts's listMine) so losing a saved
// code is no longer the only way to ever see a reply again. The manual
// code-lookup box stays available underneath as a fallback (checking from a
// different device, a different account, or while logged out).
export default function FeedbackTrackPage() {
  const { t } = useLanguage();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;
  const { status: sessionStatus } = useSession();

  const [mine, setMine] = useState<TrackedComplaint[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Derived, not stored — mine stays null until the fetch resolves, so
  // "authenticated and still null" already means "loading" with no separate
  // setState needed at the top of the effect (avoids a synchronous setState
  // in the effect body, same reasoning as AppealsClient's own load()).
  const mineLoading = sessionStatus === "authenticated" && mine === null;

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetch("/api/feedback/mine")
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d.complaints) ? d.complaints : []))
      .catch(() => setMine([]));
  }, [sessionStatus]);

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

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Link href="/feedback/new" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, fontWeight: 600, marginBottom: 16, textDecoration: "none" }}>
          <ArrowLeft size={16} /> {tt("back", "Back")}
        </Link>

        <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 6px" }}>
          {tt("feedbackTrackTitle", "Check status")}
        </h1>

        {sessionStatus === "authenticated" && (
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
              {tt("feedbackMineIntro", "Your own submissions from this account, so you never need to rely only on a saved code.")}
            </p>
            {mineLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Loader2 size={20} className="animate-spin" color="var(--text-muted)" />
              </div>
            ) : mine && mine.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{tt("feedbackMineEmpty", "You haven't sent any feedback or complaints yet.")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mine?.map((c) => {
                  const cat = categoryMeta(c.category);
                  const statusMeta = FEEDBACK_STATUS_META[c.status];
                  const isOpen = expandedId === c.id;
                  return (
                    <div key={c.id} style={{ borderRadius: 14, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : c.id)}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 14, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <cat.icon size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {tt(cat.i18nKey, cat.fallback)}
                          </span>
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, color: statusMeta.color, background: statusMeta.bg, flexShrink: 0 }}>
                          {tt(statusMeta.i18nKey, statusMeta.fallback)}
                        </span>
                      </button>
                      {isOpen && (
                        <div style={{ padding: "0 14px 14px" }}>
                          <ComplaintDetail complaint={c} tt={tt} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ borderTop: sessionStatus === "authenticated" ? "1px solid var(--border-subtle)" : undefined, paddingTop: sessionStatus === "authenticated" ? 20 : 0 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
            {sessionStatus === "authenticated"
              ? tt("feedbackTrackIntroSignedIn", "Checking a code from somewhere else? Enter it here.")
              : tt("feedbackTrackIntro", "Enter the tracking code you saved when you submitted feedback or a complaint.")}
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

          {complaint && (
            <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
              <ComplaintDetail complaint={complaint} tt={tt} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
