// Short "when" labels for event cards and rows, always in Bangkok time.

const TZ = "Asia/Bangkok";
const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ };

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", timeOpts);
const fmtDate = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...opts, timeZone: TZ });

// "Fri 31 Oct · 18:00–20:00" for a same-day event, "31 Oct 18:00 – 2 Nov 17:00"
// when it spans days. `withYear` adds the year (used on the full card).
export function formatEventWhen(startIso: string, endIso: string, withYear = false): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dayOpts: Intl.DateTimeFormatOptions = withYear
    ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short" };
  if (dayKey(start) === dayKey(end)) {
    const times = start.getTime() === end.getTime() ? fmtTime(start) : `${fmtTime(start)}–${fmtTime(end)}`;
    return `${fmtDate(start, dayOpts)} · ${times}`;
  }
  const spanOpts: Intl.DateTimeFormatOptions = withYear
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" };
  return `${fmtDate(start, spanOpts)} ${fmtTime(start)} – ${fmtDate(end, spanOpts)} ${fmtTime(end)}`;
}

// "2 Nov 09:00", for chips like "Opens 2 Nov 09:00".
export function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(d, { day: "numeric", month: "short" })} ${fmtTime(d)}`;
}
