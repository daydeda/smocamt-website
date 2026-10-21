export type RecurrenceRule = "none" | "daily" | "weekly" | "monthly";

export interface Occurrence {
  start: Date;
  end: Date;
}

/**
 * Return the occurrences of a recurring item that overlap [windowStart, windowEnd].
 *
 * Monthly stepping uses setMonth(+1) which clamps e.g. Jan 31 → Feb 28 — acceptable
 * for a university calendar where no rule depends on exact month-end dates.
 */
export function occurrencesInWindow(
  itemStart: Date,
  itemEnd: Date,
  recurrence: RecurrenceRule,
  until: Date | null,
  windowStart: Date,
  windowEnd: Date
): Occurrence[] {
  const duration = itemEnd.getTime() - itemStart.getTime();

  if (recurrence === "none") {
    if (itemStart <= windowEnd && itemEnd >= windowStart) {
      return [{ start: itemStart, end: itemEnd }];
    }
    return [];
  }

  const effectiveUntil = until ?? windowEnd;
  const results: Occurrence[] = [];
  const cursor = new Date(itemStart);
  let guard = 0;

  while (cursor <= effectiveUntil && cursor <= windowEnd && guard < 1000) {
    guard++;
    const occEnd = new Date(cursor.getTime() + duration);
    if (occEnd >= windowStart) {
      results.push({ start: new Date(cursor), end: occEnd });
    }
    if (recurrence === "daily") {
      cursor.setDate(cursor.getDate() + 1);
    } else if (recurrence === "weekly") {
      cursor.setDate(cursor.getDate() + 7);
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return results;
}
