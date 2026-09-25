"use client";

import { useState } from "react";
import {
  SHOP_CARRIERS, blocksPaymentReview, carrierLabel, daysUntilAutoConfirm, findCarrier, isItemHandedOver, nextFulfillmentStatus,
  trackingLinkFor, validateShipment, type ShipmentError, type StaffFulfillmentAction,
} from "@/lib/shop-fulfillment";
import { AlertTriangle, Bell, CheckCircle2, ExternalLink, Loader2, PackageCheck, RotateCcw, Truck, X } from "lucide-react";

// Handover (fulfilment) UI for one admin order card, plus the ship / handover /
// reset dialog. Button visibility comes from nextFulfillmentStatus — the same
// table the server enforces — so a button is never shown that would 409.

export interface FulfillmentFields {
  id: string;
  status: string;
  fulfillment: string;
  fulfillmentStatus: string;
  readyAt: string | null;
  carrier: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  fulfilledAt: string | null;
  fulfilledVia: string | null;
  fulfilledByName: string | null;
  fulfillmentNote: string | null;
  issueNote: string | null;
  issueAt: string | null;
  buyer: { name: string | null; nickname: string | null };
  items: { id: string; productName: string; variantLabel: string; quantity: number; handedOverAt?: string | null }[];
}

export type FulfilRequest = { action: StaffFulfillmentAction; carrier?: string; carrierName?: string; trackingNumber?: string; trackingUrl?: string; note?: string; itemIds?: string[] };

// Lines of this order still waiting to be handed over in person.
const waitingLines = (order: FulfillmentFields) => order.items.filter((i) => !isItemHandedOver(i, order.fulfillmentStatus));

const fmt = (d: string | null, th: boolean) => (d ? new Date(d).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

// Small chip for the card header, next to the payment badge.
export function FulfillmentChip({ order, th }: { order: FulfillmentFields; th: boolean }) {
  if (order.status !== "approved") return null;
  const s = order.fulfillmentStatus;
  const c = s === "picked_up" || s === "delivered"
    ? { bg: "rgba(22,163,74,0.12)", color: "#15803d", th: s === "picked_up" ? "รับแล้ว" : "ส่งถึงแล้ว", en: s === "picked_up" ? "Picked up" : "Delivered" }
    : s === "shipped" ? { bg: "rgba(59,130,246,0.12)", color: "#1d4ed8", th: "จัดส่งแล้ว", en: "Shipped" }
    : s === "issue" ? { bg: "rgba(239,68,68,0.12)", color: "#dc2626", th: "แจ้งปัญหา", en: "Problem" }
    : s === "ready" ? { bg: "rgba(124,58,237,0.12)", color: "#6d28d9", th: "พร้อมให้รับ", en: "Ready for pickup" }
    : s === "partial" ? (() => {
        const done = order.items.length - waitingLines(order).length;
        return { bg: "rgba(245,158,11,0.14)", color: "#b45309", th: `ส่งมอบแล้ว ${done}/${order.items.length}`, en: `Handed ${done}/${order.items.length}` };
      })()
    : { bg: "var(--bg-base)", color: "var(--text-muted)", th: "รอส่งมอบ", en: "To hand over" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: c.bg, color: c.color, whiteSpace: "nowrap" }}>
      {th ? c.th : c.en}
    </span>
  );
}

