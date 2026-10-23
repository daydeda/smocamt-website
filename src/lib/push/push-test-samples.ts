// Sample payloads for the admin "send test notification" panel (Profile page). Each
// mirrors the title/body/url/tag shape of a real trigger so a test exercises the same
// service-worker display and tap-to-open path. They are only ever sent to the
// requesting admin's OWN devices (see POST /api/notifications/push/test), so the
// "[Test]" prefix is just a reminder that nothing real happened.
import type { PushNotificationPayload } from "./push-payload";

export type PushTestType =
  | "basic"
  | "announcement"
  | "waitlist-seat"
  | "shop-new-order"
  | "shop-order-approved"
  | "shop-order-rejected"
  | "shop-delivery-issue"
  | "seller-application"
  | "appeal-new"
  | "appeal-decision"
  | "proposal-new"
  | "feedback"
  | "form-due-1d"
  | "form-due-1h"
  | "new-event";

type Sample = { label: { en: string; th: string }; payload: PushNotificationPayload };

const SAMPLES: Record<PushTestType, Sample> = {
  basic: {
    label: { en: "Basic test", th: "ทดสอบทั่วไป" },
    payload: { title: "[Test] ActiveCAMT", body: "Push notifications work on this device.", url: "/dashboard/profile", tag: "test:basic" },
  },
  announcement: {
    label: { en: "Announcement (broadcast)", th: "ประกาศ (ส่งถึงทุกคน)" },
    payload: { title: "[Test] New announcement", body: "This is how an announcement looks.", url: "/dashboard", tag: "test:announcement" },
  },
  "waitlist-seat": {
    label: { en: "Waitlist: you got a seat", th: "คิวรอ: ได้ที่นั่งแล้ว" },
    payload: {
      title: "[Test] ได้ที่นั่งแล้ว! / You got a seat!",
      body: "คุณได้รับการลงทะเบียนกิจกรรม \"Sample event\" แล้ว / You're now registered for \"Sample event\".",
      url: "/dashboard",
      tag: "test:waitlist",
    },
  },
  "shop-new-order": {
    label: { en: "Shop: new order (staff)", th: "ร้านค้า: ออเดอร์ใหม่ (ทีมงาน)" },
    payload: { title: "[Test] New shop order", body: "A new order is waiting for review.", url: "/admin/shop", tag: "test:shop-order" },
  },
  "shop-order-approved": {
    label: { en: "Shop: order approved (buyer)", th: "ร้านค้า: อนุมัติออเดอร์ (ผู้ซื้อ)" },
    payload: { title: "[Test] Order approved", body: "Your shop order was approved.", url: "/dashboard/shop", tag: "test:shop-approved" },
  },
  "shop-order-rejected": {
    label: { en: "Shop: order rejected (buyer)", th: "ร้านค้า: ปฏิเสธออเดอร์ (ผู้ซื้อ)" },
    payload: { title: "[Test] Order rejected", body: "Your shop order was rejected. Open the app for details.", url: "/dashboard/shop", tag: "test:shop-rejected" },
  },
  "shop-delivery-issue": {
    label: { en: "Shop: delivery problem (staff)", th: "ร้านค้า: ปัญหาการจัดส่ง (ทีมงาน)" },
    payload: { title: "[Test] Delivery problem reported", body: "A buyer reported a problem with a shipped order.", url: "/admin/shop", tag: "test:shop-issue" },
  },
  "seller-application": {
    label: { en: "Shop: seller application (admin)", th: "ร้านค้า: สมัครเป็นผู้ขาย (แอดมิน)" },
    payload: { title: "[Test] New shop seller application", body: "Sample Shop applied to sell in the shop.", url: "/admin/shop", tag: "test:seller" },
  },
  "appeal-new": {
    label: { en: "Appeal: new (staff)", th: "อุทธรณ์: รายการใหม่ (ทีมงาน)" },
    payload: { title: "[Test] New no-show appeal", body: "An appeal was submitted for \"Sample event\".", url: "/admin/appeals", tag: "test:appeal" },
  },
  "appeal-decision": {
    label: { en: "Appeal: decision (student)", th: "อุทธรณ์: ผลการพิจารณา (นักศึกษา)" },
    payload: { title: "[Test] Your appeal was approved", body: "Your no-show appeal for \"Sample event\" was approved.", url: "/dashboard", tag: "test:appeal-decision" },
  },
  "proposal-new": {
    label: { en: "Event proposal (staff)", th: "ข้อเสนอกิจกรรม (ทีมงาน)" },
    payload: { title: "[Test] New event proposal", body: "\"Sample event\" is waiting for review.", url: "/admin/proposals", tag: "test:proposal" },
  },
  feedback: {
    label: { en: "Feedback / complaint (staff)", th: "ข้อเสนอแนะ/ร้องเรียน (ทีมงาน)" },
    payload: { title: "[Test] New feedback", body: "A new feedback message was submitted.", url: "/admin/feedback", tag: "test:feedback" },
  },
  "form-due-1d": {
    label: { en: "Form closes in 24h (student)", th: "แบบฟอร์มใกล้ปิด 24 ชม. (นักศึกษา)" },
    payload: {
      title: "[Test] ปิดภายใน 24 ชั่วโมง / closes within 24 hours",
      body: "แบบประเมินความคิดเห็น ของกิจกรรม \"Sample event\" ยังไม่ได้ทำ / Your feedback form for \"Sample event\" is still waiting.",
      url: "/dashboard",
      tag: "test:form-due-1d",
    },
  },
  "form-due-1h": {
    label: { en: "Form closes in 1h (student)", th: "แบบฟอร์มใกล้ปิด 1 ชม. (นักศึกษา)" },
    payload: {
      title: "[Test] เหลือเวลาอีก 1 ชั่วโมง / 1 hour left",
      body: "แบบทดสอบหลังกิจกรรม ของกิจกรรม \"Sample event\" ยังไม่ได้ทำ / Your post-test for \"Sample event\" is still waiting.",
      url: "/dashboard",
      tag: "test:form-due-1h",
    },
  },
  "new-event": {
    label: { en: "New event to join (student)", th: "กิจกรรมใหม่ให้ลงทะเบียน (นักศึกษา)" },
    payload: {
      title: "[Test] กิจกรรมใหม่ / New event",
      body: "\"Sample event\" เปิดให้ลงทะเบียนแล้ว / Registration is open for \"Sample event\".",
      url: "/dashboard",
      tag: "test:new-event",
    },
  },
};

export const PUSH_TEST_TYPES = Object.keys(SAMPLES) as PushTestType[];

export function isPushTestType(value: unknown): value is PushTestType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SAMPLES, value);
}

export function pushTestPayload(type: PushTestType): PushNotificationPayload {
  return SAMPLES[type].payload;
}

export function pushTestLabel(type: PushTestType, lang: "en" | "th"): string {
  return SAMPLES[type].label[lang];
}
