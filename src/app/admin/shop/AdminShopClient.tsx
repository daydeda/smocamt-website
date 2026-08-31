"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { ShopCustomField, ShopCustomValue, ShopCustomFieldType } from "@/lib/shop-custom-fields";
import { normalizeTiers, type ShopDeliveryTier } from "@/lib/shop-delivery";
import {
  ShoppingBag, Package, ReceiptText, Settings as SettingsIcon, Plus, Trash2, Pencil,
  Upload, Loader2, X, CheckCircle2, XCircle, Clock, GripVertical, Save, RotateCcw, Download,
  Check, FileText, Truck, Store, Users, ChevronLeft, ChevronRight, ChevronDown,
  AlertTriangle, ExternalLink,
} from "lucide-react";

// True when a decoded slip QR payload is a link the admin can tap to open the
// issuing bank's own verify page. Deliberately NOT imported from
// shop-slip-verify.ts — that module pulls in Node's `crypto`, which has no
// business in a client bundle. Mirrors the check in isVerifyUrl() there.
const isHttpUrl = (s: string | null): s is string => {
  if (!s) return false;
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

// Copy for the three automated slip pre-filter flags (shop_orders.slip_flag —
// see shop-slip-verify.ts). Free/offline signals only, not bank confirmation:
// duplicate_* means this slip (or its QR) was already seen on another order;
// no_qr means the automated pass couldn't find a QR to cross-check at all.
const SLIP_FLAG_COPY: Record<string, { th: string; en: string; severity: "high" | "low" }> = {
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
};

const baht = (n: number) => `฿${n.toLocaleString()}`;

// Short owner tag for a product row: "Central (SMO)" when no owner, else the
// club name(s) / major code(s) that own it. Club names come from ownerOptions
// (falls back to the raw id if the club isn't in the caller's option list).
function ownerLabel(
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

// Shared page size for the admin Products and Orders lists.
const PAGE_SIZE = 10;

// True when a product is restricted to a subset of the audience (so the list can
// flag it). Empty role/major lists + both student types = visible to everyone.
const isAudienceLimited = (p: AdminProduct) =>
  (p.allowedRoles?.length ?? 0) > 0 ||
  (p.allowedMajors?.length ?? 0) > 0 ||
  p.targetThai === false ||
  p.targetInternational === false;

interface AdminVariant { id?: string; label: string; stock: number | null; allowCustom?: boolean; priceDelta?: number; sold?: number }
interface AdminProduct {
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
  // President ownership scope (admin-side only). Empty both = "central" (SMO)
  // product. Drives which club_president/major_president may manage it + its orders.
  ownerClubIds: string[]; ownerMajors: string[];
}

// Which club(s)/major(s) the current shop-admin may assign as a product owner
// (all of them for a full admin; just their own for a president). From
// GET /api/admin/shop/context and the products list response.
type OwnerOptions = { clubs: { id: string; name: string }[]; majors: string[] };
interface ShopContext { scoped: boolean; ownerOptions: OwnerOptions }

// Editor row for one custom field (key is assigned at save time, by index).
interface FieldDraft {
  label: string; type: ShopCustomFieldType; required: boolean;
  maxLength: number | null; min: number | null; max: number | null; options: string[];
}

// Editor row for one delivery tier (strings keep empty inputs forgiving).
interface TierDraft { minQty: string; fee: string }

// Roles a product's visibility can be restricted to (mirrors the events targeting
// list). Empty selection = all roles. Admins always see everything.
const ALL_ROLES = ["student", "staff", "smo", "anusmo", "club_president", "major_president"] as const;
const ROLE_LABELS: Record<string, string> = {
  student: "Student", staff: "Staff", smo: "SMO", anusmo: "ANUSMO",
  club_president: "Club President", major_president: "Major President",
};
// Student majors (the `major` text column on users). Empty selection = all majors.
const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"] as const;

// ISO/Date -> value for <input type="datetime-local"> (local time, no seconds).
function toLocalInput(d?: string | Date | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
interface AdminOrder {
  id: string; status: string; totalAmount: number; note: string | null; rejectionReason: string | null;
  hasSlip: boolean; slipFlag: string | null; slipQrPayload: string | null;
  createdAt: string; reviewedAt: string | null;
  fulfillment: string; shippingFee: number;
  recipientName: string | null; recipientPhone: string | null; shippingAddress: string | null;
  // False (scoped president only) when the order also contains another team's
  // items — the president may see it but not approve/reject it.
  fullyInScope?: boolean;
  buyer: { name: string | null; studentId: string | null; nickname: string | null };
  items: { productName: string; variantLabel: string; customValues: ShopCustomValue[] | null; unitPrice: number; quantity: number }[];
}

async function uploadImage(file: File): Promise<string> {
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

interface ProductOrderRow {
  orderId: string; status: string; createdAt: string; reviewedAt: string | null;
  rejectionReason: string | null; orderTotal: number; slipPath: string | null; note: string | null;
  fulfillment: string; shippingFee: number;
  recipientName: string | null; recipientPhone: string | null; shippingAddress: string | null;
  variantLabel: string; customValues: ShopCustomValue[] | null; quantity: number; unitPrice: number;
  buyerName: string | null; nickname: string | null; studentId: string | null;
  email: string | null; phone: string | null; major: string | null; houseId: string | null;
}

// Export every order for one product to a real .xlsx with two sheets: a "Summary"
// of quantities per option (so admins can see how many of each size to make) and
// an "Orders" sheet (one row per buyer line, with autofilter) so they can filter
// by status/option in Excel. Times are rendered in Bangkok regardless of device
// timezone. xlsx is imported lazily (same pattern as the events export).
async function exportProductXlsx(p: AdminProduct) {
  const XLSX = await import("xlsx");
  const data = await fetch(`/api/admin/shop/products/${p.id}/orders`).then((r) => r.json()).catch(() => null);
  const rows: ProductOrderRow[] = data?.rows ?? [];
  const dt = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) : "");

  // Summary sheet: quantity per option, split by status (rejected excluded from the active total).
  const byOption = new Map<string, { approved: number; pending: number; rejected: number }>();
  for (const r of rows) {
    const k = r.variantLabel || "—";
    const cur = byOption.get(k) ?? { approved: 0, pending: 0, rejected: 0 };
    if (r.status === "rejected") cur.rejected += r.quantity;
    else if (r.status === "approved") cur.approved += r.quantity;
    else cur.pending += r.quantity;
    byOption.set(k, cur);
  }
  const sumAoa: (string | number)[][] = [["Option", "Approved", "Pending", "Rejected", "Active total (Approved+Pending)"]];
  let tA = 0, tP = 0, tR = 0;
  for (const [k, v] of byOption) {
    sumAoa.push([k, v.approved, v.pending, v.rejected, v.approved + v.pending]);
    tA += v.approved; tP += v.pending; tR += v.rejected;
  }
  sumAoa.push(["TOTAL", tA, tP, tR, tA + tP]);
  const wsSum = XLSX.utils.aoa_to_sheet(sumAoa);
  wsSum["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];

  // Custom-field columns (e.g. jersey Name / Number) — the union of every label
  // seen across this product's lines, in first-seen order, inserted after "Option".
  const customLabels: string[] = [];
  for (const r of rows) for (const cv of r.customValues ?? []) if (!customLabels.includes(cv.label)) customLabels.push(cv.label);

  // Orders sheet: one row per order line with every detail, autofilter on for easy filtering.
  const header = [
    "Name", "Nickname", "Student ID", "Major", "House", "Email", "Phone",
    "Option", ...customLabels, "Qty", "Unit price (THB)", "Subtotal (THB)",
    "Status", "Ordered (Bangkok)", "Reviewed (Bangkok)", "Rejection reason",
    "Slip uploaded", "Order total (THB)", "Fulfillment", "Shipping (THB)",
    "Recipient", "Recipient phone", "Delivery address", "Note", "Order ID",
  ];
  const wsRows = rows.map((r) => {
    const customCols: Record<string, string> = {};
    for (const label of customLabels) {
      customCols[label] = (r.customValues ?? []).find((cv) => cv.label === label)?.value ?? "";
    }
    return {
    "Name": r.buyerName ?? "",
    "Nickname": r.nickname ?? "",
    "Student ID": r.studentId ?? "",
    "Major": r.major ?? "",
    "House": r.houseId ?? "",
    "Email": r.email ?? "",
    "Phone": r.phone ?? "",
    "Option": r.variantLabel,
    ...customCols,
    "Qty": r.quantity,
    "Unit price (THB)": r.unitPrice,
    "Subtotal (THB)": r.unitPrice * r.quantity,
    "Status": r.status,
    "Ordered (Bangkok)": dt(r.createdAt),
    "Reviewed (Bangkok)": dt(r.reviewedAt),
    "Rejection reason": r.rejectionReason ?? "",
    "Slip uploaded": r.slipPath ? "Yes" : "No",
    "Order total (THB)": r.orderTotal,
    "Fulfillment": r.fulfillment === "delivery" ? "Delivery" : "Self-pickup",
    "Shipping (THB)": r.shippingFee,
    "Recipient": r.recipientName ?? "",
    "Recipient phone": r.recipientPhone ?? "",
    "Delivery address": r.shippingAddress ?? "",
    "Note": r.note ?? "",
    "Order ID": r.orderId,
    };
  });
  const ws = XLSX.utils.json_to_sheet(wsRows, { header });
  ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
  ws["!cols"] = header.map((h) => ({ wch: Math.min(40, Math.max(10, h.length + 2)) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  // Keep Unicode (Thai) intact; strip only filename-illegal chars and collapse whitespace.
  const safe = (data?.productName || p.name)
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40)
    .replace(/^_+|_+$/g, "") || "product";
  XLSX.writeFile(wb, `product_${safe}.xlsx`);
}

export default function AdminShopClient() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [tab, setTab] = useState<"products" | "orders" | "settings">("products");
  // null until the context loads. A scoped president (club/major) never sees the
  // Settings tab — shop settings (QR, payment info, delivery) stay admin-only.
  const [ctx, setCtx] = useState<ShopContext | null>(null);

  useEffect(() => {
    fetch("/api/admin/shop/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCtx(d); })
      .catch(() => {});
  }, []);

  const scoped = ctx?.scoped ?? false;
  const tabs = ([
    ["products", Package, th ? "สินค้า" : "Products"],
    ["orders", ReceiptText, th ? "คำสั่งซื้อ" : "Orders"],
    ...(scoped ? [] : [["settings", SettingsIcon, th ? "ตั้งค่า" : "Settings"] as const]),
  ] as const);
  const activeTab = tab === "settings" && scoped ? "products" : tab;

  return (
    <div className="pb-20">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <ShoppingBag size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em" }}>{th ? "จัดการร้านค้า" : "Manage Shop"}</h1>
      </div>

      {scoped && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, fontWeight: 600 }}>
          {th
            ? "คุณเห็นเฉพาะสินค้าและคำสั่งซื้อของชมรม/สาขาที่คุณดูแล"
            : "You're seeing only the products and orders your club / major owns."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {tabs.map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k)} className={activeTab === k ? "btn btn-primary" : "btn btn-ghost"} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {activeTab === "products" && <ProductsTab th={th} ctx={ctx} />}
      {activeTab === "orders" && <OrdersTab th={th} ctx={ctx} />}
      {activeTab === "settings" && !scoped && <SettingsTab th={th} />}
    </div>
  );
}

/* ------------------------------- Products ------------------------------- */

function ProductsTab({ th, ctx }: { th: boolean; ctx: ShopContext | null }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  // Owner-picker options from the products response; falls back to the parent's
  // context fetch so the form still works before the first list load resolves.
  const [ownerOptionsFromList, setOwnerOptionsFromList] = useState<OwnerOptions | null>(null);
  const ownerOptions = ownerOptionsFromList ?? ctx?.ownerOptions ?? null;
  const [loading, setLoading] = useState(true);
  // Set when the product list fails to load — shown instead of swallowing the
  // failure as an empty "No products yet" list.
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const exportProduct = async (p: AdminProduct) => {
    setExportingId(p.id);
    try { await exportProductXlsx(p); } catch { /* surfaced via empty file is unlikely; ignore */ } finally { setExportingId(null); }
  };

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/shop/products");
      if (!res.ok) throw new Error("failed");
      const d = await res.json();
      // New shape: { products, scoped, ownerOptions }. Tolerate the old bare array.
      const list: AdminProduct[] = Array.isArray(d) ? d : (d.products ?? []);
      setProducts(list);
      if (!Array.isArray(d) && d.ownerOptions) setOwnerOptionsFromList(d.ownerOptions);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (p: AdminProduct) => {
    if (!confirm(th ? `ลบสินค้า "${p.name}"? คำสั่งซื้อเดิมจะยังเก็บไว้` : `Delete "${p.name}"? Existing orders are kept.`)) return;
    await fetch(`/api/admin/shop/products/${p.id}`, { method: "DELETE" });
    load();
  };

  // Page the list (10/page). Clamp to a derived page so deleting the last row on the
  // final page falls back to a valid page instead of showing an empty one.
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageProducts = products.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <Spinner />;
  if (loadError) return (
    <p style={{ color: "#ef4444", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {th ? "โหลดสินค้าไม่สำเร็จ" : "Couldn't load products."}
      <button onClick={() => { setLoading(true); load(); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "4px 10px" }}>{th ? "ลองอีกครั้ง" : "Retry"}</button>
    </p>
  );

  return (
    <div>
      <button onClick={() => setEditing("new")} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Plus size={18} />{th ? "เพิ่มสินค้า" : "New product"}
      </button>

      {products.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ยังไม่มีสินค้า" : "No products yet."}</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {pageProducts.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 14, alignItems: "center", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 14 }}>
              <div style={{ width: 60, height: 60, borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", overflow: "hidden", flexShrink: 0 }}>
                {p.imageUrls[0] ? <img src={p.imageUrls[0]} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}><Package size={20} /></div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 15, overflowWrap: "anywhere", wordBreak: "break-word" }}>{p.name} {!p.isActive && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>({th ? "ซ่อน" : "hidden"})</span>}{isAudienceLimited(p) && <span title={th ? "จำกัดผู้เห็น (บทบาท/สาขา/นักศึกษา)" : "Limited audience (roles/majors/students)"} style={{ fontSize: 11, color: "var(--accent-primary)", fontWeight: 700 }}> · {th ? "จำกัดผู้เห็น" : "limited"}</span>}<span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}> · {ownerLabel(p, ownerOptions, th)}</span></p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {baht(p.price)} · {p.variants.map((v) => `${v.label}${v.stock != null ? ` ${Math.max(0, v.stock - (v.sold ?? 0))}/${v.stock}` : ""}`).join(", ")}
                  {p.maxPerOrder != null ? ` · ${th ? "จำกัด" : "max"} ${p.maxPerOrder}/${th ? "คน" : "person"}` : ""}
                </p>
                {(p.opensAt || p.closesAt) && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} style={{ flexShrink: 0 }} /> {p.opensAt ? new Date(p.opensAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "เปิดอยู่" : "now")} → {p.closesAt ? new Date(p.closesAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "ไม่กำหนด" : "open-ended")}
                  </p>
                )}
              </div>
              <button onClick={() => exportProduct(p)} disabled={exportingId === p.id} className="btn btn-ghost" style={{ padding: 8 }} title={th ? "ส่งออกคำสั่งซื้อเป็น .xlsx" : "Export orders to .xlsx"}>
                {exportingId === p.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              </button>
              <button onClick={() => setEditing(p)} className="btn btn-ghost" style={{ padding: 8 }}><Pencil size={16} /></button>
              <button onClick={() => remove(p)} className="btn btn-ghost" style={{ padding: 8, color: "#ef4444" }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <Pagination th={th} page={safePage} total={products.length} onPage={setPage} />

      {editing && (
        <ProductForm
          th={th}
          product={editing === "new" ? null : editing}
          ownerOptions={ownerOptions}
          scoped={ctx?.scoped ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductForm({ th, product, ownerOptions, scoped, onClose, onSaved }: { th: boolean; product: AdminProduct | null; ownerOptions: OwnerOptions | null; scoped: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product?.price ?? 0);
  const [description, setDescription] = useState(product?.description ?? "");
  const [imageUrls, setImageUrls] = useState<string[]>(product?.imageUrls ?? []);
  const [maxPerOrder, setMaxPerOrder] = useState<string>(product?.maxPerOrder != null ? String(product.maxPerOrder) : "");
  const [opensAt, setOpensAt] = useState<string>(toLocalInput(product?.opensAt));
  const [closesAt, setClosesAt] = useState<string>(toLocalInput(product?.closesAt));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [allowedRoles, setAllowedRoles] = useState<string[]>(product?.allowedRoles ?? []);
  const [allowedMajors, setAllowedMajors] = useState<string[]>(product?.allowedMajors ?? []);
  const [targetThai, setTargetThai] = useState(product?.targetThai ?? true);
  const [targetInternational, setTargetInternational] = useState(product?.targetInternational ?? true);
  const [customFields, setCustomFields] = useState<FieldDraft[]>(
    (product?.customFields ?? []).map((f) => ({
      label: f.label, type: f.type, required: f.required,
      maxLength: f.maxLength ?? null, min: f.min ?? null, max: f.max ?? null, options: f.options ?? [],
    }))
  );
  const [deliveryFee, setDeliveryFee] = useState<string>(product?.deliveryFee != null ? String(product.deliveryFee) : "");
  const [deliveryTiers, setDeliveryTiers] = useState<TierDraft[]>(
    (product?.deliveryTiers ?? []).map((t) => ({ minQty: String(t.minQty), fee: String(t.fee) }))
  );
  const [variants, setVariants] = useState<AdminVariant[]>(product?.variants?.length ? product.variants : [{ label: "Standard", stock: null, allowCustom: false, priceDelta: 0 }]);
  // Product ownership (admin-side scoping). For a NEW product a scoped president
  // defaults to owning it with every club/major they lead; a full admin starts
  // blank (central).
  const [ownerClubIds, setOwnerClubIds] = useState<string[]>(
    product?.ownerClubIds ?? (scoped ? (ownerOptions?.clubs.map((c) => c.id) ?? []) : [])
  );
  const [ownerMajors, setOwnerMajors] = useState<string[]>(
    product?.ownerMajors ?? (scoped ? (ownerOptions?.majors ?? []) : [])
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = async (files: FileList) => {
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        const url = await uploadImage(f);
        setImageUrls((prev) => [...prev, url]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const setVariant = (i: number, patch: Partial<AdminVariant>) => setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError(th ? "กรุณากรอกชื่อสินค้า" : "Product name is required"); return; }
    if (variants.length === 0 || variants.some((v) => !v.label.trim())) { setError(th ? "ทุกตัวเลือกต้องมีชื่อ" : "Every option needs a label"); return; }
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) { setError(th ? "เวลาปิดต้องอยู่หลังเวลาเปิด" : "Close time must be after open time"); return; }
    if (customFields.some((f) => !f.label.trim())) { setError(th ? "ช่องกรอกเองทุกช่องต้องมีชื่อ" : "Every custom field needs a label"); return; }
    if (customFields.some((f) => f.type === "select" && f.options.filter((o) => o.trim()).length === 0)) { setError(th ? "ช่องแบบตัวเลือกต้องมีอย่างน้อย 1 ตัวเลือก" : "A select field needs at least one option"); return; }
    if (customFields.some((f) => f.type === "select" && f.options.some((o) => o.trim().length > 1000))) { setError(th ? "แต่ละตัวเลือกต้องไม่เกิน 1000 ตัวอักษร" : "Each option must be 1000 characters or fewer"); return; }
    if (scoped && ownerClubIds.length === 0 && ownerMajors.length === 0) { setError(th ? "เลือกชมรมหรือสาขาที่เป็นเจ้าของสินค้านี้" : "Pick the club or major that owns this product"); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description,
        price: Math.round(price) || 0,
        imageUrls,
        maxPerOrder: maxPerOrder.trim() === "" ? null : Math.max(1, Math.round(Number(maxPerOrder))),
        opensAt: opensAt ? new Date(opensAt).toISOString() : null,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
        isActive,
        allowedRoles,
        allowedMajors,
        targetThai,
        targetInternational,
        // Assign stable keys by index; snapshots store labels, so renumbering is safe.
        customFields: customFields.map((f, i) => ({
          key: `cf${i + 1}`,
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          maxLength: f.type === "text" ? f.maxLength : null,
          min: f.type === "number" ? f.min : null,
          max: f.type === "number" ? f.max : null,
          options: f.type === "select" ? f.options.map((o) => o.trim()).filter(Boolean) : [],
        })),
        // Per-product delivery. Blank base fee = null (use shop-wide fallback).
        // Tiers: drop incomplete rows, then dedupe + sort ascending by minQty.
        deliveryFee: deliveryFee.trim() === "" ? null : Math.max(0, Math.round(Number(deliveryFee) || 0)),
        deliveryTiers: normalizeTiers(
          deliveryTiers
            .filter((t) => t.minQty.trim() !== "" && t.fee.trim() !== "")
            .map((t) => ({ minQty: Math.round(Number(t.minQty) || 0), fee: Math.round(Number(t.fee) || 0) }))
        ),
        sortOrder: product?.sortOrder ?? 0,
        ownerClubIds,
        ownerMajors,
        variants: variants.map((v) => ({ id: v.id, label: v.label.trim(), stock: v.stock, allowCustom: !!v.allowCustom, priceDelta: Math.max(0, Math.round(Number(v.priceDelta) || 0)) })),
      };
      const res = await fetch(product ? `/api/admin/shop/products/${product.id}` : "/api/admin/shop/products", {
        method: product ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // One-line summaries shown on each collapsed section so an admin can see what's
  // set (and which sections need attention) without expanding everything.
  const scheduleSet = !!(opensAt || closesAt);
  const scheduleSummary = scheduleSet ? (th ? "มีกำหนดเวลา" : "Time-limited") : (th ? "ขายได้ตลอด" : "Always available");
  const deliveryBase = deliveryFee.trim() === "" ? (th ? "ค่าเริ่มต้นร้าน" : "Shop default") : baht(Math.max(0, Math.round(Number(deliveryFee) || 0)));
  const deliverySummary = deliveryTiers.length > 0 ? `${deliveryBase} · ${th ? "ตามจำนวน" : "tiered"}` : deliveryBase;
  const filledFields = customFields.filter((f) => f.label.trim()).length;
  const fieldsSummary = filledFields === 0 ? (th ? "ไม่มี" : "None") : `${filledFields} ${th ? "ช่อง" : filledFields === 1 ? "field" : "fields"}`;
  const audienceLimited = allowedRoles.length > 0 || allowedMajors.length > 0 || !targetThai || !targetInternational;
  const audienceSummary = audienceLimited ? (th ? "จำกัดผู้เห็น" : "Limited") : (th ? "ทุกคน" : "Everyone");

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 640, maxHeight: "94vh", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16 }}>{product ? (th ? "แก้ไขสินค้า" : "Edit product") : (th ? "เพิ่มสินค้า" : "New product")}</p>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 6 }}><X size={20} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            {th
              ? "ช่องที่มี * จำเป็นต้องกรอก · ส่วนที่เหลือกดเปิดเพื่อตั้งค่าเพิ่มได้"
              : "Fields marked * are required. Open the sections below to configure the optional extras."}
          </p>

          {/* ---- Essentials (always visible) ---- */}
          <Field label={th ? "ชื่อสินค้า" : "Name"} required>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder={th ? "เช่น เสื้อค่าย SMO" : "e.g. SMO Camp Shirt"} />
          </Field>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Field label={th ? "ราคา (บาท)" : "Price (฿)"} required style={{ flex: 1, minWidth: 140 }}>
              <input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label={th ? "จำกัดต่อคน" : "Max per buyer"} hint={th ? "เว้นว่าง = ไม่จำกัด" : "Blank = unlimited"} style={{ flex: 1, minWidth: 160 }}>
              <input type="number" min={1} value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value)} style={inputStyle} placeholder={th ? "ไม่จำกัด" : "Unlimited"} />
            </Field>
          </div>

          {/* Owner — which club/major manages this product + its orders. Does NOT
              affect who can buy it (that's the Audience section). Blank = central
              (SMO), which only super_admin/admin can manage. */}
          {ownerOptions && (
            <Field
              label={th ? "ผู้ดูแลสินค้า (ชมรม/สาขา)" : "Managed by (club / major)"}
              required={scoped}
              hint={scoped
                ? (th ? "เลือกได้เฉพาะที่คุณดูแล" : "Only the club/major you preside over")
                : (th ? "เว้นว่าง = ส่วนกลาง (SMO)" : "Blank = central (SMO)")}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ownerOptions.clubs.length === 0 && ownerOptions.majors.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                    {th ? "ยังไม่มีชมรม/สาขาให้เลือก" : "No clubs / majors available."}
                  </span>
                )}
                {ownerOptions.clubs.map((c) => {
                  const on = ownerClubIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setOwnerClubIds((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                      style={ownerChip(on, "#f59e0b")}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {ownerOptions.majors.map((m) => {
                  const on = ownerMajors.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOwnerMajors((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                      style={ownerChip(on, "#06b6d4")}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              {!scoped && ownerClubIds.length === 0 && ownerMajors.length === 0 && (
                <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, marginTop: 6 }}>
                  {th ? "ส่วนกลาง (SMO) — ประธานชมรม/สาขาจะไม่เห็นสินค้านี้" : "Central (SMO) — hidden from every club/major president."}
                </p>
              )}
            </Field>
          )}

          {/* Images */}
          <Field label={th ? "รูปสินค้า" : "Posters"} hint={th ? "รูปแรกใช้เป็นหน้าปก" : "The first image is used as the cover"}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {imageUrls.map((url, i) => (
                <div key={url} style={{ position: "relative", width: 80, height: 80, borderRadius: "var(--radius-md)", overflow: "hidden", border: i === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setImageUrls((prev) => prev.filter((u) => u !== url))} style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>
                  {i !== 0 && <button onClick={() => setImageUrls((prev) => { const a = [...prev]; const [m] = a.splice(i, 1); a.unshift(m); return a; })} title={th ? "ตั้งเป็นหน้าปก" : "Make cover"} style={{ position: "absolute", bottom: 2, left: 2, fontSize: 9, padding: "1px 4px", border: "none", borderRadius: 4, background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer" }}>★</button>}
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ width: 80, height: 80, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addImages(e.target.files); e.target.value = ""; }} />
            </div>
          </Field>

          {/* Description */}
          <Field label={th ? "รายละเอียด" : "Description"}>
            <RichTextEditor value={description} onChange={setDescription} rows={4} placeholder={th ? "รายละเอียดสินค้า…" : "Product details…"} />
          </Field>

          {/* Variants */}
          <Field label={th ? "ตัวเลือก / ไซส์" : "Options / sizes"} required hint={th ? "สต็อกเว้นว่าง = ไม่จำกัด · +฿ = บวกเพิ่มจากราคา (เช่น ไซส์พิเศษ)" : "Blank stock = unlimited · +฿ = surcharge on top of price (e.g. special size)"}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {variants.map((v, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <GripVertical size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <input value={v.label} onChange={(e) => setVariant(i, { label: e.target.value })} placeholder={v.allowCustom ? (th ? "ชื่อ เช่น อื่นๆ" : "Label e.g. Other") : (th ? "ชื่อ เช่น S, M, L" : "Label e.g. S, M, L")} style={{ ...inputStyle, flex: 2, minWidth: 120 }} />
                  <input type="number" min={0} value={v.stock ?? ""} onChange={(e) => setVariant(i, { stock: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} placeholder={th ? "สต็อก" : "Stock"} style={{ ...inputStyle, flex: 1, minWidth: 80 }} />
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 110 }} title={th ? "บวกเพิ่มจากราคาสินค้า เช่น ไซส์พิเศษ (0 = ไม่บวกเพิ่ม)" : "Added on top of the base price, e.g. a special size (0 = no surcharge)"}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>+฿</span>
                    <input type="number" min={0} value={v.priceDelta ?? ""} onChange={(e) => setVariant(i, { priceDelta: e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))) })} placeholder={th ? "เพิ่มราคา" : "Surcharge"} style={{ ...inputStyle, width: "100%" }} />
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }} title={th ? "ให้ผู้ซื้อพิมพ์รายละเอียดเอง" : "Buyer types their own value"}>
                    <input type="checkbox" checked={!!v.allowCustom} onChange={(e) => setVariant(i, { allowCustom: e.target.checked })} />
                    {th ? "ระบุเอง" : "Other"}
                  </label>
                  {variants.length > 1 && <button onClick={() => setVariants((vs) => vs.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "#ef4444" }}><Trash2 size={15} /></button>}
                </div>
              ))}
              <button onClick={() => setVariants((vs) => [...vs, { label: "", stock: null, allowCustom: false, priceDelta: 0 }])} className="btn btn-ghost" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <Plus size={15} />{th ? "เพิ่มตัวเลือก" : "Add option"}
              </button>
            </div>
          </Field>

          {/* ---- Optional extras (each under a labeled divider; all stay visible) ---- */}

          {/* Sale schedule */}
          <SectionDivider icon={<Clock size={15} />} title={th ? "ช่วงเวลาขาย" : "Sale schedule"} summary={scheduleSummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Field label={th ? "เปิดขาย" : "Opens at"} style={{ flex: 1, minWidth: 150 }}>
                <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} style={inputStyle} />
              </Field>
              <Field label={th ? "ปิดขาย" : "Closes at"} style={{ flex: 1, minWidth: 150 }}>
                <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th ? "เว้นว่างทั้งคู่ = ขายได้ตลอดเวลา" : "Leave both blank to keep it on sale indefinitely."}
            </p>
          </div>

          {/* Per-product delivery pricing. Base fee blank = use the shop-wide
              fallback (Settings tab). Tiers raise the fee once the ordered quantity
              of THIS product reaches minQty ("order more than N → fee goes up").
              An order's total shipping is the sum of each product's computed fee. */}
          <SectionDivider icon={<Truck size={15} />} title={th ? "ค่าจัดส่ง (เฉพาะสินค้านี้)" : "Delivery fee (this product)"} summary={deliverySummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ค่าส่งพื้นฐาน (฿)" : "Base fee (฿)"}</span>
              <input type="number" min={0} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder={th ? "เว้นว่าง = ใช้ค่าเริ่มต้นของร้าน" : "blank = use shop default"} style={{ ...inputStyle, width: 220 }} />
            </div>
            {deliveryTiers.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {deliveryTiers.map((t, i) => {
                  const setTier = (patch: Partial<TierDraft>) => setDeliveryTiers((ts) => ts.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ตั้งแต่" : "From"}</span>
                      <input type="number" min={1} value={t.minQty} onChange={(e) => setTier({ minQty: e.target.value })} placeholder={th ? "จำนวน" : "qty"} style={{ ...inputStyle, width: 90 }} />
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ชิ้นขึ้นไป → ฿" : "+ pcs → ฿"}</span>
                      <input type="number" min={0} value={t.fee} onChange={(e) => setTier({ fee: e.target.value })} placeholder={th ? "ค่าส่ง" : "fee"} style={{ ...inputStyle, width: 110 }} />
                      <button onClick={() => setDeliveryTiers((ts) => ts.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "#ef4444" }}><Trash2 size={15} /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => setDeliveryTiers((ts) => [...ts, { minQty: "", fee: "" }])} className="btn btn-ghost" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <Plus size={15} />{th ? "เพิ่มขั้นตามจำนวน" : "Add quantity tier"}
            </button>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th
                ? "ค่าส่งคิดต่อสินค้าตามจำนวนที่สั่ง โดยใช้ขั้นที่จำนวนถึงสูงสุด (เช่น 1–2 ชิ้น ฿30, ตั้งแต่ 3 ชิ้น ฿50) แล้วรวมค่าส่งของทุกสินค้าในออร์เดอร์"
                : "Charged per product by ordered quantity, using the highest tier reached (e.g. 1–2 pcs ฿30, from 3 pcs ฿50). The order's shipping is the sum across products."}
            </p>
          </div>

          {/* Custom fields — buyer-filled personalization (e.g. jersey name/number).
              Empty = none. Each becomes an input on the storefront + a column in export. */}
          <SectionDivider icon={<Pencil size={15} />} title={th ? "ช่องให้ผู้ซื้อกรอก" : "Personalization fields"} summary={fieldsSummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th ? "เช่น ชื่อ/เบอร์บนเสื้อ — ผู้ซื้อกรอกตอนสั่ง และจะอยู่ในไฟล์ส่งออก" : "e.g. name / number on a jersey — buyers fill these at checkout and they appear in the export."}
            </p>
            {customFields.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                {th ? "ยังไม่มี — ผู้ซื้อไม่ต้องกรอกอะไรเพิ่ม" : "None yet — buyers fill nothing extra."}
              </p>
            )}
            {customFields.map((f, i) => {
              const setField = (patch: Partial<FieldDraft>) => setCustomFields((fs) => fs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-base)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input value={f.label} maxLength={1000} onChange={(e) => setField({ label: e.target.value })} placeholder={th ? "ชื่อช่อง เช่น ชื่อบนเสื้อ" : "Label e.g. Name on back"} style={{ ...inputStyle, flex: 2, minWidth: 140 }} />
                    <select value={f.type} onChange={(e) => setField({ type: e.target.value as ShopCustomFieldType })} style={{ ...inputStyle, flex: 1, minWidth: 110 }}>
                      <option value="text">{th ? "ข้อความ" : "Text"}</option>
                      <option value="number">{th ? "ตัวเลข" : "Number"}</option>
                      <option value="select">{th ? "ตัวเลือก" : "Select"}</option>
                    </select>
                    <button onClick={() => setCustomFields((fs) => fs.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "#ef4444" }}><Trash2 size={15} /></button>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={f.required} onChange={(e) => setField({ required: e.target.checked })} />
                      {th ? "จำเป็น" : "Required"}
                    </label>
                    {f.type === "text" && (
                      <input type="number" min={1} max={1000} value={f.maxLength ?? ""} onChange={(e) => setField({ maxLength: e.target.value === "" ? null : Math.min(1000, Math.max(1, Number(e.target.value))) })} placeholder={th ? "ความยาวสูงสุด" : "Max length"} style={{ ...inputStyle, width: 140 }} />
                    )}
                    {f.type === "number" && (
                      <>
                        <input type="number" value={f.min ?? ""} onChange={(e) => setField({ min: e.target.value === "" ? null : Number(e.target.value) })} placeholder={th ? "ต่ำสุด" : "Min"} style={{ ...inputStyle, width: 100 }} />
                        <input type="number" value={f.max ?? ""} onChange={(e) => setField({ max: e.target.value === "" ? null : Number(e.target.value) })} placeholder={th ? "สูงสุด" : "Max"} style={{ ...inputStyle, width: 100 }} />
                      </>
                    )}
                    {f.type === "select" && (
                      <input value={f.options.join(", ")} onChange={(e) => setField({ options: e.target.value.split(",").map((o) => o.replace(/^\s+|\s+$/g, "")) })} placeholder={th ? "ตัวเลือก คั่นด้วย , เช่น แดง, น้ำเงิน" : "Options, comma-separated e.g. Red, Blue"} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
                    )}
                  </div>
                </div>
              );
            })}
            <button onClick={() => setCustomFields((fs) => [...fs, { label: "", type: "text", required: false, maxLength: null, min: null, max: null, options: [] }])} className="btn btn-ghost" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <Plus size={15} />{th ? "เพิ่มช่องกรอกเอง" : "Add custom field"}
            </button>
          </div>

          {/* Audience targeting — who may see (and order) this product. Empty role
              and major selections + both student types = visible to everyone. */}
          <SectionDivider icon={<Users size={15} />} title={th ? "ใครเห็นสินค้านี้ได้" : "Who can see this"} summary={audienceSummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{th ? "บทบาท" : "Roles"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ALL_ROLES.map((r) => (
                  <Chip key={r} selected={allowedRoles.includes(r)} onClick={() => setAllowedRoles((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r])}>
                    {ROLE_LABELS[r] ?? r}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{th ? "สาขา" : "Majors"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ALL_MAJORS.map((m) => (
                  <Chip key={m} selected={allowedMajors.includes(m)} onClick={() => setAllowedMajors((cur) => cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m])}>
                    {m}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{th ? "นักศึกษา" : "Students"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={targetThai} onChange={(e) => setTargetThai(e.target.checked)} />
                  {th ? "ไทย" : "Thai"}
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={targetInternational} onChange={(e) => setTargetInternational(e.target.checked)} />
                  {th ? "นานาชาติ" : "International"}
                </label>
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th
                ? "เว้นว่างทั้งหมด = ทุกคนเห็นได้ · ผู้ดูแลเห็นสินค้าทั้งหมดเสมอ"
                : "All empty = everyone can see it · admins always see every product."}
            </p>
          </div>

          {/* Visibility — prominent toggle so the live/hidden state is obvious. */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "12px 14px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--bg-base)" }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>{th ? "แสดงในร้านค้า" : "Visible in shop"}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: isActive ? "#15803d" : "var(--text-muted)" }}>{isActive ? (th ? "กำลังแสดง" : "Live") : (th ? "ซ่อนอยู่" : "Hidden")}</span>
          </label>
        </div>

        {/* Sticky footer actions */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button onClick={save} disabled={saving || uploading} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {saving && <Loader2 size={16} className="animate-spin" />}<Save size={16} />{th ? "บันทึก" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Orders -------------------------------- */

function OrdersTab({ th, ctx }: { th: boolean; ctx: ShopContext | null }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  // Extra filters layered on top of status: by product (an order matches if any of
  // its lines is that product) and by an inclusive created-at date/time range.
  const [productFilter, setProductFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Free automated pre-filter (see shop-slip-verify.ts) — narrows to orders whose
  // slip is a duplicate or has no readable QR, so the review queue doesn't require
  // opening every slip one by one to find the ones that actually need a look.
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [page, setPage] = useState(1);
  // Tracks the active filter combination so we can reset to page 1 during render
  // when it changes (the effect-free pattern — avoids set-state-in-effect).
  const [filterKey, setFilterKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Set when the order list fails to load (instead of swallowing it as an empty
  // "No orders" list); actionError holds a failed approve/reject/revert message.
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Reject/revert open a custom modal instead of the browser prompt/confirm.
  const [pending, setPending] = useState<{ order: AdminOrder; action: "reject" | "revert" } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/shop/orders");
      if (!res.ok) throw new Error("failed");
      const d = await res.json();
      if (Array.isArray(d)) setOrders(d);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Approve runs immediately; reject/revert defer to the modal which calls submit().
  const review = (o: AdminOrder, action: "approve" | "reject" | "revert") => {
    if (action === "approve") { submit(o, "approve"); return; }
    setPending({ order: o, action });
  };

  const submit = async (o: AdminOrder, action: "approve" | "reject" | "revert", rejectionReason?: string) => {
    setBusy(o.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shop/orders/${o.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectionReason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || (th ? "ดำเนินการไม่สำเร็จ" : "Action failed"));
      }
      load();
    } catch (e) {
      // A 4xx/5xx or network error must not read as success — surface it.
      setActionError(e instanceof Error ? e.message : (th ? "ดำเนินการไม่สำเร็จ" : "Action failed"));
    } finally {
      // ALWAYS clear busy + close the modal so the button can't stick spinning.
      setBusy(null);
      setPending(null);
    }
  };

  // Product dropdown options: every distinct product name across all orders.
  const productNames = Array.from(new Set(orders.flatMap((o) => o.items.map((i) => i.productName)))).sort((a, b) => a.localeCompare(b));

  // Product + date filters apply before status, so the status tab counts reflect
  // the active product/date filter. Date bounds are inclusive (datetime-local).
  const fromMs = fromDate ? new Date(fromDate).getTime() : null;
  const toMs = toDate ? new Date(toDate).getTime() : null;
  const preFlag = orders.filter((o) => {
    if (productFilter !== "all" && !o.items.some((i) => i.productName === productFilter)) return false;
    const created = new Date(o.createdAt).getTime();
    if (fromMs != null && created < fromMs) return false;
    if (toMs != null && created > toMs) return false;
    return true;
  });
  const flaggedCount = preFlag.filter((o) => o.slipFlag).length;
  const base = flaggedOnly ? preFlag.filter((o) => o.slipFlag) : preFlag;
  const shown = base.filter((o) => filter === "all" || o.status === filter);
  const hasExtraFilter = productFilter !== "all" || !!fromDate || !!toDate || flaggedOnly;

  // Reset to page 1 whenever the filter combination changes (adjust-state-during-render
  // pattern), then clamp to a derived page so an emptied last page falls back.
  const curKey = `${filter}|${productFilter}|${fromDate}|${toDate}|${flaggedOnly}`;
  let effectivePage = page;
  if (curKey !== filterKey) {
    setFilterKey(curKey);
    setPage(1);
    effectivePage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(effectivePage, totalPages);
  const pageOrders = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <Spinner />;
  if (loadError) return (
    <p style={{ color: "#ef4444", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {th ? "โหลดคำสั่งซื้อไม่สำเร็จ" : "Couldn't load orders."}
      <button onClick={() => { setLoading(true); load(); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "4px 10px" }}>{th ? "ลองอีกครั้ง" : "Retry"}</button>
    </p>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 14px" }}>
            {f === "all" ? (th ? "ทั้งหมด" : "All") : f === "pending" ? (th ? "รอตรวจสอบ" : "Pending") : f === "approved" ? (th ? "อนุมัติ" : "Approved") : (th ? "ปฏิเสธ" : "Rejected")}
            {" "}({base.filter((o) => f === "all" || o.status === f).length})
          </button>
        ))}
        <button
          onClick={() => setFlaggedOnly((v) => !v)}
          className={flaggedOnly ? "btn btn-primary" : "btn btn-ghost"}
          style={{
            fontSize: 13, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6,
            ...(flaggedOnly ? {} : { color: "#b45309" }),
          }}
          title={th ? "คำสั่งซื้อที่สลิปซ้ำหรือไม่พบ QR (ตรวจอัตโนมัติ ฟรี)" : "Orders whose slip is a duplicate or has no readable QR (free automated check)"}
        >
          <AlertTriangle size={14} />
          {th ? "ต้องตรวจสอบ" : "Needs review"} ({flaggedCount})
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "สินค้า" : "Product"}</label>
          <FilterDropdown
            value={productFilter}
            onChange={setProductFilter}
            options={[{ value: "all", label: th ? "ทุกสินค้า" : "All products" }, ...productNames.map((n) => ({ value: n, label: n }))]}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ตั้งแต่" : "From"}</label>
          <input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ถึง" : "To"}</label>
          <input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </div>
        {hasExtraFilter && (
          <button onClick={() => { setProductFilter("all"); setFromDate(""); setToDate(""); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "9px 12px", display: "inline-flex", alignItems: "center", gap: 4 }}><X size={14} />{th ? "ล้างตัวกรอง" : "Clear"}</button>
        )}
      </div>

      {actionError && <p style={{ color: "#ef4444", fontSize: 13, margin: "0 0 12px" }}>{actionError}</p>}

      {shown.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ไม่มีคำสั่งซื้อ" : "No orders."}</p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 14 }}>
            {pageOrders.map((o) => <AdminOrderRow key={o.id} order={o} th={th} busy={busy === o.id} scoped={ctx?.scoped ?? false} onReview={review} />)}
          </div>
          <Pagination th={th} page={safePage} total={shown.length} onPage={setPage} />
        </>
      )}

      {pending && (
        <ReviewModal
          th={th}
          order={pending.order}
          action={pending.action}
          busy={busy === pending.order.id}
          onCancel={() => setPending(null)}
          onConfirm={(reason) => submit(pending.order, pending.action, reason)}
        />
      )}
    </div>
  );
}

// Custom confirmation modal for the two non-trivial order actions: rejecting
// (needs a buyer-visible reason) and reverting an approved/rejected order back
// to pending. Mirrors ProductForm's overlay styling.
function ReviewModal({ th, order, action, busy, onCancel, onConfirm }: {
  th: boolean; order: AdminOrder; action: "reject" | "revert"; busy: boolean;
  onCancel: () => void; onConfirm: (rejectionReason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isReject = action === "reject";
  const buyerName = order.buyer.name ?? order.buyer.nickname ?? (th ? "ผู้ซื้อรายนี้" : "this buyer");

  const confirm = () => onConfirm(isReject ? reason.trim() : undefined);

  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 460, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {isReject ? <XCircle size={18} style={{ color: "#ef4444" }} /> : <RotateCcw size={18} style={{ color: "#b45309" }} />}
            {isReject ? (th ? "ปฏิเสธคำสั่งซื้อ" : "Reject order") : (th ? "ย้อนกลับเป็นรอตรวจสอบ" : "Revert to pending")}
          </p>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost" style={{ padding: 6 }}><X size={20} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
            {isReject
              ? (th ? `ปฏิเสธคำสั่งซื้อของ ${buyerName}? ผู้ซื้อจะเห็นเหตุผลด้านล่าง` : `Reject ${buyerName}'s order? The buyer will see the reason below.`)
              : (th ? `ย้อนคำสั่งซื้อของ ${buyerName} กลับเป็น "รอตรวจสอบ" เพื่อตรวจใหม่?` : `Send ${buyerName}'s order back to "pending" to re-check it?`)}
          </p>

          {isReject && (
            <Field label={th ? "เหตุผลที่ปฏิเสธ (ผู้ซื้อจะเห็น)" : "Rejection reason (buyer will see)"}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder={th ? "เช่น สลิปไม่ชัด / ยอดเงินไม่ตรง" : "e.g. Slip unclear / amount doesn't match"}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "ยกเลิก" : "Cancel"}</button>
          <button
            onClick={confirm}
            disabled={busy}
            className={isReject ? "btn btn-ghost" : "btn btn-primary"}
            style={{
              flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              ...(isReject ? { color: "#fff", background: "#ef4444" } : {}),
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : (isReject ? <XCircle size={16} /> : <RotateCcw size={16} />)}
            {isReject ? (th ? "ปฏิเสธ" : "Reject") : (th ? "ย้อนกลับ" : "Revert")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminOrderRow({ order, th, busy, scoped, onReview }: { order: AdminOrder; th: boolean; busy: boolean; scoped: boolean; onReview: (o: AdminOrder, a: "approve" | "reject" | "revert") => void }) {
  const [showSlip, setShowSlip] = useState(order.status === "pending");
  const badge = ORDER_BADGE[order.status] ?? ORDER_BADGE.pending;
  // A scoped president may only review an order that is entirely theirs — a mixed
  // order (also has another team's items) is shown read-only, reviewed by an admin.
  const reviewLocked = scoped && order.fullyInScope === false;
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 15 }}>{order.buyer.name ?? "—"} {order.buyer.nickname ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({order.buyer.nickname})</span> : null}</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{order.buyer.studentId ?? ""} · {new Date(order.createdAt).toLocaleString(th ? "th-TH" : "en-GB")}</p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: badge.bg, color: badge.color, height: "fit-content", whiteSpace: "nowrap" }}>{badge.icon}{th ? badge.th : badge.en}</span>
      </div>

      <div style={{ fontSize: 14, marginBottom: 8 }}>
        {order.items.map((i, idx) => (
          <div key={idx}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}</span>
              <span style={{ color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{baht(i.unitPrice * i.quantity)}</span>
            </div>
            {i.customValues && i.customValues.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--accent-primary)", paddingLeft: 2, marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                {i.customValues.map((cv, k) => (
                  <span key={k} style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}><span style={{ color: "var(--text-muted)" }}>{cv.label}:</span> <strong>{cv.value}</strong></span>
                ))}
              </div>
            )}
          </div>
        ))}
        {order.shippingFee > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
            <span>{th ? "ค่าจัดส่ง" : "Shipping"}</span><span>{baht(order.shippingFee)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-subtle)" }}>
          <span>{th ? "รวม" : "Total"}</span><span>{baht(order.totalAmount)}</span>
        </div>
      </div>

      {/* Fulfillment: pickup chip, or the delivery recipient + address block. */}
      {order.fulfillment === "delivery" ? (
        <div style={{ fontSize: 13, background: "var(--bg-base)", padding: "8px 12px", borderRadius: 8, marginBottom: 8, border: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 700, marginBottom: 3, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-primary)" }}><Truck size={14} /> {th ? "จัดส่ง" : "Delivery"}</p>
          <p style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{order.recipientName ?? "—"}{order.recipientPhone ? ` · ${order.recipientPhone}` : ""}</p>
          {order.shippingAddress && <p style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", marginTop: 2 }}>{order.shippingAddress}</p>}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}><Store size={14} /> {th ? "รับสินค้าเอง" : "Self-pickup"}</p>
      )}

      {order.note && <p style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "8px 12px", borderRadius: 8, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><FileText size={13} style={{ flexShrink: 0 }} /> {order.note}</p>}
      {order.status === "rejected" && order.rejectionReason && <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 8 }}>{th ? "เหตุผล: " : "Reason: "}{order.rejectionReason}</p>}

      {order.slipFlag && SLIP_FLAG_COPY[order.slipFlag] && (() => {
        const flag = SLIP_FLAG_COPY[order.slipFlag];
        const high = flag.severity === "high";
        return (
          <p
            style={{
              fontSize: 13, marginBottom: 8, padding: "8px 12px", borderRadius: 8,
              display: "flex", alignItems: "flex-start", gap: 6,
              background: high ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.12)",
              color: high ? "#dc2626" : "#b45309",
              border: `1px solid ${high ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{th ? flag.th : flag.en}</span>
          </p>
        );
      })()}

      {reviewLocked ? null : order.hasSlip ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: showSlip ? 10 : 0 }}>
            <button onClick={() => setShowSlip((s) => !s)} className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }}>{showSlip ? (th ? "ซ่อนสลิป" : "Hide slip") : (th ? "ดูสลิป" : "View slip")}</button>
            {isHttpUrl(order.slipQrPayload) && (
              <a
                href={order.slipQrPayload}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                style={{ fontSize: 13, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-primary)" }}
                title={th ? "เปิดหน้าตรวจสอบสลิปของธนาคาร (จาก QR บนสลิป)" : "Open the bank's own slip-verify page (from the slip's QR)"}
              >
                <ExternalLink size={13} />{th ? "ยืนยันกับธนาคาร" : "Verify with bank"}
              </a>
            )}
          </div>
          {showSlip && <img src={`/api/shop/orders/${order.id}/slip`} alt="slip" style={{ width: "100%", maxHeight: 400, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-base)", marginBottom: 10 }} />}
        </>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>{th ? "ไม่มีสลิป" : "No slip uploaded"}</p>
      )}

      {reviewLocked ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {th
            ? "คำสั่งซื้อนี้มีสินค้าของทีมอื่นด้วย — ผู้ดูแลร้าน (SMO) เป็นผู้ตรวจสอบ"
            : "This order also has another team's items — a shop admin (SMO) reviews it."}
        </p>
      ) : order.status === "pending" ? (
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={() => onReview(order, "reject")} disabled={busy} className="btn btn-ghost" style={{ flex: 1, color: "#ef4444", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}><XCircle size={16} />{th ? "ปฏิเสธ" : "Reject"}</button>
          <button onClick={() => onReview(order, "approve")} disabled={busy} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{th ? "อนุมัติ" : "Approve"}</button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => onReview(order, "revert")}
            disabled={busy}
            className="btn btn-ghost"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13,
              padding: "6px 12px",
              background: "rgba(245,158,11,0.12)", color: "#b45309",
              border: "1px solid rgba(245,158,11,0.25)",
            }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}{th ? "ย้อนกลับเป็นรอตรวจสอบ" : "Revert to pending"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Settings ------------------------------- */

function SettingsTab({ th }: { th: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState("");
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState<string>("0");
  const [pickupInfo, setPickupInfo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/shop/settings").then((r) => r.json()).then((d) => {
      if (d) {
        setEnabled(!!d.enabled); setPaymentInfo(d.paymentInfo ?? ""); setQrImageUrl(d.qrImageUrl ?? null);
        setDeliveryEnabled(!!d.deliveryEnabled); setDeliveryFee(String(d.deliveryFee ?? 0)); setPickupInfo(d.pickupInfo ?? "");
      }
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shop/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, paymentInfo, qrImageUrl: qrImageUrl || null, deliveryEnabled, deliveryFee: Math.max(0, Math.round(Number(deliveryFee) || 0)), pickupInfo }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 24, maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดร้านค้า" : "Shop open"}</span>
      </label>

      <Field label={th ? "QR พร้อมเพย์ / บัญชีธนาคาร" : "PromptPay / bank QR"}>
        {qrImageUrl ? (
          <div style={{ position: "relative", width: 200 }}>
            <img src={qrImageUrl} alt="QR" style={{ width: 200, height: 200, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "#fff" }} />
            <button onClick={() => setQrImageUrl(null)} style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ width: 200, height: 200, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)" }}>
            {uploading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
            <span style={{ fontSize: 12 }}>{th ? "อัปโหลด QR" : "Upload QR"}</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          setUploading(true); setError(null);
          try { setQrImageUrl(await uploadImage(f)); } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); } finally { setUploading(false); }
        }} />
      </Field>

      <Field label={th ? "คำแนะนำการชำระเงิน" : "Payment instructions"}>
        <RichTextEditor value={paymentInfo} onChange={setPaymentInfo} rows={4} placeholder={th ? "เช่น พร้อมเพย์ 08x-xxx-xxxx (ชื่อ) — โอนแล้วแนบสลิป" : "e.g. PromptPay 08x-xxx-xxxx (Name) — transfer then upload slip"} />
      </Field>

      {/* Delivery / fulfillment (flat fee) */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดให้จัดส่ง (พร้อมค่าส่งแบบเหมา)" : "Offer delivery (flat fee)"}</span>
        </label>
        {deliveryEnabled && (
          <Field label={th ? "ค่าจัดส่งเริ่มต้นของร้าน (บาท)" : "Default delivery fee (฿)"} style={{ maxWidth: 280 }}>
            <input type="number" min={0} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} style={inputStyle} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
              {th ? "ใช้กับสินค้าที่ไม่ได้ตั้งค่าส่งของตัวเอง" : "Used for products that don't set their own delivery fee."}
            </p>
          </Field>
        )}
        <Field label={th ? "คำแนะนำการรับสินค้าเอง (ที่ไหน/เมื่อไหร่)" : "Self-pickup instructions (where / when)"}>
          <RichTextEditor value={pickupInfo} onChange={setPickupInfo} rows={3} placeholder={th ? "เช่น รับที่ห้อง SMO ชั้น 1 อาคาร CAMT จ.–ศ. 12:00–13:00" : "e.g. Collect at the SMO room, CAMT building, Mon–Fri 12:00–13:00"} />
        </Field>
      </div>

      {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={save} disabled={saving || uploading} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{th ? "บันทึก" : "Save"}
        </button>
        {savedAt && !saving && <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={13} style={{ flexShrink: 0 }} /> {th ? "บันทึกแล้ว" : "Saved"}</span>}
      </div>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Field({ label, children, style, required, hint }: { label: string; children: React.ReactNode; style?: React.CSSProperties; required?: boolean; hint?: string }) {
  return (
    <div style={style}>
      <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: hint ? 4 : 8 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
      </label>
      {hint && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>{hint}</p>}
      {children}
    </div>
  );
}

// A plain labeled divider that introduces a group of fields. It does NOT wrap the
// fields — they render in the form's normal flat flow right below it — so there's
// nothing to collapse and nothing can hide. The right-aligned summary chip shows
// the group's current state at a glance (e.g. "Everyone", "Shop default fee").
function SectionDivider({ icon, title, summary }: { icon: React.ReactNode; title: string; summary?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ color: "var(--accent-primary)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{title}</span>
      {summary && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{summary}</span>}
    </div>
  );
}

function Spinner() {
  return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;
}

// Prev/next pager shared by the Products and Orders lists. Hidden when everything
// fits on one page. `total` is the count across all pages (post-filter).
function Pagination({ th, page, total, onPage }: { th: boolean; page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, padding: "6px 12px" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{th ? `${from}–${to} จาก ${total}` : `${from}–${to} of ${total}`}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn btn-ghost" style={btn}><ChevronLeft size={15} />{th ? "ก่อนหน้า" : "Prev"}</button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{th ? `หน้า ${page}/${pages}` : `Page ${page}/${pages}`}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="btn btn-ghost" style={btn}>{th ? "ถัดไป" : "Next"}<ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

// Inline-styled custom dropdown matching this page's inputs (the native <select>
// looked out of place next to the filter chips). Closes on outside-click or Escape;
// shows a check on the active option. Used for the Orders product filter.
function FilterDropdown({ value, options, onChange, minWidth = 160, maxWidth = 260 }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  minWidth?: number;
  maxWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", minWidth, maxWidth }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...inputStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          cursor: "pointer", textAlign: "left",
          borderColor: open ? "var(--accent-primary)" : "var(--border-subtle)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.label ?? ""}</span>
        <ChevronDown size={16} style={{ flexShrink: 0, color: "var(--text-muted)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 50,
          background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          maxHeight: 280, overflowY: "auto", padding: 4,
        }}>
          {options.map((opt) => {
            const sel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
                  width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 14,
                  border: "none", borderRadius: 8, cursor: "pointer",
                  background: sel ? "var(--bg-elevated)" : "transparent",
                  color: sel ? "var(--accent-primary)" : "var(--text-secondary)",
                  fontWeight: sel ? 700 : 500,
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{opt.label}</span>
                {sel && <Check size={15} style={{ flexShrink: 0, marginTop: 3 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Toggleable selection pill used for the role/major audience pickers.
function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
        padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
        background: selected ? "var(--accent-primary)" : "var(--bg-base)",
        color: selected ? "#fff" : "var(--text-secondary)",
      }}
    >
      {selected && <Check size={13} />}{children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)",
};

// Toggle chip for the product-owner (club/major) multi-select.
const ownerChip = (on: boolean, accent: string): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
  background: on ? `${accent}26` : "var(--bg-elevated)",
  color: on ? accent : "var(--text-secondary)",
  border: `1px solid ${on ? `${accent}66` : "var(--border-subtle)"}`,
});

const ORDER_BADGE: Record<string, { th: string; en: string; bg: string; color: string; icon: React.ReactNode }> = {
  pending: { th: "รอตรวจสอบ", en: "Pending", bg: "rgba(245,158,11,0.12)", color: "#b45309", icon: <Clock size={13} /> },
  approved: { th: "อนุมัติแล้ว", en: "Approved", bg: "rgba(22,163,74,0.12)", color: "#15803d", icon: <CheckCircle2 size={13} /> },
  rejected: { th: "ถูกปฏิเสธ", en: "Rejected", bg: "rgba(239,68,68,0.12)", color: "#dc2626", icon: <XCircle size={13} /> },
};