// The fulfilment block on an approved order card.
export function FulfillmentPanel({ order, th, busy, locked, onAction }: {
  order: FulfillmentFields; th: boolean; busy: boolean; locked: boolean;
  onAction: (order: FulfillmentFields, action: StaffFulfillmentAction) => void;
}) {
  if (order.status !== "approved") return null;
  const s = order.fulfillmentStatus;
  const delivery = order.fulfillment === "delivery";
  const can = (a: StaffFulfillmentAction) => !locked && nextFulfillmentStatus(order, a) !== null;
  const link = trackingLinkFor(order.carrier, order.trackingUrl);
  const who = order.fulfilledVia === "buyer" ? (th ? "ผู้ซื้อยืนยันรับของ" : "buyer confirmed")
    : order.fulfilledVia === "auto" ? (th ? `ยืนยันอัตโนมัติ (ไม่ตอบกลับ)` : "auto-confirmed (no reply)")
    : order.fulfilledVia === "qr" ? (th ? `สแกน Digital ID โดย ${order.fulfilledByName ?? "—"}` : `Digital ID scan by ${order.fulfilledByName ?? "—"}`)
    : (th ? `บันทึกโดย ${order.fulfilledByName ?? "—"}` : `marked by ${order.fulfilledByName ?? "—"}`);

  // 40px tall: these are tapped on a phone at a busy counter.
  const btn = { fontSize: 13, padding: "8px 14px", minHeight: 40, display: "inline-flex", alignItems: "center", gap: 6 } as const;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {th ? "การส่งมอบสินค้า" : "Handover"}
      </p>

      {(s === "picked_up" || s === "delivered") && (
        <p style={{ fontSize: 13, color: "#15803d", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {s === "picked_up" ? (th ? "ผู้ซื้อรับสินค้าแล้ว" : "Picked up") : (th ? "ส่งถึงผู้ซื้อแล้ว" : "Delivered")} · {fmt(order.fulfilledAt, th)} · {who}
            {order.fulfillmentNote ? <><br /><span style={{ color: "var(--text-secondary)" }}>{order.fulfillmentNote}</span></> : null}
          </span>
        </p>
      )}

      {s === "partial" && (
        <p style={{ fontSize: 13, color: "#b45309" }}>
          {th ? `ส่งมอบไปแล้วบางรายการ ยังเหลือ: ` : "Partly handed over. Still waiting: "}
          <strong>{waitingLines(order).map((i) => `${i.productName}${i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} ×${i.quantity}`).join(", ")}</strong>
        </p>
      )}

      {s === "ready" && (
        <p style={{ fontSize: 13, color: "#6d28d9" }}>{th ? `แจ้งผู้ซื้อว่าพร้อมให้รับแล้ว · ${fmt(order.readyAt, th)}` : `Buyer told it's ready · ${fmt(order.readyAt, th)}`}</p>
      )}

      {order.trackingNumber || order.trackingUrl ? (
        <div style={{ fontSize: 13, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", padding: "8px 12px", borderRadius: 8 }}>
          <p style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}><Truck size={14} />{carrierLabel(order.carrier, order.carrierName, th)}</p>
          {order.trackingNumber && <p style={{ fontFamily: "monospace", fontSize: 14, marginTop: 2, userSelect: "all" }}>{order.trackingNumber}</p>}
          <p style={{ color: "var(--text-muted)", marginTop: 2 }}>
            {th ? "ส่งเมื่อ " : "Shipped "}{fmt(order.shippedAt, th)}
            {s === "shipped" && ` · ${th ? `ยืนยันอัตโนมัติในอีก ${daysUntilAutoConfirm(order.shippedAt)} วัน` : `auto-confirms in ${daysUntilAutoConfirm(order.shippedAt)} day(s)`}`}
          </p>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-primary)", marginTop: 4 }}>
              <ExternalLink size={13} />{th ? "หน้าติดตามพัสดุ" : "Tracking page"}
            </a>
          )}
        </div>
      ) : null}

      {order.issueNote && (
        <p style={{ fontSize: 13, color: s === "issue" ? "#dc2626" : "var(--text-muted)", background: s === "issue" ? "rgba(239,68,68,0.08)" : "transparent", padding: s === "issue" ? "8px 12px" : 0, borderRadius: 8, display: "flex", gap: 6 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>{s === "issue" ? (th ? "ผู้ซื้อแจ้งปัญหา" : "Buyer reported a problem") : (th ? "เคยแจ้งปัญหา" : "Earlier problem report")}</strong> · {fmt(order.issueAt, th)}
            <br /><span style={{ overflowWrap: "anywhere" }}>{order.issueNote}</span>
          </span>
        </p>
      )}

      {s === "awaiting" && !locked && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {delivery
            ? (th ? "ส่งทางขนส่ง → กด \"บันทึกการจัดส่ง\" · ส่งเองในมหาวิทยาลัย → สแกน Digital ID ที่ปุ่ม \"ส่งมอบสินค้า\" ด้านบน" : "Mailing it → \"Mark as shipped\". Delivering on campus → scan their Digital ID with \"Hand over items\" at the top.")
            : (th ? "เมื่อของพร้อม กด \"พร้อมให้รับ\" เพื่อแจ้งผู้ซื้อ แล้วสแกน Digital ID ตอนมารับ" : "When it's ready, tap \"Ready for pickup\" to notify the buyer, then scan their Digital ID when they come.")}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {can("ready") && (
          <button onClick={() => onAction(order, "ready")} disabled={busy} className="btn btn-ghost" style={{ ...btn, color: "#6d28d9", border: "1px solid rgba(124,58,237,0.3)" }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}{th ? "พร้อมให้รับ" : "Ready for pickup"}
          </button>
        )}
        {can("ship") && (
          <button onClick={() => onAction(order, "ship")} disabled={busy} className="btn btn-ghost" style={{ ...btn, color: "#1d4ed8", border: "1px solid rgba(59,130,246,0.3)" }}>
            <Truck size={14} />{s === "shipped" ? (th ? "แก้เลขพัสดุ" : "Edit tracking") : s === "issue" ? (th ? "ส่งใหม่" : "Ship again") : (th ? "บันทึกการจัดส่ง" : "Mark as shipped")}
          </button>
        )}
        {can("handover") && (
          <button onClick={() => onAction(order, "handover")} disabled={busy} className="btn btn-primary" style={btn}>
            <PackageCheck size={14} />{delivery && (s === "shipped" || s === "issue") ? (th ? "ปิดว่าส่งถึงแล้ว" : "Mark delivered") : (th ? "ส่งมอบเอง (ไม่สแกน)" : "Hand over manually")}
          </button>
        )}
      </div>
      {/* The undo sits on its own line, away from the forward buttons, so it
          can't be hit by a thumb aiming for "Handed over". It still confirms. */}
      {can("reset") && (
        <button onClick={() => onAction(order, "reset")} disabled={busy} className="btn btn-ghost" style={{ ...btn, alignSelf: "flex-start", fontSize: 12, color: "var(--text-muted)", padding: "6px 10px", marginTop: 2 }}>
          <RotateCcw size={13} />{th ? "ยกเลิกการส่งมอบ (กดผิด)" : "Reset handover (fix a mistake)"}
        </button>
      )}
    </div>
  );
}

// Whether the card should still offer "Revert to pending" (the server refuses
// it once the goods have left the seller).
export const canRevertPayment = (fulfillmentStatus: string) => !blocksPaymentReview(fulfillmentStatus);

const SHIP_ERROR_COPY: Record<ShipmentError, { th: string; en: string }> = {
  unknown_carrier: { th: "เลือกบริษัทขนส่ง", en: "Choose a carrier." },
  carrier_name_required: { th: "พิมพ์ชื่อบริษัทขนส่ง", en: "Type the carrier's name." },
  tracking_number_invalid: { th: "เลขพัสดุไม่ถูกต้อง (ตัวอักษรและตัวเลข 6–40 ตัว)", en: "That tracking number doesn't look right (letters and numbers, 6–40)." },
  tracking_link_invalid: { th: "ลิงก์ต้องขึ้นต้นด้วย https://", en: "The link must start with https://" },
  tracking_required: { th: "ใส่เลขพัสดุ (หรือลิงก์ติดตามสำหรับส่งด่วน)", en: "Enter the tracking number (or the tracking link for a same-day courier)." },
};

// Dialog for the three actions that need input or a confirmation. "ready" has
// no dialog — it just notifies the buyer.
export function FulfilModal({ th, order, action, busy, error, onCancel, onConfirm }: {
  th: boolean; order: FulfillmentFields; action: "ship" | "handover" | "reset"; busy: boolean; error: string | null;
  onCancel: () => void; onConfirm: (req: FulfilRequest) => void;
}) {
  const [carrier, setCarrier] = useState(order.carrier ?? "thailand_post");
  const [carrierName, setCarrierName] = useState(order.carrierName ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // Manual handover has no Digital ID check, so nothing is pre-ticked: staff
  // tick each line they actually hand over. A mailed parcel (shipped/issue) is
  // settled whole, so its lines are fixed.
  const waiting = waitingLines(order);
  const wholeParcel = order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "issue";
  const [picked, setPicked] = useState<Set<string>>(() => new Set(wholeParcel ? waiting.map((i) => i.id) : []));
  const buyerName = order.buyer.name ?? order.buyer.nickname ?? (th ? "ผู้ซื้อ" : "the buyer");
  const selected = findCarrier(carrier);

  const submit = () => {
    if (action === "ship") {
      const v = validateShipment({ carrier, carrierName, trackingNumber, trackingUrl });
      if (!v.ok) { setLocalError(th ? SHIP_ERROR_COPY[v.error].th : SHIP_ERROR_COPY[v.error].en); return; }
      setLocalError(null);
      onConfirm({ action, carrier, carrierName, trackingNumber, trackingUrl });
    } else if (action === "handover") {
      if (picked.size === 0) { setLocalError(th ? "ติ๊กรายการที่ส่งมอบก่อน" : "Tick the items you're handing over."); return; }
      setLocalError(null);
      onConfirm({ action, note: note.trim() || undefined, itemIds: [...picked] });
    } else {
      onConfirm({ action });
    }
  };

  const title = action === "ship" ? (th ? "บันทึกการจัดส่ง" : "Mark as shipped")
    : action === "handover" ? (th ? "ยืนยันการส่งมอบ" : "Confirm handover")
    : (th ? "ยกเลิกการส่งมอบ" : "Reset handover");
  const input = { width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)" } as const;
  const label = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" } as const;

  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 460, maxHeight: "92vh", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {action === "ship" ? <Truck size={18} /> : action === "handover" ? <PackageCheck size={18} /> : <RotateCcw size={18} />}{title}
          </p>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost" style={{ padding: 6 }} aria-label={th ? "ปิด" : "Close"}><X size={20} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          {action === "ship" && (
            <>
              <div>
                <label style={label} htmlFor="ship-carrier">{th ? "บริษัทขนส่ง" : "Carrier"}</label>
                <select id="ship-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} style={input}>
                  {SHOP_CARRIERS.map((c) => <option key={c.id} value={c.id}>{th ? c.th : c.en}</option>)}
                </select>
              </div>
              {carrier === "other" && (
                <div>
                  <label style={label} htmlFor="ship-carrier-name">{th ? "ชื่อบริษัทขนส่ง" : "Carrier name"}</label>
                  <input id="ship-carrier-name" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} maxLength={80} style={input} />
                </div>
              )}
              {selected?.needs !== "link" && (
                <div>
                  <label style={label} htmlFor="ship-number">{th ? "เลขพัสดุ (Tracking number)" : "Tracking number"}{selected?.needs === "number_or_link" ? (th ? " — หรือใส่ลิงก์ด้านล่าง" : " — or a link below") : ""}</label>
                  <input id="ship-number" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} maxLength={80} autoFocus placeholder="EF123456789TH" style={{ ...input, fontFamily: "monospace", textTransform: "uppercase" }} />
                </div>
              )}
              {selected?.needs !== "number" && (
                <div>
                  <label style={label} htmlFor="ship-link">{th ? "ลิงก์ติดตาม (https://…)" : "Tracking link (https://…)"}</label>
                  <input id="ship-link" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} maxLength={1000} placeholder="https://" style={input} />
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {th
                  ? `ผู้ซื้อจะได้รับแจ้งเตือนพร้อมเลขพัสดุ ถ้าผู้ซื้อไม่กด "ได้รับสินค้าแล้ว" ระบบจะปิดคำสั่งซื้อให้อัตโนมัติใน 7 วัน`
                  : "The buyer is notified with the tracking number. If they don't tap \"I received it\", the order completes automatically after 7 days."}
              </p>
            </>
          )}

          {action === "handover" && (
            <>
              <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                {th ? `ติ๊กสินค้าที่ ${buyerName} ได้รับจริงตอนนี้` : `Tick what ${buyerName} actually has in hand now.`}
              </p>
              {!wholeParcel && (
                <p style={{ fontSize: 12.5, color: "#b45309", background: "rgba(245,158,11,0.1)", padding: "8px 10px", borderRadius: 8 }}>
                  {th ? "วิธีนี้ไม่ได้ตรวจตัวตนผู้รับ ถ้าผู้ซื้ออยู่ตรงหน้า ให้ใช้ \"ส่งมอบสินค้า (สแกน Digital ID)\" แทน" : "This doesn't check who is collecting. If the buyer is in front of you, use \"Hand over items (scan Digital ID)\" instead."}
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {waiting.map((i) => {
                  const on = picked.has(i.id);
                  return (
                    <label key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", minHeight: 48, borderRadius: 10, border: `2px solid ${on ? "var(--accent-primary)" : "var(--border-subtle)"}`, cursor: wholeParcel ? "default" : "pointer" }}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={wholeParcel}
                        onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
                        style={{ width: 20, height: 20, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>
                        {i.productName}
                        {i.variantLabel && i.variantLabel !== "Standard" ? <strong> · {i.variantLabel}</strong> : null}
                        <strong> ×{i.quantity}</strong>
                      </span>
                    </label>
                  );
                })}
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={th ? "หมายเหตุ (ไม่บังคับ) เช่น เพื่อนมารับแทน" : "Note (optional), e.g. collected by a friend"} style={input} />
            </>
          )}

          {action === "reset" && (
            <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              {th
                ? `ย้อนคำสั่งซื้อของ ${buyerName} กลับเป็น "รอส่งมอบ"? เลขพัสดุและบันทึกการส่งมอบทุกรายการจะถูกล้าง (ใช้เมื่อกดผิด)`
                : `Send ${buyerName}'s order back to "to hand over"? The tracking and the handover record of every item are cleared (use this to fix a mistake).`}
            </p>
          )}

          {(localError || error) && <p style={{ fontSize: 13, color: "#dc2626" }}>{localError || error}</p>}
        </div>

        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "ยกเลิก" : "Cancel"}</button>
          <button onClick={submit} disabled={busy || (action === "handover" && picked.size === 0)} className="btn btn-primary" style={{ flex: 2, minHeight: 48, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {action === "ship" ? (th ? "บันทึกและแจ้งผู้ซื้อ" : "Save & notify buyer")
              : action === "handover" ? (() => {
                  const qty = waiting.filter((i) => picked.has(i.id)).reduce((n, i) => n + i.quantity, 0);
                  return qty === 0 ? (th ? "ติ๊กรายการก่อน" : "Tick items first") : (th ? `ส่งมอบ ${qty} ชิ้น` : `Hand over ${qty} item${qty === 1 ? "" : "s"}`);
                })()
              : (th ? "ยกเลิกการส่งมอบ" : "Reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
