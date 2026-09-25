// Shop fulfilment (handover) rules — proof the buyer actually GOT the item.
// Pure and client-safe (no DB import): the admin card, the buyer's order list and
// every fulfilment route share these so the buttons shown and the transitions the
// server accepts can't drift apart. See docs/features/shop-fulfillment.md.
//
// shop_orders.status is ONLY the payment review; fulfilmentStatus is layered on
// top and only moves once the order is 'approved'.
//
//   self-pickup:        awaiting → ready (optional) → picked_up        staff scan / manual
//   delivery, campus:   awaiting → delivered                            staff scan / manual
//   delivery, mail:     awaiting → shipped → delivered                  buyer confirms, or auto
//                                  shipped → issue → shipped/delivered  buyer reported a problem
//
// In person, the counter hands over order LINES (one product at a time), so an
// order with several products sits in 'partial' until every line is stamped
// (shop_order_items.handed_over_at). See statusAfterItemHandover.

export type FulfillmentStatus = "awaiting" | "ready" | "partial" | "shipped" | "picked_up" | "delivered" | "issue";
export type FulfilledVia = "qr" | "manual" | "buyer" | "auto";
export type StaffFulfillmentAction = "ready" | "ship" | "handover" | "reset";
export type BuyerFulfillmentAction = "confirm" | "report";
export type FulfillmentAction = StaffFulfillmentAction | BuyerFulfillmentAction;

// A mailed order the buyer never confirms completes on its own this many days
// after it was marked shipped, so orders don't stay open forever. The buyer can
// still "report a problem" before then, which stops the clock.
export const SHOP_AUTO_CONFIRM_DAYS = 7;

export interface ShopCarrier {
  id: string;
  th: string;
  en: string;
  // The carrier's official public tracking page. We deliberately link the page
  // itself rather than a guessed deep link with the number in the query string:
  // none of these carriers document a stable deep-link format, and a wrong one
  // breaks silently. The buyer UI copies the number to the clipboard first.
  trackingPage: string | null;
  // Same-day couriers (Lalamove/Grab/LINE MAN) hand out a live tracking LINK,
  // not a number; "other" may be either.
  needs: "number" | "link" | "number_or_link";
}

export const SHOP_CARRIERS: readonly ShopCarrier[] = [
  { id: "thailand_post", th: "ไปรษณีย์ไทย (EMS / ลงทะเบียน)", en: "Thailand Post (EMS / Registered)", trackingPage: "https://track.thailandpost.co.th/", needs: "number" },
  { id: "flash", th: "Flash Express", en: "Flash Express", trackingPage: "https://flashexpress.com/fle/tracking", needs: "number" },
  { id: "kex", th: "KEX Express (Kerry เดิม)", en: "KEX Express (formerly Kerry)", trackingPage: "https://th.kex-express.com/th/track/", needs: "number" },
  { id: "jt", th: "J&T Express", en: "J&T Express", trackingPage: "https://www.jtexpress.co.th/service/track", needs: "number" },
  { id: "spx", th: "SPX Express (Shopee Express)", en: "SPX Express (Shopee Express)", trackingPage: "https://spx.co.th/track", needs: "number" },
  { id: "ninjavan", th: "Ninja Van", en: "Ninja Van", trackingPage: "https://www.ninjavan.co/th-th/tracking", needs: "number" },
  { id: "same_day", th: "ส่งด่วนในวัน (Lalamove / Grab / LINE MAN)", en: "Same-day courier (Lalamove / Grab / LINE MAN)", trackingPage: null, needs: "link" },
  { id: "other", th: "อื่น ๆ (ระบุชื่อ)", en: "Other (type the name)", trackingPage: null, needs: "number_or_link" },
];

const CARRIER_BY_ID = new Map(SHOP_CARRIERS.map((c) => [c.id, c]));

export function findCarrier(id: string | null | undefined): ShopCarrier | null {
  return id ? CARRIER_BY_ID.get(id) ?? null : null;
}

