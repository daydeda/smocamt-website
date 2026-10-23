import { describe, expect, it } from "vitest";
import { formReminderPayload, isReminderFormType, newEventPayload, reminderStage } from "./reminders";

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
