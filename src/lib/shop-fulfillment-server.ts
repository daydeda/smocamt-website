import { db } from "@/db";
import { shopOrderItems, shopOrders } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import {
  SHOP_AUTO_CONFIRM_DAYS, statusAfterItemHandover, statusAfterItemUndo, type FulfillmentStatus, type ShipmentValue,
} from "@/lib/shop-fulfillment";
import { and, eq, inArray, lte, type SQL } from "drizzle-orm";

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
      // A note ("collected by a friend") is kept across partial handovers;
      // a later step without one doesn't wipe it.
      if (next === "partial") {
        return { fulfillmentStatus: next, ...(note?.trim() ? { fulfillmentNote: note.trim() } : {}), updatedAt: now };
      }
      return {
        fulfillmentStatus: next,
        fulfilledAt: now,
        fulfilledBy: actorId,
        fulfilledVia: params.via ?? "manual",
        ...(note?.trim() ? { fulfillmentNote: note.trim() } : {}),
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A handover/undo the current state doesn't allow. Routes turn it into a JSON
// error with this status.
export class HandoverRefused extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

export type LineChange = { orderId: string; from: string; next: FulfillmentStatus; itemIds: string[] };

// Locks the orders owning these lines, then re-reads every line of those orders
// under the lock (a line read before the lock may already have been handed over
// by another counter). The caller has already checked the caller's scope.
async function lockLines(tx: Tx, itemIds: string[]) {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) throw new HandoverRefused("Choose at least one item.", 400);
  const owners = await tx
    .select({ orderId: shopOrderItems.orderId })
    .from(shopOrderItems)
    .where(inArray(shopOrderItems.id, ids));
  const orderIds = [...new Set(owners.map((o) => o.orderId))];
  if (orderIds.length === 0) throw new HandoverRefused("These items no longer exist. Scan again to refresh.", 404);
  const orders = await tx
    .select({
      id: shopOrders.id,
      buyerId: shopOrders.buyerId,
      status: shopOrders.status,
      fulfillment: shopOrders.fulfillment,
      fulfillmentStatus: shopOrders.fulfillmentStatus,
      readyAt: shopOrders.readyAt,
      shippedAt: shopOrders.shippedAt,
    })
    .from(shopOrders)
    .where(inArray(shopOrders.id, orderIds))
    .orderBy(shopOrders.id)
    .for("update");
  const lines = await tx
    .select({
      id: shopOrderItems.id,
      orderId: shopOrderItems.orderId,
      productId: shopOrderItems.productId,
      productName: shopOrderItems.productName,
      variantLabel: shopOrderItems.variantLabel,
      quantity: shopOrderItems.quantity,
      handedOverAt: shopOrderItems.handedOverAt,
    })
    .from(shopOrderItems)
    .where(inArray(shopOrderItems.orderId, orderIds));
  const requested = lines.filter((l) => ids.includes(l.id));
  if (requested.length !== ids.length) throw new HandoverRefused("These items no longer exist. Scan again to refresh.", 404);
  return { ids, orders, lines, requested };
}

const lineLabel = (l: { productName: string; variantLabel: string; quantity: number }) =>
  `${l.productName}${l.variantLabel && l.variantLabel !== "Standard" ? ` (${l.variantLabel})` : ""} x${l.quantity}`;

