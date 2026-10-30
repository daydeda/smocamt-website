import { describe, expect, it } from "vitest";
import { eventReminderPayload, EVENT_REPUSH_COOLDOWN_MS, formReminderPayload, isOpenToStudents, isReminderFormType, newEventPayload, reminderStage, repushWaitMs } from "./reminders";

const now = new Date("2026-10-23T10:00:00Z");
const at = (mins: number) => new Date(now.getTime() + mins * 60_000);

describe("reminderStage", () => {
  it("has no stage without a close time or once closed", () => {
    expect(reminderStage(null, now)).toBeNull();
    expect(reminderStage(at(-1), now)).toBeNull();
    expect(reminderStage(at(0), now)).toBeNull();
  });
  it("is 1d between 1 and 24 hours left, 1h inside the last hour", () => {
    expect(reminderStage(at(25 * 60), now)).toBeNull();
    expect(reminderStage(at(24 * 60), now)).toBe("1d");
    expect(reminderStage(at(61), now)).toBe("1d");
    expect(reminderStage(at(60), now)).toBe("1h");
    expect(reminderStage(at(1), now)).toBe("1h");
  });
});

describe("payloads", () => {
  it("builds a form reminder with a stage-specific tag", () => {
    const p = formReminderPayload({ stage: "1h", formId: "f1", formType: "K_post", eventId: "e1", eventTitle: "Camp" });
    expect(p.url).toBe("/dashboard?event=e1");
    expect(p.tag).toBe("form-due:f1:1h");
    expect(p.body).toContain("Camp");
  });
  it("only reminds for student-facing form types", () => {
    expect(isReminderFormType("K_pre")).toBe(true);
    expect(isReminderFormType("F")).toBe(true);
    expect(isReminderFormType("S")).toBe(false);
  });
  it("builds a new-event push", () => {
    const p = newEventPayload({ eventId: "e1", title: "Camp", startTime: "2026-11-01T03:00:00Z" });
    expect(p.tag).toBe("new-event:e1");
    expect(p.body).toContain("Camp");
  });
});

describe("isOpenToStudents", () => {
  it("is open with no role restriction or when student is listed", () => {
    expect(isOpenToStudents(null)).toBe(true);
    expect(isOpenToStudents([])).toBe(true);
    expect(isOpenToStudents(["smo", "student"])).toBe(true);
  });
  it("is hidden when only staff roles are listed", () => {
    expect(isOpenToStudents(["smo"])).toBe(false);
  });
});

describe("event re-push", () => {
  it("builds a reminder push with its own tag", () => {
    const p = eventReminderPayload({ eventId: "e1", title: "Camp", startTime: "2026-11-01T03:00:00Z" });
    expect(p.tag).toBe("event-reminder:e1");
    expect(p.body).toContain("Camp");
  });
  it("waits out the cooldown after the last re-send", () => {
    expect(repushWaitMs(null, now)).toBe(0);
    expect(repushWaitMs(at(-10), now)).toBe(EVENT_REPUSH_COOLDOWN_MS - 10 * 60_000);
    expect(repushWaitMs(at(-60), now)).toBe(0);
    expect(repushWaitMs(at(-120), now)).toBe(0);
  });
});
