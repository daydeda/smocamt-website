import { z } from "zod";

export const allowedEventYearsSchema = z.array(z.number().int().min(1).max(4))
  .transform((years) => [...new Set(years)].sort((a, b) => a - b));

// A single session/day must start and end on the same calendar day. Each
// session is one check-in window (`idx_attendance_session_student` allows
// exactly one attendance row per student per session), so a session whose
// start and end fall on different dates would let a student check in only
// once for the whole range instead of once per day — the "once" registration
// mode ("one sign-up, N days") is meant to be N session rows, not one long
// one. This is a same-DAY check, not a duration cap: a flat 24h0m session
// (e.g. 11/07 13:26 → 12/07 13:26) still covers two distinct dates and must
// be rejected just the same as a much longer span. See registrationModeOnce
// in i18n.ts.
const BANGKOK_TZ = "Asia/Bangkok";

// Everything in this app is entered/displayed in Asia/Bangkok (see the
// `timeZone: "Asia/Bangkok"` formatting already used on the scanner page) —
// there's no per-user timezone to account for. `iso` is a UTC ISO datetime
// string (what the client sends after `.toISOString()`); naive UTC-string
// slicing would misidentify the date near local midnight (e.g. 00:30 Bangkok
// time is still 17:30 UTC the *previous* day), so this goes through Date +
// Intl instead.
export function bangkokDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// One session (day) of an event. `id` present = an existing session being edited;
// absent = a new session to create. Shared by the create (POST) and update (PUT)
// admin event routes. Lives here rather than in a route.ts because Next.js route
// modules may only export request handlers + known config — an extra export there
// trips the generated route-type check.
//
// No same-calendar-day refine here (deliberately) — see sessionsHaveInvalidSpan
// below for why a SINGLE session is allowed to span multiple days.
export const sessionInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  quotaWalkIn: z.number().int().min(0).optional().nullable(),
  // Only meaningful when the parent event's checkInMode is 'evidence' — see
  // eventSessions.evidenceNonce/evidencePrompt in schema.ts. Trimmed to null
  // when blank so an empty string never satisfies the "has a code word" check.
  evidenceNonce: z.string().trim().min(1).optional().nullable(),
  evidencePrompt: z.string().optional().nullable(),
});

export type SessionInput = z.infer<typeof sessionInputSchema>;

// Only meaningful once an event has an EXPLICIT per-day schedule (2+ rows) —
// each row is then meant to be one day, so a row spanning multiple calendar
// days among several is almost certainly a mistake. A single session/row is
// allowed to span multiple calendar days on purpose: some events (e.g. a
// multi-day camp) only need ONE check-in for the whole range rather than a
// check-in per day, and forcing a split there would misrepresent the
// organizer's intent. See registrationModeOnce / multiDaySessionWarning in
// i18n.ts and the client-side warning-not-block banners in admin/events and
// the club/major proposal forms.
export function sessionsHaveInvalidSpan(sessions: { startTime: string; endTime: string }[]): boolean {
  if (sessions.length <= 1) return false;
  return sessions.some((s) => bangkokDateKey(s.startTime) !== bangkokDateKey(s.endTime));
}

// Same same-calendar-day check as the server refine above, for the admin
// create-event and club-president proposal forms so they can warn/block
// before submit instead of only surfacing the 400 after a round-trip.
// `start`/`end` here are datetime-local strings (no timezone marker — the
// browser already renders them in local wall-clock time, which for this app
// is always Asia/Bangkok), so a plain substring compare is correct without
// going through Intl — no UTC round-trip to get wrong.
export function sessionSpansTooLong(start: string, end: string): boolean {
  if (!start || !end) return false;
  return start.slice(0, 10) !== end.slice(0, 10);
}

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Turns one datetime-local range that spans multiple calendar days into one
// row per day — e.g. 2026-07-11T09:00 → 2026-07-13T17:00 becomes three rows
// (09:00–17:00) on the 11th, 12th, and 13th. This is what an admin almost
// always means when they type a multi-day range into a single field: this
// event runs 09:00–17:00 on each of these days, not one session stretching
// across all of them (see sessionSpansTooLong above). Returns the input
// unchanged (as a 1-element array) when it's already within a single day.
export function splitIntoDailySessions(
  startTime: string,
  endTime: string,
): { startTime: string; endTime: string }[] {
  if (!startTime || !endTime) return [];
  const startDate = startTime.slice(0, 10);
  const endDate = endTime.slice(0, 10);
  if (startDate >= endDate) return [{ startTime, endTime }];
  const startClock = startTime.slice(10);
  const endClock = endTime.slice(10);
  // Reusing the same start/end clock time on every day only makes sense when
  // that produces a real (non-zero, non-overnight) same-day window. When it
  // doesn't — e.g. a flat 24h0m range where both clock times are identical,
  // or an overnight ordering — fall back to a 2-hour window from the start
  // clock, the same default addSessionRow uses for a brand new day.
  const useSameClock = endClock > startClock;
  const days: { startTime: string; endTime: string }[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addOneDay(cursor)) {
    if (useSameClock) {
      days.push({ startTime: `${cursor}${startClock}`, endTime: `${cursor}${endClock}` });
      continue;
    }
    const start = new Date(`${cursor}${startClock}`);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const tzOffsetMs = end.getTimezoneOffset() * 60000;
    const endLocal = new Date(end.getTime() - tzOffsetMs).toISOString().slice(0, 16);
    days.push({ startTime: `${cursor}${startClock}`, endTime: endLocal });
  }
  return days;
}