// Hand over these order lines in person (the Digital ID counter, or the manual
// fallback on the order card). Stamps each line and moves each order to
// 'partial' or, once nothing is left, picked_up / delivered. Optional guards:
// buyerId = the lines must belong to the scanned person; productId = the lines
// must be the product the counter selected (the whole point of choosing the
// product first); orderId = the lines must all be on this order (card button).
export async function handOverItems(tx: Tx, params: {
  itemIds: string[];
  actorId: string;
  via: "qr" | "manual";
  note?: string | null;
  ip: string;
  buyerId?: string;
  productId?: string;
  orderId?: string;
}): Promise<LineChange[]> {
  const { ids, orders, lines, requested } = await lockLines(tx, params.itemIds);
  if (params.orderId && requested.some((l) => l.orderId !== params.orderId)) {
    throw new HandoverRefused("These items aren't on this order.", 400);
  }
  if (params.buyerId && orders.some((o) => o.buyerId !== params.buyerId)) {
    throw new HandoverRefused("These items don't belong to the scanned buyer.", 403);
  }
  if (params.productId && requested.some((l) => l.productId !== params.productId)) {
    throw new HandoverRefused("One of these items isn't the product you selected.", 400);
  }
  if (requested.some((l) => l.handedOverAt)) {
    throw new HandoverRefused("One of these items was already handed over. Scan again to refresh.", 409);
  }

  const now = new Date();
  const changes: LineChange[] = [];
  for (const order of orders) {
    const mine = requested.filter((l) => l.orderId === order.id);
    const remaining = lines.filter((l) => l.orderId === order.id && !l.handedOverAt && !ids.includes(l.id)).length;
    const next = statusAfterItemHandover(order, remaining);
    if (!next) {
      throw new HandoverRefused(
        order.status !== "approved"
          ? "One of these orders hasn't been paid (approved) yet. Don't hand it over."
          : order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "issue"
            ? "This order was sent by mail. Settle the whole parcel from the order card."
            : "One of these orders was already handed over. Scan again to refresh.",
        409,
      );
    }
    await tx
      .update(shopOrderItems)
      .set({ handedOverAt: now, handedOverBy: params.actorId })
      .where(inArray(shopOrderItems.id, mine.map((l) => l.id)));
    await tx
      .update(shopOrders)
      .set(staffFulfillmentPatch({ action: "handover", from: order.fulfillmentStatus, next, actorId: params.actorId, via: params.via, note: params.note }))
      .where(eq(shopOrders.id, order.id));
    await AuditService.logActionInternal(tx, {
      actorId: params.actorId,
      targetId: order.id,
      action: `Handed over ${mine.map(lineLabel).join(", ")} on shop order ${order.id} (${params.via === "qr" ? "Digital ID scan" : "manual"}) [${order.fulfillmentStatus} → ${next}]`,
      ipAddress: params.ip,
    });
    changes.push({ orderId: order.id, from: order.fulfillmentStatus, next, itemIds: mine.map((l) => l.id) });
  }
  return changes;
}

// Undo the handover of these lines (a slip at the counter: wrong size, wrong
// person). Only for lines handed over in person; a mailed order is undone with
// the order-level reset, which also clears the tracking.
export async function undoItemHandover(tx: Tx, params: { itemIds: string[]; actorId: string; ip: string }): Promise<LineChange[]> {
  const { ids, orders, lines, requested } = await lockLines(tx, params.itemIds);
  if (requested.some((l) => !l.handedOverAt)) {
    throw new HandoverRefused("One of these items isn't marked as handed over. Refresh and try again.", 409);
  }
  const changes: LineChange[] = [];
  for (const order of orders) {
    const mine = requested.filter((l) => l.orderId === order.id);
    const stillHanded = lines.filter((l) => l.orderId === order.id && l.handedOverAt && !ids.includes(l.id)).length;
    const next = statusAfterItemUndo(order, stillHanded);
    if (!next) throw new HandoverRefused("This order can't be undone here. Use \"Reset handover\" on the order card.", 409);
    await tx
      .update(shopOrderItems)
      .set({ handedOverAt: null, handedOverBy: null })
      .where(inArray(shopOrderItems.id, mine.map((l) => l.id)));
    await tx
      .update(shopOrders)
      .set({
        fulfillmentStatus: next,
        fulfilledAt: null,
        fulfilledBy: null,
        fulfilledVia: null,
        ...(next === "partial" ? {} : { fulfillmentNote: null }),
        updatedAt: new Date(),
      })
      .where(eq(shopOrders.id, order.id));
    await AuditService.logActionInternal(tx, {
      actorId: params.actorId,
      targetId: order.id,
      action: `Undid handover of ${mine.map(lineLabel).join(", ")} on shop order ${order.id} [${order.fulfillmentStatus} → ${next}]`,
      ipAddress: params.ip,
    });
    changes.push({ orderId: order.id, from: order.fulfillmentStatus, next, itemIds: mine.map((l) => l.id) });
  }
  return changes;
}

export const SHIPMENT_ERROR_MESSAGE: Record<string, string> = {
  unknown_carrier: "Please choose a carrier from the list.",
  carrier_name_required: "Please type the carrier's name.",
  tracking_number_invalid: "That tracking number doesn't look right (letters and numbers only, 6–40 characters).",
  tracking_link_invalid: "The tracking link must start with https://",
  tracking_required: "Please enter the tracking number (or the tracking link for a same-day courier).",
};
