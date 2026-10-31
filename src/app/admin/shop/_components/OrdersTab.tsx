"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { orderBreakdown } from "@/lib/shop/shop-finance";
import { Pencil, Loader2, X, CheckCircle2, XCircle, Clock, Save, RotateCcw, FileText, Truck, Store, AlertTriangle, ExternalLink, Wallet, ScanLine, Search } from "lucide-react";
import { EmptyState, ErrorState, InlineAlert, LoadingState, Modal, Toolbar, useToast } from "@/components/admin/ui";
import { isItemHandedOver, type StaffFulfillmentAction } from "@/lib/shop/shop-fulfillment";
import ShopHandoverScanner from "../ShopHandoverScanner";
import { FulfillmentChip, FulfillmentPanel, FulfilModal, canRevertPayment, type FulfilRequest } from "../ShopFulfillmentControls";
import { isHttpUrl, SLIP_FLAG_COPY, baht, ymdDaysAgo, PAGE_SIZE, type AdminProduct, type ShopContext, type AdminOrder, type OrderFilter, matchesOrderFilter, type AdminOrderItem } from "./shop-model";
import { Field, Pagination, FilterDropdown, OrderStatusBadge } from "./ui";
import { OptionSummary } from "./OptionSummary";

// `productId` pins the tab to a single product (the /admin/shop/[productId] page):
// only orders with a line for that product are shown and the product dropdown is hidden.
export function OrdersTab({ th, ctx, productId, onPendingCount }: { th: boolean; ctx: ShopContext | null; productId?: string; onPendingCount?: (n: number) => void }) {
  const router = useRouter();
  const toast = useToast();
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
  // "No orders" list). A failed approve/reject/revert is shown as a toast.
  const [loadError, setLoadError] = useState(false);
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
    const who = o.buyer.name ?? o.buyer.nickname ?? (th ? "ผู้ซื้อ" : "the buyer");
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
      toast.success(
        action === "approve" ? (th ? `อนุมัติคำสั่งซื้อของ ${who} แล้ว` : `Approved ${who}'s order`)
          : action === "reject" ? (th ? `ปฏิเสธคำสั่งซื้อของ ${who} แล้ว` : `Rejected ${who}'s order`)
          : (th ? `ย้อนคำสั่งซื้อของ ${who} เป็นรอตรวจสอบแล้ว` : `Moved ${who}'s order back to pending`),
      );
      load();
    } catch (e) {
      // A 4xx/5xx or network error must not read as success — surface it.
      toast.error(
        action === "approve" ? (th ? "อนุมัติไม่สำเร็จ" : "Couldn't approve the order") : action === "reject" ? (th ? "ปฏิเสธไม่สำเร็จ" : "Couldn't reject the order") : (th ? "ย้อนกลับไม่สำเร็จ" : "Couldn't revert the order"),
        e instanceof Error ? e.message : (th ? "ดำเนินการไม่สำเร็จ" : "Action failed"),
      );
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
      const who = o.buyer.name ?? o.buyer.nickname ?? (th ? "ผู้ซื้อ" : "the buyer");
      toast.success(
        req.action === "ready" ? (th ? `แจ้ง ${who} ว่าพร้อมให้รับแล้ว` : `Told ${who} the order is ready`)
          : req.action === "ship" ? (th ? `บันทึกการจัดส่งของ ${who} และแจ้งผู้ซื้อแล้ว` : `Saved shipping for ${who} and notified them`)
          : req.action === "handover" ? (th ? `บันทึกการส่งมอบให้ ${who} แล้ว` : `Recorded the handover to ${who}`)
          : (th ? `ยกเลิกการส่งมอบของ ${who} แล้ว` : `Reset the handover for ${who}`),
      );
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (th ? "ดำเนินการไม่สำเร็จ" : "Action failed");
      // Inside the dialog, keep it open with the error so typed input isn't lost.
      if (req.action === "ready") toast.error(th ? "แจ้งผู้ซื้อไม่สำเร็จ" : "Couldn't notify the buyer", msg); else setFulfilError(msg);
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

  const pendingTotal = productId ? null : orders.filter((o) => o.status === "pending").length;
  // Tell the page shell how many orders still need a payment review (tab badge).
  useEffect(() => {
    if (pendingTotal != null) onPendingCount?.(pendingTotal);
  }, [pendingTotal, onPendingCount]);

  if (loading) return <LoadingState variant="skeleton" rows={4} label={th ? "กำลังโหลดคำสั่งซื้อ" : "Loading orders"} />;
  if (loadError) return <ErrorState title={th ? "โหลดคำสั่งซื้อไม่สำเร็จ" : "Couldn't load orders"} onRetry={() => { setLoading(true); load(); }} />;

  const pill = (_active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({ fontSize: 13, padding: "6px 14px", ...extra });
  const groupLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginRight: 2 };

  return (
    <div>
      {productId && (
        <h2 className="adm-panel-title" style={{ fontSize: 20, marginBottom: 14, overflowWrap: "anywhere" }}>
          {pinnedProduct?.name ?? (productsLoaded ? (th ? "สินค้า" : "Product") : "…")} · {th ? "คำสั่งซื้อ" : "Orders"}
        </h2>
      )}
      {/* The pickup-counter action: its own row so it's the obvious big button on a phone. */}
      <button onClick={() => setScanning(true)} className="btn btn-primary" style={{ width: "100%", maxWidth: 360, marginBottom: 16 }}>
        <ScanLine size={18} aria-hidden="true" />{th ? "ส่งมอบสินค้า (สแกน Digital ID)" : "Hand over items (scan Digital ID)"}
      </button>

      {/* Status filters. Counts follow the product / date / search filters below,
          and "Pending" is the work queue, so it leads. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <div role="group" aria-label={th ? "กรองตามการชำระเงิน" : "Filter by payment"} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={groupLabel}>{th ? "การชำระเงิน" : "Payment"}</span>
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={pill(filter === f)}>
              {f === "all" ? (th ? "ทั้งหมด" : "All") : f === "pending" ? (th ? "รอตรวจสอบ" : "Pending") : f === "approved" ? (th ? "อนุมัติ" : "Approved") : (th ? "ปฏิเสธ" : "Rejected")}
              {" "}({base.filter((o) => matchesOrderFilter(o, f)).length})
            </button>
          ))}
        </div>
        <div role="group" aria-label={th ? "กรองตามการส่งมอบ" : "Filter by handover"} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={groupLabel}>{th ? "การส่งมอบ" : "Handover"}</span>
          {(["to_fulfil", "shipped", "issue"] as const).map((f) => {
            const count = base.filter((o) => matchesOrderFilter(o, f)).length;
            // Hide the empty "problem" filter so it only draws the eye when needed.
            if (f === "issue" && count === 0 && filter !== "issue") return null;
            return (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={filter === f ? "btn btn-primary" : "btn btn-ghost"} style={pill(filter === f, f === "issue" && filter !== f ? { color: "var(--red-600)" } : {})}>
                {f === "issue" && <AlertTriangle size={14} aria-hidden="true" />}
                {f === "to_fulfil" ? (th ? "รอส่งมอบ" : "To hand over") : f === "shipped" ? (th ? "จัดส่งแล้ว" : "Shipped") : (th ? "แจ้งปัญหา" : "Problem")}
                {" "}({count})
              </button>
            );
          })}
          <button
            onClick={() => setFlaggedOnly((v) => !v)}
            aria-pressed={flaggedOnly}
            className={flaggedOnly ? "btn btn-primary" : "btn btn-ghost"}
            style={pill(flaggedOnly, flaggedOnly ? {} : { color: "var(--amber-700)" })}
            title={th ? "คำสั่งซื้อที่สลิปซ้ำหรือไม่พบ QR (ตรวจอัตโนมัติ ฟรี)" : "Orders whose slip is a duplicate or has no readable QR (free automated check)"}
          >
            <AlertTriangle size={14} aria-hidden="true" />
            {th ? "สลิปต้องตรวจเพิ่ม" : "Slip needs a look"} ({flaggedCount})
          </button>
        </div>
      </div>

      <Toolbar>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", width: "100%" }}>
          <Field label={th ? "ค้นหา" : "Search"} style={{ flex: "1 1 240px", maxWidth: 360 }}>
            <div style={{ position: "relative" }}>
              <Search size={15} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                type="search"
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={th ? "ชื่อ หรือ รหัสนักศึกษา" : "Name or student ID"}
                style={{ paddingLeft: 32 }}
              />
            </div>
          </Field>
          {!productId && (
            <Field label={th ? "สินค้า" : "Product"}>
              <FilterDropdown
                ariaLabel={th ? "สินค้า" : "Product"}
                value={productFilter}
                onChange={pickProduct}
                options={[{ value: "all", label: th ? "ทุกสินค้า" : "All products" }, ...productNames.map((n) => ({ value: n, label: n }))]}
              />
            </Field>
          )}
          <Field label={th ? "ตั้งแต่วันที่" : "From date"}>
            <input type="date" className="input" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} style={{ width: "auto" }} />
          </Field>
          <Field label={th ? "ถึงวันที่" : "To date"}>
            <input type="date" className="input" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} style={{ width: "auto" }} />
          </Field>
          <div role="group" aria-label={th ? "ช่วงเวลาลัด" : "Date shortcuts"} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([
              [0, th ? "วันนี้" : "Today"],
              [6, th ? "7 วัน" : "7 days"],
              [29, th ? "30 วัน" : "30 days"],
            ] as const).map(([back, label]) => {
              const from = ymdDaysAgo(back), to = ymdDaysAgo(0);
              const active = fromDate === from && toDate === to;
              return (
                <button key={back} onClick={() => { setFromDate(from); setToDate(to); }} aria-pressed={active} className={active ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13, padding: "9px 12px" }}>{label}</button>
              );
            })}
          </div>
          {hasExtraFilter && (
            <button onClick={() => { setProductFilter("all"); setFromDate(""); setToDate(""); setSearch(""); setFlaggedOnly(false); }} className="btn btn-ghost" style={{ fontSize: 13, padding: "9px 12px" }}><X size={14} aria-hidden="true" />{th ? "ล้างตัวกรอง" : "Clear filters"}</button>
          )}
        </div>
      </Toolbar>

      {productId && <OptionSummary th={th} orders={base} productId={productId} filtered={hasExtraFilter} />}

      {shown.length === 0 ? (
        <EmptyState
          icon={<Search size={24} />}
          title={hasExtraFilter ? (th ? "ไม่พบคำสั่งซื้อที่ตรงกับตัวกรอง" : "No orders match your filters") : filter === "pending" ? (th ? "ไม่มีคำสั่งซื้อที่รอตรวจสอบ" : "Nothing waiting for review") : (th ? "ไม่มีคำสั่งซื้อในหมวดนี้" : "No orders here")}
          description={hasExtraFilter
            ? (th ? "ลองล้างตัวกรองหรือค้นหาด้วยคำอื่น" : "Try clearing the filters or searching for something else.")
            : filter === "pending"
              ? (th ? "ตรวจสลิปครบแล้ว เมื่อมีคนสั่งสินค้าใหม่ คำสั่งซื้อจะมาอยู่ที่นี่" : "You're all caught up. New orders appear here when someone buys.")
              : (th ? "ดูหมวด \"ทั้งหมด\" เพื่อเห็นทุกคำสั่งซื้อ" : "Switch to \"All\" to see every order.")}
          action={hasExtraFilter
            ? <button onClick={() => { setProductFilter("all"); setFromDate(""); setToDate(""); setSearch(""); setFlaggedOnly(false); }} className="btn btn-ghost">{th ? "ล้างตัวกรอง" : "Clear filters"}</button>
            : filter !== "all" ? <button onClick={() => setFilter("all")} className="btn btn-ghost">{th ? "ดูทั้งหมด" : "Show all orders"}</button> : undefined}
        />
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

// Confirmation for the two non-trivial order actions: rejecting (with a reason
// the buyer sees) and reverting an approved/rejected order back to pending.
export function ReviewModal({ th, order, action, busy, onCancel, onConfirm }: {
  th: boolean; order: AdminOrder; action: "reject" | "revert"; busy: boolean;
  onCancel: () => void; onConfirm: (rejectionReason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isReject = action === "reject";
  const buyerName = order.buyer.name ?? order.buyer.nickname ?? (th ? "ผู้ซื้อรายนี้" : "this buyer");

  const confirm = () => onConfirm(isReject ? reason.trim() : undefined);

  return (
    <Modal
      open
      onClose={onCancel}
      dismissible={!busy}
      size="sm"
      icon={isReject ? <XCircle size={20} /> : <RotateCcw size={20} />}
      title={isReject ? (th ? `ปฏิเสธคำสั่งซื้อของ ${buyerName}` : `Reject ${buyerName}'s order`) : (th ? "ย้อนกลับเป็นรอตรวจสอบ" : "Revert to pending")}
      description={isReject
        ? (th ? "ผู้ซื้อจะเห็นเหตุผลด้านล่าง" : "The buyer will see the reason below.")
        : (th ? `ย้อนคำสั่งซื้อของ ${buyerName} กลับเป็น "รอตรวจสอบ" เพื่อตรวจใหม่` : `Send ${buyerName}'s order back to "pending" to re-check it.`)}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost">{th ? "ยกเลิก" : "Cancel"}</button>
          <button type="button" onClick={confirm} disabled={busy} className={isReject ? "btn adm-btn-danger-solid" : "btn btn-primary"}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : (isReject ? <XCircle size={16} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />)}
            {isReject ? (th ? "ปฏิเสธคำสั่งซื้อ" : "Reject order") : (th ? "ย้อนกลับ" : "Revert to pending")}
          </button>
        </>
      }
    >
      {isReject && (
        <Field label={th ? "เหตุผลที่ปฏิเสธ (ผู้ซื้อจะเห็น)" : "Rejection reason (buyer will see)"} hint={th ? "ไม่บังคับ แต่ช่วยให้ผู้ซื้อรู้ว่าต้องแก้อะไร" : "Optional, but it tells the buyer what to fix."}>
          <textarea
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={th ? "เช่น สลิปไม่ชัด / ยอดเงินไม่ตรง" : "e.g. Slip unclear / amount doesn't match"}
            style={{ resize: "vertical" }}
          />
        </Field>
      )}
    </Modal>
  );
}

// Per-order money breakdown: subtotal → discount → shipping → total charged,
// who receives the money, and where the payment stands. Subtotal is derived
// from the charged total (orderBreakdown), so it reconciles even when a scoped
// viewer only sees their own lines of a mixed order.
export function OrderFinanceSummary({ order, th }: { order: AdminOrder; th: boolean }) {
  const f = orderBreakdown(order);
  const when = (d: string) => new Date(d).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const line = (label: string, value: string, color?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color }}>
      <span>{label}</span><span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
  return (
    <div style={{ fontSize: 13, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 12px", marginBottom: 8, display: "grid", gap: 4 }}>
      <p style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 2 }}><Wallet size={14} />{th ? "สรุปการเงิน" : "Financial summary"}</p>
      {line(th ? "ราคาสินค้า" : "Subtotal", baht(f.subtotal), "var(--text-secondary)")}
      {f.discount > 0 && line(th ? "ส่วนลดโปรโมชัน" : "Promotion discount", `−${baht(f.discount)}`, "var(--emerald-500)")}
      {f.shipping > 0 && line(th ? "ค่าจัดส่ง" : "Shipping", baht(f.shipping), "var(--text-secondary)")}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
        <span>{th ? "ยอดชำระ" : "Total charged"}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{baht(f.total)}</span>
      </div>
      {line(th ? "ผู้รับเงิน" : "Paid to", order.sellerName || (th ? "ส่วนกลาง (SMO)" : "Central (SMO)"), "var(--text-muted)")}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
        <span>{th ? "สถานะการชำระ" : "Payment"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {!order.hasSlip && <span>{th ? "ไม่มีสลิป" : "no slip"}</span>}
          <OrderStatusBadge status={order.status} th={th} />
        </span>
      </div>
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
  const [slipFailed, setSlipFailed] = useState(false);
  // A scoped president may only review an order that is entirely theirs — a mixed
  // order (also has another team's items) is shown read-only, reviewed by an admin.
  const reviewLocked = scoped && order.fullyInScope === false;
  return (
    <article className="adm-panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          {order.sellerName && <p style={{ fontSize: 12, color: "var(--accent-primary)", fontWeight: 700, marginBottom: 2 }}>{th ? "ผู้ขาย: " : "Seller: "}{order.sellerName}</p>}
          <p style={{ fontWeight: 700, fontSize: 15 }}>{order.buyer.name ?? "—"} {order.buyer.nickname ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({order.buyer.nickname})</span> : null}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{order.buyer.studentId ?? ""} · {new Date(order.createdAt).toLocaleString(th ? "th-TH" : "en-GB")}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <OrderStatusBadge status={order.status} th={th} />
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
                    ? <CheckCircle2 size={14} role="img" aria-label={th ? "ส่งมอบแล้ว" : "Handed over"} style={{ display: "inline-block", color: "var(--green-700)", verticalAlign: "-2px", marginRight: 4 }} />
                    : <Clock size={14} role="img" aria-label={th ? "ยังไม่ส่งมอบ" : "Not handed over yet"} style={{ display: "inline-block", color: "var(--text-muted)", verticalAlign: "-2px", marginRight: 4 }} />
                )}
                {i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}
              </span>
              <span style={{ color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{baht(i.unitPrice * i.quantity)}</span>
            </div>
            {i.customValues && i.customValues.length > 0 && (
              <div style={{ fontSize: 13, color: "var(--accent-primary)", paddingLeft: 2, marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
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
      {order.status === "rejected" && order.rejectionReason && <p style={{ fontSize: 13, color: "var(--red-600)", marginBottom: 8 }}>{th ? "เหตุผล: " : "Reason: "}{order.rejectionReason}</p>}

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
            <button onClick={() => setShowSlip((s) => !s)} aria-expanded={showSlip} className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }}>{showSlip ? (th ? "ซ่อนสลิป" : "Hide slip") : (th ? "ดูสลิป" : "View slip")}</button>
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
          {showSlip && (slipFailed ? (
            <InlineAlert tone="warning">{th ? "โหลดรูปสลิปไม่สำเร็จ ลองเปิดในแท็บใหม่" : "The slip image didn't load. Try opening it in a new tab."}</InlineAlert>
          ) : (
            // Same auth-guarded URL as before; nothing is cached client-side.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/shop/orders/${order.id}/slip`} alt={th ? `สลิปการโอนเงินของ ${order.buyer.name ?? "ผู้ซื้อ"}` : `Payment slip from ${order.buyer.name ?? "the buyer"}`} onError={() => setSlipFailed(true)} style={{ width: "100%", maxHeight: 400, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-base)", marginBottom: 10 }} />
          ))}
          {showSlip && (
            <a href={`/api/shop/orders/${order.id}/slip`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px", marginBottom: 10 }}>
              <ExternalLink size={13} aria-hidden="true" />{th ? "เปิดสลิปขนาดเต็ม" : "Open slip full size"}
            </a>
          )}
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
          <button onClick={() => onReview(order, "reject")} disabled={busy} className="btn btn-ghost" style={{ flex: 1, color: "var(--red-600)" }}><XCircle size={16} aria-hidden="true" />{th ? "ปฏิเสธ" : "Reject"}</button>
          <button onClick={() => onReview(order, "approve")} disabled={busy} className="btn btn-primary" style={{ flex: 2 }}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{busy ? (th ? "กำลังอนุมัติ…" : "Approving…") : (th ? "อนุมัติ" : "Approve")}</button>
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
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}{th ? "ย้อนกลับเป็นรอตรวจสอบ" : "Revert to pending"}
          </button>
        </div>
      )}

      <FulfillmentPanel order={order} th={th} busy={busy} locked={reviewLocked} onAction={(o, a) => onFulfil(order, a)} />
    </article>
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
  const toast = useToast();

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
      toast.success(th ? "บันทึกคำสั่งซื้อแล้ว" : "Order updated");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : (th ? "บันทึกไม่สำเร็จ" : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const buyerName = order.buyer.name ?? order.buyer.nickname ?? (th ? "ผู้ซื้อ" : "the buyer");

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      icon={<Pencil size={20} />}
      title={th ? `แก้ไขรายละเอียดคำสั่งซื้อของ ${buyerName}` : `Edit ${buyerName}'s order`}
      description={th
        ? "แก้ตัวเลือก/จำนวน/ช่องกรอกที่ผู้ซื้อเลือกผิดหรือลืมกรอก — สินค้ายังเป็นตัวเดิม เปลี่ยนได้แค่ตัวเลือกในตัวสินค้านั้น (ราคาจะคำนวณใหม่เฉพาะเมื่อเปลี่ยนตัวเลือก ไม่ใช่แค่เปลี่ยนจำนวน)"
        : "Correct an option, quantity, or personalization field the buyer got wrong or skipped. The product itself stays the same; only its own options are swappable. Price only recalculates when the option actually changes, not just the quantity."}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-ghost">{th ? "ยกเลิก" : "Cancel"}</button>
          <button type="button" onClick={save} disabled={saving || !productsLoaded} className="btn btn-primary">
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save")}
          </button>
        </>
      }
    >
      {!productsLoaded ? (
        <LoadingState compact />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <InlineAlert tone="error">{error}</InlineAlert>}

          {order.items.map((item, idx) => {
            const draft = drafts[idx];
            const product = item.productId ? productById.get(item.productId) : undefined;
            if (!product) {
              return (
                <div key={item.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 10 }}>
                  <p style={{ fontWeight: 700, fontSize: 14 }}>{item.productName}</p>
                  <p style={{ fontSize: 13, color: "var(--red-600)", marginTop: 4 }}>{th ? "สินค้านี้ถูกลบไปแล้ว แก้ไขไม่ได้" : "This product no longer exists and can't be edited."}</p>
                </div>
              );
            }
            const variant = product.variants.find((v) => v.id === draft.variantId);
            return (
              <div key={item.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 12, display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-base)" }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{product.name}</p>
                <Field label={th ? "จำนวน" : "Quantity"}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={draft.quantity}
                    onChange={(e) => setDraft(item.id, { quantity: e.target.value })}
                    className="input"
                    style={{ width: 100 }}
                  />
                </Field>
                {product.variants.length > 1 && (
                  <Field label={th ? "ตัวเลือก / ไซส์" : "Option / Size"}>
                    <FilterDropdown
                      ariaLabel={th ? "ตัวเลือก / ไซส์" : "Option / Size"}
                      maxWidth={420}
                      value={draft.variantId}
                      onChange={(v) => setDraft(item.id, { variantId: v, customValue: "" })}
                      options={product.variants.map((v) => ({ value: v.id ?? "", label: v.priceDelta ? `${v.label}  +${baht(v.priceDelta)}` : v.label }))}
                    />
                  </Field>
                )}
                {variant?.allowCustom && (
                  <Field label={th ? "ระบุรายละเอียด" : "Please specify"} required>
                    <input value={draft.customValue} maxLength={120} onChange={(e) => setDraft(item.id, { customValue: e.target.value })} className="input" />
                  </Field>
                )}
                {product.customFields.map((f) => (
                  <Field key={f.key} label={f.label} required={f.required}>
                    {f.type === "select" ? (
                      <FilterDropdown
                        ariaLabel={f.label}
                        maxWidth={420}
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
                        className="input"
                      />
                    )}
                  </Field>
                ))}
              </div>
            );
          })}

          <Field label={th ? "หมายเหตุ" : "Note"}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="input" style={{ resize: "vertical" }} />
          </Field>

          {order.fulfillment === "delivery" && (
            <>
              <Field label={th ? "ชื่อผู้รับ" : "Recipient name"}>
                <input value={recipientName} maxLength={120} onChange={(e) => setRecipientName(e.target.value)} className="input" />
              </Field>
              <Field label={th ? "เบอร์โทรผู้รับ" : "Recipient phone"}>
                <input type="tel" inputMode="tel" value={recipientPhone} maxLength={40} onChange={(e) => setRecipientPhone(e.target.value)} className="input" />
              </Field>
              <Field label={th ? "ที่อยู่จัดส่ง" : "Shipping address"}>
                <textarea value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} rows={3} maxLength={1000} className="input" style={{ resize: "vertical" }} />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------- Finance -------------------------------- */
