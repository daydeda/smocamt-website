"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { uploadFormViaXHR } from "@/lib/xhr-upload";
import { parseRichText } from "@/lib/rich-text";
import type { ShopCustomField, ShopCustomValue } from "@/lib/shop-custom-fields";
import { computeProductDeliveryFee, type ShopDeliveryTier } from "@/lib/shop-delivery";
import { computeBundleDiscount, type ShopBundleDeal } from "@/lib/shop-promotions";
import { carrierLabel, daysUntilAutoConfirm, isItemHandedOver, nextFulfillmentStatus, trackingLinkFor } from "@/lib/shop-fulfillment";
import {
  ShoppingBag, X, ChevronLeft, ChevronRight, ChevronDown, Check, Upload, Loader2, CheckCircle2,
  Clock, XCircle, Package, Minus, Plus, ReceiptText, Store, Tag, Truck, Copy, ExternalLink, AlertTriangle, QrCode,
} from "lucide-react";

interface Variant { id: string; label: string; remaining: number | null; allowCustom?: boolean; priceDelta?: number }
interface Product {
  id: string; name: string; description: string; price: number;
  imageUrls: string[]; maxPerOrder: number | null; variants: Variant[];
  opensAt?: string | null; closesAt?: string | null; saleStatus?: "open" | "upcoming" | "closed";
  customFields?: ShopCustomField[];
  deliveryFee?: number | null; deliveryTiers?: ShopDeliveryTier[];
  bundleDeals?: ShopBundleDeal[];
  seller?: {
    id: string; displayName: string; paymentInfo: string; qrImageUrl: string | null;
    deliveryEnabled: boolean; deliveryFee: number; pickupInfo: string;
  } | null;
}
interface ShopData {
  enabled: boolean; paymentInfo: string; qrImageUrl: string | null;
  deliveryEnabled?: boolean; deliveryFee?: number; pickupInfo?: string;
  products: Product[];
}
interface OrderItem { productName: string; variantLabel: string; customValues?: ShopCustomValue[] | null; unitPrice: number; quantity: number; handedOverAt?: string | null }
interface Order {
  id: string; status: string; totalAmount: number; note: string | null;
  rejectionReason: string | null; hasSlip: boolean; createdAt: string; items: OrderItem[];
  fulfillment?: string; shippingFee?: number; discountAmount?: number;
  recipientName?: string | null; recipientPhone?: string | null; shippingAddress?: string | null;
  sellerName?: string | null;
  // Handover tracking (src/lib/shop-fulfillment.ts).
  fulfillmentStatus?: string; pickupInfo?: string | null; readyAt?: string | null;
  carrier?: string | null; carrierName?: string | null; trackingNumber?: string | null; trackingUrl?: string | null;
  shippedAt?: string | null; fulfilledAt?: string | null; fulfilledVia?: string | null;
  issueNote?: string | null; issueAt?: string | null;
}
interface SellerApplication {
  id: string; displayName: string; status: "pending" | "approved" | "rejected" | "suspended";
  reviewNote: string | null; appliedAt: string; reviewedAt: string | null;
}

const baht = (n: number) => `฿${n.toLocaleString()}`;
// Price label for a product: one price, or a "฿min – ฿max" range when options
// cost different amounts (e.g. base ฿0 with every option priced by surcharge).
const priceLabel = (p: Product) => {
  const prices = p.variants.length ? p.variants.map((v) => p.price + (v.priceDelta ?? 0)) : [p.price];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? baht(min) : `${baht(min)} – ${baht(max)}`;
};

export default function ShopClient() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [data, setData] = useState<ShopData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"shop" | "orders">("shop");
  const [active, setActive] = useState<Product | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sellerApplication, setSellerApplication] = useState<SellerApplication | null>(null);

  const load = useCallback(async () => {
    const [s, o, seller] = await Promise.all([
      fetch("/api/shop").then((r) => r.json()).catch(() => null),
      fetch("/api/shop/orders").then((r) => r.json()).catch(() => []),
      fetch("/api/shop/seller").then((r) => r.json()).catch(() => null),
    ]);
    if (s && Array.isArray(s.products)) setData(s);
    if (Array.isArray(o)) setOrders(o);
    setSellerApplication(seller?.seller ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <StudentNav />
      <main className="page-container" style={{ marginTop: 40, paddingBottom: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <ShoppingBag size={30} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
          <h1 style={{ fontSize: "clamp(26px,5vw,38px)", fontWeight: 900, letterSpacing: "-0.03em" }}>
            {th ? "ร้านค้า" : "Shop"}
          </h1>
        </div>
        <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: 14 }}>
          {th ? "สั่งซื้อสินค้า โอนเงิน แล้วแนบสลิปเพื่อยืนยัน" : "Order merch, transfer payment, then upload your slip to confirm."}
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {(["shop", "orders"] as const).map((tk) => (
            <button
              key={tk}
              onClick={() => setTab(tk)}
              className={tab === tk ? "btn btn-primary" : "btn btn-ghost"}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              {tk === "shop" ? <Package size={16} /> : <ReceiptText size={16} />}
              {tk === "shop" ? (th ? "สินค้า" : "Products") : (th ? `คำสั่งซื้อของฉัน${orders.length ? ` (${orders.length})` : ""}` : `My Orders${orders.length ? ` (${orders.length})` : ""}`)}
            </button>
          ))}
        </div>

        {!loading && tab === "shop" && (
          <SellerApplicationCard
            application={sellerApplication}
            th={th}
            onApplied={async () => { await load(); }}
          />
        )}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : tab === "shop" ? (
          !data || !data.enabled ? (
            <EmptyState icon={<ShoppingBag size={40} />} text={th ? "ขณะนี้ร้านค้าปิดทำการ" : "The shop is currently closed."} />
          ) : data.products.length === 0 ? (
            <EmptyState icon={<Package size={40} />} text={th ? "ยังไม่มีสินค้า" : "No products yet."} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 20 }}>
              {data.products.map((p) => <ProductCard key={p.id} product={p} th={th} onOpen={() => setActive(p)} />)}
            </div>
          )
        ) : (
          <OrdersList orders={orders} th={th} onChanged={load} />
        )}
      </main>

      {active && data && (
        <ProductModal
          product={active}
          settings={data}
          th={th}
          onClose={() => setActive(null)}
          onOrdered={async () => {
            setActive(null);
            showToast(th ? "ส่งคำสั่งซื้อแล้ว! รอแอดมินตรวจสอบสลิป" : "Order placed! Awaiting admin slip review.");
            setTab("orders");
            await load();
          }}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 3000, background: "var(--text-primary)", color: "var(--bg-base)", padding: "12px 20px", borderRadius: 12, fontWeight: 600, fontSize: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.2)", maxWidth: "90vw", textAlign: "center" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: 80, color: "var(--text-muted)" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, opacity: 0.5 }}>{icon}</div>
      <p style={{ fontSize: 15 }}>{text}</p>
    </div>
  );
}

