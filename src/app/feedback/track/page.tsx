"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, LogIn } from "lucide-react";
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

// Detail block for an expanded row — deliberately does NOT repeat
// category/status, since the collapsed toggle button right above it already
// shows both (an earlier version rendered them twice here, reported as
// visibly duplicated content).
function ComplaintDetail({
  complaint,
  tt,
  onClose,
  closing,
}: {
  complaint: TrackedComplaint;
  tt: (key: string, fallback: string) => string;
  onClose: () => void;
  closing: boolean;
}) {
  const severityMeta = FEEDBACK_SEVERITY_META[complaint.severity];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
      {complaint.status === "resolved" && (
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          className="btn btn-ghost btn-sm"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 99, alignSelf: "flex-start" }}
        >
          {closing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {tt("feedbackCloseBtn", "Mark as done")}
        </button>
      )}
    </div>
  );
}

// "My Feedback" — the submitter's own history, replacing the old public
// tracking-code lookup entirely (dropped 2026-08-13, docs §7.0/§8): since
// submission already requires login, the code wasn't buying additional
// anonymity, just UX cost. Requires being signed in — there is no
// code-based fallback anymore, so a signed-out visitor is prompted to sign
// in rather than shown any lookup box.
export default function FeedbackTrackPage() {
  const { t } = useLanguage();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;
  const { status: sessionStatus } = useSession();

  const [mine, setMine] = useState<TrackedComplaint[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  // Derived, not stored — mine stays null until the fetch resolves, so
  // "authenticated and still null" already means "loading" with no separate
  // setState needed at the top of the effect (avoids a synchronous setState
  // in the effect body, same reasoning as AppealsClient's own load()).
  const mineLoading = sessionStatus === "authenticated" && mine === null;

  const load = () => {
    fetch("/api/feedback/mine")
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d.complaints) ? d.complaints : []))
      .catch(() => setMine([]));
  };

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    load();
  }, [sessionStatus]);

  const closeComplaint = async (id: string) => {
    setClosingId(id);
    try {
      const res = await fetch(`/api/feedback/mine/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (res.ok) {
        setMine((prev) => prev?.map((c) => (c.id === id ? { ...c, status: "closed" } : c)) ?? prev);
      }
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Link href="/feedback/new" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, fontWeight: 600, marginBottom: 16, textDecoration: "none" }}>
          <ArrowLeft size={16} /> {tt("back", "Back")}
        </Link>

        <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 6px" }}>
          {tt("feedbackTrackTitle", "My Feedback")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.6 }}>
          {tt("feedbackMineIntro", "Everything you've sent from this account, and any staff reply.")}
        </p>

        {sessionStatus === "unauthenticated" && (
          <Link
            href="/login"
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, borderRadius: 10, padding: "0 20px" }}
          >
            <LogIn size={16} /> {tt("feedbackMineSignIn", "Sign in to see your submissions")}
          </Link>
        )}

        {sessionStatus === "authenticated" && (
          mineLoading ? (
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
                        <ComplaintDetail complaint={c} tt={tt} onClose={() => closeComplaint(c.id)} closing={closingId === c.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
