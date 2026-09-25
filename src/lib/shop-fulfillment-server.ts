import { db } from "@/db";
import { shopOrders } from "@/db/schema";
import { SHOP_AUTO_CONFIRM_DAYS, type FulfillmentStatus, type ShipmentValue } from "@/lib/shop-fulfillment";
import { and, eq, lte, type SQL } from "drizzle-orm";

// Server half of src/lib/shop-fulfillment.ts (that file stays DB-free so the
// client can import it).

// Complete mailed orders the buyer never confirmed. There is no scheduler on the
// self-hosted deploy (vercel.json crons don't run there), so instead of a cron
// this runs lazily at the top of every order-list read — the buyer's own list
// and the admin queue — which is exactly when anyone could observe the state.
// Idempotent: the WHERE clause only matches rows still 'shipped' past the
// deadline, so concurrent reads can't double-apply. 'issue' orders are never
// auto-completed: the buyer said something is wrong.
export async function autoConfirmDueShipments(extra?: SQL): Promise<number> {
  const cutoff = new Date(Date.now() - SHOP_AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .update(shopOrders)
    .set({ fulfillmentStatus: "delivered", fulfilledAt: new Date(), fulfilledBy: null, fulfilledVia: "auto", updatedAt: new Date() })
    .where(and(eq(shopOrders.status, "approved"), eq(shopOrders.fulfillmentStatus, "shipped"), lte(shopOrders.shippedAt, cutoff), extra))
    .returning({ id: shopOrders.id });
  return rows.length;
}

// The column patch for a staff transition that nextFulfillmentStatus() already
// allowed. Centralized so the per-order card and the Digital ID scanner write
// identical rows.
export function staffFulfillmentPatch(params: {
  action: "ready" | "ship" | "handover" | "reset";
  from: string;
  next: FulfillmentStatus;
  actorId: string;
  via?: "qr" | "manual";
  shipment?: ShipmentValue;
  note?: string | null;
}): Partial<typeof shopOrders.$inferInsert> {
  const now = new Date();
  const { action, from, next, actorId, shipment, note } = params;
  switch (action) {
    case "ready":
      return { fulfillmentStatus: next, readyAt: now, updatedAt: now };
    case "ship":
      return {
        fulfillmentStatus: next,
        carrier: shipment!.carrier,
        carrierName: shipment!.carrierName,
        trackingNumber: shipment!.trackingNumber,
        trackingUrl: shipment!.trackingUrl,
        // Editing the tracking of an already-shipped order is a typo fix, so it
        // keeps the original shippedAt (and the auto-confirm clock). Shipping
        // from 'issue' is a replacement parcel, which restarts the clock.
        ...(from === "shipped" ? {} : { shippedAt: now, shippedBy: actorId }),
        updatedAt: now,
      };
    case "handover":
      return {
        fulfillmentStatus: next,
        fulfilledAt: now,
        fulfilledBy: actorId,
        fulfilledVia: params.via ?? "manual",
        fulfillmentNote: note?.trim() || null,
        updatedAt: now,
      };
    case "reset":
      // Undo: back to "not handed over". The buyer's issue report is history,
      // not state, so it's kept.
      return {
        fulfillmentStatus: next,
        readyAt: null,
        carrier: null,
        carrierName: null,
        trackingNumber: null,
        trackingUrl: null,
        shippedAt: null,
        shippedBy: null,
        fulfilledAt: null,
        fulfilledBy: null,
        fulfilledVia: null,
        fulfillmentNote: null,
        updatedAt: now,
      };
  }
}

export const SHIPMENT_ERROR_MESSAGE: Record<string, string> = {
  unknown_carrier: "Please choose a carrier from the list.",
  carrier_name_required: "Please type the carrier's name.",
  tracking_number_invalid: "That tracking number doesn't look right (letters and numbers only, 6–40 characters).",
  tracking_link_invalid: "The tracking link must start with https://",
  tracking_required: "Please enter the tracking number (or the tracking link for a same-day courier).",
};
