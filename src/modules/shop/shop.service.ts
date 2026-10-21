import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSellers, shopSettings, shopVariants } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

export class ShopService {
  /** The latest shop-wide settings row (QR, payment text, delivery config), or undefined. */
  static async getCurrentSettings() {
    const [settings] = await db
      .select()
      .from(shopSettings)
      .orderBy(desc(shopSettings.updatedAt))
      .limit(1);
    return settings;
  }

  /** Active, approved products in storefront order. */
  static async listActiveApprovedProducts() {
    return db
      .select()
      .from(shopProducts)
      .where(and(eq(shopProducts.isActive, true), eq(shopProducts.approvalStatus, "approved")))
      .orderBy(asc(shopProducts.sortOrder), desc(shopProducts.createdAt));
  }

  /** Approved sellers (payment/delivery details) among the given seller ids. */
  static async listApprovedSellersByIds(sellerIds: string[]) {
    return db
      .select({
        id: shopSellers.id,
        displayName: shopSellers.displayName,
        paymentInfo: shopSellers.paymentInfo,
        qrImageUrl: shopSellers.qrImageUrl,
        deliveryEnabled: shopSellers.deliveryEnabled,
        deliveryFee: shopSellers.deliveryFee,
        pickupInfo: shopSellers.pickupInfo,
      })
      .from(shopSellers)
      .where(and(inArray(shopSellers.id, sellerIds), eq(shopSellers.status, "approved")));
  }

  /** Variants of the given products in display order. */
  static async listVariantsForProducts(productIds: string[]) {
    return db
      .select()
      .from(shopVariants)
      .where(inArray(shopVariants.productId, productIds))
      .orderBy(asc(shopVariants.sortOrder));
  }

  /**
   * Units already committed per variant (everything not rejected counts against
   * stock). One grouped query instead of N.
   */
  static async listSoldByVariant(variantIds: string[]) {
    return db
      .select({
        variantId: shopOrderItems.variantId,
        sold: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)`,
      })
      .from(shopOrderItems)
      .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
      .where(and(inArray(shopOrderItems.variantId, variantIds), ne(shopOrders.status, "rejected")))
      .groupBy(shopOrderItems.variantId);
  }

  /** The signed-in account's own seller application (null if none). */
  static async getOwnSellerApplication(userId: string) {
    const [seller] = await db
      .select({
        id: shopSellers.id,
        displayName: shopSellers.displayName,
        status: shopSellers.status,
        reviewNote: shopSellers.reviewNote,
        appliedAt: shopSellers.appliedAt,
        reviewedAt: shopSellers.reviewedAt,
      })
      .from(shopSellers)
      .where(eq(shopSellers.userId, userId))
      .limit(1);
    return seller ?? null;
  }

  /**
   * Apply (or re-apply after rejection) to sell, with its audit log, in one
   * transaction. Returns { conflict } if the account's current seller status
   * blocks a (re-)application.
   */
  static async applyToSell(userId: string, displayName: string, ipAddress: string) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: shopSellers.id, status: shopSellers.status })
        .from(shopSellers)
        .where(eq(shopSellers.userId, userId))
        .limit(1);

      if (existing?.status === "approved") return { conflict: "Your seller account is already approved." };
      if (existing?.status === "pending") return { conflict: "Your seller application is already pending." };
      if (existing?.status === "suspended") return { conflict: "This seller account is suspended. Contact a shop administrator." };

      if (existing) {
        await tx
          .update(shopSellers)
          .set({
            displayName,
            status: "pending",
            reviewNote: null,
            appliedAt: new Date(),
            reviewedBy: null,
            reviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(shopSellers.id, existing.id));
      } else {
        await tx.insert(shopSellers).values({
          userId,
          displayName,
          status: "pending",
        });
      }

      await AuditService.logActionInternal(tx, {
        actorId: userId,
        action: existing ? "Re-applied for shop seller access" : "Applied for shop seller access",
        ipAddress,
      });
      return { success: true as const };
    });
  }
}
