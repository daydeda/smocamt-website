"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { orderBreakdown } from "@/lib/shop/shop-finance";
import { Pencil, Loader2, X, CheckCircle2, XCircle, Clock, Save, RotateCcw, FileText, Truck, Store, AlertTriangle, ExternalLink, Wallet, ScanLine, Search } from "lucide-react";
import { isItemHandedOver, type StaffFulfillmentAction } from "@/lib/shop/shop-fulfillment";
import ShopHandoverScanner from "../ShopHandoverScanner";
import { FulfillmentChip, FulfillmentPanel, FulfilModal, canRevertPayment, type FulfilRequest } from "../ShopFulfillmentControls";
import { isHttpUrl, SLIP_FLAG_COPY, baht, ymdDaysAgo, PAGE_SIZE, type AdminProduct, type ShopContext, type AdminOrder, type OrderFilter, matchesOrderFilter, type AdminOrderItem } from "./shop-model";
import { Field, Spinner, Pagination, FilterDropdown, inputStyle, ORDER_BADGE } from "./ui";
import { OptionSummary } from "./OptionSummary";

// `productId` pins the tab to a single product (the /admin/shop/[productId] page):
// only orders with a line for that product are shown and the product dropdown is hidden.
export function OrdersTab({ th, ctx, productId }: { th: boolean; ctx: ShopContext | null; productId?: string }) {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  // Product configs (variants + personalization fields), fetched once so the
  // edit-order modal can offer the right option list / custom fields per item.
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrderFilter>("pending");
  // Extra filters layered on top of status: by product (an order matches if any of
  // its lines is that product) and by an inclusive created-at date/time range.
  const [productFilter, setProductFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Free-text search over buyer name / nickname / student ID / recipient name.
  const [search, setSearch] = useState("");
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
  // The order currently open in the "edit details" modal (admin/owner
  // correcting a buyer's option/personalization/delivery mistake).
  const [editing, setEditing] = useState<AdminOrder | null>(null);
  // Handover: the ship/handover/reset dialog, and the Digital ID scanner.
  const [fulfilling, setFulfilling] = useState<{ order: AdminOrder; action: "ship" | "handover" | "reset" } | null>(null);
  const [fulfilError, setFulfilError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

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
  useEffect(() => {
    fetch("/api/admin/shop/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.products) setProducts(d.products); })
      .catch(() => {})
      .finally(() => setProductsLoaded(true));
  }, []);
  const productById = new Map(products.map((p) => [p.id, p]));

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

  // "ready" runs immediately (it only notifies the buyer); the rest open a dialog.
  const fulfil = (o: AdminOrder, action: StaffFulfillmentAction) => {
    setFulfilError(null);
    if (action === "ready") { submitFulfil(o, { action }); return; }
    setFulfilling({ order: o, action });
  };

  const submitFulfil = async (o: AdminOrder, req: FulfilRequest) => {
    setBusy(o.id);
    setActionError(null);
    setFulfilError(null);
    try {
      const res = await fetch(`/api/admin/shop/orders/${o.id}/fulfillment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || (th ? "ดำเนินการไม่สำเร็จ" : "Action failed"));
      }
      setFulfilling(null);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (th ? "ดำเนินการไม่สำเร็จ" : "Action failed");
      // Inside the dialog, keep it open with the error so typed input isn't lost.
      if (req.action === "ready") setActionError(msg); else setFulfilError(msg);
    } finally {
      setBusy(null);
    }
  };

  // Product dropdown options: every distinct product name across all orders.
  const productNames = Array.from(new Set(orders.flatMap((o) => o.items.map((i) => i.productName)))).sort((a, b) => a.localeCompare(b));
  // Picking a product opens its own page (/admin/shop/[productId]). A product that
  // was deleted has no id left, so it falls back to the in-page name filter.
  const productIdByName = new Map<string, string>();
  for (const o of orders) for (const i of o.items) if (i.productId) productIdByName.set(i.productName, i.productId);
  const pickProduct = (name: string) => {
    const id = name === "all" ? undefined : productIdByName.get(name);
    if (id) router.push(`/admin/shop/${id}`); else setProductFilter(name);
  };

  // Product + date + search filters apply before status, so the status tab counts
  // reflect them. Dates are whole local days, both ends inclusive.
  const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
  const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
  const q = search.trim().toLowerCase();
  const preFlag = orders.filter((o) => {
    if (productId && !o.items.some((i) => i.productId === productId)) return false;
    if (productFilter !== "all" && !o.items.some((i) => i.productName === productFilter)) return false;
    const created = new Date(o.createdAt).getTime();
    if (fromMs != null && created < fromMs) return false;
    if (toMs != null && created > toMs) return false;
    if (q) {
      const hay = [o.buyer.name, o.buyer.nickname, o.buyer.studentId, o.recipientName].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const flaggedCount = preFlag.filter((o) => o.slipFlag).length;
  const base = flaggedOnly ? preFlag.filter((o) => o.slipFlag) : preFlag;
  const shown = base.filter((o) => matchesOrderFilter(o, filter));
  const hasExtraFilter = (!productId && productFilter !== "all") || !!fromDate || !!toDate || !!q || flaggedOnly;
  const pinnedProduct = productId ? productById.get(productId) : undefined;

  // Reset to page 1 whenever the filter combination changes (adjust-state-during-render
  // pattern), then clamp to a derived page so an emptied last page falls back.
  const curKey = `${filter}|${productFilter}|${fromDate}|${toDate}|${flaggedOnly}|${q}`;
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
    <p style={{ color: "var(--red-500)", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {th ? "โหลดคำสั่งซื้อไม่สำเร็จ" : "Couldn't load orders."}
      <button onClick={() => { setLoading(true); load(); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "4px 10px" }}>{th ? "ลองอีกครั้ง" : "Retry"}</button>
    </p>
  );

  return (
    <div>
      {productId && (
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14, overflowWrap: "anywhere" }}>
          {pinnedProduct?.name ?? (productsLoaded ? (th ? "สินค้า" : "Product") : "…")} · {th ? "คำสั่งซื้อ" : "Orders"}
        </h2>
      )}
      {/* The pickup-counter action: its own row so it's the obvious big button on a phone. */}
      <button onClick={() => setScanning(true)} className="btn btn-primary" style={{ width: "100%", maxWidth: 360, marginBottom: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ScanLine size={16} />{th ? "ส่งมอบสินค้า (สแกน Digital ID)" : "Hand over items (scan Digital ID)"}
      </button>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 14px" }}>
            {f === "all" ? (th ? "ทั้งหมด" : "All") : f === "pending" ? (th ? "รอตรวจสอบ" : "Pending") : f === "approved" ? (th ? "อนุมัติ" : "Approved") : (th ? "ปฏิเสธ" : "Rejected")}
            {" "}({base.filter((o) => matchesOrderFilter(o, f)).length})
          </button>
        ))}
        {(["to_fulfil", "shipped", "issue"] as const).map((f) => {
          const count = base.filter((o) => matchesOrderFilter(o, f)).length;
          // Hide the empty "problem" filter so it only draws the eye when needed.
          if (f === "issue" && count === 0 && filter !== "issue") return null;
          return (
            <button key={f} onClick={() => setFilter(f)} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "6px 14px", ...(f === "issue" && filter !== f ? { color: "var(--red-600)" } : {}) }}>
              {f === "to_fulfil" ? (th ? "รอส่งมอบ" : "To hand over") : f === "shipped" ? (th ? "จัดส่งแล้ว" : "Shipped") : (th ? "แจ้งปัญหา" : "Problem")}
              {" "}({count})
            </button>
          );
        })}

        <button
          onClick={() => setFlaggedOnly((v) => !v)}
          className={flaggedOnly ? "btn btn-primary" : "btn btn-ghost"}
          style={{
            fontSize: 13, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6,
            ...(flaggedOnly ? {} : { color: "var(--amber-700)" }),
          }}
          title={th ? "คำสั่งซื้อที่สลิปซ้ำหรือไม่พบ QR (ตรวจอัตโนมัติ ฟรี)" : "Orders whose slip is a duplicate or has no readable QR (free automated check)"}
        >
          <AlertTriangle size={14} />
          {th ? "ต้องตรวจสอบ" : "Needs review"} ({flaggedCount})
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px", maxWidth: 360 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ค้นหา" : "Search"}</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={th ? "ชื่อ หรือ รหัสนักศึกษา" : "Name or student ID"}
              style={{ ...inputStyle, paddingLeft: 32 }}
            />
          </div>
        </div>
        {!productId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "สินค้า" : "Product"}</label>
            <FilterDropdown
              value={productFilter}
              onChange={pickProduct}
              options={[{ value: "all", label: th ? "ทุกสินค้า" : "All products" }, ...productNames.map((n) => ({ value: n, label: n }))]}
            />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ตั้งแต่วันที่" : "From date"}</label>
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{th ? "ถึงวันที่" : "To date"}</label>
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {([
            [0, th ? "วันนี้" : "Today"],
            [6, th ? "7 วัน" : "7 days"],
            [29, th ? "30 วัน" : "30 days"],
          ] as const).map(([back, label]) => {
            const from = ymdDaysAgo(back), to = ymdDaysAgo(0);
            const active = fromDate === from && toDate === to;
            return (
              <button key={back} onClick={() => { setFromDate(from); setToDate(to); }} className={active ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "9px 12px" }}>{label}</button>
            );
          })}
        </div>
        {hasExtraFilter && (
          <button onClick={() => { setProductFilter("all"); setFromDate(""); setToDate(""); setSearch(""); setFlaggedOnly(false); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "9px 12px", display: "inline-flex", alignItems: "center", gap: 4 }}><X size={14} />{th ? "ล้างตัวกรอง" : "Clear"}</button>
        )}
      </div>

      {productId && <OptionSummary th={th} orders={base} productId={productId} filtered={hasExtraFilter} />}

      {actionError && <p style={{ color: "var(--red-500)", fontSize: 13, margin: "0 0 12px" }}>{actionError}</p>}

      {shown.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ไม่มีคำสั่งซื้อ" : "No orders."}</p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 14 }}>
            {pageOrders.map((o) => <AdminOrderRow key={o.id} order={o} th={th} busy={busy === o.id} scoped={ctx?.scoped ?? false} onReview={review} onEdit={() => setEditing(o)} onFulfil={fulfil} />)}
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

      {fulfilling && (
        <FulfilModal
          th={th}
          order={fulfilling.order}
          action={fulfilling.action}
          busy={busy === fulfilling.order.id}
          error={fulfilError}
          onCancel={() => { setFulfilling(null); setFulfilError(null); }}
          onConfirm={(req) => submitFulfil(fulfilling.order, req)}
        />
      )}

      {scanning && <ShopHandoverScanner th={th} onClose={() => setScanning(false)} onHandedOver={load} />}

      {editing && (
        <EditOrderModal
          th={th}
          order={editing}
          productById={productById}
          productsLoaded={productsLoaded}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// Custom confirmation modal for the two non-trivial order actions: rejecting
// (needs a buyer-visible reason) and reverting an approved/rejected order back
// to pending. Mirrors ProductForm's overlay styling.
export function ReviewModal({ th, order, action, busy, onCancel, onConfirm }: {
  th: boolean; order: AdminOrder; action: "reject" | "revert"; busy: boolean;
  onCancel: () => void; onConfirm: (rejectionReason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isReject = action === "reject";
  const buyerName = order.buyer.name ?? order.buyer.nickname ?? (th ? "ผู้ซื้อรายนี้" : "this buyer");

  const confirm = () => onConfirm(isReject ? reason.trim() : undefined);

  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgb(var(--scrim-rgb) / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 460, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {isReject ? <XCircle size={18} style={{ color: "var(--red-500)" }} /> : <RotateCcw size={18} style={{ color: "var(--amber-700)" }} />}
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
              ...(isReject ? { color: "var(--text-on-color)", background: "var(--red-500)" } : {}),
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

// Per-order money breakdown: subtotal → discount → shipping → total charged,
// who receives the money, and where the payment stands. Subtotal is derived
// from the charged total (orderBreakdown), so it reconciles even when a scoped
// viewer only sees their own lines of a mixed order.
export function OrderFinanceSummary({ order, th }: { order: AdminOrder; th: boolean }) {
  const f = orderBreakdown(order);
  const status = ORDER_BADGE[order.status] ?? ORDER_BADGE.pending;
  const when = (d: string) => new Date(d).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const line = (label: string, value: string, color?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color }}>
      <span>{label}</span><span style={{ whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
  return (
    <div style={{ fontSize: 13, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 12px", marginBottom: 8, display: "grid", gap: 4 }}>
      <p style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 2 }}><Wallet size={14} />{th ? "สรุปการเงิน" : "Financial summary"}</p>
      {line(th ? "ราคาสินค้า" : "Subtotal", baht(f.subtotal), "var(--text-secondary)")}
      {f.discount > 0 && line(th ? "ส่วนลดโปรโมชัน" : "Promotion discount", `−${baht(f.discount)}`, "var(--emerald-500)")}
      {f.shipping > 0 && line(th ? "ค่าจัดส่ง" : "Shipping", baht(f.shipping), "var(--text-secondary)")}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
        <span>{th ? "ยอดชำระ" : "Total charged"}</span><span>{baht(f.total)}</span>
      </div>
      {line(th ? "ผู้รับเงิน" : "Paid to", order.sellerName || (th ? "ส่วนกลาง (SMO)" : "Central (SMO)"), "var(--text-muted)")}
      {line(
        th ? "สถานะการชำระ" : "Payment",
        `${th ? status.th : status.en}${!order.hasSlip ? (th ? " · ไม่มีสลิป" : " · no slip") : ""}`,
        status.color,
      )}
      {order.reviewedAt && order.status !== "pending" && (
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {th ? "ตรวจโดย " : "Reviewed by "}{order.reviewerName ?? "—"} · {when(order.reviewedAt)}
        </p>
      )}
    </div>
  );
}

export function AdminOrderRow({ order, th, busy, scoped, onReview, onEdit, onFulfil }: { order: AdminOrder; th: boolean; busy: boolean; scoped: boolean; onReview: (o: AdminOrder, a: "approve" | "reject" | "revert") => void; onEdit: () => void; onFulfil: (o: AdminOrder, a: StaffFulfillmentAction) => void }) {
  const [showSlip, setShowSlip] = useState(order.status === "pending");
  const badge = ORDER_BADGE[order.status] ?? ORDER_BADGE.pending;
  // A scoped president may only review an order that is entirely theirs — a mixed
  // order (also has another team's items) is shown read-only, reviewed by an admin.
  const reviewLocked = scoped && order.fullyInScope === false;
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          {order.sellerName && <p style={{ fontSize: 12, color: "var(--accent-primary)", fontWeight: 700, marginBottom: 2 }}>{th ? "ผู้ขาย: " : "Seller: "}{order.sellerName}</p>}
          <p style={{ fontWeight: 700, fontSize: 15 }}>{order.buyer.name ?? "—"} {order.buyer.nickname ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({order.buyer.nickname})</span> : null}</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{order.buyer.studentId ?? ""} · {new Date(order.createdAt).toLocaleString(th ? "th-TH" : "en-GB")}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: badge.bg, color: badge.color, height: "fit-content", whiteSpace: "nowrap" }}>{badge.icon}{th ? badge.th : badge.en}</span>
          <FulfillmentChip order={order} th={th} />
        </div>
      </div>

      <div style={{ fontSize: 14, marginBottom: 8 }}>
        {order.items.map((i, idx) => (
          <div key={idx}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {order.status === "approved" && order.fulfillmentStatus === "partial" && (
                  isItemHandedOver(i, order.fulfillmentStatus)
                    ? <CheckCircle2 size={14} aria-label={th ? "ส่งมอบแล้ว" : "Handed over"} style={{ display: "inline-block", color: "var(--green-700)", verticalAlign: "-2px", marginRight: 4 }} />
                    : <Clock size={14} aria-label={th ? "ยังไม่ส่งมอบ" : "Not handed over yet"} style={{ display: "inline-block", color: "var(--text-muted)", verticalAlign: "-2px", marginRight: 4 }} />
                )}
                {i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}
              </span>
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
      </div>

      <OrderFinanceSummary order={order} th={th} />

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
      {order.status === "rejected" && order.rejectionReason && <p style={{ fontSize: 13, color: "var(--red-500)", marginBottom: 8 }}>{th ? "เหตุผล: " : "Reason: "}{order.rejectionReason}</p>}

      {order.slipFlag && SLIP_FLAG_COPY[order.slipFlag] && (() => {
        const flag = SLIP_FLAG_COPY[order.slipFlag];
        const high = flag.severity === "high";
        return (
          <p
            style={{
              fontSize: 13, marginBottom: 8, padding: "8px 12px", borderRadius: 8,
              display: "flex", alignItems: "flex-start", gap: 6,
              background: high ? "rgb(var(--red-500-rgb) / 0.1)" : "rgb(var(--amber-500-rgb) / 0.12)",
              color: high ? "var(--red-600)" : "var(--amber-700)",
              border: `1px solid ${high ? "rgb(var(--red-500-rgb) / 0.25)" : "rgb(var(--amber-500-rgb) / 0.25)"}`,
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

      {!reviewLocked && (
        <button
          onClick={onEdit}
          disabled={busy}
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }}
          title={th ? "แก้ไขตัวเลือก/จำนวน/ช่องกรอก/ที่อยู่จัดส่งของคำสั่งซื้อนี้" : "Fix this order's option, quantity, personalization fields, or delivery details"}
        >
          <Pencil size={14} />{th ? "แก้ไขรายละเอียด" : "Edit details"}
        </button>
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
          <button onClick={() => onReview(order, "reject")} disabled={busy} className="btn btn-ghost" style={{ flex: 1, color: "var(--red-500)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}><XCircle size={16} />{th ? "ปฏิเสธ" : "Reject"}</button>
          <button onClick={() => onReview(order, "approve")} disabled={busy} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{th ? "อนุมัติ" : "Approve"}</button>
        </div>
      ) : !canRevertPayment(order.fulfillmentStatus) ? (
        // The goods already left the seller — payment review is closed until the
        // handover is reset (the server refuses reject/revert here too).
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
          {th ? "ส่งมอบ/จัดส่งแล้ว — ถ้าต้องตรวจการชำระเงินใหม่ ให้ \"ยกเลิกการส่งมอบ\" ก่อน" : "Already shipped/handed over — to re-check the payment, reset the handover first."}
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => onReview(order, "revert")}
            disabled={busy}
            className="btn btn-ghost"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13,
              padding: "6px 12px",
              background: "rgb(var(--amber-500-rgb) / 0.12)", color: "var(--amber-700)",
              border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
            }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}{th ? "ย้อนกลับเป็นรอตรวจสอบ" : "Revert to pending"}
          </button>
        </div>
      )}

      <FulfillmentPanel order={order} th={th} busy={busy} locked={reviewLocked} onAction={(o, a) => onFulfil(order, a)} />
    </div>
  );
}

// Per-item edit draft. `custom` is keyed by the product's custom-field `key`
// (not label — labels are display text, keys are what the API/order-placement
// flow use to address a field).
export interface ItemDraft { itemId: string; productId: string | null; variantId: string; quantity: string; customValue: string; custom: Record<string, string> }

// Rebuild an editable draft for one order line from its current snapshot +
// live product config: resolve the variant (falling back to the product's
// first variant if the original was deleted or is otherwise stale), prefill
// the "Other (specify)" text by stripping it back out of the snapshotted
// "Label: text" variantLabel, and map customValues [{label,value}] back to
// {key: value} by matching against the product's current field labels.
export function initialDraftFor(item: AdminOrderItem, product: AdminProduct | undefined): ItemDraft {
  const variantExists = product?.variants.some((v) => v.id === item.variantId);
  const variantId = variantExists ? (item.variantId as string) : (product?.variants[0]?.id ?? "");
  const variant = product?.variants.find((v) => v.id === variantId);
  let customValue = "";
  if (variant?.allowCustom && item.variantLabel.startsWith(`${variant.label}: `)) {
    customValue = item.variantLabel.slice(variant.label.length + 2);
  }
  const labelToKey = new Map((product?.customFields ?? []).map((f) => [f.label, f.key]));
  const custom: Record<string, string> = {};
  for (const cv of item.customValues ?? []) {
    const key = labelToKey.get(cv.label);
    if (key) custom[key] = cv.value;
  }
  return { itemId: item.id, productId: item.productId, variantId, quantity: String(item.quantity), customValue, custom };
}

// Lets a shop admin/owner correct an order AFTER it was placed — the buyer
// picked the wrong size, ordered the wrong number of units, skipped a
// personalization field, or the delivery address has a typo. Works at any
// order status. Scoped deliberately: only the VARIANT (never the product
// itself, and never adding/removing a line item), quantity, and
// personalization/delivery text are editable, so stock/shipping accounting
// stays simple — see the PUT handler in api/admin/shop/orders/[id]/route.ts.
export function EditOrderModal({ th, order, productById, productsLoaded, onClose, onSaved }: {
  th: boolean; order: AdminOrder; productById: Map<string, AdminProduct>; productsLoaded: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<ItemDraft[]>(() =>
    order.items.map((i) => initialDraftFor(i, i.productId ? productById.get(i.productId) : undefined))
  );
  const [note, setNote] = useState(order.note ?? "");
  const [recipientName, setRecipientName] = useState(order.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(order.recipientPhone ?? "");
  const [shippingAddress, setShippingAddress] = useState(order.shippingAddress ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDraft = (itemId: string, patch: Partial<ItemDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.itemId === itemId ? { ...d, ...patch } : d)));

  const save = async () => {
    setError(null);
    for (const d of drafts) {
      if (!d.productId) { setError(th ? "สินค้าบางรายการถูกลบไปแล้ว แก้ไขไม่ได้" : "One item's product no longer exists and can't be edited."); return; }
      if (!d.variantId) { setError(th ? "กรุณาเลือกตัวเลือกให้ครบทุกรายการ" : "Please choose an option for every item."); return; }
      const qty = Number(d.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        setError(th ? "จำนวนต้องเป็นจำนวนเต็มระหว่าง 1-99" : "Quantity must be a whole number between 1 and 99.");
        return;
      }
      const variant = productById.get(d.productId)?.variants.find((v) => v.id === d.variantId);
      if (variant?.allowCustom && !d.customValue.trim()) {
        setError(th ? `กรุณาระบุรายละเอียดสำหรับ "${variant.label}"` : `Please specify a value for "${variant.label}".`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/shop/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note,
          ...(order.fulfillment === "delivery" ? { recipientName, recipientPhone, shippingAddress } : {}),
          items: drafts.map((d) => ({ id: d.itemId, variantId: d.variantId, quantity: Number(d.quantity), customValue: d.customValue.trim() || undefined, custom: d.custom })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (th ? "บันทึกไม่สำเร็จ" : "Save failed"));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : (th ? "บันทึกไม่สำเร็จ" : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={saving ? undefined : onClose} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgb(var(--scrim-rgb) / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 640, maxHeight: "94vh", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Pencil size={18} />{th ? "แก้ไขรายละเอียดคำสั่งซื้อ" : "Edit order details"}
          </p>
          <button onClick={onClose} disabled={saving} className="btn btn-ghost" style={{ padding: 6 }}><X size={20} /></button>
        </div>

        {!productsLoaded ? (
          <div style={{ padding: 40 }}><Spinner /></div>
        ) : (
          <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {th
                ? "แก้ตัวเลือก/จำนวน/ช่องกรอกที่ผู้ซื้อเลือกผิดหรือลืมกรอก — สินค้ายังเป็นตัวเดิม เปลี่ยนได้แค่ตัวเลือกในตัวสินค้านั้น (ราคาจะคำนวณใหม่เฉพาะเมื่อเปลี่ยนตัวเลือก ไม่ใช่แค่เปลี่ยนจำนวน)"
                : "Correct an option, quantity, or personalization field the buyer got wrong or skipped. The product itself stays the same; only its own options are swappable. Price only recalculates when the option actually changes, not just the quantity."}
            </p>

            {order.items.map((item, idx) => {
              const draft = drafts[idx];
              const product = item.productId ? productById.get(item.productId) : undefined;
              if (!product) {
                return (
                  <div key={item.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 10 }}>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{item.productName}</p>
                    <p style={{ fontSize: 12, color: "var(--red-500)", marginTop: 4 }}>{th ? "สินค้านี้ถูกลบไปแล้ว แก้ไขไม่ได้" : "This product no longer exists and can't be edited."}</p>
                  </div>
                );
              }
              const variant = product.variants.find((v) => v.id === draft.variantId);
              return (
                <div key={item.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 10, display: "flex", flexDirection: "column", gap: 10, background: "var(--bg-base)" }}>
                  <p style={{ fontWeight: 700, fontSize: 14 }}>{product.name}</p>
                  <Field label={th ? "จำนวน" : "Quantity"}>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={draft.quantity}
                      onChange={(e) => setDraft(item.id, { quantity: e.target.value })}
                      style={{ ...inputStyle, width: 100 }}
                    />
                  </Field>
                  {product.variants.length > 1 && (
                    <Field label={th ? "ตัวเลือก / ไซส์" : "Option / Size"}>
                      <FilterDropdown
                        value={draft.variantId}
                        onChange={(v) => setDraft(item.id, { variantId: v, customValue: "" })}
                        options={product.variants.map((v) => ({ value: v.id ?? "", label: v.priceDelta ? `${v.label}  +${baht(v.priceDelta)}` : v.label }))}
                      />
                    </Field>
                  )}
                  {variant?.allowCustom && (
                    <Field label={th ? "ระบุรายละเอียด *" : "Please specify *"}>
                      <input value={draft.customValue} maxLength={120} onChange={(e) => setDraft(item.id, { customValue: e.target.value })} style={inputStyle} />
                    </Field>
                  )}
                  {product.customFields.map((f) => (
                    <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                      {f.type === "select" ? (
                        <FilterDropdown
                          value={draft.custom[f.key] ?? ""}
                          onChange={(v) => setDraft(item.id, { custom: { ...draft.custom, [f.key]: v } })}
                          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
                        />
                      ) : (
                        <input
                          type={f.type === "number" ? "number" : "text"}
                          value={draft.custom[f.key] ?? ""}
                          onChange={(e) => setDraft(item.id, { custom: { ...draft.custom, [f.key]: e.target.value } })}
                          maxLength={f.type === "text" ? (f.maxLength ?? undefined) : undefined}
                          min={f.type === "number" ? (f.min ?? undefined) : undefined}
                          max={f.type === "number" ? (f.max ?? undefined) : undefined}
                          style={inputStyle}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              );
            })}

            <Field label={th ? "หมายเหตุ" : "Note"}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            {order.fulfillment === "delivery" && (
              <>
                <Field label={th ? "ชื่อผู้รับ" : "Recipient name"}>
                  <input value={recipientName} maxLength={120} onChange={(e) => setRecipientName(e.target.value)} style={inputStyle} />
                </Field>
                <Field label={th ? "เบอร์โทรผู้รับ" : "Recipient phone"}>
                  <input value={recipientPhone} maxLength={40} onChange={(e) => setRecipientPhone(e.target.value)} style={inputStyle} />
                </Field>
                <Field label={th ? "ที่อยู่จัดส่ง" : "Shipping address"}>
                  <textarea value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} rows={3} maxLength={1000} style={{ ...inputStyle, resize: "vertical" }} />
                </Field>
              </>
            )}
          </div>
        )}

        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <p style={{ color: "var(--red-500)", fontSize: 13, margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} disabled={saving} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button onClick={save} disabled={saving || !productsLoaded} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {saving && <Loader2 size={16} className="animate-spin" />}<Save size={16} />{th ? "บันทึก" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Finance -------------------------------- */
