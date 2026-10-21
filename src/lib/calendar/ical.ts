// Minimal, dependency-free iCalendar (RFC 5545) generation + "add to calendar"
// URL builders for ActiveCAMT. Hand-rolled deliberately: the spec subset we need
// is tiny, and we don't want a third-party dep running on the public, tokenized
// .ics feed endpoint.
//
// All ActiveCAMT times are stored as instants (UTC in the DB). The university is
// in a single fixed timezone with no DST, so we emit timed events anchored to
// Asia/Bangkok (+07:00) via a VTIMEZONE block, and convert to UTC for the
// Google/Outlook quick-add URLs.

const TZID = "Asia/Bangkok";
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // +07:00, fixed (no DST)
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CalItem {
  /** Stable id (without domain) — the "@activecamt" suffix is added here. */
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  allDay?: boolean;
  /** Absolute link back to the item on the site. */
  url?: string | null;
  updatedAt?: Date | null;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | null;
  recurrenceUntil?: Date | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Bangkok local wall-clock: YYYYMMDDTHHMMSS (for DTSTART;TZID=Asia/Bangkok). */
function formatLocal(date: Date): string {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** UTC instant: YYYYMMDDTHHMMSSZ (for DTSTAMP and the Google URL). */
function formatUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Bangkok calendar date: YYYYMMDD (for all-day VALUE=DATE). */
function formatDate(date: Date): string {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash first). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Fold a content line to <=75 octets, splitting on UTF-8 byte boundaries and
 * inserting CRLF + a single leading space (RFC 5545 §3.1). Continuation lines
 * reserve one octet for that leading space.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (curBytes + chBytes > limit) {
      out.push(cur);
      cur = ch;
      curBytes = chBytes;
      limit = 74; // continuation lines carry a leading space
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Serialize calendar items to a complete VCALENDAR document. */
export function buildVCalendar(items: CalItem[]): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ActiveCAMT//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ActiveCAMT",
    `X-WR-TIMEZONE:${TZID}`,
    // Fixed +07:00 timezone, no DST → a single STANDARD component.
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0700",
    "TZOFFSETTO:+0700",
    "TZNAME:+07",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const item of items) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.uid}@activecamt`);
    lines.push(`DTSTAMP:${formatUtc(now)}`);
    if (item.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDate(item.start)}`);
      // All-day DTEND is exclusive → the day after the last day.
      lines.push(`DTEND;VALUE=DATE:${formatDate(new Date(item.end.getTime() + DAY_MS))}`);
    } else {
      lines.push(`DTSTART;TZID=${TZID}:${formatLocal(item.start)}`);
      lines.push(`DTEND;TZID=${TZID}:${formatLocal(item.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(item.title)}`);
    if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
    if (item.url) lines.push(`URL:${escapeText(item.url)}`);
    if (item.updatedAt) lines.push(`LAST-MODIFIED:${formatUtc(item.updatedAt)}`);
    if (item.recurrence && item.recurrence !== "none" && item.recurrenceUntil) {
      const freq = item.recurrence.toUpperCase(); // DAILY | WEEKLY | MONTHLY
      const until = item.allDay
        ? formatDate(item.recurrenceUntil)
        : formatUtc(item.recurrenceUntil);
      lines.push(`RRULE:FREQ=${freq};UNTIL=${until}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function detailsWithUrl(item: CalItem): string | null {
  const parts = [item.description, item.url].filter(Boolean) as string[];
  return parts.length ? parts.join("\n\n") : null;
}

/** "Add to Google Calendar" template URL (one-off event compose). */
export function googleCalendarUrl(item: CalItem): string {
  const dates = item.allDay
    ? `${formatDate(item.start)}/${formatDate(new Date(item.end.getTime() + DAY_MS))}`
    : `${formatUtc(item.start)}/${formatUtc(item.end)}`;
  const params = new URLSearchParams({ action: "TEMPLATE", text: item.title, dates });
  const details = detailsWithUrl(item);
  if (details) params.set("details", details);
  if (item.location) params.set("location", item.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** "Add to Outlook/Microsoft Calendar" deeplink compose URL. */
export function outlookCalendarUrl(item: CalItem): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: item.title,
    startdt: item.start.toISOString(),
    enddt: item.end.toISOString(),
  });
  if (item.allDay) params.set("allday", "true");
  if (item.location) params.set("location", item.location);
  const details = detailsWithUrl(item);
  if (details) params.set("body", details);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