function SellerApplicationCard({ application, th, onApplied }: {
  application: SellerApplication | null;
  th: boolean;
  onApplied: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(application?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (displayName.trim().length < 2) {
      setError(th ? "กรุณากรอกชื่อร้านอย่างน้อย 2 ตัวอักษร" : "Enter a seller name of at least 2 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/seller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Application failed");
      setOpen(false);
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Application failed");
    } finally {
      setSaving(false);
    }
  };

  const statusCopy = application?.status === "pending"
    ? (th ? "คำขอผู้ขายของคุณกำลังรอตรวจสอบ" : "Your seller application is awaiting review.")
    : application?.status === "approved"
      ? (th ? "บัญชีผู้ขายได้รับการอนุมัติแล้ว" : "Your seller account is approved.")
      : application?.status === "suspended"
        ? (th ? "บัญชีผู้ขายถูกระงับชั่วคราว" : "Your seller account is suspended.")
        : application?.status === "rejected"
          ? (th ? "คำขอผู้ขายยังไม่ได้รับอนุมัติ" : "Your seller application was not approved.")
          : null;

  return (
    <div style={{ marginBottom: 22, padding: 16, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
          <Store size={20} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontWeight: 800, fontSize: 14 }}>
              {application?.displayName || (th ? "อยากขายสินค้าของคุณ?" : "Want to sell your own items?")}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
              {statusCopy || (th
                ? "บัญชี Google ทุกโดเมนสมัครได้หลังทำ onboarding และต้องผ่านการอนุมัติก่อนลงสินค้า"
                : "Any Google-account email domain may apply after onboarding; approval is required before listing products.")}
            </p>
            {application?.reviewNote && (
              <p style={{ color: application.status === "rejected" || application.status === "suspended" ? "#dc2626" : "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
                {th ? "หมายเหตุ: " : "Note: "}{application.reviewNote}
              </p>
            )}
          </div>
        </div>
        {application?.status === "approved" ? (
          <Link href="/admin/shop" className="btn btn-primary" style={{ fontSize: 13 }}>
            {th ? "จัดการร้านของฉัน" : "Manage my shop"}
          </Link>
        ) : application?.status === "pending" || application?.status === "suspended" ? null : (
          <button onClick={() => setOpen((value) => !value)} className="btn btn-ghost" style={{ fontSize: 13 }}>
            {application?.status === "rejected" ? (th ? "สมัครใหม่" : "Re-apply") : (th ? "สมัครเป็นผู้ขาย" : "Apply to sell")}
          </button>
        )}
      </div>

      {open && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label htmlFor="seller-display-name" style={{ display: "block", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>{th ? "ชื่อผู้ขาย / ชื่อร้าน" : "Seller / shop name"}</label>
            <input id="seller-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} style={customInputStyle} placeholder={th ? "เช่น ชมรมถ่ายภาพ หรือ Jane's Bakery" : "e.g. Photography Club or Jane's Bakery"} />
          </div>
          <button onClick={apply} disabled={saving} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {saving && <Loader2 size={15} className="animate-spin" />}{th ? "ส่งคำขอ" : "Submit application"}
          </button>
          {error && <p style={{ width: "100%", color: "#ef4444", fontSize: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, th, onOpen }: { product: Product; th: boolean; onOpen: () => void }) {
  const cover = product.imageUrls[0];
  const soldOut = product.variants.length > 0 && product.variants.every((v) => v.remaining != null && v.remaining <= 0);
  const closed = product.saleStatus === "closed";
  const upcoming = product.saleStatus === "upcoming";
  const overlayText = closed ? (th ? "ปิดการขาย" : "CLOSED") : upcoming ? (th ? "เร็วๆ นี้" : "COMING SOON") : soldOut ? (th ? "สินค้าหมด" : "SOLD OUT") : null;
  const hasDesc = product.description.trim() !== "";
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ textAlign: "left", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}
    >
      <div style={{ aspectRatio: "1", background: "var(--bg-elevated)", position: "relative" }}>
        {cover ? (
          <img src={cover} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}><Package size={40} /></div>
        )}
        {overlayText && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: "0.05em" }}>
            {overlayText}
          </div>
        )}
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", flex: 1 }}>
        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, lineHeight: 1.3 }}>{product.name}</p>
        {product.seller?.displayName && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{th ? "ผู้ขาย: " : "Seller: "}{product.seller.displayName}</p>
        )}
        {hasDesc && (
          <>
            <div
              style={{
                fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 2,
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                overflowWrap: "anywhere", wordBreak: "break-word",
              }}
              dangerouslySetInnerHTML={{ __html: parseRichText(product.description) }}
            />
            <span style={{ color: "var(--accent-primary)", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
              {th ? "อ่านเพิ่มเติม..." : "Read more..."}
            </span>
          </>
        )}
        <p style={{ fontWeight: 800, fontSize: 16, color: "var(--accent-primary)", marginTop: "auto" }}>{priceLabel(product)}</p>
        {(product.bundleDeals?.length ?? 0) > 0 && <BundleDealBadges deals={product.bundleDeals!} variants={product.variants} th={th} />}
      </div>
    </div>
  );
}

function ProductModal({ product, settings, th, onClose, onOrdered }: {
  product: Product; settings: ShopData; th: boolean; onClose: () => void; onOrdered: () => void;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  // Quantity per variant, so one order can mix sizes (e.g. 2×S + 1×XL). A
  // single-option product starts at 1 (nothing to choose); a multi-option one
  // starts empty so the buyer picks sizes deliberately. The server already
  // accepts several items per order and re-checks stock/limits per variant.
  const [qtyByVariant, setQtyByVariant] = useState<Record<string, number>>(() => {
    if (product.variants.length !== 1) return {};
    const only = product.variants[0];
    return only && (only.remaining == null || only.remaining > 0) ? { [only.id]: 1 } : {};
  });
  // "Other (specify)" text, per variant (only variants with allowCustom use it).
  const [customValueByVariant, setCustomValueByVariant] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"select" | "pay">("select");
  const [slipPath, setSlipPath] = useState<string | null>(null);
  // Signed hash/QR from the upload response (see shop-slip-verify.ts) — carried
  // forward so order creation can trust it without re-downloading the slip.
  const [slipMeta, setSlipMeta] = useState<string | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checkoutSettings = product.seller ?? settings;
  const customFields = product.customFields ?? [];
  const missingRequiredCustom = customFields.some((f) => f.required && !(customAnswers[f.key] ?? "").trim());
  // Per-variant cap: 99 (the API's per-item max) and the variant's remaining stock.
  const variantCap = (v: Variant) => Math.max(0, Math.min(99, v.remaining ?? 99));
  // Chosen lines in variant order. Clamped at render (not in an effect) so a
  // stale quantity can never exceed the variant's cap.
  const lines = product.variants
    .map((v) => ({ variant: v, qty: Math.min(qtyByVariant[v.id] ?? 0, variantCap(v)) }))
    .filter((l) => l.qty > 0);
  // Total units of this product in the order: drives the per-person limit, the
  // bundle promotion and the delivery tier, all of which are per product.
  const qty = lines.reduce((n, l) => n + l.qty, 0);
  const productCap = product.maxPerOrder ?? Infinity;
  const setVariantQty = (v: Variant, next: number) => {
    const others = qty - Math.min(qtyByVariant[v.id] ?? 0, variantCap(v));
    const clamped = Math.max(0, Math.min(next, variantCap(v), productCap - others));
    setQtyByVariant((m) => ({ ...m, [v.id]: clamped }));
  };
  const missingOtherText = lines.some((l) => l.variant.allowCustom && !(customValueByVariant[l.variant.id] ?? "").trim());
  // Unit price per line = base price + that variant's surcharge (e.g. a special
  // size). Mirrors the server's authoritative computation in /api/shop/orders.
  const unitPriceOf = (v: Variant) => product.price + (v.priceDelta ?? 0);
  const subtotal = lines.reduce((sum, l) => sum + unitPriceOf(l.variant) * l.qty, 0);
  // "Buy N for ฿X" saving — mirrors the server's authoritative computeBundleDiscount.
  const discount = computeBundleDiscount(product, product.variants, new Map(lines.map((l) => [l.variant.id, l.qty])));
  // Options can cost different amounts; if so, show each option's full price.
  const pricesVary = new Set(product.variants.map(unitPriceOf)).size > 1;
  // Per-product delivery fee for the current quantity (tiers can raise it as qty
  // grows). Mirrors the server's authoritative computeProductDeliveryFee. The
  // fee at qty=1 powers the "Delivery (+฿X)" hint on the chooser.
  const shopWideFee = checkoutSettings.deliveryFee ?? 0;
  const deliveryFee = fulfillment === "delivery" ? computeProductDeliveryFee(product, qty, shopWideFee) : 0;
  const deliveryFeeFrom = computeProductDeliveryFee(product, 1, shopWideFee);
  const total = subtotal - discount + deliveryFee;
  const deliveryIncomplete = fulfillment === "delivery" && (!recipientName.trim() || !recipientPhone.trim() || !shippingAddress.trim());
  const hasImages = product.imageUrls.length > 0;
  const notOpen = product.saleStatus && product.saleStatus !== "open";
  const fmt = (iso: string) => new Date(iso).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  const uploadSlip = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Shrink the photo in the browser first. Raw phone slips (2–5MB) get
      // rejected by the reverse proxy's body-size cap with a 413 before reaching
      // the app; a downscaled WebP is a few hundred KB and sails through.
      const unreadable = th ? "อ่านไฟล์รูปไม่ได้ กรุณาเลือกรูปใหม่" : "Could not read that image. Please choose it again.";
      // Copy the picked file into memory FIRST. On iPhone, picking from Photos
      // hands back a temp ".jpeg" that iOS transcoded from HEIC; that file is
      // disk-backed and can be empty/unreadable by the time it's posted, which
      // the server sees as a multipart body with Content-Length: 0 ("Could not
      // read the uploaded file"). Reading it now, while it's fresh, both
      // catches that case with a clear message and means nothing downstream
      // touches the temp file again.
      let picked: File;
      try {
        const bytes = await file.arrayBuffer();
        if (bytes.byteLength === 0) throw new Error("empty");
        picked = new File([bytes], file.name, { type: file.type });
      } catch {
        throw new Error(unreadable);
      }
      const upload = await compressImageFile(picked);
      if (upload.size === 0) throw new Error(unreadable);
      const fd = new FormData();
      // Must go through uploadFormViaXHR, not fetch(): on iOS Safari a Blob
      // posted directly can go out with an empty body. The helper materializes
      // the bytes first (see src/lib/xhr-upload.ts).
      fd.append("file", upload);
      // A proxy-level rejection (e.g. 413) returns an HTML body, not JSON; the
      // helper parses defensively and hands back {} in that case.
      let res = await uploadFormViaXHR("/api/shop/slip", fd);
      // The server couldn't parse the body (it arrived empty/truncated). The
      // bytes are already in memory, so one silent retry usually succeeds.
      if (res.status === 400 && res.body.code === "BODY_UNREADABLE") {
        res = await uploadFormViaXHR("/api/shop/slip", fd);
      }
      const d = res.body as { path?: string; slipMeta?: string; error?: string };
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(th ? "ไฟล์รูปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง" : "Image is too large. Please choose a smaller photo.");
        }
        throw new Error(d.error || (th ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again."));
      }
      if (!d.path) throw new Error(th ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again.");
      setSlipPath(d.path);
      setSlipMeta(d.slipMeta ?? null);
      setSlipPreview(URL.createObjectURL(upload));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (deliveryIncomplete) { setError(th ? "กรุณากรอกชื่อผู้รับ เบอร์โทร และที่อยู่จัดส่ง" : "Please fill in the recipient name, phone, and delivery address."); return; }
    if (!slipPath) { setError(th ? "กรุณาแนบสลิปการโอนเงิน" : "Please upload your payment slip."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({
            variantId: l.variant.id,
            quantity: l.qty,
            customValue: l.variant.allowCustom ? (customValueByVariant[l.variant.id] ?? "").trim() : undefined,
            // Custom fields are per product, so every line carries the same answers.
            custom: customFields.length ? customAnswers : undefined,
          })),
          slipPath, slipMeta: slipMeta || undefined, note: note || undefined,
          fulfillment,
          recipientName: fulfillment === "delivery" ? recipientName.trim() : undefined,
          recipientPhone: fulfillment === "delivery" ? recipientPhone.trim() : undefined,
          shippingAddress: fulfillment === "delivery" ? shippingAddress.trim() : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Order failed");
      onOrdered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 560, maxHeight: "94vh", border: "1px solid var(--border-subtle)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step === "select" ? product.name : (th ? "ชำระเงิน & แนบสลิป" : "Pay & upload slip")}</p>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 6, flexShrink: 0 }}><X size={20} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16 }}>
          {step === "select" ? (
            <>
              {/* Image carousel */}
              <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", position: "relative", overflow: "hidden", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220 }}>
                {hasImages ? (
                  <img src={product.imageUrls[imgIdx]} alt={product.name} style={{ width: "100%", maxHeight: "60vh", objectFit: "contain", display: "block" }} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220, color: "var(--text-muted)" }}><Package size={48} /></div>
                )}
                {product.imageUrls.length > 1 && (
                  <>
                    <button onClick={() => setImgIdx((i) => (i - 1 + product.imageUrls.length) % product.imageUrls.length)} style={navBtn("left")}><ChevronLeft size={20} /></button>
                    <button onClick={() => setImgIdx((i) => (i + 1) % product.imageUrls.length)} style={navBtn("right")}><ChevronRight size={20} /></button>
                    <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
                      {product.imageUrls.map((_, i) => (
                        <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i === imgIdx ? "#fff" : "rgba(255,255,255,0.5)" }} />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <p style={{ fontWeight: 800, fontSize: 22, color: "var(--accent-primary)", marginBottom: 12 }}>
                {priceLabel(product)}
              </p>
              {(product.bundleDeals?.length ?? 0) > 0 && (
                <div style={{ marginTop: -4, marginBottom: 12 }}>
                  <BundleDealBadges deals={product.bundleDeals!} variants={product.variants} th={th} />
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {th ? "นับรวมตัวเลือกที่ร่วมโปรในออร์เดอร์เดียว ระบบคิดราคาที่ถูกที่สุดให้อัตโนมัติ" : "Counts every eligible option in one order, and the best price is applied automatically."}
                  </p>
                </div>
              )}

              {/* Sale schedule notice */}
              {(product.saleStatus === "upcoming" || product.saleStatus === "closed" || product.closesAt) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, padding: "8px 12px", borderRadius: "var(--radius-md)", background: product.saleStatus === "open" ? "var(--bg-base)" : "rgba(245,158,11,0.1)", color: product.saleStatus === "open" ? "var(--text-secondary)" : "#b45309" }}>
                  <Clock size={15} style={{ flexShrink: 0 }} />
                  <span>
                    {product.saleStatus === "upcoming" && product.opensAt ? (th ? `เปิดขาย ${fmt(product.opensAt)}` : `Opens ${fmt(product.opensAt)}`)
                      : product.saleStatus === "closed" ? (th ? "ปิดการขายแล้ว" : "Sales have closed")
                      : product.closesAt ? (th ? `ปิดรับ ${fmt(product.closesAt)}` : `Closes ${fmt(product.closesAt)}`)
                      : null}
                  </span>
                </div>
              )}

              {product.description.trim() !== "" && (
                <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.6, overflowWrap: "anywhere", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: parseRichText(product.description) }} />
              )}

              {/* Quantity per option. Several sizes can go into one order, each
                  with its own stepper; the per-person limit, promotion and
                  delivery tier count the product's total across all of them. */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                  {product.variants.length > 1 ? (th ? "เลือกไซส์และจำนวน (เลือกได้หลายไซส์)" : "Choose sizes & quantity (mix sizes freely)") : (th ? "จำนวน" : "Quantity")}
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {product.variants.map((v) => {
                    const cap = variantCap(v);
                    const out = cap === 0;
                    const q = Math.min(qtyByVariant[v.id] ?? 0, cap);
                    const atLimit = q >= cap || qty >= productCap;
                    return (
                      <div key={v.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: product.variants.length > 1 ? "8px 12px" : 0, borderRadius: "var(--radius-md)", border: product.variants.length > 1 ? `1px solid ${q > 0 ? "var(--accent-primary)" : "var(--border-subtle)"}` : "none", background: product.variants.length > 1 ? "var(--bg-base)" : "transparent", opacity: out ? 0.55 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {product.variants.length > 1 && (
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere", wordBreak: "break-word", textDecoration: out ? "line-through" : undefined }}>{v.label}</span>
                              {pricesVary
                                ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", marginLeft: 6 }}>{baht(unitPriceOf(v))}</span>
                                : null}
                              {v.remaining != null && (
                                <span style={{ display: "block", fontSize: 12, color: out ? "#ef4444" : "var(--text-muted)" }}>{out ? (th ? "หมด" : "Sold out") : (th ? `เหลือ ${v.remaining}` : `${v.remaining} left`)}</span>
                              )}
                            </div>
                          )}
                          <button onClick={() => setVariantQty(v, q - 1)} disabled={q === 0} aria-label={th ? `ลดจำนวน ${v.label}` : `Decrease ${v.label}`} className="btn btn-ghost" style={{ padding: 8 }}><Minus size={16} /></button>
                          <span style={{ fontWeight: 800, fontSize: 18, minWidth: 32, textAlign: "center" }}>{q}</span>
                          <button onClick={() => setVariantQty(v, q + 1)} disabled={out || atLimit} aria-label={th ? `เพิ่มจำนวน ${v.label}` : `Increase ${v.label}`} className="btn btn-ghost" style={{ padding: 8 }}><Plus size={16} /></button>
                        </div>
                        {/* Custom value for an "Other (specify)" option */}
                        {v.allowCustom && q > 0 && (
                          <input
                            value={customValueByVariant[v.id] ?? ""}
                            onChange={(e) => setCustomValueByVariant((m) => ({ ...m, [v.id]: e.target.value }))}
                            maxLength={120}
                            aria-label={th ? "ระบุรายละเอียด" : "Please specify"}
                            placeholder={th ? "ระบุรายละเอียด * เช่น ไซส์/สีที่ต้องการ" : "Please specify * e.g. desired size/colour"}
                            style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-surface)" }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                {(product.maxPerOrder != null || (product.variants.length > 1 && qty > 0)) && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                    {product.variants.length > 1 && qty > 0 ? (th ? `รวม ${qty} ชิ้น` : `${qty} item${qty === 1 ? "" : "s"} in total`) : ""}
                    {product.variants.length > 1 && qty > 0 && product.maxPerOrder != null ? " · " : ""}
                    {product.maxPerOrder != null ? (th ? `จำกัด ${product.maxPerOrder} ชิ้น/คน` : `Max ${product.maxPerOrder} per person`) : ""}
                  </p>
                )}
              </div>

              {/* Custom fields (e.g. jersey name/number) */}
              {customFields.map((f) => (
                <div key={f.key} style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {f.label}{f.required ? " *" : ""}
                  </label>
                  {f.type === "select" ? (
                    <CustomSelect
                      ariaLabel={f.label}
                      value={customAnswers[f.key] ?? ""}
                      placeholder={th ? "— เลือก —" : "— Select —"}
                      onChange={(val) => setCustomAnswers((a) => ({ ...a, [f.key]: val }))}
                      options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
                    />
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      inputMode={f.type === "number" ? "numeric" : undefined}
                      value={customAnswers[f.key] ?? ""}
                      onChange={(e) => setCustomAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                      maxLength={f.type === "text" ? (f.maxLength ?? undefined) : undefined}
                      min={f.type === "number" ? (f.min ?? undefined) : undefined}
                      max={f.type === "number" ? (f.max ?? undefined) : undefined}
                      placeholder={f.type === "number" && (f.min != null || f.max != null) ? `${f.min ?? ""}–${f.max ?? ""}` : ""}
                      style={customInputStyle}
                    />
                  )}
                </div>
              ))}

              {error && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{error}</p>}

              <button onClick={() => setStep("pay")} disabled={qty === 0 || missingOtherText || missingRequiredCustom || !!notOpen} className="btn btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "space-between", display: "flex" }}>
                <span>{notOpen ? (product.saleStatus === "upcoming" ? (th ? "ยังไม่เปิดขาย" : "Not on sale yet") : (th ? "ปิดการขาย" : "Sales closed")) : (th ? "ดำเนินการต่อ" : "Continue")}</span>
                {!notOpen && <span>{baht(total)}</span>}
              </button>
            </>
          ) : (
            <>
              {/* Order summary */}
              <div style={{ background: "var(--bg-base)", borderRadius: "var(--radius-md)", padding: 14, marginBottom: 16, border: "1px solid var(--border-subtle)" }}>
                {lines.map((l) => {
                  const other = l.variant.allowCustom ? (customValueByVariant[l.variant.id] ?? "").trim() : "";
                  return (
                    <div key={l.variant.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, marginBottom: 4 }}>
                      <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{product.name}{product.variants.length > 1 ? ` · ${l.variant.label}${other ? `: ${other}` : ""}` : ""} × {l.qty}</span>
                      <span style={{ fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>{baht(unitPriceOf(l.variant) * l.qty)}</span>
                    </div>
                  );
                })}
                {customFields.filter((f) => (customAnswers[f.key] ?? "").trim()).map((f) => (
                  <div key={f.key} style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>{f.label}: <strong style={{ color: "var(--text-secondary)" }}>{customAnswers[f.key]}</strong></div>
                ))}
                {discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "#10b981", fontWeight: 600, marginTop: 4 }}>
                    <span>{th ? "ส่วนลดโปรโมชัน" : "Promotion discount"}</span><span>−{baht(discount)}</span>
                  </div>
                )}
                {deliveryFee > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                    <span>{th ? "ค่าจัดส่ง" : "Shipping"}</span><span>{baht(deliveryFee)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 800, fontSize: 15, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-subtle)" }}>
                  <span>{th ? "รวมทั้งหมด" : "Total"}</span><span>{baht(total)}</span>
                </div>
              </div>

              {/* Fulfillment: pickup vs delivery (delivery only if the shop enables it) */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "การรับสินค้า" : "Fulfillment"}</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {(["pickup", "delivery"] as const).map((opt) => {
                    const disabled = opt === "delivery" && !checkoutSettings.deliveryEnabled;
                    const sel = fulfillment === opt;
                    return (
                      <button key={opt} disabled={disabled} onClick={() => setFulfillment(opt)}
                        style={{ flex: 1, padding: "10px 12px", borderRadius: "var(--radius-md)", border: `2px solid ${sel ? "var(--accent-primary)" : "var(--border-subtle)"}`, background: sel ? "var(--accent-glow)" : "var(--bg-base)", fontWeight: 700, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}>
                        {opt === "pickup" ? (th ? "รับเอง" : "Self-pickup") : (th ? `จัดส่ง${deliveryFeeFrom ? ` (+${baht(deliveryFeeFrom)})` : ""}` : `Delivery${deliveryFeeFrom ? ` (+${baht(deliveryFeeFrom)})` : ""}`)}
                      </button>
                    );
                  })}
                </div>
                {fulfillment === "pickup" && (checkoutSettings.pickupInfo ?? "").trim() !== "" && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "8px 12px", borderRadius: "var(--radius-md)", lineHeight: 1.6, overflowWrap: "anywhere", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: parseRichText(checkoutSettings.pickupInfo ?? "") }} />
                )}
                {fulfillment === "delivery" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={120} placeholder={th ? "ชื่อผู้รับ *" : "Recipient name *"} style={customInputStyle} />
                    <input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} maxLength={40} inputMode="tel" placeholder={th ? "เบอร์โทร *" : "Phone *"} style={customInputStyle} />
                    <textarea value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} maxLength={1000} rows={3} placeholder={th ? "ที่อยู่จัดส่ง *" : "Delivery address *"} style={{ ...customInputStyle, resize: "vertical" }} />
                  </div>
                )}
              </div>

              {/* Payment instructions + QR */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "ช่องทางการชำระเงิน" : "How to pay"}</label>
                {product.seller?.displayName && (
                  <p style={{ textAlign: "center", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                    {th ? "ชำระโดยตรงให้ " : "Pay directly to "}{product.seller.displayName}
                  </p>
                )}
                {checkoutSettings.qrImageUrl && (
                  <img src={checkoutSettings.qrImageUrl} alt="Payment QR" style={{ width: "100%", maxWidth: 320, aspectRatio: "1 / 1", objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", display: "block", margin: "0 auto 12px", background: "#fff" }} />
                )}
                {checkoutSettings.paymentInfo.trim() !== "" && (
                  <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, textAlign: "center", overflowWrap: "anywhere", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: parseRichText(checkoutSettings.paymentInfo) }} />
                )}
                {product.seller && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 10 }}>
                    {th ? "ActiveCAMT ไม่รับหรือถือเงิน การชำระเงินส่งตรงถึงผู้ขาย" : "ActiveCAMT does not receive or hold funds; payment goes directly to the seller."}
                  </p>
                )}
              </div>

              {/* Slip upload */}
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "แนบสลิปการโอนเงิน *" : "Upload payment slip *"}</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlip(f); }} />
              {slipPreview ? (
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <img src={slipPreview} alt="slip" style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-base)" }} />
                  <button onClick={() => { setSlipPath(null); setSlipPreview(null); if (fileRef.current) fileRef.current.value = ""; }} className="btn btn-ghost" style={{ position: "absolute", top: 8, right: 8, padding: 6, background: "var(--bg-surface)" }} aria-label={th ? "ลบสลิป" : "Remove slip"}><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ width: "100%", padding: 24, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--text-muted)", marginBottom: 16 }}>
                  {uploading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{uploading ? (th ? "กำลังอัปโหลด…" : "Uploading…") : (th ? "แตะเพื่อเลือกรูปสลิป" : "Tap to choose slip image")}</span>
                </button>
              )}

              {/* Note */}
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "หมายเหตุ (ไม่บังคับ)" : "Note (optional)"}</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={th ? "เช่น ชื่อบนสลิป, ขนาดที่ต้องการ" : "e.g. name on slip, pickup details"} style={{ width: "100%", padding: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)", resize: "vertical", marginBottom: 16 }} />

              {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setStep("select")} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "ย้อนกลับ" : "Back"}</button>
                <button onClick={submit} disabled={submitting || uploading || !slipPath || deliveryIncomplete} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {th ? "ยืนยันคำสั่งซื้อ" : "Place order"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OrdersList({ orders, th, onChanged }: { orders: Order[]; th: boolean; onChanged: () => void }) {
  if (orders.length === 0) {
    return <EmptyState icon={<ReceiptText size={40} />} text={th ? "ยังไม่มีคำสั่งซื้อ" : "No orders yet."} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {orders.map((o) => <OrderRow key={o.id} order={o} th={th} onChanged={onChanged} />)}
    </div>
  );
}

function OrderRow({ order, th, onChanged }: { order: Order; th: boolean; onChanged: () => void }) {
  const [showSlip, setShowSlip] = useState(false);
  const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE.pending;
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          {order.sellerName && (
            <p style={{ fontSize: 12, color: "var(--accent-primary)", fontWeight: 700, marginBottom: 3 }}>
              {th ? "ผู้ขาย: " : "Seller: "}{order.sellerName}
            </p>
          )}
          {order.items.map((i, idx) => (
            <div key={idx}>
              <p style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {order.fulfillmentStatus === "partial" && isItemHandedOver(i, "partial") && (
                  <CheckCircle2 size={14} aria-label={th ? "ได้รับแล้ว" : "Received"} style={{ display: "inline-block", color: "#15803d", verticalAlign: "-2px", marginRight: 4 }} />
                )}
                {i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}
              </p>
              {i.customValues && i.customValues.length > 0 && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {i.customValues.map((cv) => `${cv.label}: ${cv.value}`).join(" · ")}
                </p>
              )}
            </div>
          ))}
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{new Date(order.createdAt).toLocaleString(th ? "th-TH" : "en-GB")}</p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: badge.bg, color: badge.color, whiteSpace: "nowrap" }}>
          {badge.icon}{th ? badge.th : badge.en}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>
          {baht(order.totalAmount)}
          {order.discountAmount ? <span style={{ fontSize: 12, fontWeight: 600, color: "#10b981", marginLeft: 6 }}>{th ? `ส่วนลด ${baht(order.discountAmount)}` : `saved ${baht(order.discountAmount)}`}</span> : null}
        </span>
        {order.hasSlip && (
          <button onClick={() => setShowSlip((s) => !s)} className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }}>
            {showSlip ? (th ? "ซ่อนสลิป" : "Hide slip") : (th ? "ดูสลิป" : "View slip")}
          </button>
        )}
      </div>
      {order.fulfillment === "delivery" ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>
          {th ? "จัดส่ง" : "Delivery"}{order.shippingFee ? ` (+${baht(order.shippingFee)})` : ""}{order.shippingAddress ? ` · ${order.shippingAddress}` : ""}
        </p>
      ) : order.fulfillment === "pickup" ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{th ? "รับสินค้าเอง" : "Self-pickup"}</p>
      ) : null}
      {order.status === "rejected" && order.rejectionReason && (
        <p style={{ marginTop: 10, fontSize: 13, color: "#ef4444", background: "rgba(239,68,68,0.06)", padding: "8px 12px", borderRadius: 8 }}>
          {th ? "เหตุผล: " : "Reason: "}{order.rejectionReason}
        </p>
      )}
      {showSlip && order.hasSlip && (
        <img src={`/api/shop/orders/${order.id}/slip`} alt="slip" style={{ marginTop: 12, width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-base)" }} />
      )}
      {order.status === "approved" && <OrderHandover order={order} th={th} onChanged={onChanged} />}
    </div>
  );
}

