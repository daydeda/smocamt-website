"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Calendar, AlertCircle, CheckCircle2, Clock, FileQuestion } from "lucide-react";
import { InlineAlert, LoadingState, Panel, StatusBadge, type Tone } from "@/components/admin/ui";
import { useLanguage } from "@/lib/i18n/LanguageContext";
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
  const { t } = useLanguage();
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

  const STATUS_TONE: Record<FormStatus, { tone: Tone; label: string; icon: React.ReactNode }> = {
    none: { tone: "neutral", label: t.adminEvfStatusNone, icon: <FileQuestion size={12} /> },
    pending: { tone: "warning", label: t.adminEvfStatusPending, icon: <Clock size={12} /> },
    changes: { tone: "danger", label: t.adminEvfStatusChanges, icon: <AlertCircle size={12} /> },
    approved: { tone: "success", label: t.adminEvfStatusApproved, icon: <CheckCircle2 size={12} /> },
  };

  if (!loading && events.length === 0) return null;

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Panel
          title={scope === "club" ? t.adminEvfShortcutClubTitle : t.adminEvfShortcutMajorTitle}
          description={t.adminEvfShortcutDesc}
          icon={<ClipboardList size={18} />}
        >
          {loading ? (
            <LoadingState compact />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {events.map((evt) => {
                const st = formStatus[evt.id] || { status: "none" as const, note: null };
                const style = STATUS_TONE[st.status];
                const owner = ownerLabel(evt);
                return (
                  <li key={evt.id} className="rounded-2xl" style={{ background: "var(--bg-elevated)" }}>
                    <button
                      type="button"
                      onClick={() => setOpenEvent({ id: evt.id, title: evt.title })}
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left"
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-primary)" }}
                    >
                      <span className="min-w-0">
                        <span className="block" style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{evt.title}</span>
                        <span className="adm-field-hint mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={12} aria-hidden="true" /> {new Date(evt.startTime).toLocaleDateString()}
                          </span>
                          {owner && (
                            <span style={{ background: "var(--bg-surface)", borderRadius: 999, padding: "0 8px", fontWeight: 600 }}>
                              {owner}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0">
                        <StatusBadge tone={style.tone} icon={style.icon}>{style.label}</StatusBadge>
                      </span>
                    </button>

                    {/* Highlight the staff note when changes were requested.
                        Clicking the row above re-opens the same form for
                        editing, which is the "resubmit" action (saving clears
                        reviewNote and re-queues it for review — see
                        PATCH /api/admin/events/[id]/form). */}
                    {st.status === "changes" && st.note && (
                      <div className="px-4 pb-3">
                        <InlineAlert tone="error" title={t.fbReviewNoteLabel}>{st.note}</InlineAlert>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
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
