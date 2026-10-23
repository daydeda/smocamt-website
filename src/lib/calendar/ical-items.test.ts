import { describe, expect, it } from "vitest";
import { toCalItems, type CalendarFeedRow } from "./ical";

const DAY = 86_400_000;
const now = Date.parse("2026-10-23T00:00:00Z");

function row(over: Partial<CalendarFeedRow>): CalendarFeedRow {
  return {
    id: "a",
    kind: "event",
    title: "T",
    description: null,
    location: null,
    startTime: new Date(now).toISOString(),
    endTime: new Date(now + 3600_000).toISOString(),
    allDay: false,
    updatedAt: null,
    recurrence: "none",
    recurrenceUntil: null,
    ...over,
  };
}

describe("toCalItems", () => {
  it("links events to /e/<id> and entries to the calendar page", () => {
    const [ev, en] = toCalItems(
      [row({ id: "e1" }), row({ id: "n1", kind: "entry" })],
      "https://x.test",
      now,
    );
    expect(ev.url).toBe("https://x.test/e/e1");
    expect(en.url).toBe("https://x.test/dashboard/calendar");
    expect(ev.uid).toBe("event-e1");
  });

  it("drops one-off items outside the −90d … +365d window", () => {
    const items = toCalItems(
      [
        row({ id: "old", startTime: new Date(now - 91 * DAY).toISOString() }),
        row({ id: "far", startTime: new Date(now + 366 * DAY).toISOString() }),
        row({ id: "ok", startTime: new Date(now + DAY).toISOString() }),
      ],
      "https://x.test",
      now,
    );
    expect(items.map((i) => i.uid)).toEqual(["event-ok"]);
  });

  it("keeps a recurring series whose until-date is still inside the window", () => {
    const items = toCalItems(
      [
        row({ id: "r1", recurrence: "weekly", startTime: new Date(now - 200 * DAY).toISOString(), recurrenceUntil: new Date(now - 10 * DAY).toISOString() }),
        row({ id: "r2", recurrence: "weekly", startTime: new Date(now - 200 * DAY).toISOString(), recurrenceUntil: new Date(now - 100 * DAY).toISOString() }),
      ],
      "https://x.test",
      now,
    );
    expect(items.map((i) => i.uid)).toEqual(["event-r1"]);
  });
});
