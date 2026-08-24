"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { parseRichText } from "@/lib/rich-text";
import type { ShopCustomField, ShopCustomValue } from "@/lib/shop-custom-fields";
import { computeProductDeliveryFee, type ShopDeliveryTier } from "@/lib/shop-delivery";
import {
  ShoppingBag, X, ChevronLeft, ChevronRight, ChevronDown, Check, Upload, Loader2, CheckCircle2,
  Clock, XCircle, Package, Minus, Plus, ReceiptText,
} from "lucide-react";

interface Variant { id: string; label: string; remaining: number | null; allowCustom?: boolean; priceDelta?: number }
interface Product {
  id: string; name: string; description: string; price: number;
  imageUrls: string[]; maxPerOrder: number | null; variants: Variant[];
  opensAt?: string | null; closesAt?: string | null; saleStatus?: "open" | "upcoming" | "closed";
  customFields?: ShopCustomField[];
  deliveryFee?: number | null; deliveryTiers?: ShopDeliveryTier[];
}
interface ShopData {
  enabled: boolean; paymentInfo: string; qrImageUrl: string | null;
  deliveryEnabled?: boolean; deliveryFee?: number; pickupInfo?: string;
  products: Product[];
}
interface OrderItem { productName: string; variantLabel: string; customValues?: ShopCustomValue[] | null; unitPrice: number; quantity: number }
interface Order {
  id: string; status: string; totalAmount: number; note: string | null;
  rejectionReason: string | null; hasSlip: boolean; createdAt: string; items: OrderItem[];
  fulfillment?: string; shippingFee?: number;
  recipientName?: string | null; recipientPhone?: string | null; shippingAddress?: string | null;
}

const baht = (n: number) => `฿${n.toLocaleString()}`;

export default function ShopClient() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [data, setData] = useState<ShopData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"shop" | "orders">("shop");
  const [active, setActive] = useState<Product | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, o] = await Promise.all([
      fetch("/api/shop").then((r) => r.json()).catch(() => null),
      fetch("/api/shop/orders").then((r) => r.json()).catch(() => []),
    ]);
    if (s && Array.isArray(s.products)) setData(s);
    if (Array.isArray(o)) setOrders(o);
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
          <OrdersList orders={orders} th={th} />
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
        <p style={{ fontWeight: 800, fontSize: 16, color: "var(--accent-primary)", marginTop: "auto" }}>{baht(product.price)}</p>
      </div>
    </div>
  );
}

