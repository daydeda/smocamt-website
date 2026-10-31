"use client";

import { useState } from "react";
import {
  SHOP_CARRIERS, blocksPaymentReview, carrierLabel, daysUntilAutoConfirm, findCarrier, isItemHandedOver, nextFulfillmentStatus,
  trackingLinkFor, validateShipment, type ShipmentError, type StaffFulfillmentAction,
} from "@/lib/shop/shop-fulfillment";
import { AlertTriangle, Bell, CheckCircle2, Clock, ExternalLink, Loader2, PackageCheck, RotateCcw, Truck } from "lucide-react";
import { InlineAlert, Modal, StatusBadge, type Tone } from "@/components/admin/ui";

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

// Small status badge for the card header, next to the payment badge. Colour +
// icon + text, so a colour-blind reviewer can still tell the states apart.
export function FulfillmentChip({ order, th }: { order: FulfillmentFields; th: boolean }) {
  if (order.status !== "approved") return null;
  const s = order.fulfillmentStatus;
  let tone: Tone;
  let icon: React.ReactNode;
  let text: string;
  if (s === "picked_up" || s === "delivered") {
    tone = "success"; icon = <PackageCheck size={12} />;
    text = s === "picked_up" ? (th ? "รับแล้ว" : "Picked up") : (th ? "ส่งถึงแล้ว" : "Delivered");
  } else if (s === "shipped") {
    tone = "info"; icon = <Truck size={12} />; text = th ? "จัดส่งแล้ว" : "Shipped";
  } else if (s === "issue") {
    tone = "danger"; icon = <AlertTriangle size={12} />; text = th ? "แจ้งปัญหา" : "Problem";
  } else if (s === "ready") {
    tone = "accent"; icon = <Bell size={12} />; text = th ? "พร้อมให้รับ" : "Ready for pickup";
  } else if (s === "partial") {
    const done = order.items.length - waitingLines(order).length;
    tone = "warning"; icon = <Clock size={12} />; text = th ? `ส่งมอบแล้ว ${done}/${order.items.length}` : `Handed ${done}/${order.items.length}`;
  } else {
    tone = "neutral"; icon = <Clock size={12} />; text = th ? "รอส่งมอบ" : "To hand over";
  }
  return <StatusBadge tone={tone} icon={icon}>{text}</StatusBadge>;
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

  // 44px tall (the admin shell enforces it on touch): these are tapped on a phone at a busy counter.
  const btn = { fontSize: 13, padding: "8px 14px", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 } as const;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
        {th ? "การส่งมอบสินค้า" : "Handover"}
      </p>

      {(s === "picked_up" || s === "delivered") && (
        <p style={{ fontSize: 13, color: "var(--green-700)", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {s === "picked_up" ? (th ? "ผู้ซื้อรับสินค้าแล้ว" : "Picked up") : (th ? "ส่งถึงผู้ซื้อแล้ว" : "Delivered")} · {fmt(order.fulfilledAt, th)} · {who}
            {order.fulfillmentNote ? <><br /><span style={{ color: "var(--text-secondary)" }}>{order.fulfillmentNote}</span></> : null}
          </span>
        </p>
      )}

      {s === "partial" && (
        <p style={{ fontSize: 13, color: "var(--amber-700)" }}>
          {th ? `ส่งมอบไปแล้วบางรายการ ยังเหลือ: ` : "Partly handed over. Still waiting: "}
          <strong>{waitingLines(order).map((i) => `${i.productName}${i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} ×${i.quantity}`).join(", ")}</strong>
        </p>
      )}

      {s === "ready" && (
        <p style={{ fontSize: 13, color: "var(--violet-700)" }}>{th ? `แจ้งผู้ซื้อว่าพร้อมให้รับแล้ว · ${fmt(order.readyAt, th)}` : `Buyer told it's ready · ${fmt(order.readyAt, th)}`}</p>
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
        <p style={{ fontSize: 13, color: s === "issue" ? "var(--red-600)" : "var(--text-muted)", background: s === "issue" ? "rgb(var(--red-500-rgb) / 0.08)" : "transparent", padding: s === "issue" ? "8px 12px" : 0, borderRadius: 8, display: "flex", gap: 6 }}>
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
          <button onClick={() => onAction(order, "ready")} disabled={busy} className="btn btn-ghost" style={{ ...btn, color: "var(--violet-700)", border: "1px solid rgb(var(--violet-600-rgb) / 0.3)" }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}{th ? "พร้อมให้รับ" : "Ready for pickup"}
          </button>
        )}
        {can("ship") && (
          <button onClick={() => onAction(order, "ship")} disabled={busy} className="btn btn-ghost" style={{ ...btn, color: "var(--blue-700)", border: "1px solid rgb(var(--blue-500-rgb) / 0.3)" }}>
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
        <button onClick={() => onAction(order, "reset")} disabled={busy} className="btn btn-ghost" style={{ ...btn, alignSelf: "flex-start", fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
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
  const input = "input";
  const label = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block" } as const;
  const err = localError || error;
  const handoverQty = waiting.filter((i) => picked.has(i.id)).reduce((n, i) => n + i.quantity, 0);
  const isReset = action === "reset";

  return (
    <Modal
      open
      onClose={onCancel}
      dismissible={!busy}
      size="sm"
      title={title}
      icon={action === "ship" ? <Truck size={20} /> : action === "handover" ? <PackageCheck size={20} /> : <RotateCcw size={20} />}
      description={action === "ship" ? `${buyerName}` : undefined}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost">{th ? "ยกเลิก" : "Cancel"}</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (action === "handover" && picked.size === 0)}
            className={isReset ? "btn adm-btn-danger-solid" : "btn btn-primary"}
            style={{ minHeight: 48 }}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {action === "ship" ? (th ? "บันทึกและแจ้งผู้ซื้อ" : "Save & notify buyer")
              : action === "handover" ? (handoverQty === 0 ? (th ? "ติ๊กรายการก่อน" : "Tick items first") : (th ? `ส่งมอบ ${handoverQty} ชิ้น` : `Hand over ${handoverQty} item${handoverQty === 1 ? "" : "s"}`))
              : (th ? "ยกเลิกการส่งมอบ" : "Reset handover")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {action === "ship" && (
          <>
            <div>
              <label style={label} htmlFor="ship-carrier">{th ? "บริษัทขนส่ง" : "Carrier"}</label>
              <select id="ship-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={input}>
                {SHOP_CARRIERS.map((c) => <option key={c.id} value={c.id}>{th ? c.th : c.en}</option>)}
              </select>
            </div>
            {carrier === "other" && (
              <div>
                <label style={label} htmlFor="ship-carrier-name">{th ? "ชื่อบริษัทขนส่ง" : "Carrier name"}</label>
                <input id="ship-carrier-name" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} maxLength={80} className={input} />
              </div>
            )}
            {selected?.needs !== "link" && (
              <div>
                <label style={label} htmlFor="ship-number">{th ? "เลขพัสดุ (Tracking number)" : "Tracking number"}{selected?.needs === "number_or_link" ? (th ? " — หรือใส่ลิงก์ด้านล่าง" : " — or a link below") : ""}</label>
                <input id="ship-number" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} maxLength={80} autoFocus placeholder="EF123456789TH" className={input} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
              </div>
            )}
            {selected?.needs !== "number" && (
              <div>
                <label style={label} htmlFor="ship-link">{th ? "ลิงก์ติดตาม (https://…)" : "Tracking link (https://…)"}</label>
                <input id="ship-link" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} maxLength={1000} placeholder="https://" inputMode="url" className={input} />
              </div>
            )}
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {th
                ? `ผู้ซื้อจะได้รับแจ้งเตือนพร้อมเลขพัสดุ ถ้าผู้ซื้อไม่กด "ได้รับสินค้าแล้ว" ระบบจะปิดคำสั่งซื้อให้อัตโนมัติใน 7 วัน`
                : "The buyer is notified with the tracking number. If they don't tap \"I received it\", the order completes automatically after 7 days."}
            </p>
          </>
        )}

        {action === "handover" && (
          <>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {th ? `ติ๊กสินค้าที่ ${buyerName} ได้รับจริงตอนนี้` : `Tick what ${buyerName} actually has in hand now.`}
            </p>
            {!wholeParcel && (
              <InlineAlert tone="warning">
                {th ? "วิธีนี้ไม่ได้ตรวจตัวตนผู้รับ ถ้าผู้ซื้ออยู่ตรงหน้า ให้ใช้ \"ส่งมอบสินค้า (สแกน Digital ID)\" แทน" : "This doesn't check who is collecting. If the buyer is in front of you, use \"Hand over items (scan Digital ID)\" instead."}
              </InlineAlert>
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
                      style={{ width: 22, height: 22, flexShrink: 0 }}
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
            <div>
              <label style={label} htmlFor="handover-note">{th ? "หมายเหตุ (ไม่บังคับ)" : "Note (optional)"}</label>
              <input id="handover-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={th ? "เช่น เพื่อนมารับแทน" : "e.g. collected by a friend"} className={input} />
            </div>
          </>
        )}

        {action === "reset" && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {th
              ? `ย้อนคำสั่งซื้อของ ${buyerName} กลับเป็น "รอส่งมอบ"? เลขพัสดุและบันทึกการส่งมอบทุกรายการจะถูกล้าง (ใช้เมื่อกดผิด)`
              : `Send ${buyerName}'s order back to "to hand over"? The tracking and the handover record of every item are cleared (use this to fix a mistake).`}
          </p>
        )}

        {err && <InlineAlert tone="error">{err}</InlineAlert>}
      </div>
    </Modal>
  );
}
