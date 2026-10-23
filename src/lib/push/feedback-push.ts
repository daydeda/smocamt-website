// Push payloads for the submitter of a feedback/complaint, sent only when they opted in
// on the form (feedback_complaints.push_notify_user_id). Deliberately generic: a push shows
// on a lock screen, so it never carries the category, message or staff reply text, only
// that something changed. The detail stays behind sign-in on /feedback/track.
import type { PushNotificationPayload } from "./push-payload";

export type FeedbackPushKind = "reply" | "resolved";

export function feedbackSubmitterPayload(kind: FeedbackPushKind, complaintId: string): PushNotificationPayload {
  return kind === "reply"
    ? {
        title: "เจ้าหน้าที่ตอบกลับความคิดเห็นของคุณแล้ว / Staff replied to your feedback",
        body: "เปิดแอปเพื่ออ่านข้อความ / Open the app to read it.",
        url: "/feedback/track",
        tag: `feedback-reply:${complaintId}`,
      }
    : {
        title: "ความคิดเห็นของคุณได้รับการดำเนินการแล้ว / Your feedback was resolved",
        body: "เปิดแอปเพื่อดูรายละเอียด / Open the app to see the details.",
        url: "/feedback/track",
        tag: `feedback-resolved:${complaintId}`,
      };
}