// Display name for an order's carrier ("other" shows what the seller typed).
export function carrierLabel(carrier: string | null | undefined, carrierName: string | null | undefined, th: boolean): string {
  const c = findCarrier(carrier);
  if (!c) return carrierName?.trim() || (th ? "ขนส่ง" : "Carrier");
  if (c.id === "other") return carrierName?.trim() || (th ? c.th : c.en);
  return th ? c.th : c.en;
}

// Where "Track parcel" goes: the seller's own link when they gave one (same-day
// couriers, "other"), otherwise the carrier's official tracking page.
export function trackingLinkFor(carrier: string | null | undefined, trackingUrl: string | null | undefined): string | null {
  if (trackingUrl && isHttpsUrl(trackingUrl)) return trackingUrl;
  return findCarrier(carrier)?.trackingPage ?? null;
}

export function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

// Tracking numbers are letters/digits (e.g. EF123456789TH, TH0123456789A,
// 123456789012). Sellers paste them with spaces or lowercase, so normalize
// before validating rather than rejecting a perfectly good number.
export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}
const TRACKING_NUMBER_RE = /^[A-Z0-9]{6,40}$/;

export interface ShipmentInput {
  carrier: string;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}
export interface ShipmentValue {
  carrier: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

// Error codes rather than sentences so the admin UI can show TH/EN copy; the
// route maps them to an English message for the API response.
export type ShipmentError = "unknown_carrier" | "carrier_name_required" | "tracking_number_invalid" | "tracking_link_invalid" | "tracking_required";

export function validateShipment(input: ShipmentInput): { ok: true; value: ShipmentValue } | { ok: false; error: ShipmentError } {
  const carrier = findCarrier(input.carrier);
  if (!carrier) return { ok: false, error: "unknown_carrier" };

  const carrierName = input.carrierName?.trim() || null;
  if (carrier.id === "other" && !carrierName) return { ok: false, error: "carrier_name_required" };

  const rawNumber = input.trackingNumber?.trim() ?? "";
  const trackingNumber = rawNumber ? normalizeTrackingNumber(rawNumber) : null;
  if (trackingNumber && !TRACKING_NUMBER_RE.test(trackingNumber)) return { ok: false, error: "tracking_number_invalid" };

  const trackingUrl = input.trackingUrl?.trim() || null;
  if (trackingUrl && !isHttpsUrl(trackingUrl)) return { ok: false, error: "tracking_link_invalid" };

  if (carrier.needs === "number" && !trackingNumber) return { ok: false, error: "tracking_required" };
  if (carrier.needs === "link" && !trackingUrl) return { ok: false, error: "tracking_required" };
  if (carrier.needs === "number_or_link" && !trackingNumber && !trackingUrl) return { ok: false, error: "tracking_required" };

  return {
    ok: true,
    value: {
      carrier: carrier.id,
      carrierName: carrier.id === "other" ? carrierName : null,
      // A same-day courier has no number; a numbered carrier keeps a link only
      // if the seller explicitly gave one.
      trackingNumber: carrier.needs === "link" ? null : trackingNumber,
      trackingUrl,
    },
  };
}

export interface FulfillmentState {
  status: string; // payment review: pending | approved | rejected
  fulfillment: string; // pickup | delivery
  fulfillmentStatus: string;
}

// The single transition table. Returns the next status, or null when the action
// isn't allowed from here (the route answers 409, the UI hides the button).
export function nextFulfillmentStatus(order: FulfillmentState, action: FulfillmentAction): FulfillmentStatus | null {
  if (order.status !== "approved") return null;
  const from = order.fulfillmentStatus as FulfillmentStatus;
  const pickup = order.fulfillment !== "delivery";
  switch (action) {
    case "ready":
      return pickup && from === "awaiting" ? "ready" : null;
    case "ship":
      // Re-shipping from "shipped" corrects a typo'd tracking number; from
      // "issue" it's the seller sending a replacement.
      return !pickup && (from === "awaiting" || from === "shipped" || from === "issue") ? "shipped" : null;
    case "handover":
      // The status once EVERY line is handed over (statusAfterItemHandover
      // handles handing over only some of them).
      if (pickup) return from === "awaiting" || from === "ready" || from === "partial" ? "picked_up" : null;
      // On-campus hand delivery, or staff closing a shipped/issue order they
      // settled in person.
      return from === "awaiting" || from === "partial" || from === "shipped" || from === "issue" ? "delivered" : null;
    case "reset":
      // Undo a mistake (wrong buyer, marked too early). Back to square one.
      return from === "awaiting" ? null : "awaiting";
    case "confirm":
      return !pickup && (from === "shipped" || from === "issue") ? "delivered" : null;
    case "report":
      return !pickup && from === "shipped" ? "issue" : null;
  }
}

// True once the item is in the buyer's hands (the end of the flow).
export function isFulfilled(fulfillmentStatus: string): boolean {
  return fulfillmentStatus === "picked_up" || fulfillmentStatus === "delivered";
}

// Has this order line reached the buyer? A stamped line, or any line of a
// finished order (a mailed order completes by buyer confirmation without
// stamping its lines, and orders finished before per-line handover existed
// were never stamped either).
export function isItemHandedOver(item: { handedOverAt?: Date | string | null }, orderFulfillmentStatus: string): boolean {
  return item.handedOverAt != null || isFulfilled(orderFulfillmentStatus);
}

// The order's status after staff hand over some lines in person, given how
// many lines would still be waiting afterwards. Null = not allowed.
// Only an order that hasn't left by mail can be handed over line by line: from
// shipped/issue the staff are settling the whole parcel, so every remaining
// line must go at once.
export function statusAfterItemHandover(order: FulfillmentState, remainingAfter: number): FulfillmentStatus | null {
  const complete = nextFulfillmentStatus(order, "handover");
  if (!complete) return null;
  if (remainingAfter <= 0) return complete;
  const from = order.fulfillmentStatus;
  return from === "awaiting" || from === "ready" || from === "partial" ? "partial" : null;
}

// The order's status after staff undo the handover of some lines (a slip at
// the counter: wrong size, wrong person). Null = not allowed — mailed orders
// are undone with the order-level reset instead, which also clears tracking.
export function statusAfterItemUndo(
  order: FulfillmentState & { shippedAt?: Date | string | null; readyAt?: Date | string | null },
  stillHandedAfter: number,
): FulfillmentStatus | null {
  if (order.status !== "approved" || order.shippedAt) return null;
  const from = order.fulfillmentStatus;
  if (from !== "partial" && from !== "picked_up" && from !== "delivered") return null;
  if (stillHandedAfter > 0) return "partial";
  return order.readyAt && order.fulfillment !== "delivery" ? "ready" : "awaiting";
}

// An order whose goods have left the seller (shipped / handed over / disputed)
// must not be rejected or sent back to payment review underneath — the seller
// has to undo the handover first, so the two records can't contradict.
export function blocksPaymentReview(fulfillmentStatus: string): boolean {
  return fulfillmentStatus !== "awaiting" && fulfillmentStatus !== "ready";
}

export function isAutoConfirmDue(shippedAt: Date | string | null, now: Date = new Date(), days = SHOP_AUTO_CONFIRM_DAYS): boolean {
  if (!shippedAt) return false;
  const shipped = typeof shippedAt === "string" ? new Date(shippedAt) : shippedAt;
  return now.getTime() - shipped.getTime() >= days * 24 * 60 * 60 * 1000;
}

// Whole days left before auto-confirm (0 = due now). For "auto in X days" copy.
export function daysUntilAutoConfirm(shippedAt: Date | string | null, now: Date = new Date(), days = SHOP_AUTO_CONFIRM_DAYS): number {
  if (!shippedAt) return days;
  const shipped = typeof shippedAt === "string" ? new Date(shippedAt) : shippedAt;
  const msLeft = shipped.getTime() + days * 24 * 60 * 60 * 1000 - now.getTime();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}
