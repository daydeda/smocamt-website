import { compressImageFile } from "@/lib/media/compress-image";
import type { ShopCustomField, ShopCustomValue, ShopCustomFieldType } from "@/lib/shop/shop-custom-fields";
import { type ShopDeliveryTier } from "@/lib/shop/shop-delivery";
import { type ShopBundleDeal } from "@/lib/shop/shop-promotions";

// True when a decoded slip QR payload is a link the admin can tap to open the
// issuing bank's own verify page. Deliberately NOT imported from
// shop-slip-verify.ts — that module pulls in Node's `crypto`, which has no
// business in a client bundle. Mirrors the check in isVerifyUrl() there.
export const isHttpUrl = (s: string | null): s is string => {
  if (!s) return false;
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

// Copy for the automated slip pre-filter flags (shop_orders.slip_flag —
// see shop-slip-verify.ts). Free/offline signals only, not bank confirmation:
// duplicate_* means this slip (or its QR) was already seen on another order;
// no_qr means the automated pass couldn't find a QR to cross-check at all;
// amount_mismatch means the OCR'd amount on the slip isn't the order total;
// amount_unreadable means no amount could be read, so it wasn't compared.
export const SLIP_FLAG_COPY: Record<string, { th: string; en: string; severity: "high" | "low" }> = {
  duplicate_image: {
    th: "สลิปรูปนี้ถูกใช้กับคำสั่งซื้ออื่นมาแล้ว — ตรวจสอบก่อนอนุมัติ",
    en: "This exact slip image was already used on another order — check before approving.",
    severity: "high",
  },
  duplicate_qr: {
    th: "QR บนสลิปนี้ตรงกับคำสั่งซื้ออื่น (อาจเป็นสลิปเดิมถ่ายซ้ำ) — ตรวจสอบก่อนอนุมัติ",
    en: "This slip's QR matches another order's slip (may be the same slip re-photographed) — check before approving.",
    severity: "high",
  },
  no_qr: {
    th: "ตรวจไม่พบ QR บนสลิปนี้ — ระบบยืนยันอัตโนมัติไม่ได้ กรุณาตรวจสอบด้วยตนเอง",
    en: "No QR code was found on this slip — the automated check couldn't run. Please review it yourself.",
    severity: "low",
  },
  amount_mismatch: {
    th: "จำนวนเงินที่อ่านได้จากสลิปไม่ตรงกับยอดที่ต้องชำระ — ตรวจสอบยอดในสลิปก่อนอนุมัติ (อ่านอัตโนมัติ อาจคลาดเคลื่อน)",
    en: "The amount read from this slip doesn't match the order total — check the slip yourself before approving (read automatically, may be wrong).",
    severity: "high",
  },
  amount_unreadable: {
    th: "ระบบอ่านจำนวนเงินจากสลิปนี้ไม่ได้ จึงเทียบกับยอดที่ต้องชำระไม่ได้ — กรุณาตรวจยอดในสลิปด้วยตนเอง",
    en: "The amount couldn't be read from this slip, so it wasn't checked against the order total — please check it yourself.",
    severity: "low",
  },
};

export const baht = (n: number) => `฿${n.toLocaleString()}`;

// One price, or a "฿min – ฿max" range when options cost different amounts.
export const adminPriceLabel = (p: { price: number; variants: { priceDelta?: number }[] }) => {
  const prices = p.variants.length ? p.variants.map((v) => p.price + (v.priceDelta ?? 0)) : [p.price];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? baht(min) : `${baht(min)} – ${baht(max)}`;
};

// "฿min – ฿max" of the welfare prices a product's options carry, or null when it
// has none. Mirrors welfareUnitPrice in shop-welfare.ts, so a product saved with
// only the older product-level welfare base still shows its per-option prices.
export const adminWelfareLabel = (p: { price: number; welfarePrice?: number | null; welfareRoles?: string[]; variants: AdminVariant[] }) => {
  if ((p.welfareRoles?.length ?? 0) === 0) return null;
  const prices = p.variants
    .map((v) => ({ normal: p.price + (v.priceDelta ?? 0), welfare: v.welfarePrice ?? (p.welfarePrice != null ? p.welfarePrice + (v.priceDelta ?? 0) : null) }))
    .filter((x) => x.welfare != null && x.welfare < x.normal)
    .map((x) => x.welfare as number);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? baht(min) : `${baht(min)} – ${baht(max)}`;
};

// Short owner tag for a product row: "Central (SMO)" when no owner, else the
// club name(s) / major code(s) that own it. Club names come from ownerOptions
// (falls back to the raw id if the club isn't in the caller's option list).
export function ownerLabel(
  p: { ownerClubIds?: string[]; ownerMajors?: string[] },
  ownerOptions: OwnerOptions | null,
  th: boolean,
): string {
  const clubIds = p.ownerClubIds ?? [];
  const majors = p.ownerMajors ?? [];
  if (clubIds.length === 0 && majors.length === 0) return th ? "ส่วนกลาง (SMO)" : "Central (SMO)";
  const clubNames = clubIds.map((id) => ownerOptions?.clubs.find((c) => c.id === id)?.name ?? (th ? "ชมรม" : "club"));
  return [...clubNames, ...majors].join(", ");
}

// Local-date "YYYY-MM-DD" for N days ago (for the date-range presets).
export function ymdDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Shared page size for the admin Products and Orders lists.
export const PAGE_SIZE = 10;

// True when a product is restricted to a subset of the audience (so the list can
// flag it). Empty role/major lists + both student types = visible to everyone.
export const isAudienceLimited = (p: AdminProduct) =>
  (p.allowedRoles?.length ?? 0) > 0 ||
  (p.allowedMajors?.length ?? 0) > 0 ||
  p.targetThai === false ||
  p.targetInternational === false;

export interface AdminVariant { id?: string; label: string; stock: number | null; allowCustom?: boolean; priceDelta?: number; welfarePrice?: number | null; sold?: number }

export interface AdminProduct {
  id: string; name: string; description: string; price: number; imageUrls: string[];
  maxPerOrder: number | null; opensAt: string | null; closesAt: string | null;
  isActive: boolean; sortOrder: number; variants: AdminVariant[];
  // Audience targeting (mirrors events). Empty arrays / both targets true = visible
  // to everyone. Admins always see every product.
  allowedRoles: string[]; allowedMajors: string[];
  targetThai: boolean; targetInternational: boolean;
  // Per-product personalization fields (e.g. jersey name/number).
  customFields: ShopCustomField[];
  // Per-product delivery pricing. deliveryFee = base ฿ (null = shop-wide fallback);
  // deliveryTiers = quantity thresholds (highest applicable minQty wins).
  deliveryFee: number | null; deliveryTiers: ShopDeliveryTier[];
  // Bundle promotions — "buy N for ฿X" (e.g. 3 for ฿100). Empty = none.
  bundleDeals: ShopBundleDeal[];
  // Welfare price (สวัสดิการ): at-cost ฿ charged to buyers holding any of
  // welfareRoles. null / empty roles = no welfare.
  welfarePrice: number | null; welfareRoles: string[];
  // President ownership scope (admin-side only). Empty both = "central" (SMO)
  // product. Drives which club_president/major_president may manage it + its orders.
  ownerClubIds: string[]; ownerMajors: string[];
  sellerId: string | null; sellerName: string | null;
  approvalStatus: "pending" | "approved" | "rejected";
  approvalReason: string | null;
}

// Which club(s)/major(s) the current shop-admin may assign as a product owner
// (all of them for a full admin; just their own for a president). From
// GET /api/admin/shop/context and the products list response.
export type OwnerOptions = { clubs: { id: string; name: string }[]; majors: string[] };

export interface ShopContext {
  scoped: boolean;
  ownerOptions: OwnerOptions;
  canEditSettings: boolean;
  canReviewMarketplace: boolean;
  // False for SMO Finance: sees every product but may not delete one, and may
  // not approve a central product (its own new products start pending).
  canDeleteProducts: boolean;
  canApproveCentral: boolean;
  requiresOwner: boolean;
  seller: { id: string; displayName: string; status: string } | null;
}

export interface SellerReviewRow {
  id: string; userId: string; displayName: string; status: string;
  reviewNote: string | null; appliedAt: string; reviewedAt: string | null;
  accountName: string; accountEmail: string;
}

// Editor row for one custom field (key is assigned at save time, by index).
export interface FieldDraft {
  label: string; type: ShopCustomFieldType; required: boolean;
  maxLength: number | null; min: number | null; max: number | null; options: string[];
}

// Editor row for one delivery tier (strings keep empty inputs forgiving).
export interface TierDraft { minQty: string; fee: string }

// keys = the option keys (VariantDraft.key) a promotion is limited to; null = all options.
export interface DealDraft { qty: string; price: string; keys: string[] | null }

// Form-only stable key per option row: the id for a saved option, a random key for
// a new one. Promotions reference options by it, so deleting a row can't shift them.
export type VariantDraft = AdminVariant & { key: string };

export const newVariantKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Math.random().toString(36).slice(2)}`);

// Roles a product's visibility can be restricted to (mirrors the events targeting
// list). Empty selection = all roles. Admins always see everything.
export const ALL_ROLES = ["student", "staff", "smo", "anusmo", "club_president", "major_president"] as const;

export const ROLE_LABELS: Record<string, string> = {
  student: "Student", staff: "Staff", smo: "SMO", anusmo: "ANUSMO",
  club_president: "Club President", major_president: "Major President",
};

// Student majors (the `major` text column on users). Empty selection = all majors.
export const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"] as const;

// ISO/Date -> value for <input type="datetime-local"> (local time, no seconds).
export function toLocalInput(d?: string | Date | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export interface AdminOrder {
  id: string; status: string; totalAmount: number; note: string | null; rejectionReason: string | null;
  hasSlip: boolean; slipFlag: string | null; slipQrPayload: string | null;
  createdAt: string; reviewedAt: string | null; reviewerName?: string | null;
  fulfillment: string; shippingFee: number; discountAmount: number;
  recipientName: string | null; recipientPhone: string | null; shippingAddress: string | null;
  sellerId?: string | null; sellerName?: string | null;
  // False (scoped president only) when the order also contains another team's
  // items — the president may see it but not approve/reject it.
  fullyInScope?: boolean;
  buyer: { name: string | null; studentId: string | null; nickname: string | null };
  items: AdminOrderItem[];
  // Handover tracking (src/lib/shop-fulfillment.ts) — layered on top of status.
  fulfillmentStatus: string; readyAt: string | null;
  carrier: string | null; carrierName: string | null; trackingNumber: string | null; trackingUrl: string | null;
  shippedAt: string | null; fulfilledAt: string | null; fulfilledVia: string | null; fulfilledByName: string | null;
  fulfillmentNote: string | null; issueNote: string | null; issueAt: string | null;
}

// Handover filters layered on the payment-status filter row. "to_fulfil" = paid
// and not yet in the buyer's hands (awaiting/ready/partial), i.e. who still
// hasn't collected (all of) their stuff or been sent it.
export type OrderFilter = "all" | "pending" | "approved" | "rejected" | "to_fulfil" | "shipped" | "issue";

export const matchesOrderFilter = (o: AdminOrder, f: OrderFilter) => {
  if (f === "all") return true;
  if (f === "to_fulfil") return o.status === "approved" && (o.fulfillmentStatus === "awaiting" || o.fulfillmentStatus === "ready" || o.fulfillmentStatus === "partial");
  if (f === "shipped" || f === "issue") return o.status === "approved" && o.fulfillmentStatus === f;
  return o.status === f;
};

export interface AdminOrderItem {
  id: string; productId: string | null; variantId: string | null;
  productName: string; variantLabel: string; customValues: ShopCustomValue[] | null;
  unitPrice: number; quantity: number;
  // Per-line handover stamp (see isItemHandedOver).
  handedOverAt?: string | null;
}

export async function uploadImage(file: File): Promise<string> {
  // Downscale in the browser first. Kept at 1600px so a payment-QR image stays
  // scannable; this also keeps the upload under the reverse proxy's body cap,
  // which would otherwise reject a raw multi-MB photo with a 413 before the app.
  const upload = await compressImageFile(file, { maxDim: 1600 });
  const fd = new FormData();
  fd.append("file", upload);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const d = await res.json().catch(() => null);
  if (res.status === 413) throw new Error("Image is too large. Please choose a smaller photo.");
  if (!res.ok || !d?.url) throw new Error(d?.error || "Upload failed");
  return d.url as string;
}

// Export every order for one product to .xlsx: "Summary" (quantity per option),
// "Orders" (one row per buyer line, autofiltered) and "Slips" (each order's
// payment slip embedded as a picture). Built server-side — the SheetJS build the
// other exports use can't embed images; see the route for why slips get their
// own sheet.
export async function exportProductXlsx(p: AdminProduct) {
  const res = await fetch(`/api/admin/shop/products/${p.id}/export`);
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.error || "Export failed");
  }
  const blob = await res.blob();
  // Filename comes from the server's Content-Disposition (Thai-safe, RFC 5987).
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const filename = m ? decodeURIComponent(m[1]) : "product.xlsx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
