"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { ShopCustomFieldType } from "@/lib/shop/shop-custom-fields";
import { normalizeTiers } from "@/lib/shop/shop-delivery";
import { findBundleScopeConflict } from "@/lib/shop/shop-promotions";
import { Package, ReceiptText, Plus, Trash2, Pencil, Upload, Loader2, X, CheckCircle2, XCircle, Clock, GripVertical, Save, Download, Truck, Users, Tag, HeartHandshake } from "lucide-react";
import { baht, adminPriceLabel, ownerLabel, PAGE_SIZE, isAudienceLimited, type AdminVariant, type AdminProduct, type OwnerOptions, type ShopContext, type FieldDraft, type TierDraft, type DealDraft, type VariantDraft, newVariantKey, ALL_ROLES, ROLE_LABELS, ALL_MAJORS, toLocalInput, uploadImage, exportProductXlsx } from "./shop-model";
import { Field, SectionDivider, Spinner, Pagination, Chip, inputStyle, ownerChip } from "./ui";

export function ProductsTab({ th, ctx }: { th: boolean; ctx: ShopContext | null }) {
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
  const [approvalFilter, setApprovalFilter] = useState<"all" | "pending">("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const exportProduct = async (p: AdminProduct) => {
    setExportingId(p.id);
    try {
      await exportProductXlsx(p);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExportingId(null);
    }
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

  const reviewProduct = async (p: AdminProduct, action: "approve" | "reject") => {
    const reason = action === "reject"
      ? prompt(th ? "เหตุผลที่ปฏิเสธ (ผู้ขายจะเห็น)" : "Rejection reason (shown to seller)")
      : undefined;
    if (action === "reject" && !reason?.trim()) return;
    setReviewingId(p.id);
    try {
      const res = await fetch(`/api/admin/shop/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason?.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Review failed");
      }
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Review failed");
    } finally {
      setReviewingId(null);
    }
  };

  // Page the list (10/page). Clamp to a derived page so deleting the last row on the
  // final page falls back to a valid page instead of showing an empty one.
  const visibleProducts = approvalFilter === "pending" ? products.filter((p) => p.approvalStatus === "pending") : products;
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageProducts = visibleProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <Spinner />;
  if (loadError) return (
    <p style={{ color: "var(--red-500)", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {th ? "โหลดสินค้าไม่สำเร็จ" : "Couldn't load products."}
      <button onClick={() => { setLoading(true); load(); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "4px 10px" }}>{th ? "ลองอีกครั้ง" : "Retry"}</button>
    </p>
  );

  return (
    <div>
      <button
        onClick={() => setEditing("new")}
        disabled={!ctx || Boolean(ctx.scoped && ctx.seller?.status !== "approved")}
        className="btn btn-primary"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 20 }}
      >
        <Plus size={18} />{th ? "เพิ่มสินค้า" : "New product"}
      </button>

      {ctx?.canReviewMarketplace && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => { setApprovalFilter("all"); setPage(1); }} className={approvalFilter === "all" ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 12px" }}>
            {th ? "สินค้าทั้งหมด" : "All products"} ({products.length})
          </button>
          <button onClick={() => { setApprovalFilter("pending"); setPage(1); }} className={approvalFilter === "pending" ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 12px" }}>
            {th ? "รออนุมัติ" : "Pending approval"} ({products.filter((p) => p.approvalStatus === "pending").length})
          </button>
        </div>
      )}

      {visibleProducts.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ยังไม่มีสินค้า" : "No products yet."}</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {pageProducts.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 14, alignItems: "center", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 14 }}>
              <div style={{ width: 60, height: 60, borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", overflow: "hidden", flexShrink: 0 }}>
                {p.imageUrls[0] ? <img src={p.imageUrls[0]} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}><Package size={20} /></div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 15, overflowWrap: "anywhere", wordBreak: "break-word" }}>{p.name} {!p.isActive && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>({th ? "ซ่อน" : "hidden"})</span>}{isAudienceLimited(p) && <span title={th ? "จำกัดผู้เห็น (บทบาท/สาขา/นักศึกษา)" : "Limited audience (roles/majors/students)"} style={{ fontSize: 11, color: "var(--accent-primary)", fontWeight: 700 }}> · {th ? "จำกัดผู้เห็น" : "limited"}</span>}<span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}> · {p.sellerName || ownerLabel(p, ownerOptions, th)}</span></p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {adminPriceLabel(p)}{p.welfarePrice != null && (p.welfareRoles?.length ?? 0) > 0 ? ` · ${th ? "สวัสดิการ" : "welfare"} ${baht(p.welfarePrice)} (${p.welfareRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")})` : ""}{(p.bundleDeals ?? []).map((d) => ` · ${th ? `${d.qty} ชิ้น ${baht(d.price)}` : `${d.qty} for ${baht(d.price)}`}${d.variantIds ? ` (${p.variants.filter((v) => v.id && d.variantIds!.includes(v.id)).map((v) => v.label).join(", ")})` : ""}`).join("")} · {p.variants.map((v) => `${v.label}${v.stock != null ? ` ${Math.max(0, v.stock - (v.sold ?? 0))}/${v.stock}` : ""}`).join(", ")}
                  {p.maxPerOrder != null ? ` · ${th ? "จำกัด" : "max"} ${p.maxPerOrder}/${th ? "คน" : "person"}` : ""}
                </p>
                {(p.sellerId || p.approvalStatus !== "approved") && (
                  <p style={{ fontSize: 12, marginTop: 3, color: p.approvalStatus === "approved" ? "var(--green-700)" : p.approvalStatus === "rejected" ? "var(--red-600)" : "var(--amber-700)", fontWeight: 700 }}>
                    {p.approvalStatus === "approved" ? (th ? "อนุมัติแล้ว" : "Approved") : p.approvalStatus === "rejected" ? (th ? "ถูกปฏิเสธ" : "Rejected") : (th ? "รออนุมัติ" : "Pending approval")}
                    {p.approvalReason ? ` · ${p.approvalReason}` : ""}
                  </p>
                )}
                {(p.opensAt || p.closesAt) && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} style={{ flexShrink: 0 }} /> {p.opensAt ? new Date(p.opensAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "เปิดอยู่" : "now")} → {p.closesAt ? new Date(p.closesAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "ไม่กำหนด" : "open-ended")}
                  </p>
                )}
              </div>
              {ctx?.canReviewMarketplace && p.approvalStatus !== "approved" && (p.sellerId || ctx.canApproveCentral) && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => reviewProduct(p, "reject")} disabled={reviewingId === p.id} className="btn btn-ghost" style={{ padding: 8, color: "var(--red-600)" }} title={th ? "ปฏิเสธ" : "Reject"} aria-label={th ? `ปฏิเสธ ${p.name}` : `Reject ${p.name}`}><XCircle size={16} /></button>
                  <button onClick={() => reviewProduct(p, "approve")} disabled={reviewingId === p.id} className="btn btn-ghost" style={{ padding: 8, color: "var(--green-700)" }} title={th ? "อนุมัติ" : "Approve"} aria-label={th ? `อนุมัติ ${p.name}` : `Approve ${p.name}`}>{reviewingId === p.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}</button>
                </div>
              )}
              <Link href={`/admin/shop/${p.id}`} className="btn btn-ghost" style={{ padding: "8px 10px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }} title={th ? "ดูคำสั่งซื้อ/สลิปของสินค้านี้" : "View this product's orders & slips"}>
                <ReceiptText size={16} />{th ? "คำสั่งซื้อ" : "Orders"}
              </Link>
              <button onClick={() => exportProduct(p)} disabled={exportingId === p.id} className="btn btn-ghost" style={{ padding: 8 }} title={th ? "ส่งออกคำสั่งซื้อเป็น .xlsx" : "Export orders to .xlsx"}>
                {exportingId === p.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              </button>
              <button onClick={() => setEditing(p)} className="btn btn-ghost" style={{ padding: 8 }}><Pencil size={16} /></button>
              {ctx?.canDeleteProducts && (
                <button onClick={() => remove(p)} className="btn btn-ghost" style={{ padding: 8, color: "var(--red-500)" }} title={th ? "ลบ" : "Delete"} aria-label={th ? `ลบ ${p.name}` : `Delete ${p.name}`}><Trash2 size={16} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination th={th} page={safePage} total={visibleProducts.length} onPage={setPage} />

      {editing && (
        <ProductForm
          th={th}
          product={editing === "new" ? null : editing}
          ownerOptions={ownerOptions}
          scoped={ctx?.scoped ?? false}
          requiresOwner={ctx?.requiresOwner ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

export function ProductForm({ th, product, ownerOptions, scoped, requiresOwner, onClose, onSaved }: { th: boolean; product: AdminProduct | null; ownerOptions: OwnerOptions | null; scoped: boolean; requiresOwner: boolean; onClose: () => void; onSaved: () => void }) {
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
  const [bundleDeals, setBundleDeals] = useState<DealDraft[]>(
    (product?.bundleDeals ?? []).map((d) => ({ qty: String(d.qty), price: String(d.price), keys: d.variantIds ?? null }))
  );
  const [welfarePrice, setWelfarePrice] = useState<string>(product?.welfarePrice != null ? String(product.welfarePrice) : "");
  const [welfareRoles, setWelfareRoles] = useState<string[]>(product?.welfareRoles ?? []);
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants?.length
      ? product.variants.map((v) => ({ ...v, key: v.id ?? newVariantKey() }))
      : [{ key: newVariantKey(), label: "Standard", stock: null, allowCustom: false, priceDelta: 0 }]
  );
  // Product ownership (admin-side scoping). For a NEW product a scoped president
  // defaults to owning it with every club/major they lead; a full admin starts
  // blank (central).
  const [ownerClubIds, setOwnerClubIds] = useState<string[]>(
    product?.ownerClubIds ?? (requiresOwner ? (ownerOptions?.clubs.map((c) => c.id) ?? []) : [])
  );
  const [ownerMajors, setOwnerMajors] = useState<string[]>(
    product?.ownerMajors ?? (requiresOwner ? (ownerOptions?.majors ?? []) : [])
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

  // A promotion's option keys that still exist (a row may have been deleted).
  const liveKeys = (keys: string[]) => keys.filter((k) => variants.some((v) => v.key === k));
  const optionPrice = (v: AdminVariant) => (Math.round(price) || 0) + Math.max(0, Math.round(Number(v.priceDelta) || 0));
  const labelOf = (k: string) => variants.find((v) => v.key === k)?.label.trim() || "?";
  const setVariant = (i: number, patch: Partial<AdminVariant>) => setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError(th ? "กรุณากรอกชื่อสินค้า" : "Product name is required"); return; }
    if (variants.length === 0 || variants.some((v) => !v.label.trim())) { setError(th ? "ทุกตัวเลือกต้องมีชื่อ" : "Every option needs a label"); return; }
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) { setError(th ? "เวลาปิดต้องอยู่หลังเวลาเปิด" : "Close time must be after open time"); return; }
    if (customFields.some((f) => !f.label.trim())) { setError(th ? "ช่องกรอกเองทุกช่องต้องมีชื่อ" : "Every custom field needs a label"); return; }
    if (customFields.some((f) => f.type === "select" && f.options.filter((o) => o.trim()).length === 0)) { setError(th ? "ช่องแบบตัวเลือกต้องมีอย่างน้อย 1 ตัวเลือก" : "A select field needs at least one option"); return; }
    if (customFields.some((f) => f.type === "select" && f.options.some((o) => o.trim().length > 1000))) { setError(th ? "แต่ละตัวเลือกต้องไม่เกิน 1000 ตัวอักษร" : "Each option must be 1000 characters or fewer"); return; }
    if (bundleDeals.some((d) => d.qty.trim() !== "" && Math.round(Number(d.qty)) < 2)) { setError(th ? "โปรโมชันต้องมีจำนวนอย่างน้อย 2 ชิ้น" : "A promotion needs a quantity of at least 2"); return; }
    const filledDealRows = bundleDeals.filter((d) => d.qty.trim() !== "" && d.price.trim() !== "");
    if (filledDealRows.some((d) => d.keys && liveKeys(d.keys).length === 0)) { setError(th ? "เลือกตัวเลือกที่ร่วมโปรโมชันอย่างน้อย 1 อย่าง" : "Pick at least one option for each promotion"); return; }
    if (findBundleScopeConflict(filledDealRows.map((d) => ({ variantIds: d.keys ? liveKeys(d.keys) : undefined })), variants.map((v) => v.key))) {
      setError(th ? "โปรโมชันแต่ละอันต้องใช้กับตัวเลือกชุดเดียวกันทั้งหมด หรือแยกกันคนละตัวเลือกเลย (เช่น \"ทุกตัวเลือก\" คู่กับ \"เฉพาะสกรีน\" ไม่ได้)" : "Promotions must cover exactly the same options or completely different ones (e.g. not \"all options\" plus \"only Screen print\").");
      return;
    }
    const welfareNum = welfarePrice.trim() === "" ? null : Math.max(0, Math.round(Number(welfarePrice) || 0));
    if (welfareNum != null && welfareRoles.length === 0) { setError(th ? "เลือกบทบาทที่ได้รับสวัสดิการ หรือเว้นราคาสวัสดิการว่าง" : "Pick the roles that get the welfare price, or leave its price blank"); return; }
    if (welfareNum != null && welfareNum >= (Math.round(price) || 0)) { setError(th ? "ราคาสวัสดิการต้องต่ำกว่าราคาปกติ" : "The welfare price must be lower than the normal price"); return; }
    if (requiresOwner && ownerClubIds.length === 0 && ownerMajors.length === 0) { setError(th ? "เลือกชมรมหรือสาขาที่เป็นเจ้าของสินค้านี้" : "Pick the club or major that owns this product"); return; }
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
        // Bundle promotions: drop incomplete rows. Options are sent as indexes into
        // the variants array below (new options have no id yet); the server maps
        // them to ids, dedupes and sorts.
        bundleDeals: filledDealRows.map((d) => ({
          qty: Math.round(Number(d.qty) || 0),
          price: Math.max(0, Math.round(Number(d.price) || 0)),
          ...(d.keys ? { variantIndexes: liveKeys(d.keys).map((k) => variants.findIndex((v) => v.key === k)) } : {}),
        })),
        // Welfare: blank price or no roles = off. Only the chosen roles get it.
        welfarePrice: welfareNum,
        welfareRoles: welfareNum != null ? welfareRoles : [],
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
  const filledDeals = bundleDeals.filter((d) => d.qty.trim() !== "" && d.price.trim() !== "");
  const promoSummary = filledDeals.length === 0
    ? (th ? "ไม่มี" : "None")
    : filledDeals.map((d) => (th ? `${d.qty} ชิ้น ${baht(Number(d.price) || 0)}` : `${d.qty} for ${baht(Number(d.price) || 0)}`) + (d.keys && liveKeys(d.keys).length ? ` (${liveKeys(d.keys).map(labelOf).join(", ")})` : "")).join(" · ");
  const filledFields = customFields.filter((f) => f.label.trim()).length;
  const fieldsSummary = filledFields === 0 ? (th ? "ไม่มี" : "None") : `${filledFields} ${th ? "ช่อง" : filledFields === 1 ? "field" : "fields"}`;
  const welfareSummary = welfarePrice.trim() === "" || welfareRoles.length === 0
    ? (th ? "ไม่มี" : "None")
    : `${baht(Math.max(0, Math.round(Number(welfarePrice) || 0)))} · ${welfareRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`;
  const audienceLimited = allowedRoles.length > 0 || allowedMajors.length > 0 || !targetThai || !targetInternational;
  const audienceSummary = audienceLimited ? (th ? "จำกัดผู้เห็น" : "Limited") : (th ? "ทุกคน" : "Everyone");

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgb(var(--scrim-rgb) / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
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
          {ownerOptions && (!scoped || requiresOwner) && (
            <Field
              label={th ? "ผู้ดูแลสินค้า (ชมรม/สาขา)" : "Managed by (club / major)"}
              required={requiresOwner}
              hint={requiresOwner
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
                      style={ownerChip(on, "var(--amber-500)")}
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
                      style={ownerChip(on, "var(--cyan-500)")}
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
                  <button onClick={() => setImageUrls((prev) => prev.filter((u) => u !== url))} style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>
                  {i !== 0 && <button onClick={() => setImageUrls((prev) => { const a = [...prev]; const [m] = a.splice(i, 1); a.unshift(m); return a; })} title={th ? "ตั้งเป็นหน้าปก" : "Make cover"} style={{ position: "absolute", bottom: 2, left: 2, fontSize: 9, padding: "1px 4px", border: "none", borderRadius: 4, background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", cursor: "pointer" }}>★</button>}
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
          <Field label={th ? "ตัวเลือก / ไซส์" : "Options / sizes"} required hint={th ? "สต็อกเว้นว่าง = ไม่จำกัด · +฿ = บวกเพิ่มจากราคา (เช่น ไซส์พิเศษ) · ถ้าแต่ละแบบราคาต่างกัน ให้ใส่ราคาของแบบที่ถูกที่สุดเป็นราคาสินค้า แล้วบวกเพิ่มเฉพาะแบบที่แพงกว่า" : "Blank stock = unlimited · +฿ = surcharge on top of price (e.g. special size) · If options cost different amounts, use the cheapest option as the price and add a surcharge to the pricier ones"}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {variants.map((v, i) => (
                <div key={v.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <GripVertical size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <input value={v.label} onChange={(e) => setVariant(i, { label: e.target.value })} placeholder={v.allowCustom ? (th ? "ชื่อ เช่น อื่นๆ" : "Label e.g. Other") : (th ? "ชื่อ เช่น S, M, L" : "Label e.g. S, M, L")} style={{ ...inputStyle, flex: 2, minWidth: 120 }} />
                  <input type="number" min={0} value={v.stock ?? ""} onChange={(e) => setVariant(i, { stock: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} placeholder={th ? "สต็อก" : "Stock"} style={{ ...inputStyle, flex: 1, minWidth: 80 }} />
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 110 }} title={th ? "บวกเพิ่มจากราคาสินค้า เช่น ไซส์พิเศษ (0 = ไม่บวกเพิ่ม)" : "Added on top of the base price, e.g. a special size (0 = no surcharge)"}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>+฿</span>
                    <input type="number" min={0} value={v.priceDelta ?? ""} onChange={(e) => setVariant(i, { priceDelta: e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))) })} placeholder={th ? "เพิ่มราคา" : "Surcharge"} style={{ ...inputStyle, width: "100%" }} />
                    {/* Final price the buyer pays for this option (price + surcharge). */}
                    <span title={th ? "ราคาที่ผู้ซื้อจ่ายต่อชิ้น" : "What the buyer pays per unit"} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", whiteSpace: "nowrap" }}>= {baht(optionPrice(v))}</span>
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }} title={th ? "ให้ผู้ซื้อพิมพ์รายละเอียดเอง" : "Buyer types their own value"}>
                    <input type="checkbox" checked={!!v.allowCustom} onChange={(e) => setVariant(i, { allowCustom: e.target.checked })} />
                    {th ? "ระบุเอง" : "Other"}
                  </label>
                  {variants.length > 1 && <button onClick={() => setVariants((vs) => vs.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "var(--red-500)" }}><Trash2 size={15} /></button>}
                </div>
              ))}
              <button onClick={() => setVariants((vs) => [...vs, { key: newVariantKey(), label: "", stock: null, allowCustom: false, priceDelta: 0 }])} className="btn btn-ghost" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
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

          {/* Bundle promotions — "buy N for ฿X" (e.g. 3 for ฿100). Counted per
              product across all its options in one order; the buyer automatically
              gets the cheapest mix. Surcharges (+฿ on an option) still apply. */}
          <SectionDivider icon={<Tag size={15} />} title={th ? "โปรโมชัน (ซื้อหลายชิ้นราคาพิเศษ)" : "Promotion (multi-buy price)"} summary={promoSummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bundleDeals.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bundleDeals.map((d, i) => {
                  const setDeal = (patch: Partial<DealDraft>) => setBundleDeals((ds) => ds.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
                  const q = Math.round(Number(d.qty));
                  const dp = Math.round(Number(d.price));
                  // Mirrors computeBundleDiscount: the deal replaces the price of the
                  // cheapest option it covers; pricier options pay their difference.
                  const scoped = d.keys ? variants.filter((v) => d.keys!.includes(v.key)) : variants;
                  const ref = scoped.length ? Math.min(...scoped.map(optionPrice)) : 0;
                  const full = q >= 2 ? q * ref : 0;
                  const saving = d.price.trim() !== "" && full > dp ? full - dp : 0;
                  const toggleKey = (k: string) => {
                    const cur = d.keys ? liveKeys(d.keys) : [];
                    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
                    // Nothing (or everything) picked means "all options".
                    setDeal({ keys: next.length === 0 || next.length === variants.length ? null : next });
                  };
                  const chip = (active: boolean): React.CSSProperties => ({
                    fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
                    border: `1px solid ${active ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    background: active ? "var(--accent-primary)" : "var(--bg-base)", color: active ? "var(--text-on-color)" : "var(--text-secondary)",
                  });
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 10, background: "var(--bg-base)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ซื้อ" : "Buy"}</span>
                      <input type="number" min={2} value={d.qty} onChange={(e) => setDeal({ qty: e.target.value })} placeholder={th ? "จำนวน" : "qty"} style={{ ...inputStyle, width: 90 }} />
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ชิ้น ในราคา ฿" : "for ฿"}</span>
                      <input type="number" min={0} value={d.price} onChange={(e) => setDeal({ price: e.target.value })} placeholder={th ? "ราคารวม" : "total"} style={{ ...inputStyle, width: 110 }} />
                      {saving > 0 && (
                        <span style={{ fontSize: 12, color: "var(--emerald-500)", fontWeight: 600 }}>{th ? `ประหยัด ${baht(saving)}` : `saves ${baht(saving)}`}</span>
                      )}
                      <button onClick={() => setBundleDeals((ds) => ds.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "var(--red-500)" }}><Trash2 size={15} /></button>
                    </div>
                    {variants.length > 1 && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 2 }}>{th ? "ใช้กับ:" : "Applies to:"}</span>
                        <button type="button" onClick={() => setDeal({ keys: null })} aria-pressed={!d.keys} style={chip(!d.keys)}>{th ? "ทุกตัวเลือก" : "All options"}</button>
                        {variants.map((v) => {
                          const on = !!d.keys && d.keys.includes(v.key);
                          return (
                            <button key={v.key} type="button" onClick={() => toggleKey(v.key)} aria-pressed={on} style={chip(on)}>
                              {v.label.trim() || (th ? "(ไม่มีชื่อ)" : "(unnamed)")}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => setBundleDeals((ds) => [...ds, { qty: "", price: "", keys: null }])} className="btn btn-ghost" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <Plus size={15} />{th ? "เพิ่มโปรโมชัน" : "Add promotion"}
            </button>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th
                ? "เช่น ซื้อ 3 ชิ้น ฿100 นับรวมทุกตัวเลือกที่ร่วมโปรในออร์เดอร์เดียว และระบบเลือกราคาที่ถูกที่สุดให้อัตโนมัติ (ชิ้นที่เกินคิดราคาปกติ) เลือก \"ใช้กับ\" เพื่อจำกัดโปรไว้เฉพาะบางแบบได้ เช่น เฉพาะสกรีน ไม่รวมปัก ถ้าแบบที่ร่วมโปรราคาไม่เท่ากัน ราคาโปรจะอิงแบบที่ถูกที่สุด และแบบที่แพงกว่าจ่ายส่วนต่างเพิ่ม"
                : "e.g. Buy 3 for ฿100 counts every eligible option in one order, and the buyer automatically gets the cheapest combination (leftover units at the normal price). Use \"Applies to\" to limit a deal to certain options, e.g. screen print but not embroidery. If eligible options cost different amounts, the deal is priced off the cheapest one and pricier options pay the difference."}
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
                      <button onClick={() => setDeliveryTiers((ts) => ts.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "var(--red-500)" }}><Trash2 size={15} /></button>
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
                    <button onClick={() => setCustomFields((fs) => fs.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: 6, color: "var(--red-500)" }}><Trash2 size={15} /></button>
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

          {/* Welfare pricing (สวัสดิการ) — an at-cost price for chosen roles only. The
              storefront sends the welfare price to those buyers alone. */}
          <SectionDivider icon={<HeartHandshake size={15} />} title={th ? "สวัสดิการ (ราคาพิเศษเฉพาะบทบาท)" : "Welfare price (for chosen roles)"} summary={welfareSummary} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={th ? "ราคาสวัสดิการ (฿)" : "Welfare price (฿)"} hint={th ? "เว้นว่าง = ไม่มีสวัสดิการ · ต้องต่ำกว่าราคาปกติ" : "Blank = no welfare · must be lower than the normal price"}>
              <input type="number" min={0} value={welfarePrice} onChange={(e) => setWelfarePrice(e.target.value)} placeholder={th ? "เช่น ราคาต้นทุน" : "e.g. at-cost price"} style={{ ...inputStyle, width: 220 }} />
            </Field>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{th ? "บทบาทที่ได้รับสวัสดิการ" : "Roles that get the welfare price"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ALL_ROLES.map((r) => (
                  <Chip key={r} selected={welfareRoles.includes(r)} onClick={() => setWelfareRoles((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r])}>
                    {ROLE_LABELS[r] ?? r}
                  </Chip>
                ))}
              </div>
            </div>
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
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: isActive ? "var(--green-700)" : "var(--text-muted)" }}>{isActive ? (th ? "กำลังแสดง" : "Live") : (th ? "ซ่อนอยู่" : "Hidden")}</span>
          </label>
        </div>

        {/* Sticky footer actions */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <p style={{ color: "var(--red-500)", fontSize: 13, margin: 0 }}>{error}</p>}
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