function ProductModal({ product, settings, th, onClose, onOrdered }: {
  product: Product; settings: ShopData; th: boolean; onClose: () => void; onOrdered: () => void;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  const [variantId, setVariantId] = useState<string>(() => {
    const firstAvailable = product.variants.find((v) => v.remaining == null || v.remaining > 0);
    return firstAvailable?.id ?? product.variants[0]?.id ?? "";
  });
  const [qtyRaw, setQty] = useState(1);
  const [customValue, setCustomValue] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"select" | "pay">("select");
  const [slipPath, setSlipPath] = useState<string | null>(null);
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

  const variant = product.variants.find((v) => v.id === variantId);
  const customFields = product.customFields ?? [];
  const missingRequiredCustom = customFields.some((f) => f.required && !(customAnswers[f.key] ?? "").trim());
  const remaining = variant?.remaining ?? null;
  // Plain computation — cheap enough that memoization isn't worth it, and the
  // React Compiler couldn't preserve the manual memo (deps derived from find()).
  const maxQtyCaps = [99];
  if (remaining != null) maxQtyCaps.push(remaining);
  if (product.maxPerOrder != null) maxQtyCaps.push(product.maxPerOrder);
  const maxQty = Math.max(1, Math.min(...maxQtyCaps));

  // Clamp at render instead of in an effect: variant changes can shrink maxQty.
  const qty = Math.min(qtyRaw, maxQty);
  // Unit price = base price + the selected variant's surcharge (e.g. a special
  // size). Mirrors the server's authoritative computation in /api/shop/orders.
  const unitPrice = product.price + (variant?.priceDelta ?? 0);
  const subtotal = unitPrice * qty;
  // Per-product delivery fee for the current quantity (tiers can raise it as qty
  // grows). Mirrors the server's authoritative computeProductDeliveryFee. The
  // fee at qty=1 powers the "Delivery (+฿X)" hint on the chooser.
  const shopWideFee = settings.deliveryFee ?? 0;
  const deliveryFee = fulfillment === "delivery" ? computeProductDeliveryFee(product, qty, shopWideFee) : 0;
  const deliveryFeeFrom = computeProductDeliveryFee(product, 1, shopWideFee);
  const total = subtotal + deliveryFee;
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
      const upload = await compressImageFile(file);
      const fd = new FormData();
      fd.append("file", upload);
      const res = await fetch("/api/shop/slip", { method: "POST", body: fd });
      // A proxy-level rejection (e.g. 413) returns an HTML body, not JSON, so
      // guard the parse and surface a useful, size-aware message instead of a
      // cryptic JSON error.
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(th ? "ไฟล์รูปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง" : "Image is too large. Please choose a smaller photo.");
        }
        throw new Error(d?.error || (th ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again."));
      }
      setSlipPath(d.path);
      setSlipPreview(URL.createObjectURL(file));
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
          items: [{ variantId, quantity: qty, customValue: variant?.allowCustom ? customValue.trim() : undefined, custom: customFields.length ? customAnswers : undefined }],
          slipPath, note: note || undefined,
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
                {baht(unitPrice)}
                {variant?.priceDelta ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginLeft: 6 }}>{baht(product.price)} +{baht(variant.priceDelta)}</span> : null}
              </p>

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

              {/* Variant picker */}
              {product.variants.length > 1 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "ตัวเลือก / ไซส์" : "Option / Size"}</label>
                  <CustomSelect
                    ariaLabel={th ? "ตัวเลือก / ไซส์" : "Option / Size"}
                    value={variantId}
                    placeholder={th ? "— เลือกตัวเลือก —" : "— Select an option —"}
                    onChange={(id) => { setVariantId(id); setCustomValue(""); }}
                    options={product.variants.map((v) => {
                      const out = v.remaining != null && v.remaining <= 0;
                      // Surcharge shown inline on the option (e.g. "XXL  +฿50") so the
                      // buyer sees the price difference before selecting.
                      return {
                        value: v.id,
                        label: v.priceDelta ? `${v.label}  +${baht(v.priceDelta)}` : v.label,
                        hint: v.remaining != null ? (out ? (th ? "หมด" : "Sold out") : (th ? `เหลือ ${v.remaining}` : `${v.remaining} left`)) : undefined,
                        disabled: out,
                        strike: out,
                      };
                    })}
                  />
                </div>
              )}

              {/* Custom value for an "Other (specify)" option */}
              {variant?.allowCustom && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "ระบุรายละเอียด *" : "Please specify *"}</label>
                  <input
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    maxLength={120}
                    placeholder={th ? "พิมพ์รายละเอียดที่ต้องการ เช่น ไซส์/สีที่ต้องการ" : "Type your request, e.g. desired size/colour"}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)" }}
                  />
                </div>
              )}

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

              {/* Quantity */}
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "จำนวน" : "Quantity"}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="btn btn-ghost" style={{ padding: 8 }}><Minus size={16} /></button>
                  <span style={{ fontWeight: 800, fontSize: 18, minWidth: 32, textAlign: "center" }}>{qty}</span>
                  <button onClick={() => setQty(Math.min(maxQty, qty + 1))} disabled={qty >= maxQty} className="btn btn-ghost" style={{ padding: 8 }}><Plus size={16} /></button>
                  {product.maxPerOrder != null && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{th ? `จำกัด ${product.maxPerOrder} ชิ้น/คน` : `Max ${product.maxPerOrder} per person`}</span>
                  )}
                </div>
              </div>

              {error && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{error}</p>}

              <button onClick={() => setStep("pay")} disabled={!variant || (remaining != null && remaining <= 0) || (!!variant?.allowCustom && !customValue.trim()) || missingRequiredCustom || !!notOpen} className="btn btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "space-between", display: "flex" }}>
                <span>{notOpen ? (product.saleStatus === "upcoming" ? (th ? "ยังไม่เปิดขาย" : "Not on sale yet") : (th ? "ปิดการขาย" : "Sales closed")) : (th ? "ดำเนินการต่อ" : "Continue")}</span>
                {!notOpen && <span>{baht(total)}</span>}
              </button>
            </>
          ) : (
            <>
              {/* Order summary */}
              <div style={{ background: "var(--bg-base)", borderRadius: "var(--radius-md)", padding: 14, marginBottom: 16, border: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, marginBottom: 4 }}>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{product.name}{variant && product.variants.length > 1 ? ` · ${variant.label}` : ""} × {qty}</span>
                  <span style={{ fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>{baht(subtotal)}</span>
                </div>
                {customFields.filter((f) => (customAnswers[f.key] ?? "").trim()).map((f) => (
                  <div key={f.key} style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>{f.label}: <strong style={{ color: "var(--text-secondary)" }}>{customAnswers[f.key]}</strong></div>
                ))}
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
                    const disabled = opt === "delivery" && !settings.deliveryEnabled;
                    const sel = fulfillment === opt;
                    return (
                      <button key={opt} disabled={disabled} onClick={() => setFulfillment(opt)}
                        style={{ flex: 1, padding: "10px 12px", borderRadius: "var(--radius-md)", border: `2px solid ${sel ? "var(--accent-primary)" : "var(--border-subtle)"}`, background: sel ? "var(--accent-glow)" : "var(--bg-base)", fontWeight: 700, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}>
                        {opt === "pickup" ? (th ? "รับเอง" : "Self-pickup") : (th ? `จัดส่ง${deliveryFeeFrom ? ` (+${baht(deliveryFeeFrom)})` : ""}` : `Delivery${deliveryFeeFrom ? ` (+${baht(deliveryFeeFrom)})` : ""}`)}
                      </button>
                    );
                  })}
                </div>
                {fulfillment === "pickup" && (settings.pickupInfo ?? "").trim() !== "" && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "8px 12px", borderRadius: "var(--radius-md)", lineHeight: 1.6, overflowWrap: "anywhere", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: parseRichText(settings.pickupInfo ?? "") }} />
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
                {settings.qrImageUrl && (
                  <img src={settings.qrImageUrl} alt="Payment QR" style={{ width: "100%", maxWidth: 320, aspectRatio: "1 / 1", objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", display: "block", margin: "0 auto 12px", background: "#fff" }} />
                )}
                {settings.paymentInfo.trim() !== "" && (
                  <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, textAlign: "center", overflowWrap: "anywhere", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: parseRichText(settings.paymentInfo) }} />
                )}
              </div>

              {/* Slip upload */}
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{th ? "แนบสลิปการโอนเงิน *" : "Upload payment slip *"}</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlip(f); }} />
              {slipPreview ? (
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <img src={slipPreview} alt="slip" style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-base)" }} />
                  <button onClick={() => { setSlipPath(null); setSlipPreview(null); fileRef.current && (fileRef.current.value = ""); }} className="btn btn-ghost" style={{ position: "absolute", top: 8, right: 8, padding: 6, background: "var(--bg-surface)" }}><X size={16} /></button>
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

function OrdersList({ orders, th }: { orders: Order[]; th: boolean }) {
  if (orders.length === 0) {
    return <EmptyState icon={<ReceiptText size={40} />} text={th ? "ยังไม่มีคำสั่งซื้อ" : "No orders yet."} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {orders.map((o) => <OrderRow key={o.id} order={o} th={th} />)}
    </div>
  );
}

function OrderRow({ order, th }: { order: Order; th: boolean }) {
  const [showSlip, setShowSlip] = useState(false);
  const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE.pending;
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          {order.items.map((i, idx) => (
            <div key={idx}>
              <p style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere", wordBreak: "break-word" }}>{i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}</p>
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
        <span style={{ fontWeight: 800, fontSize: 16 }}>{baht(order.totalAmount)}</span>
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
