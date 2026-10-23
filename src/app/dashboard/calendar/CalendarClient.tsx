"use client";

import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  MapPin,
  Clock,
  CalendarPlus,
  Link2,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Rss,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { parseRichText } from "@/lib/ui/rich-text";
import { StudentNav } from "@/components/layout/StudentNav";
import {
  buildVCalendar,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalItem,
} from "@/lib/calendar/ical";
import { occurrencesInWindow, type RecurrenceRule } from "@/lib/calendar/recurrence";

// Unified item shape returned by GET /api/calendar (kept local so this client
// component never imports the server-only calendar service).
interface CalendarItem {
  id: string;
  kind: "event" | "entry";
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  eventId: string | null;
  imageUrl: string | null;
  updatedAt: string | null;
  allowedRoles: string[] | null;
  allowedMajors: string[] | null;
  targetThai: boolean;
  targetInternational: boolean;
  recurrence: RecurrenceRule;
  recurrenceUntil: string | null;
}

interface EventOption {
  id: string;
  title: string;
}

const MANAGING_ROLES = ["super_admin", "admin", "registration", "organizer"];
const ALL_ROLES = [
  "student",
  "staff",
  "smo",
  "anusmo",
  "club_president",
  "major_president",
];
const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"];

const LOCALE: Record<string, string> = {
  en: "en-US",
  th: "th-TH",
  mm: "my-MM",
  cn: "zh-CN",
};

