import ExcelJS from "exceljs";
import sharp from "sharp";
import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, users } from "@/db/schema";
import { isProductOwnedByScope } from "@/lib/shop-auth";
import { classifyOrdersByScope, resolveShopAccess } from "@/lib/shop-scope";
import { downloadSlip } from "@/lib/shop-storage";
import { isVerifyUrl } from "@/lib/shop-slip-verify";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/logger";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// GET /api/admin/shop/products/[id]/export — every order for one product as an
// .xlsx with three sheets:
//   - "Summary": quantity per option, split by status (how many of each size to make)
//   - "Orders":  one row per buyer line, autofiltered, safe to sort/filter
//   - "Slips":   one row per ORDER with its payment slip embedded as a picture
//
// Built server-side with `exceljs` (not the `xlsx` SheetJS build the other
// exports use) for the same reason as the prize report: the SheetJS community
// build cannot embed images. Slips get their own sheet instead of a column on
// "Orders" because a picture in .xlsx floats over the cells — sorting moves the
// rows but NOT the images, which would silently put a slip beside the wrong
// buyer. "Orders" stays freely sortable; "Slips" carries a do-not-sort note and
// the order ID beside every image.
//
// Nothing is stored: the file is built in memory per request and streamed back.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Downloading + resizing one slip per order is slower than a plain sheet.
export const maxDuration = 120;

