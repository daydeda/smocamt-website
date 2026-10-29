import { describe, expect, it } from "vitest";
import { formatEventWhen, formatShortDateTime } from "./event-when";

describe("formatEventWhen", () => {
  it("collapses a same-day event to one date and a time range", () => {
    expect(formatEventWhen("2026-10-30T18:00:00+07:00", "2026-10-30T20:30:00+07:00")).toBe("Fri 30 Oct · 18:00–20:30");
  });

  it("uses Bangkok days, not UTC days", () => {
    // 01:00 Bangkok is still the previous day in UTC.
    expect(formatEventWhen("2026-10-31T01:00:00+07:00", "2026-10-31T03:00:00+07:00")).toBe("Sat 31 Oct · 01:00–03:00");
  });

  it("shows a single time for a point event", () => {
    expect(formatEventWhen("2026-10-30T18:00:00+07:00", "2026-10-30T18:00:00+07:00")).toBe("Fri 30 Oct · 18:00");
  });

  it("shows both ends for a multi-day event", () => {
    expect(formatEventWhen("2026-10-31T09:00:00+07:00", "2026-11-02T17:00:00+07:00")).toBe("31 Oct 09:00 – 2 Nov 17:00");
  });

  it("adds the year when asked", () => {
    expect(formatEventWhen("2026-10-30T18:00:00+07:00", "2026-10-30T20:00:00+07:00", true)).toBe("Fri, 30 Oct 2026 · 18:00–20:00");
  });
});

describe("formatShortDateTime", () => {
  it("formats in Bangkok time", () => {
    expect(formatShortDateTime("2026-11-02T02:00:00Z")).toBe("2 Nov 09:00");
  });
});
