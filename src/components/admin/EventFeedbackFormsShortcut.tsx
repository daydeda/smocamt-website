"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Calendar, AlertCircle, CheckCircle2, Clock, FileQuestion } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { EventFormBuilderModal } from "./EventFormBuilderModal";

type EventOption = {
  id: string;
  title: string;
  startTime: string;
  ownerClubIds: string[] | null;
  ownerMajors: string[] | null;
};

type FormStatus = "none" | "pending" | "changes" | "approved";
type FormStatusEntry = { status: FormStatus; note: string | null };

interface EventFeedbackFormsShortcutProps {
  // Resolves ownerClubIds to a display name — clubs/page.tsx already has this
  // list loaded, so it's passed down rather than re-fetched here. A president
  // of MULTIPLE clubs is exactly why this matters: without a name per row,
  // every event's form reads as one undifferentiated, seemingly-shared list.
  // admin/majors has no equivalent lookup (ownerMajors are already plain
  // codes like "SE"), so this prop is omitted there.
  clubs?: { id: string; name: string }[];
  // GET /api/admin/events scopes to every event the caller manages across
  // BOTH clubs and majors (see EventScopeService.getPresidentScope) — someone
  // holding both club_president and major_president would otherwise see their
  // major's events mixed into this list on /admin/clubs and vice versa. This
  // prop keeps each page showing only its own kind: "club" filters to events
  // with a non-empty ownerClubIds, "major" to events with a non-empty
  // ownerMajors. An event co-owned by both shows on both pages, correctly.
  scope: "club" | "major";
}

