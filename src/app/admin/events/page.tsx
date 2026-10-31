"use client";

import { AlertTriangle, Plus, Search, X } from "lucide-react";
import { EventFormBuilderModal } from "@/components/admin/EventFormBuilderModal";
import { Modal, PageHeader, Toolbar } from "@/components/admin/ui";
import { EMPTY_FORM } from "./_lib/event-model";
import { useAdminEventsPage } from "./_lib/useAdminEventsPage";
import { EventFormPanel } from "./_components/EventFormPanel";
import { EventsGrid } from "./_components/EventsGrid";
import { AttendanceModal } from "./_components/AttendanceModal";
import { StrikesModal } from "./_components/StrikesModal";
import { StudentProfileModal } from "./_components/StudentProfileModal";
import { ConfirmModal } from "./_components/ConfirmModal";
import { ErrorModal } from "./_components/ErrorModal";
import { FilterChip } from "./_components/FilterChip";
import { fmt } from "./_components/fmt";

export default function AdminEventsPage() {
  const ctx = useAdminEventsPage();
  const { ensureAssigneeUsersLoaded, events, fetchEvents, filterStatus, filteredEvents, formEventId, formEventTitle, isAttendanceOnly, loading, reviewNoticeModal, searchQuery, setEditingId, setFilterStatus, setFormData, setFormEventId, setFormEventTitle, setRegistrationMode, setReviewNoticeModal, setSearchQuery, setSessions, setShowForm, setShowFormBuilder, setSourceProposalId, showForm, showFormBuilder, t } = ctx;

  const toggleForm = () => {
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
  };

  const closeReviewNotice = () => setReviewNoticeModal((prev) => ({ ...prev, show: false }));

  return (
    <>
      <div className="animate-fade-in-up" style={{ paddingBottom: 48 }}>
        <PageHeader
          title={t.eventsTitle}
          description={isAttendanceOnly ? t.adminEvlPageDescViewOnly : t.adminEvlPageDesc}
          actions={
            !isAttendanceOnly ? (
              <button type="button" className={`btn ${showForm ? "btn-ghost" : "btn-primary"}`} onClick={toggleForm}>
                {showForm ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                {showForm ? t.adminEvlCloseEditor : t.addEventBtn}
              </button>
            ) : undefined
          }
        />

        <Toolbar>
          <div className="adm-search" style={{ position: "relative" }}>
            <Search size={18} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              className="input"
              type="search"
              aria-label={t.adminEvlSearchLabel}
              style={{ width: "100%", paddingLeft: 44 }}
              placeholder={t.searchEventsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div role="group" aria-label={t.adminEvlStatusFilterLabel} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {(["all", "live", "upcoming", "past"] as const).map((s) => (
              <FilterChip key={s} active={filterStatus === s} onClick={() => setFilterStatus(s)}>
                {s === "all" ? t.filterAll : s === "live" ? t.filterLive : s === "upcoming" ? t.filterUpcoming : t.filterPast}
              </FilterChip>
            ))}
          </div>
        </Toolbar>

        {!loading && Array.isArray(events) && events.length > 0 && (
          <p role="status" style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {fmt(t.adminEvlResultCount, { count: filteredEvents.length })}
          </p>
        )}

        {/* Form */}
        <EventFormPanel ctx={ctx} />

        {/* Events Grid */}
        <EventsGrid ctx={ctx} />

        {/* Scrollbar styling used by other components rendered on this page
            (event form, form builder, rich-text editor). */}
        <style jsx global>{`
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

      <ConfirmModal ctx={ctx} />
      <ErrorModal ctx={ctx} />

      {/* Informational notice (e.g. an edit was submitted for staff review). */}
      <Modal
        open={reviewNoticeModal.show}
        onClose={closeReviewNotice}
        size="sm"
        title={reviewNoticeModal.title}
        icon={<AlertTriangle size={20} />}
        footer={
          <button type="button" className="btn btn-primary" onClick={closeReviewNotice}>
            {t.adminEvlGotIt}
          </button>
        }
      >
        <p className="adm-modal-text">{reviewNoticeModal.message}</p>
      </Modal>

      <AttendanceModal ctx={ctx} />
      <StrikesModal ctx={ctx} />
      <StudentProfileModal ctx={ctx} />
    </>
  );
}
