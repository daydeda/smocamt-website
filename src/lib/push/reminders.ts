// Pure helpers for the scheduled "form closes soon" push and the "new event" push.
// No db / web-push here so the timing rules and wording are unit-testable.
import type { PushNotificationPayload } from "./push-payload";

export type ReminderStage = "1d" | "1h";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Which reminder a form is due for right now, judged by time left until it closes.
 * "1h" inside the last hour, "1d" inside the last 24h, none before that or once it
 * has closed. A form first seen inside its last hour only ever gets the "1h" one.
 */
export function reminderStage(closesAt: Date | string | null | undefined, now: Date): ReminderStage | null {
  if (!closesAt) return null;
  const left = new Date(closesAt).getTime() - now.getTime();
  if (!Number.isFinite(left) || left <= 0) return null;
  if (left <= HOUR_MS) return "1h";
  if (left <= 24 * HOUR_MS) return "1d";
  return null;
}

const KIND: Record<string, { en: string; th: string }> = {
  K_pre: { en: "pre-test", th: "แบบทดสอบก่อนกิจกรรม" },
  K_post: { en: "post-test", th: "แบบทดสอบหลังกิจกรรม" },
  A: { en: "attitude survey", th: "แบบประเมินทัศนคติ" },
  F: { en: "feedback form", th: "แบบประเมินความคิดเห็น" },
};

/** Form types that get a due-date reminder (S is evaluator-only and is left out). */
export function isReminderFormType(formType: string): boolean {
  return formType in KIND;
}

export function formReminderPayload(input: {
  stage: ReminderStage;
  formId: string;
  formType: string;
  eventId: string;
  eventTitle: string | null;
}): PushNotificationPayload {
  const kind = KIND[input.formType] ?? { en: "form", th: "แบบฟอร์ม" };
  const event = input.eventTitle?.trim() || "ActiveCAMT";
  const left = input.stage === "1h" ? { en: "1 hour left", th: "เหลือเวลาอีก 1 ชั่วโมง" } : { en: "closes within 24 hours", th: "ปิดภายใน 24 ชั่วโมง" };
  return {
    title: `${left.th} / ${left.en}`,
    body: `${kind.th} ของกิจกรรม "${event}" ยังไม่ได้ทำ / Your ${kind.en} for "${event}" is still waiting.`,
    url: `/dashboard?event=${encodeURIComponent(input.eventId)}`,
    tag: `form-due:${input.formId}:${input.stage}`,
  };
}

export function newEventPayload(input: { eventId: string; title: string; startTime: Date | string }): PushNotificationPayload {
  const when = new Date(input.startTime);
  const th = when.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
  return {
    title: "กิจกรรมใหม่ / New event",
    body: `"${input.title}" เปิดให้ลงทะเบียนแล้ว (${th}) / Registration is open for "${input.title}".`,
    url: `/dashboard?event=${encodeURIComponent(input.eventId)}`,
    tag: `new-event:${input.eventId}`,
  };
}