// Where the item is after payment was approved: the pickup instructions and
// "show your Digital ID", or the carrier + tracking number with "I received it"
// / "Report a problem". Buttons follow nextFulfillmentStatus — the same rules
// the server enforces.
function OrderHandover({ order, th, onChanged }: { order: Order; th: boolean; onChanged: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const s = order.fulfillmentStatus ?? "awaiting";
  const state = { status: order.status, fulfillment: order.fulfillment ?? "pickup", fulfillmentStatus: s };
  const when = (d?: string | null) => (d ? new Date(d).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
  const link = trackingLinkFor(order.carrier, order.trackingUrl);

  const act = async (body: { action: "confirm" } | { action: "report"; note: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/orders/${order.id}/fulfillment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || (th ? "ไม่สำเร็จ ลองอีกครั้ง" : "Something went wrong — try again."));
      }
      setReporting(false);
      setProblem("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : (th ? "ไม่สำเร็จ ลองอีกครั้ง" : "Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  };

  // Copy first so the buyer can paste it on the carrier's page, which we open
  // as-is (carriers don't document a stable deep link with the number in it).
  const copyNumber = async () => {
    if (!order.trackingNumber) return;
    try {
      await navigator.clipboard.writeText(order.trackingNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the number is still selectable on screen.
    }
  };

  const box = (bg: string, border: string): React.CSSProperties => ({ marginTop: 12, fontSize: 13, padding: "10px 12px", borderRadius: 8, background: bg, border: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 6 });

  if (s === "picked_up" || s === "delivered") {
    return (
      <p style={{ ...box("rgba(22,163,74,0.08)", "rgba(22,163,74,0.2)"), color: "#15803d", flexDirection: "row", alignItems: "center", gap: 6, fontWeight: 600 }}>
        <CheckCircle2 size={15} />
        {s === "picked_up" ? (th ? "รับสินค้าแล้ว" : "Picked up") : (th ? "ได้รับสินค้าแล้ว" : "Delivered")} · {when(order.fulfilledAt)}
      </p>
    );
  }

  // Some lines handed over at the counter, some still to collect.
  if (s === "partial") {
    const left = order.items.filter((i) => !isItemHandedOver(i, s));
    return (
      <div style={box("rgba(245,158,11,0.08)", "rgba(245,158,11,0.3)")}>
        <p style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, color: "#b45309" }}>
          <Package size={15} />{th ? `ได้รับแล้ว ${order.items.length - left.length} จาก ${order.items.length} รายการ` : `Received ${order.items.length - left.length} of ${order.items.length} items`}
        </p>
        <p style={{ overflowWrap: "anywhere" }}>
          {th ? "ยังต้องรับ: " : "Still to collect: "}
          <strong>{left.map((i) => `${i.productName}${i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} ×${i.quantity}`).join(", ")}</strong>
        </p>
        {order.fulfillment !== "delivery" && order.pickupInfo?.trim() && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{th ? "รับที่: " : "Pick up at: "}{order.pickupInfo}</p>}
        <Link href="/dashboard/id" className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
          <QrCode size={14} />{th ? "เปิด Digital ID" : "Open Digital ID"}
        </Link>
      </div>
    );
  }

  if (order.fulfillment !== "delivery") {
    const ready = s === "ready";
    return (
      <div style={ready ? box("rgba(124,58,237,0.08)", "rgba(124,58,237,0.25)") : box("var(--bg-base)", "var(--border-subtle)")}>
        <p style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, color: ready ? "#6d28d9" : "var(--text-secondary)" }}>
          {ready ? <Package size={15} /> : <Clock size={15} />}
          {ready ? (th ? "สินค้าพร้อมให้รับแล้ว!" : "Ready for pickup!") : (th ? "ผู้ขายกำลังเตรียมสินค้า" : "The seller is preparing your order")}
        </p>
        {order.pickupInfo?.trim() && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{th ? "รับที่: " : "Pick up at: "}{order.pickupInfo}</p>}
        <p style={{ color: "var(--text-muted)" }}>
          {th ? "ตอนไปรับ ให้เปิด Digital ID ให้ผู้ขายสแกน" : "When you collect it, show your Digital ID for the seller to scan."}
        </p>
        <Link href="/dashboard/id" className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
          <QrCode size={14} />{th ? "เปิด Digital ID" : "Open Digital ID"}
        </Link>
      </div>
    );
  }

  if (s === "awaiting") {
    return (
      <p style={{ ...box("var(--bg-base)", "var(--border-subtle)"), flexDirection: "row", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
        <Clock size={15} />{th ? "ผู้ขายกำลังเตรียมจัดส่ง" : "The seller is preparing to send it"}
      </p>
    );
  }

  // shipped / issue
  const issue = s === "issue";
  return (
    <div style={issue ? box("rgba(239,68,68,0.06)", "rgba(239,68,68,0.25)") : box("rgba(59,130,246,0.06)", "rgba(59,130,246,0.25)")}>
      <p style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, color: issue ? "#dc2626" : "#1d4ed8" }}>
        <Truck size={15} />{th ? "จัดส่งแล้ว" : "Shipped"} · {carrierLabel(order.carrier, order.carrierName, th)}
      </p>
      {order.trackingNumber && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-muted)" }}>{th ? "เลขพัสดุ" : "Tracking no."}</span>
          <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, userSelect: "all", overflowWrap: "anywhere" }}>{order.trackingNumber}</span>
          <button onClick={copyNumber} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? (th ? "คัดลอกแล้ว" : "Copied") : (th ? "คัดลอก" : "Copy")}
          </button>
        </p>
      )}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => { void copyNumber(); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
          <ExternalLink size={14} />{th ? "ติดตามพัสดุ" : "Track parcel"}
        </a>
      )}
      {link && order.trackingNumber && !order.trackingUrl && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{th ? "ระบบคัดลอกเลขพัสดุให้แล้ว วางในหน้าติดตามของขนส่งได้เลย" : "The tracking number is copied for you — paste it on the carrier's page."}</p>
      )}

      {issue ? (
        <p style={{ color: "#dc2626", overflowWrap: "anywhere" }}>
          <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {th ? "คุณแจ้งปัญหาแล้ว: " : "You reported: "}{order.issueNote} — {th ? "ผู้ขายจะติดต่อกลับ" : "the seller will follow up."}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {th
            ? `ถ้าได้รับแล้วกด "ได้รับสินค้าแล้ว" — ถ้าไม่กด ระบบจะยืนยันให้อัตโนมัติในอีก ${daysUntilAutoConfirm(order.shippedAt ?? null)} วัน`
            : `Tap "I received it" when it arrives — otherwise it's confirmed automatically in ${daysUntilAutoConfirm(order.shippedAt ?? null)} day(s).`}
        </p>
      )}

      {reporting ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} maxLength={500} autoFocus placeholder={th ? "เกิดอะไรขึ้น? เช่น ยังไม่ได้รับของ / ของเสียหาย / ได้ของผิด" : "What happened? e.g. not arrived / damaged / wrong item"} style={{ ...customInputStyle, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setReporting(false); setError(null); }} disabled={busy} className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button onClick={() => act({ action: "report", note: problem.trim() })} disabled={busy || !problem.trim()} className="btn btn-primary" style={{ flex: 2, fontSize: 13, background: "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {busy && <Loader2 size={14} className="animate-spin" />}{th ? "ส่งเรื่องให้ผู้ขาย" : "Send to seller"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {nextFulfillmentStatus(state, "confirm") && (
            <button onClick={() => act({ action: "confirm" })} disabled={busy} className="btn btn-primary" style={{ fontSize: 13, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{th ? "ได้รับสินค้าแล้ว" : "I received it"}
            </button>
          )}
          {nextFulfillmentStatus(state, "report") && (
            <button onClick={() => setReporting(true)} disabled={busy} className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 14px", color: "#dc2626" }}>
              {th ? "แจ้งปัญหา" : "Report a problem"}
            </button>
          )}
        </div>
      )}
      {error && <p style={{ fontSize: 12, color: "#dc2626" }}>{error}</p>}
    </div>
  );
}

