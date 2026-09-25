import { describe, it, expect } from "vitest";
import {
  blocksPaymentReview,
  carrierLabel,
  daysUntilAutoConfirm,
  isAutoConfirmDue,
  nextFulfillmentStatus,
  normalizeTrackingNumber,
  trackingLinkFor,
  validateShipment,
  type FulfillmentAction,
} from "@/lib/shop-fulfillment";

const order = (fulfillment: "pickup" | "delivery", fulfillmentStatus: string, status = "approved") => ({
  status,
  fulfillment,
  fulfillmentStatus,
});

describe("nextFulfillmentStatus", () => {
  it("never moves an order that isn't paid (approved)", () => {
    const actions: FulfillmentAction[] = ["ready", "ship", "handover", "reset", "confirm", "report"];
    for (const status of ["pending", "rejected"]) {
      for (const action of actions) {
        expect(nextFulfillmentStatus(order("pickup", "awaiting", status), action)).toBeNull();
        expect(nextFulfillmentStatus(order("delivery", "shipped", status), action)).toBeNull();
      }
    }
  });

  it("self-pickup: awaiting → ready → picked_up, or straight to picked_up", () => {
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "ready")).toBe("ready");
    expect(nextFulfillmentStatus(order("pickup", "ready"), "handover")).toBe("picked_up");
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "handover")).toBe("picked_up");
  });

  it("self-pickup: can't be shipped, confirmed or reported by the buyer, or handed over twice", () => {
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "ship")).toBeNull();
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "confirm")).toBeNull();
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "report")).toBeNull();
    expect(nextFulfillmentStatus(order("pickup", "picked_up"), "handover")).toBeNull();
    expect(nextFulfillmentStatus(order("pickup", "ready"), "ready")).toBeNull();
  });

  it("delivery by mail: awaiting → shipped → delivered by the buyer", () => {
    expect(nextFulfillmentStatus(order("delivery", "awaiting"), "ship")).toBe("shipped");
    expect(nextFulfillmentStatus(order("delivery", "shipped"), "confirm")).toBe("delivered");
  });

  it("delivery by mail: the buyer can report a problem only while shipped, then still confirm", () => {
    expect(nextFulfillmentStatus(order("delivery", "shipped"), "report")).toBe("issue");
    expect(nextFulfillmentStatus(order("delivery", "awaiting"), "report")).toBeNull();
    expect(nextFulfillmentStatus(order("delivery", "delivered"), "report")).toBeNull();
    expect(nextFulfillmentStatus(order("delivery", "issue"), "confirm")).toBe("delivered");
  });

  it("delivery: the seller can re-ship (fix tracking / send a replacement)", () => {
    expect(nextFulfillmentStatus(order("delivery", "shipped"), "ship")).toBe("shipped");
    expect(nextFulfillmentStatus(order("delivery", "issue"), "ship")).toBe("shipped");
    expect(nextFulfillmentStatus(order("delivery", "delivered"), "ship")).toBeNull();
  });

  it("delivery on campus: awaiting → delivered by staff handover; no 'ready' step", () => {
    expect(nextFulfillmentStatus(order("delivery", "awaiting"), "handover")).toBe("delivered");
    expect(nextFulfillmentStatus(order("delivery", "awaiting"), "ready")).toBeNull();
    expect(nextFulfillmentStatus(order("delivery", "delivered"), "handover")).toBeNull();
  });

  it("the buyer can't confirm an order that was never shipped", () => {
    expect(nextFulfillmentStatus(order("delivery", "awaiting"), "confirm")).toBeNull();
  });

  it("reset undoes anything except an order that hasn't moved", () => {
    expect(nextFulfillmentStatus(order("pickup", "awaiting"), "reset")).toBeNull();
    for (const s of ["ready", "picked_up"]) expect(nextFulfillmentStatus(order("pickup", s), "reset")).toBe("awaiting");
    for (const s of ["shipped", "delivered", "issue"]) expect(nextFulfillmentStatus(order("delivery", s), "reset")).toBe("awaiting");
  });
});

