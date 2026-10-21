import { db } from "@/db";
import { clubs, shopVariants, shopOrderItems, shopOrders, shopProducts, shopSellers, shopSettings, users } from "@/db/schema";
import { z } from "zod";
import { AuditService } from "@/modules/audit/audit.service";
import { carrierLabel, nextFulfillmentStatus, type ShipmentValue } from "@/lib/shop/shop-fulfillment";
import { handOverItems, staffFulfillmentPatch, undoItemHandover } from "@/lib/shop/shop-fulfillment-server";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { productSchema } from "@/lib/shop/shop-product-schema";

type ProductInput = z.infer<typeof productSchema>;

const ROLE_PRIORITY = [
  "super_admin", "admin", "registration", "organizer", "smo", "anusmo",
  "club_president", "major_president", "shop_seller", "staff", "professor",
  "officer", "student",
];

function nextRoles(current: string[] | null, fallback: string | null, approved: boolean): string[] {
  const roles = new Set(current?.length ? current : [fallback || "student"]);
  if (approved) roles.add("shop_seller");
  else roles.delete("shop_seller");
  if (roles.size === 0) roles.add("student");
  return [...roles];
}

// Second users join for who reviewed the order (the finance summary on each card).
const reviewers = alias(users, "reviewers");
// ...and for who handed the order over (the "picked up … by" line).
const fulfillers = alias(users, "fulfillers");
const lineHanders = alias(users, "line_handers");

const LABEL = {
  ready: "Marked ready for pickup",
  ship: "Marked shipped",
  handover: "Marked handed over (manual)",
  reset: "Reset fulfilment of",
} as const;

// Thrown when a staff fulfilment transition is refused (maps to 404/409 in the route).
export class TransitionRefused extends Error {}

export class ShopAdminService {
  /** Non-archived clubs (id + name) for the product-owner picker. */
  static async listActiveClubsForOwnerPicker() {
    return db
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .where(eq(clubs.isArchived, false))
      .orderBy(asc(clubs.name));
  }