// Longest edge for the embedded slip. Big enough that the amount/name stay
// readable when the picture is enlarged in Excel; small enough that a slip
// costs ~50-100KB instead of the stored original.
const SLIP_PX = 800;
const SLIP_COL_WIDTH = 30; // ≈ 215px
const SLIP_ROW_HEIGHT = 225; // points ≈ 300px
// Every slip is fetched and resized in memory — cap the embedded set.
const MAX_SLIPS = 500;
const SLIP_CONCURRENCY = 6;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// shop_orders.slip_flag → reader-facing text (see src/lib/shop-slip-verify.ts).
const SLIP_FLAG_TEXT: Record<string, string> = {
  duplicate_image: "Duplicate slip image (used on another order)",
  duplicate_qr: "Duplicate slip QR (same slip on another order)",
  no_qr: "No QR found — check manually",
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
    }

    const [product] = await db
      .select({ name: shopProducts.name, sellerId: shopProducts.sellerId, ownerClubIds: shopProducts.ownerClubIds, ownerMajors: shopProducts.ownerMajors })
      .from(shopProducts)
      .where(eq(shopProducts.id, id))
      .limit(1);
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // A scoped president/seller may only export orders for a product they own.
    if (!access.unscoped && !isProductOwnedByScope(product, access.scope, access.sellerId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
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

    // One slip per order (an order can hold several lines of this product).
    const orders = [...new Map(rows.map((r) => [r.orderId, r])).values()];
    const withSlip = orders.filter((o) => o.slipPath);
    if (withSlip.length > MAX_SLIPS) {
      return NextResponse.json(
        { error: `This product has ${withSlip.length} slips; the export is capped at ${MAX_SLIPS}.` },
        { status: 413 },
      );
    }

    // Same rule as GET /api/shop/orders/[id]/slip: a scoped president/seller may
    // see a slip only for an order that is ENTIRELY their products — a mixed
    // cart's slip also pays for someone else's items.
    let slipAllowed: (orderId: string) => boolean = () => true;
    if (!access.unscoped) {
      const info = await classifyOrdersByScope(withSlip.map((o) => o.orderId), access.scope, access.sellerId);
      slipAllowed = (orderId) => !!info.get(orderId)?.anyOwned && !!info.get(orderId)?.fullyOwned;
    }

    const dt = (d: Date | string | null) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) : "");
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    // ---- Summary ----------------------------------------------------------
    const byOption = new Map<string, { approved: number; pending: number; rejected: number }>();
    for (const r of rows) {
      const k = r.variantLabel || "—";
      const cur = byOption.get(k) ?? { approved: 0, pending: 0, rejected: 0 };
      if (r.status === "rejected") cur.rejected += r.quantity;
      else if (r.status === "approved") cur.approved += r.quantity;
      else cur.pending += r.quantity;
      byOption.set(k, cur);
    }
    const wsSum = wb.addWorksheet("Summary");
    wsSum.columns = [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 30 }];
    wsSum.addRow(["Option", "Approved", "Pending", "Rejected", "Active total (Approved+Pending)"]).font = { bold: true };
    let tA = 0, tP = 0, tR = 0;
    for (const [k, v] of byOption) {
      wsSum.addRow([k, v.approved, v.pending, v.rejected, v.approved + v.pending]);
      tA += v.approved; tP += v.pending; tR += v.rejected;
    }
    wsSum.addRow(["TOTAL", tA, tP, tR, tA + tP]).font = { bold: true };

    // ---- Orders -----------------------------------------------------------
    // Custom-field columns (e.g. jersey Name / Number) — the union of every label
    // seen across this product's lines, in first-seen order, inserted after "Option".
    const customLabels: string[] = [];
    for (const r of rows) for (const cv of r.customValues ?? []) if (!customLabels.includes(cv.label)) customLabels.push(cv.label);

    const header = [
      "Name", "Nickname", "Student ID", "Major", "House", "Email", "Phone",
      "Option", ...customLabels, "Qty", "Unit price (THB)", "Subtotal (THB)",
      "Status", "Ordered (Bangkok)", "Reviewed (Bangkok)", "Rejection reason",
      "Slip uploaded", "Promotion discount (THB)", "Order total (THB)", "Fulfillment", "Shipping (THB)",
      "Recipient", "Recipient phone", "Delivery address", "Note", "Order ID",
    ];
    const ws = wb.addWorksheet("Orders");
    ws.columns = header.map((h) => ({ width: Math.min(40, Math.max(10, h.length + 2)) }));
    ws.addRow(header).font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        r.buyerName ?? "", r.nickname ?? "", r.studentId ?? "", r.major ?? "", r.houseId ?? "", r.email ?? "", r.phone ?? "",
        r.variantLabel,
        ...customLabels.map((label) => (r.customValues ?? []).find((cv) => cv.label === label)?.value ?? ""),
        r.quantity, r.unitPrice, r.unitPrice * r.quantity,
        r.status, dt(r.createdAt), dt(r.reviewedAt), r.rejectionReason ?? "",
        r.slipPath ? "Yes" : "No", r.discountAmount ?? 0, r.orderTotal,
        r.fulfillment === "delivery" ? "Delivery" : "Self-pickup", r.shippingFee,
        r.recipientName ?? "", r.recipientPhone ?? "", r.shippingAddress ?? "", r.note ?? "", r.orderId,
      ]);
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

    // ---- Slips ------------------------------------------------------------
    const wsSlip = wb.addWorksheet("Slips");
    wsSlip.mergeCells("A1:I1");
    wsSlip.getCell("A1").value = "Note: slip pictures do NOT move when this sheet is sorted/filtered — match each slip by the Order ID beside it.";
    wsSlip.getCell("A1").font = { italic: true, color: { argb: "FFB00020" } };
    const slipHeader = ["Name", "Student ID", "Status", "Order total (THB)", "Ordered (Bangkok)", "Automated slip check", "Bank verify link", "Slip", "Order ID"];
    const slipHeaderRow = wsSlip.addRow(slipHeader);
    slipHeaderRow.font = { bold: true };
    wsSlip.columns = [
      { width: 26 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 20 },
      { width: 26 }, { width: 16 }, { width: SLIP_COL_WIDTH }, { width: 38 },
    ];
    wsSlip.views = [{ state: "frozen", ySplit: slipHeaderRow.number }];

    const slipRows = orders.map((o) => {
      const canSee = !!o.slipPath && slipAllowed(o.orderId);
      const row = wsSlip.addRow([
        o.buyerName ?? "", o.studentId ?? "", o.status, o.orderTotal, dt(o.createdAt),
        o.slipPath ? (o.slipFlag ? SLIP_FLAG_TEXT[o.slipFlag] ?? o.slipFlag : "OK") : "",
        canSee && isVerifyUrl(o.slipQrPayload) ? { text: "Open bank page", hyperlink: o.slipQrPayload } : "",
        !o.slipPath ? "— no slip —" : canSee ? "" : "— not your order —",
        o.orderId,
      ]);
      row.alignment = { vertical: "middle", wrapText: true };
      if (canSee) row.height = SLIP_ROW_HEIGHT;
      return { row, slipPath: canSee ? o.slipPath : null, orderId: o.orderId };
    });

    // Download + shrink the slips a few at a time; addImage itself stays sequential.
    const slipCellPx = { w: SLIP_COL_WIDTH * 7 - 8, h: (SLIP_ROW_HEIGHT * 4) / 3 - 8 };
    const toEmbed = slipRows.filter((s) => s.slipPath);
    let embedded = 0;
    for (let i = 0; i < toEmbed.length; i += SLIP_CONCURRENCY) {
      const batch = toEmbed.slice(i, i + SLIP_CONCURRENCY);
      const thumbs = await Promise.all(batch.map(async (s) => {
        try {
          const { buffer } = await downloadSlip(s.slipPath!);
          // Stored slips are webp, which .xlsx can't hold — re-encode as jpeg.
          const thumb = await sharp(buffer)
            .rotate()
            .resize(SLIP_PX, SLIP_PX, { fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 70 })
            .toBuffer({ resolveWithObject: true });
          return thumb;
        } catch (e) {
          // One unreadable slip must not fail the whole export — mark that row.
          console.error(`Failed to embed slip for shop order ${s.orderId}:`, e);
          return null;
        }
      }));
      batch.forEach((s, j) => {
        const thumb = thumbs[j];
        if (!thumb) {
          s.row.getCell(8).value = "— could not load slip —";
          return;
        }
        const imageId = wb.addImage({ buffer: new Uint8Array(thumb.data) as unknown as ExcelJS.Buffer, extension: "jpeg" });
        const scale = Math.min(slipCellPx.w / thumb.info.width, slipCellPx.h / thumb.info.height);
        wsSlip.addImage(imageId, {
          tl: { col: 7.05, row: s.row.number - 1 + 0.03 },
          ext: { width: Math.round(thumb.info.width * scale), height: Math.round(thumb.info.height * scale) },
        });
        embedded++;
      });
    }

    // Bulk PII export — every buyer's email, phone, recipient phone, shipping
    // address AND payment slips (bank name/account) for one product. Keep a
    // tamper-evident record of who pulled it (PDPA); not best-effort — if we
    // can't record it, we don't hand it over.
    await AuditService.logAction({
      actorId: access.userId,
      action: `Exported orders for shop product "${product.name}" (${id}) (${rows.length} order lines, included buyer email/phone + shipping address, ${embedded} payment slip images)`,
      ipAddress: getClientIp(req),
    });

    const out = await wb.xlsx.writeBuffer();
    // Keep Unicode (Thai) intact; strip only filename-illegal chars and collapse whitespace.
    const safe = product.name
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 40)
      .replace(/^_+|_+$/g, "") || "product";
    return new NextResponse(new Uint8Array(out as ArrayBuffer), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`product_${safe}.xlsx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    captureException(error, { route: "GET /api/admin/shop/products/[id]/export" });
    return NextResponse.json({ error: "Failed to generate the export" }, { status: 500 });
  }
}