const STATUS_BADGE: Record<string, { th: string; en: string; bg: string; color: string; icon: React.ReactNode }> = {
  pending: { th: "รอตรวจสอบ", en: "Pending", bg: "rgba(245,158,11,0.12)", color: "#b45309", icon: <Clock size={13} /> },
  approved: { th: "อนุมัติแล้ว", en: "Approved", bg: "rgba(22,163,74,0.12)", color: "#15803d", icon: <CheckCircle2 size={13} /> },
  rejected: { th: "ถูกปฏิเสธ", en: "Rejected", bg: "rgba(239,68,68,0.12)", color: "#dc2626", icon: <XCircle size={13} /> },
};

const customInputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)",
};

const navBtn = (side: "left" | "right"): React.CSSProperties => ({
  position: "absolute", top: "50%", [side]: 8, transform: "translateY(-50%)",
  width: 34, height: 34, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.45)",
  color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
});

interface DropOption { value: string; label: string; hint?: string; disabled?: boolean; strike?: boolean }

// Themed dropdown used for the variant picker and custom select-fields. The menu
// is portaled to <body> so it never clips inside the modal's scroll container,
// and is anchored to its trigger with fixed positioning (flips up when there's
// little room below). Closes on outside-click, Escape, scroll, or resize.
function CustomSelect({ value, options, onChange, placeholder, ariaLabel }: {
  value: string; options: DropOption[]; onChange: (v: string) => void; placeholder: string; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Capture scrolls from any ancestor (the modal body scrolls) so the menu
    // never drifts away from its trigger — but DON'T close when the scroll comes
    // from inside the menu itself (a long option list scrolls internally).
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  const selected = options.find((o) => o.value === value);
  const MENU_MAX = 260;
  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
  const openUp = rect ? spaceBelow < 200 && rect.top > spaceBelow : false;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{ ...customInputStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "inherit" : "var(--text-muted)", fontWeight: selected ? 600 : 400 }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={18} style={{ flexShrink: 0, color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: "fixed", left: rect.left, width: rect.width, zIndex: 3000,
            ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
            maxHeight: MENU_MAX, overflowY: "auto", WebkitOverflowScrolling: "touch",
            background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(0,0,0,0.28)", padding: 4,
          }}
        >
          {options.map((o) => {
            const sel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={sel}
                disabled={o.disabled}
                onClick={() => { if (o.disabled) return; onChange(o.value); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "10px 12px", borderRadius: 8, border: "none",
                  background: sel ? "var(--accent-glow)" : "transparent",
                  color: o.disabled ? "var(--text-muted)" : "inherit",
                  cursor: o.disabled ? "not-allowed" : "pointer", textAlign: "left",
                  fontSize: 14, fontWeight: sel ? 700 : 500, fontFamily: "inherit", opacity: o.disabled ? 0.55 : 1,
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word", textDecoration: o.strike ? "line-through" : "none" }}>
                  {o.label}{o.hint ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {o.hint}</span> : null}
                </span>
                {sel && <Check size={16} style={{ flexShrink: 0, color: "var(--accent-primary)" }} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

// "Buy N for ฿X" promotion chips, shown on the product card and in the buy modal.
function BundleDealBadges({ deals, variants, th }: { deals: ShopBundleDeal[]; variants: Variant[]; th: boolean }) {
  // Name the options a scoped deal covers (e.g. "3 for ฿100 · Screen print").
  const scopeOf = (d: ShopBundleDeal) =>
    d.variantIds ? variants.filter((v) => d.variantIds!.includes(v.id)).map((v) => v.label).join(", ") : "";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {deals.map((d) => {
        const scope = scopeOf(d);
        return (
          <span key={`${d.variantIds?.join(",") ?? "*"}|${d.qty}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: "rgba(16,185,129,0.12)", color: "#059669", maxWidth: "100%", overflowWrap: "anywhere" }}>
            <Tag size={12} style={{ flexShrink: 0 }} />{th ? `${d.qty} ชิ้น ${baht(d.price)}` : `${d.qty} for ${baht(d.price)}`}{scope ? ` · ${scope}` : ""}
          </span>
        );
      })}
    </div>
  );
}
