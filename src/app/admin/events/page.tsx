"use client";

import { Plus, Search, X, AlertTriangle } from "lucide-react";
import { EventFormBuilderModal } from "@/components/admin/EventFormBuilderModal";
import { EMPTY_FORM } from "./_lib/event-model";
import { useAdminEventsPage } from "./_lib/useAdminEventsPage";
import { EventFormPanel } from "./_components/EventFormPanel";
import { EventsGrid } from "./_components/EventsGrid";
import { AttendanceModal } from "./_components/AttendanceModal";
import { StrikesModal } from "./_components/StrikesModal";
import { StudentProfileModal } from "./_components/StudentProfileModal";
import { ConfirmModal } from "./_components/ConfirmModal";
import { ErrorModal } from "./_components/ErrorModal";

export default function AdminEventsPage() {
  const ctx = useAdminEventsPage();
  const { ensureAssigneeUsersLoaded, fetchEvents, filterStatus, formEventId, formEventTitle, isAttendanceOnly, lang, reviewNoticeModal, searchQuery, setEditingId, setFilterStatus, setFormData, setFormEventId, setFormEventTitle, setRegistrationMode, setReviewNoticeModal, setSearchQuery, setSessions, setShowForm, setShowFormBuilder, setSourceProposalId, showForm, showFormBuilder, t } = ctx;

  return (
    <>
      <div className="animate-fade-in-up" style={{ paddingBottom: 100 }}>
        {/* Main Header */}
        <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 20 }}>
          <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">{t.eventsTitle}</h1>
          {!isAttendanceOnly && (
          <button
            className={`btn ${showForm ? "btn-ghost" : "btn-primary"} flex-shrink-0 transition-all duration-300 ${!showForm && "shadow-[0_12px_32px_var(--accent-glow)]"}`}
            style={{ gap: 10, minHeight: 52, paddingInline: 28, borderRadius: 99, fontSize: 15, fontWeight: 700 }}
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                setEditingId(null);
                setFormData(EMPTY_FORM);
                setSourceProposalId(null);
                setRegistrationMode(null);
                setSessions([]);
              } else {
                setEditingId(null);
                setFormData(EMPTY_FORM);
                setSourceProposalId(null);
                setRegistrationMode(null);
                // Seed one empty session row so a single-day event still submits
                // a valid session; it stays in sync with start/end below.
                setSessions([{ title: "", startTime: "", endTime: "", quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }]);
                setShowForm(true);
                ensureAssigneeUsersLoaded();
              }
            }}
          >
            {showForm ? <><X size={18} /> {lang === "th" ? "ปิดตัวแก้ไข" : lang === "cn" ? "关闭编辑器" : lang === "mm" ? "အယ်ဒီတာ ပိတ်ရန်" : "Close Editor"}</> : <><Plus size={18} /> {t.addEventBtn}</>}
          </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3" style={{ marginBottom: 48 }}>
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              className="input w-full h-12"
              style={{ paddingLeft: 48, borderRadius: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
              placeholder={t.searchEventsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "live", "upcoming", "past"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "8px 20px",
                  minHeight: 44,
                  borderRadius: 99,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  border: filterStatus === s ? "1px solid var(--accent-primary)" : "1px solid transparent",
                  background: filterStatus === s ? "var(--accent-glow)" : "var(--bg-elevated)",
                  color: filterStatus === s ? "var(--accent-primary)" : "var(--text-secondary)"
                }}
              >
                {s === "all" ? t.filterAll : s === "live" ? t.filterLive : s === "upcoming" ? t.filterUpcoming : t.filterPast}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <EventFormPanel ctx={ctx} />

      {/* Events Grid */}
      <EventsGrid ctx={ctx} />

      {/* Global CSS for the premium experience */}
      <style jsx global>{`
        .event-card-premium:hover {
          transform: translateY(-8px);
          border-color: var(--accent-primary);
          box-shadow: 0 30px 60px rgb(var(--accent-rgb) / 0.1);
        }
        .event-card-premium:hover .hover-overlay {
          opacity: 1;
        }
        .attendance-card:hover {
          transform: scale(1.02);
          border-color: var(--accent-primary);
          background: var(--bg-elevated);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-medium);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }

        /* Attendance Modal Responsive Styles */
        .attendance-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgb(var(--scrim-rgb) / 0.7);
          backdrop-filter: blur(16px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(12px, 3vw, 24px);
        }
        .attendance-modal-container {
          background: var(--bg-surface);
          width: 100%;
          max-width: 1100px;
          max-height: 90vh;
          border-radius: clamp(20px, 4vw, 40px);
          padding: 0;
          /* The whole modal scrolls as one column. Only the header is pinned
             (sticky), so the summary + filters scroll away and the roster gets
             the full height instead of being squeezed by tall fixed chrome. */
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-medium);
          box-shadow: 0 50px 120px rgb(var(--shadow-rgb) / 0.4);
          position: relative;
        }
        .attendance-modal-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: linear-gradient(to right, var(--bg-surface), var(--bg-elevated));
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .attendance-modal-header h2 {
          font-size: clamp(18px, 4vw, 28px);
          font-weight: 900;
          letter-spacing: -0.04em;
          margin: 0;
        }
        .attendance-modal-close-btn {
          border-radius: 50%;
          width: 40px;
          height: 40px;
          padding: 0;
          font-size: 20px;
          flex-shrink: 0;
        }
        .attendance-modal-actions-bar {
          padding: 12px 20px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .attendance-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex: 1 1 0;
          min-width: 0;
          border-radius: 99px;
          height: 40px;
          padding-inline: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .attendance-modal-filter-bar {
          padding: 12px 20px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .attendance-modal-list {
          padding: 20px;
        }

        @media (min-width: 1024px) {
          .attendance-modal-header {
            padding: 24px 40px;
          }
          .attendance-modal-header h2 {
            font-size: 32px;
          }
          .attendance-modal-close-btn {
            width: 48px;
            height: 48px;
          }
          .attendance-modal-actions-bar {
            padding: 16px 40px;
            gap: 10px;
          }
          .attendance-action-btn {
            flex: 0 0 auto;
            height: 48px;
            padding-inline: 20px;
            font-size: 14px;
            gap: 8px;
          }
          .attendance-modal-filter-bar {
            padding: 16px 40px;
            gap: 16px;
          }
          .attendance-modal-list {
            padding: 40px;
          }
        }
      `}</style>
      </div>

      {/* Evaluation Form Builder Modal */}
      {showFormBuilder && formEventId && (
        <EventFormBuilderModal
          eventId={formEventId}
          eventTitle={formEventTitle || "Event"}
          onClose={() => { setShowFormBuilder(false); setFormEventId(null); setFormEventTitle(null); }}
          onChanged={fetchEvents}
        />
      )}

      {/* Premium custom Confirm Modal */}
      <ConfirmModal ctx={ctx} />

      {/* Premium custom Error Modal */}
      <ErrorModal ctx={ctx} />

      {/* Informational "pending review" notice — see reviewNoticeModal above. */}
      {reviewNoticeModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setReviewNoticeModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgb(var(--amber-500-rgb) / 0.1)",
              color: "var(--amber-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertTriangle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {reviewNoticeModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {reviewNoticeModal.message}
            </p>
            <button
              className="btn btn-primary"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800 }}
              onClick={() => setReviewNoticeModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "รับทราบ" : "Got it"}
            </button>
          </div>
        </div>
      )}

      {/* Attendance Modal */}
      <AttendanceModal ctx={ctx} />

      {/* No-show Strikes Confirm Modal */}
      <StrikesModal ctx={ctx} />

      {/* Student Profile Modal */}
      <StudentProfileModal ctx={ctx} />
    </>
  );
}