describe("validateShipment", () => {
  it("normalizes a pasted tracking number", () => {
    expect(normalizeTrackingNumber(" ef 1234-5678 9th ")).toBe("EF123456789TH");
    const r = validateShipment({ carrier: "thailand_post", trackingNumber: "ef123456789th" });
    expect(r).toEqual({ ok: true, value: { carrier: "thailand_post", carrierName: null, trackingNumber: "EF123456789TH", trackingUrl: null } });
  });

  it("requires a number for numbered carriers", () => {
    expect(validateShipment({ carrier: "flash" })).toEqual({ ok: false, error: "tracking_required" });
    expect(validateShipment({ carrier: "flash", trackingNumber: "   " })).toEqual({ ok: false, error: "tracking_required" });
  });

  it("rejects junk tracking numbers", () => {
    expect(validateShipment({ carrier: "jt", trackingNumber: "12" })).toEqual({ ok: false, error: "tracking_number_invalid" });
    expect(validateShipment({ carrier: "jt", trackingNumber: "<script>" })).toEqual({ ok: false, error: "tracking_number_invalid" });
  });

  it("same-day couriers need an https link, and drop any number", () => {
    expect(validateShipment({ carrier: "same_day", trackingNumber: "ABC123" })).toEqual({ ok: false, error: "tracking_required" });
    expect(validateShipment({ carrier: "same_day", trackingUrl: "http://example.com/x" })).toEqual({ ok: false, error: "tracking_link_invalid" });
    expect(validateShipment({ carrier: "same_day", trackingUrl: "javascript:alert(1)" })).toEqual({ ok: false, error: "tracking_link_invalid" });
    const r = validateShipment({ carrier: "same_day", trackingUrl: "https://share.lalamove.com/abc", trackingNumber: "ABC123" });
    expect(r.ok && r.value).toEqual({ carrier: "same_day", carrierName: null, trackingNumber: null, trackingUrl: "https://share.lalamove.com/abc" });
  });

  it("'other' needs a carrier name and either a number or a link", () => {
    expect(validateShipment({ carrier: "other", trackingNumber: "ABC123" })).toEqual({ ok: false, error: "carrier_name_required" });
    expect(validateShipment({ carrier: "other", carrierName: "Nim Express" })).toEqual({ ok: false, error: "tracking_required" });
    expect(validateShipment({ carrier: "other", carrierName: " Nim Express ", trackingNumber: "ABC123" }).ok).toBe(true);
  });

  it("ignores carrierName on a known carrier and rejects unknown carriers", () => {
    const r = validateShipment({ carrier: "kex", carrierName: "whatever", trackingNumber: "KEX123456" });
    expect(r.ok && r.value.carrierName).toBeNull();
    expect(validateShipment({ carrier: "dhl", trackingNumber: "ABC123" })).toEqual({ ok: false, error: "unknown_carrier" });
  });
});

describe("tracking links and labels", () => {
  it("prefers the seller's https link, else the carrier's official page", () => {
    expect(trackingLinkFor("same_day", "https://share.lalamove.com/abc")).toBe("https://share.lalamove.com/abc");
    expect(trackingLinkFor("thailand_post", null)).toBe("https://track.thailandpost.co.th/");
    expect(trackingLinkFor("thailand_post", "javascript:alert(1)")).toBe("https://track.thailandpost.co.th/");
    expect(trackingLinkFor("other", null)).toBeNull();
  });

  it("labels 'other' with the typed name", () => {
    expect(carrierLabel("other", "Nim Express", false)).toBe("Nim Express");
    expect(carrierLabel("flash", null, false)).toBe("Flash Express");
  });
});

describe("auto-confirm clock", () => {
  const shipped = new Date("2026-09-01T10:00:00Z");
  it("is due exactly 7 days after shipping", () => {
    expect(isAutoConfirmDue(shipped, new Date("2026-09-08T09:59:59Z"))).toBe(false);
    expect(isAutoConfirmDue(shipped, new Date("2026-09-08T10:00:00Z"))).toBe(true);
    expect(isAutoConfirmDue(null)).toBe(false);
  });
  it("counts whole days left", () => {
    expect(daysUntilAutoConfirm(shipped, new Date("2026-09-01T10:00:00Z"))).toBe(7);
    expect(daysUntilAutoConfirm(shipped, new Date("2026-09-07T11:00:00Z"))).toBe(1);
    expect(daysUntilAutoConfirm(shipped, new Date("2026-09-09T00:00:00Z"))).toBe(0);
  });
});

describe("blocksPaymentReview", () => {
  it("only an order whose goods haven't left the seller can be rejected/reverted", () => {
    expect(blocksPaymentReview("awaiting")).toBe(false);
    expect(blocksPaymentReview("ready")).toBe(false);
    for (const s of ["shipped", "picked_up", "delivered", "issue"]) expect(blocksPaymentReview(s)).toBe(true);
  });
});