// ISO → value for <input type="datetime-local"> in the browser's local tz,
// matching the admin event editor.
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Day-bucketing key for the calendar grid. Times are formatted in Asia/Bangkok
// (see formatTime), so events must be bucketed by their Bangkok calendar day too
// — otherwise an event near midnight lands in the wrong day cell for a viewer
// whose device clock is in another timezone. Returns the *device-local* midnight
// of the Bangkok calendar date, so it compares cleanly (===) against the grid
// cells, which are built as local `new Date(y, m, d)` midnights.
// One reused formatter — itemsOnDay calls startOfBangkokDay per item across all
// 42 cells, so constructing a formatter each call would be needlessly hot.
const BANGKOK_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function startOfBangkokDay(d: Date): Date {
  if (isNaN(d.getTime())) return d;
  const parts = BANGKOK_DAY_FMT.formatToParts(d);
  const val = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(val("year"), val("month") - 1, val("day"));
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

type EntryForm = {
  id: string | null;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  eventId: string | null;
  allowedRoles: string[];
  allowedMajors: string[];
  targetThai: boolean;
  targetInternational: boolean;
  recurrence: RecurrenceRule;
  recurrenceUntil: string; // YYYY-MM-DD for the date input, empty when none
};

function emptyForm(date?: Date): EntryForm {
  const base = date ? new Date(date) : new Date();
  base.setHours(9, 0, 0, 0);
  const end = new Date(base);
  end.setHours(10, 0, 0, 0);
  return {
    id: null,
    title: "",
    description: "",
    location: "",
    startTime: toDatetimeLocal(base.toISOString()),
    endTime: toDatetimeLocal(end.toISOString()),
    allDay: false,
    eventId: null,
    allowedRoles: [],
    allowedMajors: [],
    targetThai: true,
    targetInternational: true,
    recurrence: "none",
    recurrenceUntil: "",
  };
}

export default function CalendarClient({
  initialSession,
}: {
  initialSession: Session | null;
}) {
  const { data: sessionData, status: sessionStatus } = useSession();
  const session = sessionData || initialSession;
  // Logged-out visitors get the public feed link, never the personal token feed.
  const isGuest = sessionStatus === "unauthenticated";
  const { t, lang } = useLanguage();
  const locale = LOCALE[lang] ?? "en-US";

  const canManage = MANAGING_ROLES.includes(session?.user?.role || "");

  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const [form, setForm] = useState<EntryForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);

  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error("failed");
      setItems(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so loadItems' loading flag flips outside the synchronous effect body.
    const timer = setTimeout(() => loadItems(), 0);
    return () => clearTimeout(timer);
  }, [loadItems]);

  // Load the event list lazily for the "link to event" picker (managers only).
  const ensureEventOptions = useCallback(async () => {
    if (!canManage || eventOptions.length) return;
    try {
      const res = await fetch("/api/admin/events");
      if (!res.ok) return;
      const data = await res.json();
      setEventOptions(
        (data as { id: string; title: string }[]).map((e) => ({
          id: e.id,
          title: e.title,
        }))
      );
    } catch {
      /* non-fatal */
    }
  }, [canManage, eventOptions.length]);

  // ── Calendar grid (month) ────────────────────────────────────────────────
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  // Depend on the timestamp, not the Date object: gridStart is a fresh Date every
  // render, so a `[gridStart]` dep would defeat the memo entirely.
  const gridStartMs = gridStart.getTime();
  const gridDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(new Date(gridStartMs), i)),
    [gridStartMs]
  );

  // Expand each item (including recurring series) into the 42-cell grid window.
  // Events are always recurrence:"none" and pass through as single occurrences.
  const expandedItems = useMemo(() => {
    const windowStart = new Date(gridStartMs);
    const windowEnd = addDays(new Date(gridStartMs), 42);
    return items.flatMap((it) =>
      occurrencesInWindow(
        new Date(it.startTime),
        new Date(it.endTime),
        it.recurrence ?? "none",
        it.recurrenceUntil ? new Date(it.recurrenceUntil) : null,
        windowStart,
        windowEnd
      ).map((occ) => ({ item: it, start: occ.start, end: occ.end }))
    );
  }, [items, gridStartMs]);

  const itemsOnDay = useCallback(
    (day: Date) => {
      const dd = startOfDay(day).getTime();
      return expandedItems
        .filter(({ start, end }) => {
          const s = startOfBangkokDay(start).getTime();
          const e = startOfBangkokDay(end).getTime();
          return dd >= s && dd <= e;
        })
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    },
    [expandedItems]
  );

  const weekdayNames = useMemo(() => {
    const base = new Date(2024, 0, 7); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      addDays(base, i).toLocaleDateString(locale, { weekday: "short" })
    );
  }, [locale]);

  const monthLabel = cursor.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });

  // "Today" follows Asia/Bangkok too, so the highlight lands on the right cell
  // for a viewer abroad (consistent with itemsOnDay above).
  const todayKey = startOfBangkokDay(new Date()).getTime();

  // ── Export helpers ────────────────────────────────────────────────────────
  const toCalItem = useCallback((it: CalendarItem): CalItem => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      uid: `${it.kind}-${it.id}`,
      title: it.title,
      description: it.description,
      location: it.location,
      start: new Date(it.startTime),
      end: new Date(it.endTime),
      allDay: it.allDay,
      url: origin
        ? `${origin}/dashboard${it.kind === "entry" ? "/calendar" : ""}`
        : null,
      updatedAt: it.updatedAt ? new Date(it.updatedAt) : null,
      recurrence: it.recurrence,
      recurrenceUntil: it.recurrenceUntil ? new Date(it.recurrenceUntil) : null,
    };
  }, []);

  const downloadIcs = useCallback(
    (it: CalendarItem) => {
      const ics = buildVCalendar([toCalItem(it)]);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${it.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "event"}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [toCalItem]
  );

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });

  // ── Entry create / edit / delete ──────────────────────────────────────────
  const openNew = (day?: Date) => {
    ensureEventOptions();
    setForm(emptyForm(day));
  };

  const openEdit = (it: CalendarItem) => {
    ensureEventOptions();
    setForm({
      id: it.id,
      title: it.title,
      description: it.description ?? "",
      location: it.location ?? "",
      startTime: toDatetimeLocal(it.startTime),
      endTime: toDatetimeLocal(it.endTime),
      allDay: it.allDay,
      eventId: it.eventId,
      allowedRoles: it.allowedRoles ?? [],
      allowedMajors: it.allowedMajors ?? [],
      targetThai: it.targetThai,
      targetInternational: it.targetInternational,
      recurrence: it.recurrence ?? "none",
      recurrenceUntil: it.recurrenceUntil
        ? it.recurrenceUntil.slice(0, 10)
        : "",
    });
    setDetail(null);
  };

  const saveForm = async () => {
    if (!form || !form.title.trim() || !form.startTime || !form.endTime) return;
    if (form.recurrence !== "none" && !form.recurrenceUntil) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        allDay: form.allDay,
        eventId: form.eventId || null,
        allowedRoles: form.allowedRoles,
        allowedMajors: form.allowedMajors,
        targetThai: form.targetThai,
        targetInternational: form.targetInternational,
        recurrence: form.recurrence,
        recurrenceUntil:
          form.recurrence !== "none" && form.recurrenceUntil
            ? new Date(form.recurrenceUntil + "T23:59:59").toISOString()
            : null,
      };
      const res = await fetch(
        form.id ? `/api/admin/calendar/${form.id}` : "/api/admin/calendar",
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error("save failed");
      setForm(null);
      await loadItems();
    } catch {
      alert(t.calendarLoadError);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!form?.id) return;
    if (!confirm(t.calendarDeleteConfirm)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/calendar/${form.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setForm(null);
      await loadItems();
    } catch {
      alert(t.calendarLoadError);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="page">
      <StudentNav />

      <main className="cal-wrap">
        <header className="cal-head">
          <div>
            <h1 className="cal-title">{t.calendar}</h1>
            <p className="cal-sub">{t.calendarSubtitle}</p>
          </div>
          <div className="cal-actions">
            <button
              className="btn-ghost"
              onClick={() => setSubscribeOpen(true)}
            >
              <Rss size={16} /> {t.calendarSubscribe}
            </button>
            {canManage && (
              <button className="btn-primary" onClick={() => openNew()}>
                <Plus size={16} /> {t.calendarNewEntry}
              </button>
            )}
          </div>
        </header>

        <div className="cal-toolbar">
          <div className="cal-nav">
            <button
              aria-label="Previous month"
              onClick={() =>
                setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
              }
            >
              <ChevronLeft size={18} />
            </button>
            <span className="cal-month">{monthLabel}</span>
            <button
              aria-label="Next month"
              onClick={() =>
                setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
              }
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button className="btn-ghost" onClick={() => setCursor(new Date())}>
            {t.calendarToday}
          </button>
        </div>

        {error && <div className="cal-state">{t.calendarLoadError}</div>}
        {loading && !items.length && <div className="cal-state">…</div>}

        <div className="cal-grid">
          {weekdayNames.map((w) => (
            <div key={w} className="cal-weekday">
              {w}
            </div>
          ))}
          {gridDays.map((day) => {
            const dayItems = itemsOnDay(day);
            const isOtherMonth = day.getMonth() !== cursor.getMonth();
            const isToday = startOfDay(day).getTime() === todayKey;
            return (
              <div
                key={day.toISOString()}
                className={`cal-cell${isOtherMonth ? " other" : ""}${
                  isToday ? " today" : ""
                }`}
                onDoubleClick={canManage ? () => openNew(day) : undefined}
              >
                <div className="cal-daynum">{day.getDate()}</div>
                <div className="cal-chips">
                  {dayItems.map(({ item: it, start }) => (
                    <button
                      key={`${it.kind}-${it.id}-${start.getTime()}`}
                      className={`cal-chip ${it.kind}`}
                      onClick={() => setDetail(it)}
                      title={it.title}
                    >
                      {!it.allDay && (
                        <span className="cal-chip-time">
                          {formatTime(start.toISOString())}
                        </span>
                      )}
                      <span className="cal-chip-title">{it.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && !items.length && !error && (
          <div className="cal-state">{t.calendarEmpty}</div>
        )}
      </main>

      {/* ── Item detail + export ─────────────────────────────────────────── */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className={`badge ${detail.kind}`}>
                {detail.kind === "event"
                  ? t.calendarEventBadge
                  : t.calendarEntryBadge}
              </span>
              <button className="icon-btn" onClick={() => setDetail(null)}>
                <X size={18} />
              </button>
            </div>
            {detail.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="modal-poster"
                src={detail.imageUrl}
                alt={detail.title}
              />
            )}
            <h2 className="modal-title">{detail.title}</h2>
            <div className="modal-meta">
              <div>
                <Clock size={14} />
                {detail.allDay
                  ? t.calendarAllDay
                  : `${formatTime(detail.startTime)} – ${formatTime(
                      detail.endTime
                    )}`}
              </div>
              {detail.location && (
                <div>
                  <MapPin size={14} />
                  {detail.location}
                </div>
              )}
              {detail.recurrence && detail.recurrence !== "none" && (
                <div>
                  <RefreshCw size={14} />
                  {t.calendarRepeatsSummary}{" "}
                  {detail.recurrence === "daily"
                    ? t.calendarRecurDaily
                    : detail.recurrence === "weekly"
                    ? t.calendarRecurWeekly
                    : t.calendarRecurMonthly}
                  {detail.recurrenceUntil &&
                    ` · ${new Date(detail.recurrenceUntil).toLocaleDateString(locale)}`}
                </div>
              )}
            </div>
            {detail.description && (
              <div
                className="modal-desc"
                dangerouslySetInnerHTML={{
                  __html: parseRichText(detail.description),
                }}
              />
            )}

            {detail.kind === "event" && (
              <a
                className="btn-primary"
                href={`/dashboard?event=${detail.id}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16 }}
              >
                <Link2 size={14} /> {t.calendarViewOnDashboard}
              </a>
            )}

            <div className="export-row">
              <span className="export-label">
                <CalendarPlus size={14} /> {t.calendarAddToCalendar}
              </span>
              <div className="export-btns">
                <a
                  className="btn-ghost"
                  href={googleCalendarUrl(toCalItem(detail))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.calendarExportGoogle}
                </a>
                <a
                  className="btn-ghost"
                  href={outlookCalendarUrl(toCalItem(detail))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.calendarExportOutlook}
                </a>
                <button
                  className="btn-ghost"
                  onClick={() => downloadIcs(detail)}
                >
                  {t.calendarExportApple}
                </button>
              </div>
            </div>

            {canManage && detail.kind === "entry" && (
              <div className="modal-foot">
                <button className="btn-ghost" onClick={() => openEdit(detail)}>
                  {t.calendarEditEntry}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create / edit entry ──────────────────────────────────────────── */}
      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">
                {form.id ? t.calendarEditEntry : t.calendarNewEntry}
              </h2>
              <button className="icon-btn" onClick={() => setForm(null)}>
                <X size={18} />
              </button>
            </div>

            <label className="fld">
              <span>{t.calendarFieldTitle}</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>

            <label className="fld">
              <span>{t.calendarFieldDescription}</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>

            <label className="fld">
              <span>{t.calendarFieldLocation}</span>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>

            <div className="fld-row">
              <label className="fld">
                <span>{t.calendarFieldStart}</span>
                <input
                  type="datetime-local"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm({ ...form, startTime: e.target.value })
                  }
                />
              </label>
              <label className="fld">
                <span>{t.calendarFieldEnd}</span>
                <input
                  type="datetime-local"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm({ ...form, endTime: e.target.value })
                  }
                />
              </label>
            </div>

            <label className="fld-check">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
              />
              {t.calendarAllDay}
            </label>

            <label className="fld">
              <span>{t.calendarRecurrence}</span>
              <select
                value={form.recurrence}
                onChange={(e) =>
                  setForm({
                    ...form,
                    recurrence: e.target.value as RecurrenceRule,
                    recurrenceUntil: e.target.value === "none" ? "" : form.recurrenceUntil,
                  })
                }
              >
                <option value="none">{t.calendarRecurNone}</option>
                <option value="daily">{t.calendarRecurDaily}</option>
                <option value="weekly">{t.calendarRecurWeekly}</option>
                <option value="monthly">{t.calendarRecurMonthly}</option>
              </select>
            </label>

            {form.recurrence !== "none" && (
              <label className="fld">
                <span>{t.calendarRepeatUntil}</span>
                <input
                  type="date"
                  value={form.recurrenceUntil}
                  onChange={(e) =>
                    setForm({ ...form, recurrenceUntil: e.target.value })
                  }
                />
              </label>
            )}

            <label className="fld">
              <span>
                <Link2 size={13} /> {t.calendarLinkedEvent}
              </span>
              <select
                value={form.eventId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, eventId: e.target.value || null })
                }
              >
                <option value="">—</option>
                {eventOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="fld">
              <span>{t.calendarFieldVisibility}</span>
              <div className="chk-grid">
                <label className="fld-check">
                  <input
                    type="checkbox"
                    checked={form.targetThai}
                    onChange={(e) =>
                      setForm({ ...form, targetThai: e.target.checked })
                    }
                  />
                  TH
                </label>
                <label className="fld-check">
                  <input
                    type="checkbox"
                    checked={form.targetInternational}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        targetInternational: e.target.checked,
                      })
                    }
                  />
                  INTL
                </label>
              </div>
              <div className="chk-grid">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="fld-check">
                    <input
                      type="checkbox"
                      checked={form.allowedRoles.includes(r)}
                      onChange={() =>
                        setForm({
                          ...form,
                          allowedRoles: toggle(form.allowedRoles, r),
                        })
                      }
                    />
                    {r}
                  </label>
                ))}
              </div>
              <div className="chk-grid">
                {ALL_MAJORS.map((m) => (
                  <label key={m} className="fld-check">
                    <input
                      type="checkbox"
                      checked={form.allowedMajors.includes(m)}
                      onChange={() =>
                        setForm({
                          ...form,
                          allowedMajors: toggle(form.allowedMajors, m),
                        })
                      }
                    />
                    {m}
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-foot">
              {form.id && (
                <button
                  className="btn-danger"
                  onClick={deleteEntry}
                  disabled={saving}
                >
                  <Trash2 size={14} /> {t.calendarDeleteEntry}
                </button>
              )}
              <button
                className="btn-primary"
                onClick={saveForm}
                disabled={
                  saving ||
                  !form.title.trim() ||
                  (form.recurrence !== "none" && !form.recurrenceUntil)
                }
              >
                {t.calendarSaveEntry}
              </button>
            </div>
          </div>
        </div>
      )}

      {subscribeOpen && (
        <SubscribePanel publicFeed={isGuest} onClose={() => setSubscribeOpen(false)} />
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: var(--bg-base);
        }
        .cal-wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px 20px 64px;
        }
        .cal-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .cal-title {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .cal-sub {
          color: var(--text-muted);
          font-size: 14px;
          margin: 4px 0 0;
        }
        .cal-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cal-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .cal-nav {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cal-nav button {
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          border-radius: 10px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary);
        }
        .cal-month {
          font-size: 17px;
          font-weight: 700;
          min-width: 160px;
          text-align: center;
        }
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 1px;
          background: var(--border-subtle);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          overflow: hidden;
        }
        .cal-weekday {
          background: var(--bg-elevated);
          padding: 8px;
          text-align: center;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }
        .cal-cell {
          background: var(--bg-elevated);
          min-height: 96px;
          min-width: 0;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cal-cell.other {
          background: var(--bg-base);
        }
        .cal-cell.other .cal-daynum {
          color: var(--text-muted);
          opacity: 0.5;
        }
        .cal-daynum {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-secondary);
          align-self: flex-end;
        }
        .cal-cell.today .cal-daynum {
          background: var(--accent-primary);
          color: var(--text-on-color);
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cal-chips {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
          overflow: hidden;
        }
        .cal-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          border: none;
          border-radius: 6px;
          padding: 2px 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
          width: 100%;
          min-width: 0;
          overflow: hidden;
        }
        .cal-chip.event {
          background: rgb(var(--accent-rgb) / 0.12);
          color: var(--orange-700);
        }
        .cal-chip.entry {
          background: rgb(var(--blue-500-rgb) / 0.12);
          color: var(--blue-700);
        }
        .cal-chip-time {
          font-variant-numeric: tabular-nums;
          opacity: 0.8;
          flex-shrink: 0;
        }
        .cal-chip-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .cal-state {
          text-align: center;
          color: var(--text-muted);
          padding: 32px;
          font-size: 14px;
        }
        .btn-primary,
        .btn-ghost,
        .btn-danger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
          border-radius: 10px;
          padding: 8px 14px;
          cursor: pointer;
          text-decoration: none;
          border: 1px solid transparent;
        }
        .btn-primary {
          background: var(--accent-primary);
          color: var(--text-on-color);
        }
        .btn-ghost {
          background: var(--bg-elevated);
          border-color: var(--border-subtle);
          color: var(--text-secondary);
        }
        .btn-danger {
          background: var(--red-50);
          color: var(--red-500);
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgb(var(--scrim-rgb) / 0.45);
          backdrop-filter: blur(4px);
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .modal {
          background: var(--bg-elevated);
          border-radius: 18px;
          width: 100%;
          max-width: 460px;
          max-height: 88vh;
          overflow-y: auto;
          padding: 20px;
          box-shadow: 0 20px 60px rgb(var(--shadow-rgb) / 0.2);
        }
        .modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .modal-title {
          font-size: 18px;
          font-weight: 800;
          margin: 0;
        }
        .icon-btn {
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-muted);
        }
        .badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .badge.event {
          background: rgb(var(--accent-rgb) / 0.12);
          color: var(--orange-700);
        }
        .badge.entry {
          background: rgb(var(--blue-500-rgb) / 0.12);
          color: var(--blue-700);
        }
        .modal-meta {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin: 10px 0;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .modal-meta div {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .modal-poster {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 12px;
          margin-bottom: 12px;
        }
        .modal-desc {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 8px 0;
        }
        .export-row {
          border-top: 1px solid var(--border-subtle);
          margin-top: 14px;
          padding-top: 14px;
        }
        .export-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .export-btns {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .modal-foot {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 18px;
        }
        .fld {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-bottom: 12px;
        }
        .fld > span {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .fld input,
        .fld textarea,
        .fld select {
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 9px 11px;
          font-size: 14px;
          font-family: inherit;
          background: var(--bg-base);
        }
        .fld-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .fld-check {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 8px;
          cursor: pointer;
        }
        .chk-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 6px;
        }
        @media (max-width: 640px) {
          .cal-cell {
            min-height: 72px;
          }
          .cal-chip-time {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Subscribe panel ─────────────────────────────────────────────────────────
function SubscribePanel({ publicFeed = false, onClose }: { publicFeed?: boolean; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/calendar/feed/token");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setToken(data.token ?? null);
    } catch {
      // Don't fall through to the create-feed UI on a failed load — that would let
      // the user "create" a feed on top of one that may already exist.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so load's loading flag flips outside the synchronous effect body.
    // The public feed needs no token, so there is nothing to load for it.
    if (publicFeed) return;
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load, publicFeed]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const feedUrl = publicFeed ? `${origin}/api/calendar/public` : token ? `${origin}/api/calendar/feed/${token}` : "";
  const webcalUrl = feedUrl.replace(/^https?:/, "webcal:");
  const googleAddUrl = feedUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : "";

  const copy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard.writeText throws on an insecure origin / denied permission —
      // fall back to selecting the URL field so the user can copy it manually.
      document.querySelector<HTMLInputElement>(".sub-url input")?.select();
    }
  };

  const regenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/feed/token", { method: "POST" });
      const data = await res.json();
      setToken(data.token ?? null);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    setLoading(true);
    try {
      await fetch("/api/calendar/feed/token", { method: "DELETE" });
      setToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{t.calendarSubscribeTitle}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="sub-desc">{t.calendarSubscribeDesc}</p>

        {loading && !publicFeed ? (
          <div className="cal-state">…</div>
        ) : loadError && !publicFeed ? (
          <div className="sub-foot" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--amber-700)" }}>
              {lang === "th" ? "โหลดลิงก์ไม่สำเร็จ" : lang === "cn" ? "加载失败" : lang === "mm" ? "လင့်ခ် ဖွင့်၍မရပါ" : "Couldn't load the feed link."}
            </span>
            <button className="btn-ghost" onClick={load}>
              <RefreshCw size={14} /> {lang === "th" ? "ลองใหม่" : lang === "cn" ? "重试" : lang === "mm" ? "ထပ်စမ်းပါ" : "Retry"}
            </button>
          </div>
        ) : publicFeed || token ? (
          <>
            <div className="sub-url">
              <input readOnly value={feedUrl} />
              <button className="btn-ghost" onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t.calendarCopied : t.calendarCopyLink}
              </button>
            </div>

            <div className="sub-adds">
              <a
                className="btn-ghost"
                href={googleAddUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.calendarAddGoogle}
              </a>
              <a className="btn-ghost" href={webcalUrl}>
                {t.calendarAddApple}
              </a>
            </div>

            {!publicFeed && (
            <div className="sub-warn">
              <AlertTriangle size={14} />
              <span>{t.calendarSubscribeWarning}</span>
            </div>
            )}

            {!publicFeed && (
            <div className="sub-foot">
              <button className="btn-ghost" onClick={regenerate}>
                <RefreshCw size={14} /> {t.calendarRegenerate}
              </button>
              <button className="btn-danger" onClick={revoke}>
                {t.calendarRevoke}
              </button>
            </div>
            )}
          </>
        ) : (
          <div className="sub-foot">
            <button className="btn-primary" onClick={regenerate}>
              <Rss size={14} /> {t.calendarSubscribe}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgb(var(--scrim-rgb) / 0.45);
          backdrop-filter: blur(4px);
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .sub-modal {
          background: var(--bg-elevated);
          border-radius: 18px;
          width: 100%;
          max-width: 480px;
          max-height: 88vh;
          overflow-y: auto;
          padding: 20px;
          box-shadow: 0 20px 60px rgb(var(--shadow-rgb) / 0.2);
        }
        .modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .modal-title {
          font-size: 18px;
          font-weight: 800;
          margin: 0;
        }
        .icon-btn {
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-muted);
        }
        .sub-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 14px;
        }
        .sub-url {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .sub-url input {
          flex: 1;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 9px 11px;
          font-size: 12px;
          background: var(--bg-base);
          color: var(--text-secondary);
        }
        .sub-adds {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
        }
        .sub-warn {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          background: var(--amber-50);
          color: var(--amber-700);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 12px;
          line-height: 1.45;
          margin-bottom: 16px;
        }
        .sub-foot {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .cal-state {
          text-align: center;
          color: var(--text-muted);
          padding: 24px;
        }
        .btn-ghost,
        .btn-primary,
        .btn-danger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
          border-radius: 10px;
          padding: 8px 14px;
          cursor: pointer;
          text-decoration: none;
          border: 1px solid transparent;
        }
        .btn-ghost {
          background: var(--bg-elevated);
          border-color: var(--border-subtle);
          color: var(--text-secondary);
        }
        .btn-primary {
          background: var(--accent-primary);
          color: var(--text-on-color);
        }
        .btn-danger {
          background: var(--red-50);
          color: var(--red-500);
        }
      `}</style>
    </div>
  );
}
