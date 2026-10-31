"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { ShopCustomFieldType } from "@/lib/shop/shop-custom-fields";
import { normalizeTiers } from "@/lib/shop/shop-delivery";
import { findBundleScopeConflict } from "@/lib/shop/shop-promotions";
import { Package, ReceiptText, Plus, Trash2, Pencil, Upload, Loader2, X, CheckCircle2, XCircle, Clock, Save, Download, Truck, Users, Tag, HeartHandshake, EyeOff, Star } from "lucide-react";
import { EmptyState, ErrorState, IconButton, InlineAlert, LoadingState, Modal, StatusBadge, useConfirm, useToast } from "@/components/admin/ui";
import { baht, adminPriceLabel, adminWelfareLabel, ownerLabel, PAGE_SIZE, isAudienceLimited, type AdminVariant, type AdminProduct, type OwnerOptions, type ShopContext, type FieldDraft, type TierDraft, type DealDraft, type VariantDraft, newVariantKey, ALL_ROLES, ROLE_LABELS, ALL_MAJORS, toLocalInput, uploadImage, exportProductXlsx } from "./shop-model";
import { ApprovalBadge, Field, SectionDivider, Pagination, Chip, ownerChip } from "./ui";

export function ProductsTab({ th, ctx, onPendingApprovals }: { th: boolean; ctx: ShopContext | null; onPendingApprovals?: (n: number) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  // Owner-picker options from the products response; falls back to the parent's
  // context fetch so the form still works before the first list load resolves.
  const [ownerOptionsFromList, setOwnerOptionsFromList] = useState<OwnerOptions | null>(null);
  const ownerOptions = ownerOptionsFromList ?? ctx?.ownerOptions ?? null;
  const [loading, setLoading] = useState(true);
  // Set when the product list fails to load — shown instead of swallowing the
  // failure as an empty "No products yet" list.
  const [loadError, setLoadError] = useState(false);
  // Products whose full option list is expanded (long lists are collapsed).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [approvalFilter, setApprovalFilter] = useState<"all" | "pending">("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // Rejecting a product needs a reason the seller can read: a small form, not prompt().
  const [rejecting, setRejecting] = useState<AdminProduct | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const rejectRef = useRef<HTMLTextAreaElement>(null);

  const exportProduct = async (p: AdminProduct) => {
    setExportingId(p.id);
    try {
      await exportProductXlsx(p);
      toast.success(th ? `ส่งออกคำสั่งซื้อของ "${p.name}" แล้ว` : `Exported orders for "${p.name}"`);
    } catch (error) {
      toast.error(th ? "ส่งออกไม่สำเร็จ" : "Couldn't export", error instanceof Error ? error.message : undefined);
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

  const pendingApprovals = products.filter((p) => p.approvalStatus === "pending").length;
  useEffect(() => { onPendingApprovals?.(pendingApprovals); }, [onPendingApprovals, pendingApprovals]);

  const remove = async (p: AdminProduct) => {
    const ok = await confirm({
      title: th ? `ลบสินค้า "${p.name}"?` : `Delete "${p.name}"?`,
      message: th ? "สินค้าจะหายจากร้านค้า คำสั่งซื้อเดิมจะยังเก็บไว้ การลบนี้ย้อนกลับไม่ได้" : "The product is removed from the shop. Existing orders are kept. This can't be undone.",
      confirmLabel: th ? "ลบสินค้า" : "Delete product",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/shop/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || (th ? "ลบไม่สำเร็จ" : "Delete failed"));
      }
      toast.success(th ? `ลบ "${p.name}" แล้ว` : `Deleted "${p.name}"`);
    } catch (error) {
      toast.error(th ? "ลบสินค้าไม่สำเร็จ" : "Couldn't delete the product", error instanceof Error ? error.message : undefined);
    }
    load();
  };

  // Same PATCH as before; the reject reason is collected by the caller's form.
  const reviewProduct = async (p: AdminProduct, action: "approve" | "reject", reason?: string) => {
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
      toast.success(action === "approve" ? (th ? `อนุมัติ "${p.name}" แล้ว` : `Approved "${p.name}"`) : (th ? `ปฏิเสธ "${p.name}" แล้ว` : `Rejected "${p.name}"`));
      return true;
    } catch (error) {
      toast.error(action === "approve" ? (th ? "อนุมัติไม่สำเร็จ" : "Couldn't approve") : (th ? "ปฏิเสธไม่สำเร็จ" : "Couldn't reject"), error instanceof Error ? error.message : undefined);
      return false;
    } finally {
      setReviewingId(null);
    }
  };

  const openReject = (p: AdminProduct) => {
    setRejectReason("");
    setRejectError(null);
    setRejecting(p);
  };
  const submitReject = async () => {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      setRejectError(th ? "กรุณาระบุเหตุผล ผู้ขายจะเห็นข้อความนี้" : "Enter a reason. The seller will see it.");
      rejectRef.current?.focus();
      return;
    }
    if (await reviewProduct(rejecting, "reject", rejectReason)) setRejecting(null);
  };

  // Page the list (10/page). Clamp to a derived page so deleting the last row on the
  // final page falls back to a valid page instead of showing an empty one.
  const visibleProducts = approvalFilter === "pending" ? products.filter((p) => p.approvalStatus === "pending") : products;
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageProducts = visibleProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <LoadingState variant="skeleton" rows={3} label={th ? "กำลังโหลดสินค้า" : "Loading products"} />;
  if (loadError) return <ErrorState title={th ? "โหลดสินค้าไม่สำเร็จ" : "Couldn't load products"} onRetry={() => { setLoading(true); load(); }} />;

  // Same gate as before: no context yet, or a seller who isn't approved, can't add.
  const cannotCreate = !ctx || Boolean(ctx.scoped && ctx.seller?.status !== "approved");
  const newProductButton = (
    <button onClick={() => setEditing("new")} disabled={cannotCreate} className="btn btn-primary">
      <Plus size={18} aria-hidden="true" />{th ? "เพิ่มสินค้า" : "New product"}
    </button>
  );

  return (
    <div>
      <div className="adm-toolbar" style={{ justifyContent: "space-between" }}>
        {ctx?.canReviewMarketplace ? (
          <div role="group" aria-label={th ? "กรองสินค้า" : "Filter products"} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setApprovalFilter("all"); setPage(1); }} aria-pressed={approvalFilter === "all"} className={approvalFilter === "all" ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 14px" }}>
              {th ? "สินค้าทั้งหมด" : "All products"} ({products.length})
            </button>
            <button onClick={() => { setApprovalFilter("pending"); setPage(1); }} aria-pressed={approvalFilter === "pending"} className={approvalFilter === "pending" ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 14px" }}>
              {th ? "รออนุมัติ" : "Pending approval"} ({pendingApprovals})
            </button>
          </div>
        ) : <span />}
        {newProductButton}
      </div>

      {visibleProducts.length === 0 ? (
        approvalFilter === "pending" ? (
          <EmptyState
            title={th ? "ไม่มีสินค้าที่รออนุมัติ" : "Nothing waiting for approval"}
            description={th ? "สินค้าใหม่จากผู้ขายหรือฝ่ายการเงินจะมาอยู่ที่นี่เพื่อรอให้คุณตรวจ" : "New products from sellers or Finance show up here for you to review."}
            action={<button onClick={() => setApprovalFilter("all")} className="btn btn-ghost">{th ? "ดูสินค้าทั้งหมด" : "Show all products"}</button>}
          />
        ) : (
          <EmptyState
            icon={<Package size={24} />}
            title={th ? "ยังไม่มีสินค้า" : "No products yet"}
            description={cannotCreate && ctx
              ? (th ? "คุณต้องได้รับอนุมัติเป็นผู้ขายก่อนจึงจะเพิ่มสินค้าได้" : "You need to be an approved seller before you can add products.")
              : (th ? "เพิ่มสินค้าแรกเพื่อเริ่มเปิดรับคำสั่งซื้อ" : "Add your first product to start taking orders.")}
            action={cannotCreate ? undefined : newProductButton}
          />
        )
      ) : (
        <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
          {pageProducts.map((p) => {
            const needsReview = ctx?.canReviewMarketplace && p.approvalStatus !== "approved" && (p.sellerId || ctx.canApproveCentral);
            const reviewing = reviewingId === p.id;
            return (
              <li key={p.id} className="adm-panel" style={{ padding: 14 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", overflow: "hidden", flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.imageUrls[0] ? <img src={p.imageUrls[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}><Package size={20} aria-hidden="true" /></div>}
                  </div>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <p style={{ fontWeight: 700, fontSize: 15, overflowWrap: "anywhere", wordBreak: "break-word" }}>{p.name}</p>
                      {!p.isActive && <StatusBadge tone="neutral" icon={<EyeOff size={12} />}>{th ? "ซ่อนอยู่" : "Hidden"}</StatusBadge>}
                      {isAudienceLimited(p) && <span title={th ? "จำกัดผู้เห็น (บทบาท/สาขา/นักศึกษา)" : "Limited audience (roles/majors/students)"}><StatusBadge tone="info" icon={<Users size={12} />}>{th ? "จำกัดผู้เห็น" : "Limited audience"}</StatusBadge></span>}
                      {(p.sellerId || p.approvalStatus !== "approved") && <ApprovalBadge status={p.approvalStatus} th={th} />}
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{p.sellerName || ownerLabel(p, ownerOptions, th)}</p>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", overflowWrap: "anywhere", wordBreak: "break-word", marginTop: 2 }}>
                      {adminPriceLabel(p)}{adminWelfareLabel(p) ? ` · ${th ? "สวัสดิการ" : "welfare"} ${adminWelfareLabel(p)} (${p.welfareRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")})` : ""}{(p.bundleDeals ?? []).map((d) => ` · ${th ? `${d.qty} ชิ้น ${baht(d.price)}` : `${d.qty} for ${baht(d.price)}`}${d.variantIds ? ` (${p.variants.filter((v) => v.id && d.variantIds!.includes(v.id)).map((v) => v.label).join(", ")})` : ""}`).join("")}
                      {p.maxPerOrder != null ? ` · ${th ? "จำกัด" : "max"} ${p.maxPerOrder}/${th ? "คน" : "person"}` : ""}
                    </p>
                    <VariantChips th={th} variants={p.variants} expanded={expandedIds.has(p.id)} onToggle={() => setExpandedIds((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                    {p.approvalReason && p.approvalStatus !== "approved" && (
                      <p style={{ fontSize: 13, marginTop: 4, color: "var(--text-secondary)" }}>{th ? "เหตุผล: " : "Reason: "}{p.approvalReason}</p>
                    )}
                    {(p.opensAt || p.closesAt) && (
                      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Clock size={13} aria-hidden="true" style={{ flexShrink: 0 }} /> {p.opensAt ? new Date(p.opensAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "เปิดอยู่" : "now")} → {p.closesAt ? new Date(p.closesAt).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : (th ? "ไม่กำหนด" : "open-ended")}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
                    <Link href={`/admin/shop/${p.id}`} className="btn btn-ghost" style={{ fontSize: 13 }} title={th ? "ดูคำสั่งซื้อ/สลิปของสินค้านี้" : "View this product's orders & slips"}>
                      <ReceiptText size={16} aria-hidden="true" />{th ? "คำสั่งซื้อ" : "Orders"}
                    </Link>
                    <IconButton
                      label={th ? `ส่งออกคำสั่งซื้อของ ${p.name} เป็น .xlsx` : `Export orders for ${p.name} to .xlsx`}
                      icon={exportingId === p.id ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                      onClick={() => exportProduct(p)}
                      disabled={exportingId === p.id}
                    />
                    <IconButton label={th ? `แก้ไข ${p.name}` : `Edit ${p.name}`} icon={<Pencil size={18} />} tone="accent" onClick={() => setEditing(p)} />
                    {ctx?.canDeleteProducts && (
                      // Delete sits apart from the everyday actions and always asks first.
                      <span style={{ marginLeft: 10, paddingLeft: 10, borderLeft: "1px solid var(--border-subtle)", display: "inline-flex" }}>
                        <IconButton label={th ? `ลบ ${p.name}` : `Delete ${p.name}`} icon={<Trash2 size={18} />} tone="danger" onClick={() => remove(p)} />
                      </span>
                    )}
                  </div>
                </div>
                {needsReview && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border-subtle)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--amber-700)" }}>
                      {p.approvalStatus === "rejected" ? (th ? "สินค้านี้ถูกปฏิเสธไว้ อนุมัติได้หากแก้ไขแล้ว" : "Rejected earlier. You can still approve it.") : (th ? "รอให้คุณตรวจก่อนขึ้นร้าน" : "Waiting for your review before it goes live.")}
                    </p>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button onClick={() => openReject(p)} disabled={reviewing} className="btn btn-ghost" style={{ color: "var(--red-600)", fontSize: 13 }} aria-label={th ? `ปฏิเสธ ${p.name}` : `Reject ${p.name}`}>
                        <XCircle size={16} aria-hidden="true" />{th ? "ปฏิเสธ" : "Reject"}
                      </button>
                      <button onClick={() => reviewProduct(p, "approve")} disabled={reviewing} className="btn btn-primary" style={{ fontSize: 13 }} aria-label={th ? `อนุมัติ ${p.name}` : `Approve ${p.name}`}>
                        {reviewing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{reviewing ? (th ? "กำลังอนุมัติ…" : "Approving…") : (th ? "อนุมัติ" : "Approve")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
          onSaved={() => { toast.success(editing === "new" ? (th ? "เพิ่มสินค้าแล้ว" : "Product added") : (th ? "บันทึกสินค้าแล้ว" : "Product saved")); setEditing(null); load(); }}
        />
      )}

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        dismissible={!(rejecting && reviewingId === rejecting.id)}
        size="sm"
        icon={<XCircle size={20} />}
        title={th ? `ปฏิเสธ "${rejecting?.name ?? ""}"` : `Reject "${rejecting?.name ?? ""}"`}
        description={th ? "ผู้ขายจะเห็นเหตุผลนี้ และสินค้าจะไม่ขึ้นร้าน" : "The seller will see this reason, and the product stays out of the shop."}
        initialFocusRef={rejectRef}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)} disabled={!!rejecting && reviewingId === rejecting.id}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button type="button" className="btn adm-btn-danger-solid" onClick={submitReject} disabled={!!rejecting && reviewingId === rejecting.id}>
              {rejecting && reviewingId === rejecting.id && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {th ? "ปฏิเสธสินค้า" : "Reject product"}
            </button>
          </>
        }
      >
        <Field label={th ? "เหตุผลที่ปฏิเสธ" : "Rejection reason"} required error={rejectError}>
          <textarea
            ref={rejectRef}
            className="input"
            rows={3}
            maxLength={500}
            value={rejectReason}
            onChange={(e) => { setRejectReason(e.target.value); if (rejectError) setRejectError(null); }}
            placeholder={th ? "เช่น ราคาไม่ตรงกับที่ตกลง" : "e.g. The price doesn't match what we agreed"}
            style={{ resize: "vertical" }}
          />
        </Field>
      </Modal>
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
  const [welfareRoles, setWelfareRoles] = useState<string[]>(product?.welfareRoles ?? []);
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants?.length
      // A product saved with the older product-level welfare base shows it as each
      // option's own welfare price (base + that option's surcharge) and re-saves
      // it that way.
      ? product.variants.map((v) => ({
          ...v,
          welfarePrice: v.welfarePrice ?? (product.welfarePrice != null ? product.welfarePrice + (v.priceDelta ?? 0) : null),
          key: v.id ?? newVariantKey(),
        }))
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
  // The error banner sits at the top of a long scrolling form: bring it into view.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [error]);

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
    const anyWelfare = variants.some((v) => v.welfarePrice != null);
    if (anyWelfare && welfareRoles.length === 0) { setError(th ? "เลือกบทบาทที่ได้รับสวัสดิการ หรือเว้นราคาสวัสดิการของตัวเลือกให้ว่าง" : "Pick the roles that get the welfare price, or clear the options' welfare prices"); return; }
    const badWelfare = variants.find((v) => v.welfarePrice != null && v.welfarePrice >= optionPrice(v));
    if (badWelfare) { setError(th ? `ราคาสวัสดิการของ "${badWelfare.label.trim() || "?"}" ต้องต่ำกว่าราคาปกติ (${baht(optionPrice(badWelfare))})` : `The welfare price of "${badWelfare.label.trim() || "?"}" must be lower than its normal price (${baht(optionPrice(badWelfare))})`); return; }
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
        // Welfare: set per option (below). No option price or no roles = off.
        welfarePrice: null,
        welfareRoles: anyWelfare ? welfareRoles : [],
        sortOrder: product?.sortOrder ?? 0,
        ownerClubIds,
        ownerMajors,
        variants: variants.map((v) => ({ id: v.id, label: v.label.trim(), stock: v.stock, allowCustom: !!v.allowCustom, priceDelta: Math.max(0, Math.round(Number(v.priceDelta) || 0)), welfarePrice: v.welfarePrice == null ? null : Math.max(0, Math.round(Number(v.welfarePrice) || 0)) })),
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
  const welfareOptionCount = variants.filter((v) => v.welfarePrice != null).length;
  const welfareSummary = welfareOptionCount === 0 || welfareRoles.length === 0
    ? (th ? "ไม่มี" : "None")
    : `${welfareOptionCount} ${th ? "ตัวเลือก" : welfareOptionCount === 1 ? "option" : "options"} · ${welfareRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`;
  const audienceLimited = allowedRoles.length > 0 || allowedMajors.length > 0 || !targetThai || !targetInternational;
  const audienceSummary = audienceLimited ? (th ? "จำกัดผู้เห็น" : "Limited") : (th ? "ทุกคน" : "Everyone");

  // Guard against losing a long form to a stray tap outside the sheet or Escape:
  // if anything changed since the form opened, ask before closing.
  const confirmDiscard = useConfirm();
  const snapshot = JSON.stringify([name, price, description, imageUrls, maxPerOrder, opensAt, closesAt, isActive, allowedRoles, allowedMajors, targetThai, targetInternational, customFields, deliveryFee, deliveryTiers, bundleDeals, welfareRoles, variants, ownerClubIds, ownerMajors]);
  const initialSnapshot = useRef(snapshot);
  const requestClose = async () => {
    if (saving) return;
    if (snapshot !== initialSnapshot.current) {
      const ok = await confirmDiscard({
        title: th ? "ทิ้งการแก้ไขที่ยังไม่บันทึก?" : "Discard your changes?",
        message: th ? "ข้อมูลที่กรอกไว้ในฟอร์มสินค้านี้ยังไม่ถูกบันทึก" : "What you typed in this product form hasn't been saved.",
        confirmLabel: th ? "ทิ้งการแก้ไข" : "Discard changes",
        cancelLabel: th ? "กลับไปแก้ไข" : "Keep editing",
        tone: "danger",
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Modal
      open
      onClose={requestClose}
      dismissible={!saving}
      size="lg"
      title={product ? (th ? `แก้ไขสินค้า: ${product.name}` : `Edit product: ${product.name}`) : (th ? "เพิ่มสินค้า" : "New product")}
      description={th
        ? "ช่องที่มี * จำเป็นต้องกรอก · ส่วนที่เหลือเป็นตัวเลือกเสริมให้ตั้งค่าเพิ่มได้"
        : "Fields marked * are required. The sections below are optional extras."}
      footer={
        <>
          <button type="button" onClick={requestClose} disabled={saving} className="btn btn-ghost">{th ? "ยกเลิก" : "Cancel"}</button>
          <button type="button" onClick={save} disabled={saving || uploading} className="btn btn-primary">
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save")}
          </button>
        </>
      }
    >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div ref={errorRef}><InlineAlert tone="error" title={th ? "บันทึกไม่ได้" : "Couldn't save"}>{error}</InlineAlert></div>}

          {/* ---- Essentials (always visible) ---- */}
          <Field label={th ? "ชื่อสินค้า" : "Name"} required>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder={th ? "เช่น เสื้อค่าย SMO" : "e.g. SMO Camp Shirt"} />
          </Field>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Field label={th ? "ราคา (บาท)" : "Price (฿)"} required style={{ flex: 1, minWidth: 140 }}>
              <input type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="input" />
            </Field>
            <Field label={th ? "จำกัดต่อคน" : "Max per buyer"} hint={th ? "เว้นว่าง = ไม่จำกัด" : "Blank = unlimited"} style={{ flex: 1, minWidth: 160 }}>
              <input type="number" inputMode="numeric" min={1} value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value)} className="input" placeholder={th ? "ไม่จำกัด" : "Unlimited"} />
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
                <div key={url} style={{ width: 96, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ width: 96, height: 80, borderRadius: "var(--radius-md)", overflow: "hidden", border: i === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={i === 0 ? (th ? "รูปหน้าปก" : "Cover image") : (th ? `รูปที่ ${i + 1}` : `Image ${i + 1}`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    {i === 0
                      ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", display: "inline-flex", alignItems: "center", gap: 3 }}><Star size={12} aria-hidden="true" />{th ? "หน้าปก" : "Cover"}</span>
                      : <button type="button" onClick={() => setImageUrls((prev) => { const a = [...prev]; const [m] = a.splice(i, 1); a.unshift(m); return a; })} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}>{th ? "ตั้งเป็นปก" : "Make cover"}</button>}
                    <IconButton size="sm" tone="danger" label={th ? `ลบรูปที่ ${i + 1}` : `Remove image ${i + 1}`} icon={<X size={16} />} onClick={() => setImageUrls((prev) => prev.filter((u) => u !== url))} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={th ? "อัปโหลดรูปสินค้า" : "Upload product images"} style={{ width: 96, height: 80, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
                {uploading ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Upload size={20} aria-hidden="true" />}{uploading ? (th ? "กำลังอัปโหลด…" : "Uploading…") : (th ? "เพิ่มรูป" : "Add image")}
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
                  <input value={v.label} aria-label={th ? `ชื่อตัวเลือกที่ ${i + 1}` : `Option ${i + 1} name`} onChange={(e) => setVariant(i, { label: e.target.value })} placeholder={v.allowCustom ? (th ? "ชื่อ เช่น อื่นๆ" : "Label e.g. Other") : (th ? "ชื่อ เช่น S, M, L" : "Label e.g. S, M, L")} className="input" style={{ flex: 2, minWidth: 120 }} />
                  <input type="number" inputMode="numeric" min={0} value={v.stock ?? ""} aria-label={th ? `สต็อกของตัวเลือกที่ ${i + 1} (ว่าง = ไม่จำกัด)` : `Option ${i + 1} stock (blank = unlimited)`} onChange={(e) => setVariant(i, { stock: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} placeholder={th ? "สต็อก" : "Stock"} className="input" style={{ flex: 1, minWidth: 80 }} />
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 110 }} title={th ? "บวกเพิ่มจากราคาสินค้า เช่น ไซส์พิเศษ (0 = ไม่บวกเพิ่ม)" : "Added on top of the base price, e.g. a special size (0 = no surcharge)"}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>+฿</span>
                    <input type="number" inputMode="numeric" min={0} value={v.priceDelta ?? ""} aria-label={th ? `ราคาที่บวกเพิ่มของตัวเลือกที่ ${i + 1}` : `Option ${i + 1} surcharge in baht`} onChange={(e) => setVariant(i, { priceDelta: e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))) })} placeholder={th ? "เพิ่มราคา" : "Surcharge"} className="input" style={{ width: "100%" }} />
                    {/* Final price the buyer pays for this option (price + surcharge). */}
                    <span title={th ? "ราคาที่ผู้ซื้อจ่ายต่อชิ้น" : "What the buyer pays per unit"} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", whiteSpace: "nowrap" }}>= {baht(optionPrice(v))}</span>
                  </div>
                  {welfareRoles.length > 0 && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 120 }} title={th ? "ราคาสวัสดิการของตัวเลือกนี้ (ราคาเต็มต่อชิ้น เว้นว่าง = ไม่มีสวัสดิการ)" : "Welfare price for this option (full unit price; blank = no welfare)"}>
                      <HeartHandshake size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                      <input type="number" inputMode="numeric" min={0} value={v.welfarePrice ?? ""} aria-label={th ? `ราคาสวัสดิการของตัวเลือกที่ ${i + 1}` : `Option ${i + 1} welfare price in baht`} onChange={(e) => setVariant(i, { welfarePrice: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) })} placeholder={th ? "สวัสดิการ ฿" : "Welfare ฿"} className="input" style={{ width: "100%" }} />
                    </div>
                  )}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }} title={th ? "ให้ผู้ซื้อพิมพ์รายละเอียดเอง" : "Buyer types their own value"}>
                    <input type="checkbox" checked={!!v.allowCustom} onChange={(e) => setVariant(i, { allowCustom: e.target.checked })} />
                    {th ? "ระบุเอง" : "Other"}
                  </label>
                  {variants.length > 1 && <IconButton size="sm" tone="danger" label={th ? `ลบตัวเลือก ${v.label.trim() || i + 1}` : `Remove option ${v.label.trim() || i + 1}`} icon={<Trash2 size={16} />} onClick={() => setVariants((vs) => vs.filter((_, idx) => idx !== i))} />}
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
                <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className="input" />
              </Field>
              <Field label={th ? "ปิดขาย" : "Closes at"} style={{ flex: 1, minWidth: 150 }}>
                <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="input" />
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
                      <input type="number" inputMode="numeric" min={2} value={d.qty} aria-label={th ? "จำนวนชิ้นที่ต้องซื้อในโปรโมชัน" : "Promotion quantity"} onChange={(e) => setDeal({ qty: e.target.value })} placeholder={th ? "จำนวน" : "qty"} className="input" style={{ width: 90 }} />
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ชิ้น ในราคา ฿" : "for ฿"}</span>
                      <input type="number" inputMode="numeric" min={0} value={d.price} aria-label={th ? "ราคารวมของโปรโมชัน (บาท)" : "Promotion total price in baht"} onChange={(e) => setDeal({ price: e.target.value })} placeholder={th ? "ราคารวม" : "total"} className="input" style={{ width: 110 }} />
                      {saving > 0 && (
                        <span style={{ fontSize: 12, color: "var(--emerald-500)", fontWeight: 600 }}>{th ? `ประหยัด ${baht(saving)}` : `saves ${baht(saving)}`}</span>
                      )}
                      <IconButton size="sm" tone="danger" label={th ? `ลบโปรโมชันที่ ${i + 1}` : `Remove promotion ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => setBundleDeals((ds) => ds.filter((_, idx) => idx !== i))} />
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
              <input type="number" inputMode="numeric" min={0} value={deliveryFee} aria-label={th ? "ค่าส่งพื้นฐาน (บาท)" : "Base delivery fee in baht"} onChange={(e) => setDeliveryFee(e.target.value)} placeholder={th ? "เว้นว่าง = ใช้ค่าเริ่มต้นของร้าน" : "blank = use shop default"} className="input" style={{ width: 220 }} />
            </div>
            {deliveryTiers.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {deliveryTiers.map((t, i) => {
                  const setTier = (patch: Partial<TierDraft>) => setDeliveryTiers((ts) => ts.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ตั้งแต่" : "From"}</span>
                      <input type="number" inputMode="numeric" min={1} value={t.minQty} aria-label={th ? `ขั้นที่ ${i + 1}: จำนวนขั้นต่ำ` : `Tier ${i + 1} minimum quantity`} onChange={(e) => setTier({ minQty: e.target.value })} placeholder={th ? "จำนวน" : "qty"} className="input" style={{ width: 90 }} />
                      <span style={{ color: "var(--text-muted)" }}>{th ? "ชิ้นขึ้นไป → ฿" : "+ pcs → ฿"}</span>
                      <input type="number" inputMode="numeric" min={0} value={t.fee} aria-label={th ? `ขั้นที่ ${i + 1}: ค่าส่ง (บาท)` : `Tier ${i + 1} fee in baht`} onChange={(e) => setTier({ fee: e.target.value })} placeholder={th ? "ค่าส่ง" : "fee"} className="input" style={{ width: 110 }} />
                      <IconButton size="sm" tone="danger" label={th ? `ลบขั้นที่ ${i + 1}` : `Remove tier ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => setDeliveryTiers((ts) => ts.filter((_, idx) => idx !== i))} />
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
                    <input value={f.label} aria-label={th ? `ชื่อช่องกรอกที่ ${i + 1}` : `Custom field ${i + 1} label`} maxLength={1000} onChange={(e) => setField({ label: e.target.value })} placeholder={th ? "ชื่อช่อง เช่น ชื่อบนเสื้อ" : "Label e.g. Name on back"} className="input" style={{ flex: 2, minWidth: 140 }} />
                    <select value={f.type} aria-label={th ? `ประเภทช่องกรอกที่ ${i + 1}` : `Custom field ${i + 1} type`} onChange={(e) => setField({ type: e.target.value as ShopCustomFieldType })} className="input" style={{ flex: 1, minWidth: 110 }}>
                      <option value="text">{th ? "ข้อความ" : "Text"}</option>
                      <option value="number">{th ? "ตัวเลข" : "Number"}</option>
                      <option value="select">{th ? "ตัวเลือก" : "Select"}</option>
                    </select>
                    <IconButton size="sm" tone="danger" label={th ? `ลบช่องกรอกที่ ${i + 1}` : `Remove custom field ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => setCustomFields((fs) => fs.filter((_, idx) => idx !== i))} />
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={f.required} onChange={(e) => setField({ required: e.target.checked })} />
                      {th ? "จำเป็น" : "Required"}
                    </label>
                    {f.type === "text" && (
                      <input type="number" inputMode="numeric" min={1} max={1000} value={f.maxLength ?? ""} aria-label={th ? "ความยาวสูงสุด" : "Max length"} onChange={(e) => setField({ maxLength: e.target.value === "" ? null : Math.min(1000, Math.max(1, Number(e.target.value))) })} placeholder={th ? "ความยาวสูงสุด" : "Max length"} className="input" style={{ width: 140 }} />
                    )}
                    {f.type === "number" && (
                      <>
                        <input type="number" value={f.min ?? ""} aria-label={th ? "ค่าต่ำสุด" : "Minimum value"} onChange={(e) => setField({ min: e.target.value === "" ? null : Number(e.target.value) })} placeholder={th ? "ต่ำสุด" : "Min"} className="input" style={{ width: 100 }} />
                        <input type="number" value={f.max ?? ""} aria-label={th ? "ค่าสูงสุด" : "Maximum value"} onChange={(e) => setField({ max: e.target.value === "" ? null : Number(e.target.value) })} placeholder={th ? "สูงสุด" : "Max"} className="input" style={{ width: 100 }} />
                      </>
                    )}
                    {f.type === "select" && (
                      <input value={f.options.join(", ")} aria-label={th ? "ตัวเลือก คั่นด้วยจุลภาค" : "Options, comma-separated"} onChange={(e) => setField({ options: e.target.value.split(",").map((o) => o.replace(/^\s+|\s+$/g, "")) })} placeholder={th ? "ตัวเลือก คั่นด้วย , เช่น แดง, น้ำเงิน" : "Options, comma-separated e.g. Red, Blue"} className="input" style={{ flex: 1, minWidth: 180 }} />
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
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {th
                ? "ตั้งราคาสวัสดิการของแต่ละตัวเลือกในช่อง \"สวัสดิการ ฿\" ที่รายการตัวเลือกด้านบน (ช่องนี้จะโผล่เมื่อเลือกบทบาทด้านล่างแล้ว) เว้นว่าง = ตัวเลือกนั้นไม่มีสวัสดิการ และต้องต่ำกว่าราคาปกติของตัวเลือกนั้น"
                : "Set each option's welfare price in the \"Welfare ฿\" box on its row in the options list above (it appears once you pick roles below). Blank = that option has no welfare, and it must be lower than that option's normal price."}
            </p>
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
    </Modal>
  );
}

/* -------------------------------- Orders -------------------------------- */

// Option chips for a product card. Long lists collapse to the first few so a
// product with many/long options doesn't blow up the card.
const VARIANT_PREVIEW = 6;
function VariantChips({ th, variants, expanded, onToggle }: { th: boolean; variants: AdminVariant[]; expanded: boolean; onToggle: () => void }) {
  if (variants.length === 0) return null;
  const shown = expanded ? variants : variants.slice(0, VARIANT_PREVIEW);
  const hidden = variants.length - shown.length;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {shown.map((v, i) => (
        <span key={v.id ?? i} title={v.label} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {v.label}{v.stock != null ? <span style={{ color: "var(--text-muted)" }}> {Math.max(0, v.stock - (v.sold ?? 0))}/{v.stock}</span> : null}
        </span>
      ))}
      {(hidden > 0 || (expanded && variants.length > VARIANT_PREVIEW)) && (
        <button type="button" onClick={onToggle} className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px", fontWeight: 700, color: "var(--accent-primary)" }}>
          {hidden > 0 ? (th ? `+${hidden} ตัวเลือก` : `+${hidden} more`) : (th ? "ย่อ" : "Show less")}
        </button>
      )}
    </div>
  );
}