// club_president/major_president manage a Feedback Form for one of their own
// events, entirely in-page (no navigating to /admin/events and back) — via
// EventFormBuilderModal, the same builder admin/events/page.tsx uses,
// extracted into its own self-contained component so it can be mounted here
// too. GET /api/admin/events is already scoped server-side to the caller's
// own managed events (ownerClubIds/ownerMajors, see EventScopeService), and
// EventFormBuilderModal re-derives its own permissions from the session and
// re-checks ownership server-side on every form write — this component
// doesn't need to know or trust anything beyond "this is one of my events."
export function EventFeedbackFormsShortcut({ clubs, scope }: EventFeedbackFormsShortcutProps) {
  const { lang, t } = useLanguage();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [formStatus, setFormStatus] = useState<Record<string, FormStatusEntry>>({});
  const [openEvent, setOpenEvent] = useState<{ id: string; title: string } | null>(null);

  // Per-event form status, so a president can see what needs attention
  // without opening every event: "changes requested" (staff left a note —
  // see forms.reviewNote in schema.ts) takes priority over a plain "awaiting
  // review", which takes priority over "approved". Bounded to the events this
  // president actually owns (typically a handful), fetched in parallel.
  const loadStatuses = async (list: EventOption[]) => {
    const entries = await Promise.all(
      list.map(async (evt): Promise<[string, FormStatusEntry]> => {
        try {
          const r = await fetch(`/api/admin/events/${evt.id}/form`);
          if (!r.ok) return [evt.id, { status: "none", note: null }];
          const data = await r.json();
          const forms: { reviewStatus: "pending" | "approved"; reviewNote: string | null }[] = data.forms || [];
          if (forms.length === 0) return [evt.id, { status: "none", note: null }];
          const changesRequested = forms.find((f) => f.reviewStatus === "pending" && f.reviewNote);
          if (changesRequested) return [evt.id, { status: "changes", note: changesRequested.reviewNote }];
          if (forms.some((f) => f.reviewStatus === "pending")) return [evt.id, { status: "pending", note: null }];
          return [evt.id, { status: "approved", note: null }];
        } catch {
          return [evt.id, { status: "none", note: null }];
        }
      })
    );
    setFormStatus(Object.fromEntries(entries));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/admin/events")
        .then((r) => (r.ok ? r.json() : []))
        .then(async (d) => {
          if (!Array.isArray(d)) return;
          const scoped: EventOption[] = d.filter((evt: EventOption) =>
            scope === "club"
              ? !!evt.ownerClubIds && evt.ownerClubIds.length > 0
              : !!evt.ownerMajors && evt.ownerMajors.length > 0
          );
          setEvents(scoped);
          await loadStatuses(scoped);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [scope]);

  const ownerLabel = (evt: EventOption): string | null => {
    if (clubs && evt.ownerClubIds && evt.ownerClubIds.length > 0) {
      const names = evt.ownerClubIds
        .map((id) => clubs.find((c) => c.id === id)?.name)
        .filter((n): n is string => !!n);
      return names.length > 0 ? names.join(", ") : null;
    }
    if (evt.ownerMajors && evt.ownerMajors.length > 0) return evt.ownerMajors.join(", ");
    return null;
  };

  const STATUS_STYLES: Record<FormStatus, { bg: string; color: string; label: string }> = {
    none: {
      bg: "var(--bg-surface)", color: "var(--text-muted)",
      label: lang === "th" ? "ยังไม่มีแบบฟอร์ม" : lang === "cn" ? "尚无表单" : lang === "mm" ? "ဖောင်မရှိသေးပါ" : "No form yet",
    },
    pending: {
      bg: "rgb(var(--amber-500-rgb) / 0.12)", color: "var(--amber-500)",
      label: lang === "th" ? "กำลังรอตรวจสอบ" : lang === "cn" ? "等待审核" : lang === "mm" ? "ပြန်လည်စစ်ဆေးဆဲ" : "Awaiting review",
    },
    changes: {
      bg: "rgb(var(--red-500-rgb) / 0.12)", color: "var(--red-500)",
      label: lang === "th" ? "ขอให้แก้ไข" : lang === "cn" ? "需要修改" : lang === "mm" ? "ပြင်ဆင်ရန် တောင်းဆိုထား" : "Changes requested",
    },
    approved: {
      bg: "rgb(var(--emerald-500-rgb) / 0.12)", color: "var(--emerald-500)",
      label: lang === "th" ? "อนุมัติแล้ว" : lang === "cn" ? "已批准" : lang === "mm" ? "ခွင့်ပြုပြီး" : "Approved",
    },
  };

  if (!loading && events.length === 0) return null;

  return (
    <>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
        style={{ borderRadius: 32, padding: 24, marginBottom: 24 }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <ClipboardList size={20} style={{ color: "var(--indigo-500)" }} />
          {scope === "club"
            ? (lang === "th" ? "แบบประเมินกิจกรรมของชมรมคุณ" : lang === "cn" ? "你的社团活动反馈表单" : lang === "mm" ? "သင့်ကလပ်ပွဲအတွက် အကဲဖြတ်ပုံစံ" : "Your Club Events' Feedback Forms")
            : (lang === "th" ? "แบบประเมินกิจกรรมของสาขาคุณ" : lang === "cn" ? "你的专业活动反馈表单" : lang === "mm" ? "သင့်ဌာနပွဲအတွက် အကဲဖြတ်ပုံစံ" : "Your Major Events' Feedback Forms")}
        </h2>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <div className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {events.map((evt) => {
              const st = formStatus[evt.id] || { status: "none" as const, note: null };
              const style = STATUS_STYLES[st.status];
              const owner = ownerLabel(evt);
              return (
                <div key={evt.id} style={{ background: "var(--bg-elevated)", borderRadius: 16, padding: "12px 16px" }}>
                  <button
                    type="button"
                    onClick={() => setOpenEvent({ id: evt.id, title: evt.title })}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.title}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        <Calendar size={11} /> {new Date(evt.startTime).toLocaleDateString()}
                        {owner && (
                          <span style={{ background: "var(--bg-surface)", borderRadius: 999, padding: "1px 8px", fontWeight: 700 }}>
                            {owner}
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      style={{
                        flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 800, padding: "5px 12px", borderRadius: 999,
                        background: style.bg, color: style.color,
                      }}
                    >
                      {st.status === "changes" ? <AlertCircle size={12} /> : st.status === "approved" ? <CheckCircle2 size={12} /> : st.status === "pending" ? <Clock size={12} /> : <FileQuestion size={12} />}
                      {style.label}
                    </span>
                  </button>

                  {/* Highlight the staff note when changes were requested — same
                      red-callout pattern as the rejected-proposal note in
                      ProposeEventSection.tsx, so it reads consistently across
                      this page. Clicking the row above re-opens the same form
                      for editing, which is the "resubmit" action (saving
                      clears reviewNote and re-queues it for review — see
                      PATCH /api/admin/events/[id]/form). */}
                  {st.status === "changes" && st.note && (
                    <div style={{
                      display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
                      background: "rgb(var(--red-500-rgb) / 0.08)", border: "1px solid rgb(var(--red-500-rgb) / 0.2)",
                      borderRadius: 12, padding: "8px 12px",
                    }}>
                      <AlertCircle size={14} style={{ color: "var(--red-500)", flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <p style={{ fontSize: 10.5, fontWeight: 800, color: "var(--red-500)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                          {t.fbReviewNoteLabel || "Note from staff"}
                        </p>
                        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{st.note}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openEvent && (
        <EventFormBuilderModal
          eventId={openEvent.id}
          eventTitle={openEvent.title}
          onClose={() => setOpenEvent(null)}
          onChanged={() => loadStatuses(events)}
        />
      )}
    </>
  );
}