  /** Every order's finance header (status, discount, shipping, seller name). */
  static async listOrdersForFinance() {
    return db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        discountAmount: shopOrders.discountAmount,
        shippingFee: shopOrders.shippingFee,
        sellerName: shopSellers.displayName,
      })
      .from(shopOrders)
      .leftJoin(shopSellers, eq(shopOrders.sellerId, shopSellers.id));
  }

  /** Line items (money columns only) of the given orders. */
  static async listFinanceItemsForOrders(orderIds: string[]) {
    return db
      .select({
        orderId: shopOrderItems.orderId,
        productId: shopOrderItems.productId,
        productName: shopOrderItems.productName,
        unitPrice: shopOrderItems.unitPrice,
        quantity: shopOrderItems.quantity,
      })
      .from(shopOrderItems)
      .where(inArray(shopOrderItems.orderId, orderIds));
  }

  /** Every product with its seller name, for the handover counter's picker. */
  static async listProductsForFulfillmentPicker() {
    return db
      .select({
        id: shopProducts.id,
        name: shopProducts.name,
        price: shopProducts.price,
        imageUrl: shopProducts.imageUrl,
        imageUrls: shopProducts.imageUrls,
        isActive: shopProducts.isActive,
        sellerId: shopProducts.sellerId,
        ownerClubIds: shopProducts.ownerClubIds,
        ownerMajors: shopProducts.ownerMajors,
        sellerName: shopSellers.displayName,
      })
      .from(shopProducts)
      .leftJoin(shopSellers, eq(shopProducts.sellerId, shopSellers.id));
  }

  /** How much of each product is paid for and still waiting to be handed over in person. */
  static async listWaitingForHandover(productIds: string[]) {
    return db
      .select({
        productId: shopOrderItems.productId,
        quantity: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)::int`,
        buyers: sql<number>`count(distinct ${shopOrders.buyerId})::int`,
      })
      .from(shopOrderItems)
      .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
      .where(and(
        inArray(shopOrderItems.productId, productIds),
        eq(shopOrders.status, "approved"),
        inArray(shopOrders.fulfillmentStatus, ["awaiting", "ready", "partial"]),
        isNull(shopOrderItems.handedOverAt),
      ))
      .groupBy(shopOrderItems.productId);
  }

  /**
   * Marketplace application/review queue (includes account name/email). The
   * PII read and its audit log are kept together here.
   */
  static async listSellerApplications(actorId: string, ipAddress: string) {
    const sellers = await db
      .select({
        id: shopSellers.id,
        userId: shopSellers.userId,
        displayName: shopSellers.displayName,
        status: shopSellers.status,
        reviewNote: shopSellers.reviewNote,
        appliedAt: shopSellers.appliedAt,
        reviewedAt: shopSellers.reviewedAt,
        accountName: users.name,
        accountEmail: users.email,
      })
      .from(shopSellers)
      .innerJoin(users, eq(users.id, shopSellers.userId))
      .orderBy(desc(shopSellers.appliedAt));

    await AuditService.logAction({
      actorId,
      action: `Viewed shop seller review queue (${sellers.length} applications; included account name/email)`,
      ipAddress,
    });

    return sellers;
  }

  /**
   * Approve/reject/suspend a seller application. The seller capability and
   * review state move in the same transaction (with the audit log).
   */
  static async reviewSeller(
    id: string,
    data: { action: "approve" | "reject" | "suspend"; note?: string },
    actorId: string,
    ipAddress: string,
  ) {
    return db.transaction(async (tx) => {
      const [seller] = await tx
        .select({ id: shopSellers.id, userId: shopSellers.userId, status: shopSellers.status })
        .from(shopSellers)
        .where(eq(shopSellers.id, id))
        .limit(1)
        .for("update");
      if (!seller) return { notFound: true as const };

      const [user] = await tx
        .select({ role: users.role, roles: users.roles })
        .from(users)
        .where(eq(users.id, seller.userId))
        .limit(1)
        .for("update");
      if (!user) return { notFound: true as const };

      const approved = data.action === "approve";
      const status = approved ? "approved" : data.action === "reject" ? "rejected" : "suspended";
      const roles = nextRoles(user.roles, user.role, approved);
      const primaryRole = ROLE_PRIORITY.find((role) => roles.includes(role)) ?? roles[0] ?? "student";

      await tx
        .update(shopSellers)
        .set({
          status,
          reviewNote: data.note || null,
          reviewedBy: actorId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shopSellers.id, seller.id));

      await tx
        .update(users)
        .set({ role: primaryRole, roles, updatedAt: new Date() })
        .where(eq(users.id, seller.userId));

      await AuditService.logActionInternal(tx, {
        actorId,
        targetId: seller.userId,
        action: `${data.action === "approve" ? "Approved" : data.action === "reject" ? "Rejected" : "Suspended"} shop seller ${seller.id} (${seller.status} → ${status})`,
        ipAddress,
      });

      return { status };
    });
  }

  /** A seller's own payment + fulfilment settings (undefined if no such seller). */
  static async getSellerPaymentSettings(sellerId: string) {
    const [seller] = await db
      .select({
        paymentInfo: shopSellers.paymentInfo,
        qrImageUrl: shopSellers.qrImageUrl,
        deliveryEnabled: shopSellers.deliveryEnabled,
        deliveryFee: shopSellers.deliveryFee,
        pickupInfo: shopSellers.pickupInfo,
      })
      .from(shopSellers)
      .where(eq(shopSellers.id, sellerId))
      .limit(1);
    return seller;
  }

  /** The global (central SMO) shop settings row for the admin settings form. */
  static async getGlobalSettingsForAdmin() {
    const [row] = await db
      .select({
        enabled: shopSettings.enabled,
        paymentInfo: shopSettings.paymentInfo,
        qrImageUrl: shopSettings.qrImageUrl,
        deliveryEnabled: shopSettings.deliveryEnabled,
        deliveryFee: shopSettings.deliveryFee,
        pickupInfo: shopSettings.pickupInfo,
      })
      .from(shopSettings)
      .orderBy(desc(shopSettings.updatedAt))
      .limit(1);
    return row;
  }

  /**
   * Saves shop settings: a seller's own payout/fulfilment settings, or the
   * global singleton (upsert) — plus the audit log, in one transaction.
   */
  static async saveSettings(params: {
    unscoped: boolean;
    sellerId: string | null;
    userId: string;
    data: {
      enabled: boolean;
      paymentInfo: string;
      qrImageUrl: string | null;
      deliveryEnabled: boolean;
      deliveryFee: number;
      pickupInfo: string;
    };
    ipAddress: string;
  }) {
    const { unscoped, sellerId, userId, data, ipAddress } = params;
    await db.transaction(async (tx) => {
      if (!unscoped) {
        await tx
          .update(shopSellers)
          .set({
            paymentInfo: data.paymentInfo,
            qrImageUrl: data.qrImageUrl,
            deliveryEnabled: data.deliveryEnabled,
            deliveryFee: data.deliveryFee,
            pickupInfo: data.pickupInfo,
            updatedAt: new Date(),
          })
          .where(eq(shopSellers.id, sellerId!));
      } else {
        const [existing] = await tx
          .select({ id: shopSettings.id })
          .from(shopSettings)
          .orderBy(desc(shopSettings.updatedAt))
          .limit(1);

        if (existing) {
          await tx
            .update(shopSettings)
            .set({
              enabled: data.enabled,
              paymentInfo: data.paymentInfo,
              qrImageUrl: data.qrImageUrl,
              deliveryEnabled: data.deliveryEnabled,
              deliveryFee: data.deliveryFee,
              pickupInfo: data.pickupInfo,
              updatedBy: userId,
              updatedAt: new Date(),
            })
            .where(eq(shopSettings.id, existing.id));
        } else {
          await tx.insert(shopSettings).values({
            enabled: data.enabled,
            paymentInfo: data.paymentInfo,
            qrImageUrl: data.qrImageUrl,
            deliveryEnabled: data.deliveryEnabled,
            deliveryFee: data.deliveryFee,
            pickupInfo: data.pickupInfo,
            updatedBy: userId,
          });
        }
      }

      await AuditService.logActionInternal(tx, {
        actorId: userId,
        action: unscoped
          ? `Updated global shop settings (enabled: ${data.enabled})`
          : `Updated seller payment and fulfilment settings (${sellerId})`,
        ipAddress,
      });
    });
  }

  /**
   * The admin order review queue rows: every order with buyer info, newest
   * first. Bulk PII — the caller writes the PDPA access log after scoping.
   */
  static async listOrdersForReview() {
    return db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        totalAmount: shopOrders.totalAmount,
        note: shopOrders.note,
        rejectionReason: shopOrders.rejectionReason,
        slipPath: shopOrders.slipPath,
        slipFlag: shopOrders.slipFlag,
        slipQrPayload: shopOrders.slipQrPayload,
        createdAt: shopOrders.createdAt,
        reviewedAt: shopOrders.reviewedAt,
        reviewerName: reviewers.name,
        fulfillment: shopOrders.fulfillment,
        shippingFee: shopOrders.shippingFee,
        discountAmount: shopOrders.discountAmount,
        recipientName: shopOrders.recipientName,
        recipientPhone: shopOrders.recipientPhone,
        shippingAddress: shopOrders.shippingAddress,
        sellerId: shopOrders.sellerId,
        sellerName: shopSellers.displayName,
        buyerName: users.name,
        buyerStudentId: users.studentId,
        buyerNickname: users.nickname,
        fulfillmentStatus: shopOrders.fulfillmentStatus,
        readyAt: shopOrders.readyAt,
        carrier: shopOrders.carrier,
        carrierName: shopOrders.carrierName,
        trackingNumber: shopOrders.trackingNumber,
        trackingUrl: shopOrders.trackingUrl,
        shippedAt: shopOrders.shippedAt,
        fulfilledAt: shopOrders.fulfilledAt,
        fulfilledVia: shopOrders.fulfilledVia,
        fulfilledByName: fulfillers.name,
        fulfillmentNote: shopOrders.fulfillmentNote,
        issueNote: shopOrders.issueNote,
        issueAt: shopOrders.issueAt,
      })
      .from(shopOrders)
      .leftJoin(users, eq(shopOrders.buyerId, users.id))
      .leftJoin(shopSellers, eq(shopOrders.sellerId, shopSellers.id))
      .leftJoin(reviewers, eq(shopOrders.reviewedBy, reviewers.id))
      .leftJoin(fulfillers, eq(shopOrders.fulfilledBy, fulfillers.id))
      .orderBy(desc(shopOrders.createdAt));
  }

  /** Manual (staff) handover of the ticked lines under one order, in one transaction. */
  static async handOverItemsManually(params: {
    itemIds: string[];
    orderId: string;
    actorId: string;
    note?: string;
    ip: string;
  }) {
    const { itemIds, orderId, actorId, note, ip } = params;
    return db.transaction((tx) => handOverItems(tx, {
      itemIds,
      orderId,
      actorId,
      via: "manual",
      note,
      ip,
    }));
  }

  /**
   * Staff fulfilment transition (ready / ship / reset) under a row lock, with
   * its audit log, in one transaction. Throws TransitionRefused when the order
   * is missing or can't make that move. (The "handover" action is separate —
   * see handOverItemsManually.)
   */
  static async applyStaffTransition(params: {
    id: string;
    action: "ready" | "ship" | "handover" | "reset";
    shipment: ShipmentValue | undefined;
    note?: string;
    actorId: string;
    ipAddress: string;
  }) {
    const { id, action, shipment, note, actorId, ipAddress } = params;
    return db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          buyerId: shopOrders.buyerId,
          status: shopOrders.status,
          fulfillment: shopOrders.fulfillment,
          fulfillmentStatus: shopOrders.fulfillmentStatus,
        })
        .from(shopOrders)
        .where(eq(shopOrders.id, id))
        .limit(1)
        .for("update");
      if (!order) throw new TransitionRefused("Not found");

      const next = nextFulfillmentStatus(order, action);
      if (!next) {
        throw new TransitionRefused(
          order.status !== "approved"
            ? "This order hasn't been approved (paid) yet."
            : "This order can't do that in its current state — refresh the list and try again."
        );
      }

      await tx
        .update(shopOrders)
        .set(staffFulfillmentPatch({
          action: action,
          from: order.fulfillmentStatus,
          next,
          actorId,
          via: "manual",
          shipment,
          note: note,
        }))
        .where(eq(shopOrders.id, id));
      // Reset also forgets which lines were handed over.
      if (action === "reset") {
        await tx.update(shopOrderItems).set({ handedOverAt: null, handedOverBy: null }).where(eq(shopOrderItems.orderId, id));
      }

      const detail = shipment
        ? ` (${carrierLabel(shipment.carrier, shipment.carrierName, false)}${shipment.trackingNumber ? ` ${shipment.trackingNumber}` : ""})`
        : "";
      await AuditService.logActionInternal(tx, {
        actorId,
        targetId: id,
        action: `${LABEL[action]} shop order ${id}${detail} [${order.fulfillmentStatus} → ${next}]`,
        ipAddress,
      });

      return { buyerId: order.buyerId, next, from: order.fulfillmentStatus };
    });
  }

  /** Every product (incl. inactive) in admin order. */
  static async listAllProducts() {
    return db
      .select()
      .from(shopProducts)
      .orderBy(asc(shopProducts.sortOrder), desc(shopProducts.createdAt));
  }

  /** id + display name of the given sellers. */
  static async listSellerNames(sellerIds: string[]) {
    return db
      .select({ id: shopSellers.id, displayName: shopSellers.displayName })
      .from(shopSellers)
      .where(inArray(shopSellers.id, sellerIds));
  }

  /** Creates a product, its variants and the audit log in one transaction; returns the product id. */
  static async createProduct(params: {
    data: ProductInput;
    variantIds: string[];
    bundleDeals: ProductInput["bundleDeals"];
    sellerId: string | null;
    autoApproved: boolean;
    actorId: string;
    ipAddress: string;
  }) {
    const { data, variantIds, bundleDeals, sellerId, autoApproved, actorId, ipAddress } = params;
    return db.transaction(async (tx) => {
      const [product] = await tx
        .insert(shopProducts)
        .values({
          name: data.name,
          description: data.description,
          price: data.price,
          imageUrl: data.imageUrls[0] ?? null,
          imageUrls: data.imageUrls,
          maxPerOrder: data.maxPerOrder,
          opensAt: data.opensAt,
          closesAt: data.closesAt,
          isActive: data.isActive,
          allowedRoles: data.allowedRoles,
          allowedMajors: data.allowedMajors,
          targetThai: data.targetThai,
          targetInternational: data.targetInternational,
          customFields: data.customFields,
          deliveryFee: data.deliveryFee,
          deliveryTiers: data.deliveryTiers,
          bundleDeals,
          welfarePrice: data.welfarePrice,
          welfareRoles: data.welfareRoles,
          sortOrder: data.sortOrder,
          ownerClubIds: data.ownerClubIds,
          ownerMajors: data.ownerMajors,
          sellerId,
          approvalStatus: autoApproved ? "approved" : "pending",
          approvalReason: null,
        })
        .returning({ id: shopProducts.id });

      await tx.insert(shopVariants).values(
        data.variants.map((v, i) => ({ id: variantIds[i], productId: product.id, label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, welfarePrice: v.welfarePrice, sortOrder: i }))
      );

      const ownerNote = data.ownerClubIds.length || data.ownerMajors.length
        ? ` (owner clubs: [${data.ownerClubIds.join(", ")}], majors: [${data.ownerMajors.join(", ")}])`
        : " (central)";
      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        action: `Created shop product "${data.name}"${ownerNote}${autoApproved ? " (approved)" : " (pending approval)"}`,
        ipAddress: ipAddress,
      });

      return product.id;
    });
  }

  /** A product's current ownership/approval columns (the PUT scope pre-check). */
  static async getProductForEdit(id: string) {
    const [current] = await db
      .select({
        sellerId: shopProducts.sellerId,
        ownerClubIds: shopProducts.ownerClubIds,
        ownerMajors: shopProducts.ownerMajors,
        approvalStatus: shopProducts.approvalStatus,
      })
      .from(shopProducts)
      .where(eq(shopProducts.id, id))
      .limit(1);
    return current;
  }

  /** A product's name + ownership columns (delete / export scope pre-check). */
  static async getProductWithOwnership(id: string) {
    const [product] = await db
      .select({ name: shopProducts.name, sellerId: shopProducts.sellerId, ownerClubIds: shopProducts.ownerClubIds, ownerMajors: shopProducts.ownerMajors })
      .from(shopProducts)
      .where(eq(shopProducts.id, id))
      .limit(1);
    return product;
  }

  /**
   * Updates a product and reconciles its variants (existing ids updated, new
   * ones inserted, removed ones deleted; order_items keep their snapshot via ON
   * DELETE SET NULL) plus the audit log, in one transaction. `sellerScope` is
   * non-null for a scoped caller (re-assigns sellerId); throws a ZodError if the
   * product vanished.
   */
  static async updateProduct(params: {
    id: string;
    data: ProductInput;
    variantIds: string[];
    bundleDeals: ProductInput["bundleDeals"];
    sellerScope: { sellerId: string | null } | null;
    needsReReview: boolean;
    actorId: string;
    ipAddress: string;
  }) {
    const { id, data, variantIds, bundleDeals, sellerScope, needsReReview, actorId, ipAddress } = params;
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: shopProducts.id, name: shopProducts.name }).from(shopProducts).where(eq(shopProducts.id, id)).limit(1);
      if (!existing) throw new z.ZodError([{ code: "custom", message: "Product not found", path: ["id"] }]);
      // Snapshot current variant labels before the upsert loop below overwrites
      // them, so a rename can be propagated to existing order lines afterward.
      const priorVariants = await tx.select({ id: shopVariants.id, label: shopVariants.label }).from(shopVariants).where(eq(shopVariants.productId, id));
      const priorLabelById = new Map(priorVariants.map((v) => [v.id, v.label]));

      await tx
        .update(shopProducts)
        .set({
          name: data.name,
          description: data.description,
          price: data.price,
          imageUrl: data.imageUrls[0] ?? null,
          imageUrls: data.imageUrls,
          maxPerOrder: data.maxPerOrder,
          opensAt: data.opensAt,
          closesAt: data.closesAt,
          isActive: data.isActive,
          allowedRoles: data.allowedRoles,
          allowedMajors: data.allowedMajors,
          targetThai: data.targetThai,
          targetInternational: data.targetInternational,
          customFields: data.customFields,
          deliveryFee: data.deliveryFee,
          deliveryTiers: data.deliveryTiers,
          bundleDeals,
          welfarePrice: data.welfarePrice,
          welfareRoles: data.welfareRoles,
          sortOrder: data.sortOrder,
          ownerClubIds: data.ownerClubIds,
          ownerMajors: data.ownerMajors,
          ...(sellerScope ? { sellerId: sellerScope.sellerId } : {}),
          ...(needsReReview
            ? { approvalStatus: "pending", approvalReason: null, reviewedBy: null, reviewedAt: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(shopProducts.id, id));

      // Order lines snapshot productName/variantLabel at checkout so past orders
      // read as what was actually bought — but a rename (fixing a typo, or just
      // renaming "Pre-order" -> "Pre-order2") otherwise splits an order's history
      // across two names in every admin list/filter/export that groups by them.
      // Propagate a rename to EVERY existing order line for this product
      // (regardless of status), so they stay one consistent group.
      if (existing.name !== data.name) {
        await tx.update(shopOrderItems).set({ productName: data.name }).where(eq(shopOrderItems.productId, id));
      }

      const keepIds = data.variants.map((v) => v.id).filter((v): v is string => Boolean(v));
      // Delete variants the admin removed.
      if (keepIds.length) {
        await tx.delete(shopVariants).where(and(eq(shopVariants.productId, id), notInArray(shopVariants.id, keepIds)));
      } else {
        await tx.delete(shopVariants).where(eq(shopVariants.productId, id));
      }

      // Upsert each variant in order (sortOrder = position).
      for (let i = 0; i < data.variants.length; i++) {
        const v = data.variants[i];
        if (v.id) {
          await tx
            .update(shopVariants)
            .set({ label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, welfarePrice: v.welfarePrice, sortOrder: i })
            .where(and(eq(shopVariants.id, v.id), eq(shopVariants.productId, id)));

          // Same propagation as the product name, for the variant label. A line's
          // snapshot is either the bare label ("M") or, for an "Other (specify)"
          // option, "M: <what the buyer typed>" — only replace the label PREFIX so
          // the buyer's typed text survives. Matched with exact string ops
          // (left()/char_length()), never LIKE, so a label containing a literal
          // "%" or "_" (both SQL wildcards) can't widen the match; char_length()
          // (not JS .length) keeps the cut point correct for multi-byte text.
          // Guarded so a rename from "S" doesn't accidentally match a line
          // snapshotted as "Small".
          const priorLabel = priorLabelById.get(v.id);
          if (priorLabel != null && priorLabel !== v.label) {
            const prefixWithColon = `${priorLabel}: `;
            await tx
              .update(shopOrderItems)
              .set({ variantLabel: sql`${v.label} || substring(${shopOrderItems.variantLabel} from char_length(${priorLabel}) + 1)` })
              .where(
                and(
                  eq(shopOrderItems.variantId, v.id),
                  or(
                    eq(shopOrderItems.variantLabel, priorLabel),
                    sql`left(${shopOrderItems.variantLabel}, char_length(${prefixWithColon})) = ${prefixWithColon}`
                  )
                )
              );
          }
        } else {
          await tx.insert(shopVariants).values({ id: variantIds[i], productId: id, label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, welfarePrice: v.welfarePrice, sortOrder: i });
        }
      }

      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        action: `Updated shop product "${data.name}" (owner clubs: [${data.ownerClubIds.join(", ")}], majors: [${data.ownerMajors.join(", ")}])`,
        ipAddress: ipAddress,
      });
    });
  }

  /** Deletes a product and writes the audit log in one transaction. */
  static async deleteProduct(id: string, productName: string, actorId: string, ipAddress: string) {
    await db.transaction(async (tx) => {
      await tx.delete(shopProducts).where(eq(shopProducts.id, id));
      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        action: `Deleted shop product "${productName}"`,
        ipAddress: ipAddress,
      });
    });
  }

  /**
   * Trusted-reviewer approve/reject of a pending product, with its audit log,
   * in one transaction. A central product (no seller) can only be reviewed by a
   * full admin (`isFullAdmin`).
   */
  static async reviewProduct(
    id: string,
    data: { action: "approve" | "reject"; reason?: string },
    isFullAdmin: boolean,
    actorId: string,
    ipAddress: string,
  ) {
    return db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: shopProducts.id, name: shopProducts.name, sellerId: shopProducts.sellerId })
        .from(shopProducts)
        .where(eq(shopProducts.id, id))
        .limit(1);
      if (!product) return { notFound: true as const };
      if (!product.sellerId && !isFullAdmin) return { central: true as const };

      const status = data.action === "approve" ? "approved" : "rejected";
      await tx
        .update(shopProducts)
        .set({
          approvalStatus: status,
          approvalReason: data.action === "reject" ? data.reason : null,
          reviewedBy: actorId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shopProducts.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        targetId: id,
        action: `${data.action === "approve" ? "Approved" : "Rejected"} ${product.sellerId ? "seller" : "central"} product "${product.name}" (${id})`,
        ipAddress: ipAddress,
      });
      return { status };
    });
  }

  /** Every order line (with buyer + slip refs) of one product, newest first, for the xlsx export. */
  static async listOrderLinesForProductExport(id: string) {
    return db
      .select({
        orderId: shopOrders.id,
        status: shopOrders.status,
        createdAt: shopOrders.createdAt,
        reviewedAt: shopOrders.reviewedAt,
        rejectionReason: shopOrders.rejectionReason,
        orderTotal: shopOrders.totalAmount,
        slipPath: shopOrders.slipPath,
        slipFlag: shopOrders.slipFlag,
        slipQrPayload: shopOrders.slipQrPayload,
        note: shopOrders.note,
        fulfillment: shopOrders.fulfillment,
        shippingFee: shopOrders.shippingFee,
        discountAmount: shopOrders.discountAmount,
        recipientName: shopOrders.recipientName,
        recipientPhone: shopOrders.recipientPhone,
        shippingAddress: shopOrders.shippingAddress,
        variantLabel: shopOrderItems.variantLabel,
        customValues: shopOrderItems.customValues,
        quantity: shopOrderItems.quantity,
        unitPrice: shopOrderItems.unitPrice,
        buyerName: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        email: users.email,
        phone: users.phone,
        major: users.major,
        houseId: users.houseId,
      })
      .from(shopOrderItems)
      .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
      .leftJoin(users, eq(shopOrders.buyerId, users.id))
      .where(eq(shopOrderItems.productId, id))
      .orderBy(desc(shopOrders.createdAt));
  }

  /** The order ids the given order-item ids belong to (scope check before a handover). */
  static async listOrderIdsForItems(itemIds: string[]) {
    return db.select({ orderId: shopOrderItems.orderId }).from(shopOrderItems).where(inArray(shopOrderItems.id, itemIds));
  }

  /** Takes back lines just handed over, in one transaction. */
  static async undoHandover(params: { itemIds: string[]; actorId: string; ip: string }) {
    const { itemIds, actorId, ip } = params;
    return db.transaction((tx) => undoItemHandover(tx, { itemIds, actorId, ip }));
  }

  /** A product's ownership columns for the handover counter's scope check. */
  static async getProductForHandover(productId: string) {
    const [product] = await db
      .select({
        id: shopProducts.id,
        name: shopProducts.name,
        sellerId: shopProducts.sellerId,
        ownerClubIds: shopProducts.ownerClubIds,
        ownerMajors: shopProducts.ownerMajors,
      })
      .from(shopProducts)
      .where(eq(shopProducts.id, productId))
      .limit(1);
    return product;
  }

  /** QR-verified handover of the chosen lines to one buyer/product, in one transaction. */
  static async confirmHandoverByQr(params: {
    itemIds: string[];
    actorId: string;
    note?: string;
    ip: string;
    buyerId: string;
    productId: string;
  }) {
    const { itemIds, actorId, note, ip, buyerId, productId } = params;
    return db.transaction((tx) => handOverItems(tx, {
      itemIds,
      actorId,
      via: "qr",
      note,
      ip,
      buyerId,
      productId,
    }));
  }

  /** Every pending-or-approved order of one buyer (newest first) for the handover preview. */
  static async listBuyerOpenOrders(buyerId: string) {
    return db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        fulfillment: shopOrders.fulfillment,
        fulfillmentStatus: shopOrders.fulfillmentStatus,
        createdAt: shopOrders.createdAt,
        fulfilledAt: shopOrders.fulfilledAt,
        fulfilledByName: fulfillers.name,
      })
      .from(shopOrders)
      .leftJoin(fulfillers, eq(shopOrders.fulfilledBy, fulfillers.id))
      .where(and(eq(shopOrders.buyerId, buyerId), inArray(shopOrders.status, ["pending", "approved"])))
      .orderBy(desc(shopOrders.createdAt));
  }

  /** The order lines (with who handed each over) for the given orders. */
  static async listLinesForOrders(orderIds: string[]) {
    return db
      .select({
        id: shopOrderItems.id,
        orderId: shopOrderItems.orderId,
        productId: shopOrderItems.productId,
        productName: shopOrderItems.productName,
        variantLabel: shopOrderItems.variantLabel,
        customValues: shopOrderItems.customValues,
        quantity: shopOrderItems.quantity,
        handedOverAt: shopOrderItems.handedOverAt,
        handedOverByName: lineHanders.name,
      })
      .from(shopOrderItems)
      .leftJoin(lineHanders, eq(shopOrderItems.handedOverBy, lineHanders.id))
      .where(inArray(shopOrderItems.orderId, orderIds));
  }
}
