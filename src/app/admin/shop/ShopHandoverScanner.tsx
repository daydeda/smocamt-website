"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { QR_SCANNER_CONSTRUCTOR_CONFIG, QR_SCANNER_START_CONFIG } from "@/lib/qr/qr-scanner-config";
import viewfinderStyles from "@/components/admin/QrViewfinder.module.css";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ScanLine, Store, Truck, Undo2, X } from "lucide-react";
import { Modal, useConfirm } from "@/components/admin/ui";
import HandoverProductList, { ProductThumb, type HandoverProduct } from "./ShopHandoverProducts";

// The handover counter: choose the PRODUCT → scan the buyer's Digital ID → see
// that buyer's lines of that product → hand them over. Also used at the door
// for on-campus delivery. Backed by POST /api/admin/shop/fulfillment/scan.
//
// Human-error guards (why it looks the way it does):
//  - Product first, and it stays pinned at the top of every step, so staff
//    always know which item this counter is giving out. Only that product's
//    lines can be ticked; the buyer's other products are listed greyed out.
//  - Size/option and quantity are the biggest text on the line: handing over
//    the wrong size or the wrong count is the most likely slip.
//  - "Already received", "not paid" and "sent by mail" are shown above the
//    list in their own colours, before anything can be ticked.
//  - The confirm button says exactly what is being handed over.
//  - After a handover the same QR is ignored for a few seconds, so the buyer
//    still holding their phone up doesn't reopen their own result, and the
//    success screen has an Undo for an honest mistake.
//  - Closing (X, Escape or a tap outside) while a scanned result is waiting
//    asks first, so the result is never thrown away by accident.
// Camera lifecycle follows PrizeAwardPanel: the camera runs only while the
// viewfinder is on screen, and every stop is chained so a restart never races
// the previous stream's teardown.

interface Line {
  itemId: string;
  orderId: string;
  productName: string;
  variantLabel: string;
  customValues: { label: string; value: string }[] | null;
  quantity: number;
  fulfillment: string;
  orderCreatedAt: string | null;
}
interface DoneLine extends Line { handedAt: string | null; handedByName: string | null }
interface ScanPreview {
  buyer: { id: string; name: string; nickname: string | null; studentId: string | null };
  toHand: Line[];
  done: DoneLine[];
  unpaid: Line[];
  mailed: Line[];
  otherWaiting: Line[];
}

const READER_ID = "shop-handover-reader";
// Same QR ignored this long after a handover (the buyer is still holding it up).
const SAME_QR_COOLDOWN_MS = 8000;

const variantOf = (l: Pick<Line, "variantLabel">) => (l.variantLabel && l.variantLabel !== "Standard" ? l.variantLabel : null);

export default function ShopHandoverScanner({ th, product: initialProduct = null, onClose, onHandedOver }: {
  th: boolean;
  product?: HandoverProduct | null;
  onClose: () => void;
  onHandedOver: () => void;
}) {
  const [product, setProduct] = useState<HandoverProduct | null>(initialProduct);
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handed, setHanded] = useState<{ buyer: ScanPreview["buyer"]; lines: Line[] } | null>(null);
  const [undone, setUndone] = useState(false);

  const confirmDialog = useConfirm();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const stopPromiseRef = useRef<Promise<void>>(Promise.resolve());
  // The camera fires many times a second; only the first decode per view counts.
  const lockedRef = useRef(false);
  const cooldownRef = useRef<{ token: string; until: number } | null>(null);

  const stopCamera = useCallback(() => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return stopPromiseRef.current;
    stopPromiseRef.current = stopPromiseRef.current.then(async () => {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // Already stopped / never started.
      }
    });
    return stopPromiseRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopCamera();
    };
  }, [stopCamera]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/shop/fulfillment/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  }, []);

  const runPreview = useCallback(async (qrToken: string, productId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { ok, d } = await post({ action: "preview", qrToken, productId });
      if (!mountedRef.current) return;
      if (!ok) {
        setError(d.error || (th ? "สแกนไม่สำเร็จ" : "Scan failed"));
        return;
      }
      const p = d as ScanPreview;
      setToken(qrToken);
      setPreview(p);
      // The product is already chosen, so its waiting lines are what this
      // person came for: pre-tick them (staff untick one that's out of stock).
      setSelected(new Set(p.toHand.map((l) => l.itemId)));
      if ("vibrate" in navigator) navigator.vibrate(p.toHand.length ? [90, 40, 90] : [250]);
    } catch {
      if (mountedRef.current) setError(th ? "เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง" : "Connection error. Try again.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [post, th]);

  const cameraActive = !!product && !preview && !handed && !busy && !error;

  useEffect(() => {
    if (!cameraActive || !product) {
      void stopCamera();
      return;
    }
    let cancelled = false;
    lockedRef.current = false;
    const productId = product.id;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          typeof window !== "undefined" && window.isSecureContext === false
            ? (th ? "กล้องใช้ได้เฉพาะบน https" : "The camera only works over https.")
            : (th ? "อุปกรณ์นี้ไม่รองรับกล้อง" : "This device has no camera access."),
        );
        return;
      }
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopPromiseRef.current;
      if (cancelled || !mountedRef.current) return;
      const scanner = new Html5Qrcode(READER_ID, QR_SCANNER_CONSTRUCTOR_CONFIG);
      scannerRef.current = scanner;
      setCameraError(null);
      try {
        await scanner.start(
          { facingMode: "environment" },
          QR_SCANNER_START_CONFIG,
          (decodedText) => {
            if (lockedRef.current) return;
            const cd = cooldownRef.current;
            if (cd && cd.token === decodedText && Date.now() < cd.until) return;
            lockedRef.current = true;
            void runPreview(decodedText, productId);
          },
          () => {},
        );
        if (cancelled) {
          void stopCamera();
          return;
        }
        // A laptop with only a front camera needs mirroring to feel right
        // (same as PrizeAwardPanel; the shared viewfinder CSS centres the
        // video without using transform, so the two don't collide).
        try {
          const settings = scanner.getRunningTrackSettings();
          const video = document.querySelector<HTMLVideoElement>(`#${READER_ID} video`);
          if (video) video.style.transform = settings.facingMode === "environment" ? "none" : "scaleX(-1)";
        } catch {
          // getRunningTrackSettings isn't available everywhere.
        }
      } catch {
        if (mountedRef.current) setCameraError(th ? "เปิดกล้องไม่สำเร็จ อนุญาตการใช้กล้องแล้วลองใหม่" : "Couldn't start the camera. Allow camera access and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraActive, product, runPreview, stopCamera, th]);

  const confirm = async () => {
    if (!token || !preview || !product || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { ok, d } = await post({ action: "confirm", qrToken: token, productId: product.id, itemIds: [...selected], note: note.trim() || undefined });
      if (!mountedRef.current) return;
      if (!ok) {
        setError(d.error || (th ? "บันทึกไม่สำเร็จ" : "Couldn't record the handover"));
        return;
      }
      cooldownRef.current = { token, until: Date.now() + SAME_QR_COOLDOWN_MS };
      setHanded({ buyer: preview.buyer, lines: preview.toHand.filter((l) => selected.has(l.itemId)) });
      setUndone(false);
      setPreview(null);
      onHandedOver();
    } catch {
      if (mountedRef.current) setError(th ? "เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง" : "Connection error. Try again.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const undo = async () => {
    if (!handed) return;
    setBusy(true);
    setError(null);
    try {
      const { ok, d } = await post({ action: "undo", itemIds: handed.lines.map((l) => l.itemId) });
      if (!mountedRef.current) return;
      if (!ok) {
        setError(d.error || (th ? "ยกเลิกไม่สำเร็จ" : "Couldn't undo"));
        return;
      }
      setUndone(true);
      onHandedOver();
    } catch {
      if (mountedRef.current) setError(th ? "เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง" : "Connection error. Try again.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // Back to the viewfinder for the next person in the queue.
  const next = () => {
    setPreview(null);
    setToken(null);
    setSelected(new Set());
    setNote("");
    setError(null);
    setHanded(null);
    setUndone(false);
  };

  const changeProduct = () => {
    next();
    setProduct(null);
  };

  // A scanned result that still has items to hand over is unsaved work: ask
  // before closing over it (an accidental tap outside the sheet is easy).
  const requestClose = async () => {
    if (busy) return;
    if (preview && preview.toHand.length > 0) {
      const ok = await confirmDialog({
        title: th ? "ปิดโดยยังไม่ส่งมอบ?" : "Close without handing over?",
        message: th
          ? `ผลสแกนของ ${buyerLabel(preview.buyer)} จะหายไป และยังไม่มีการบันทึกการส่งมอบ`
          : `${buyerLabel(preview.buyer)}'s scan result will be discarded and nothing is recorded as handed over.`,
        confirmLabel: th ? "ปิดเลย" : "Close anyway",
        cancelLabel: th ? "กลับไปส่งมอบ" : "Keep it open",
        tone: "danger",
      });
      if (!ok) return;
    }
    onClose();
  };

  const buyerLabel = (b: ScanPreview["buyer"]) => `${b.name}${b.nickname ? ` (${b.nickname})` : ""}`;
  const selectedLines = preview ? preview.toHand.filter((l) => selected.has(l.itemId)) : [];
  const selectedQty = selectedLines.reduce((n, l) => n + l.quantity, 0);
  // "L ×3, M ×1": same option across several orders is added up, so the
  // summary reads as what to pick off the shelf.
  const summary = (lines: Line[]) => {
    const byVariant = new Map<string, number>();
    for (const l of lines) {
      const key = variantOf(l) ?? (th ? "ปกติ" : "Standard");
      byVariant.set(key, (byVariant.get(key) ?? 0) + l.quantity);
    }
    return [...byVariant].map(([v, q]) => `${v} ×${q}`).join(", ");
  };
  const when = (d: string | null) => (d ? new Date(d).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

  const alertBox = (bg: string, color: string): React.CSSProperties => ({ fontSize: 14, color, background: bg, padding: "10px 12px", borderRadius: 10, display: "flex", flexDirection: "column", gap: 3 });
  const lineText = (l: Line) => `${l.productName}${variantOf(l) ? ` · ${variantOf(l)}` : ""} ×${l.quantity}`;

  return (
    <Modal
      open
      onClose={requestClose}
      dismissible={!busy}
      size="md"
      icon={<ScanLine size={20} />}
      title={th ? "ส่งมอบสินค้า" : "Hand over items"}
      footer={
        preview ? (
          <>
            <button onClick={next} disabled={busy} className="btn btn-ghost" style={{ minHeight: 52 }}>{preview.toHand.length ? (th ? "ยกเลิก" : "Cancel") : (th ? "สแกนคนถัดไป" : "Scan next")}</button>
            {preview.toHand.length > 0 && (
              <button onClick={confirm} disabled={busy || selected.size === 0} className="btn btn-success-solid" style={{ minHeight: 56, fontSize: 16, fontWeight: 800, flex: "1 1 220px" }}>
                {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
                {selected.size === 0
                  ? (th ? "เลือกอย่างน้อย 1 รายการ" : "Tick at least one")
                  : (th ? `ส่งมอบ ${selectedQty} ชิ้น` : `Hand over ${selectedQty} item${selectedQty === 1 ? "" : "s"}`)}
              </button>
            )}
          </>
        ) : handed ? (
          <>
            {!undone && (
              <button onClick={undo} disabled={busy} className="btn btn-ghost" style={{ minHeight: 52 }}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Undo2 size={16} aria-hidden="true" />}{th ? "ยกเลิก (กดผิด)" : "Undo"}
              </button>
            )}
            <button onClick={next} disabled={busy} className="btn btn-primary" style={{ minHeight: 56, fontSize: 16, fontWeight: 800, flex: "1 1 220px" }}>{th ? "สแกนคนถัดไป" : "Scan next person"}</button>
          </>
        ) : undefined
      }
    >
      {/* The product this counter is handing out — pinned on every step. */}
      {product && (
        <div style={{ position: "sticky", top: 0, zIndex: 1, margin: "0 -4px 12px", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 12 }}>
          <ProductThumb product={product} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{th ? "กำลังส่งมอบ" : "Handing out"}</p>
            <p style={{ fontSize: 15, fontWeight: 800, overflowWrap: "anywhere" }}>{product.name}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{product.sellerName} · ฿{product.price.toLocaleString()}</p>
          </div>
          <button onClick={changeProduct} disabled={busy} className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 12px", flexShrink: 0 }}>
            {th ? "เปลี่ยน" : "Change"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!product && (
          <>
            <p style={{ fontSize: 15, fontWeight: 700 }}>{th ? "1. เลือกสินค้าที่กำลังจะส่งมอบ" : "1. Choose the product you're handing out"}</p>
            <HandoverProductList th={th} onPick={(p) => { next(); setProduct(p); }} />
          </>
        )}

        {cameraActive && (
          <>
            <div className={viewfinderStyles.viewfinder}>
              <div id={READER_ID} className={viewfinderStyles.reader} />
              <div className={viewfinderStyles.scanGuide} aria-hidden="true" />
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.6 }}>
              {th ? "2. ให้ผู้ซื้อเปิด Digital ID แล้วส่องกล้องไปที่ QR" : "2. Ask the buyer to open their Digital ID and point the camera at the QR."}
            </p>
            {cameraError && <p role="alert" style={{ fontSize: 14, color: "var(--amber-700)", background: "rgb(var(--amber-500-rgb) / 0.1)", padding: "10px 12px", borderRadius: 10 }}>{cameraError}</p>}
          </>
        )}

        {busy && !preview && !handed && product && (
          <div role="status" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: 40, color: "var(--text-secondary)", fontSize: 16 }}><Loader2 size={24} className="animate-spin" aria-hidden="true" />{th ? "กำลังตรวจสอบ" : "Checking"}</div>
        )}

        {error && !preview && !handed && (
          <>
            <p role="alert" style={{ fontSize: 16, fontWeight: 700, color: "var(--red-600)", background: "rgb(var(--red-500-rgb) / 0.08)", padding: "12px 14px", borderRadius: 10, display: "flex", gap: 8 }}>
              <AlertTriangle size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />{error}
            </p>
            <button onClick={next} className="btn btn-primary" style={{ minHeight: 56, fontSize: 16 }}>{th ? "สแกนใหม่" : "Scan again"}</button>
          </>
        )}

        {handed && (
          undone ? (
            <p role="status" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-secondary)", background: "var(--bg-base)", border: "1px solid var(--border-subtle)", padding: "16px 14px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <Undo2 size={22} aria-hidden="true" />{th ? `ยกเลิกแล้ว ${buyerLabel(handed.buyer)} ยังไม่ได้รับสินค้า` : `Undone. ${buyerLabel(handed.buyer)} is back to "not received".`}
            </p>
          ) : (
            <div role="status" style={{ background: "rgb(var(--green-600-rgb) / 0.1)", border: "2px solid rgb(var(--green-600-rgb) / 0.35)", padding: "20px 16px", borderRadius: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 22, fontWeight: 900, color: "var(--green-700)", display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle2 size={30} aria-hidden="true" />{th ? "ส่งมอบแล้ว" : "Handed over"}
              </p>
              <p style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>{buyerLabel(handed.buyer)}</p>
              <p style={{ fontSize: 16, overflowWrap: "anywhere" }}>{handed.lines[0]?.productName}: <strong>{summary(handed.lines)}</strong></p>
            </div>
          )
        )}
        {handed && error && <p role="alert" style={{ fontSize: 14, color: "var(--red-600)" }}>{error}</p>}

        {preview && (
          <>
            <div>
              <p style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.35, overflowWrap: "anywhere" }}>{buyerLabel(preview.buyer)}</p>
              {preview.buyer.studentId && <p style={{ fontSize: 16, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{preview.buyer.studentId}</p>}
            </div>

            {/* Nothing to give: say so FIRST, above the reasons, so a quick
                glance can't miss it. */}
            {preview.toHand.length === 0 && (
              <p role="alert" style={{ fontSize: 18, fontWeight: 900, color: "var(--red-700)", background: "rgb(var(--red-500-rgb) / 0.1)", border: "2px solid rgb(var(--red-500-rgb) / 0.35)", padding: "16px 14px", borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <X size={24} aria-hidden="true" style={{ flexShrink: 0 }} />
                {th ? "ไม่ต้องส่งมอบสินค้านี้ให้คนนี้" : "Don't hand over. Nothing of this product is due to this person."}
              </p>
            )}

            {preview.done.length > 0 && (
              <div style={alertBox("rgb(var(--amber-500-rgb) / 0.14)", "var(--amber-800)")}>
                <p style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={16} aria-hidden="true" />{th ? "คนนี้รับสินค้านี้ไปแล้ว" : "Already received this product"}</p>
                {preview.done.map((l) => (
                  <p key={l.itemId} style={{ overflowWrap: "anywhere" }}>
                    {lineText(l)} · {when(l.handedAt)}{l.handedByName ? ` · ${l.handedByName}` : ""}
                  </p>
                ))}
              </div>
            )}

            {preview.unpaid.length > 0 && (
              <div style={alertBox("rgb(var(--red-500-rgb) / 0.1)", "var(--red-700)")}>
                <p style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}><Clock size={16} aria-hidden="true" />{th ? "ยังไม่ได้ตรวจสลิป ห้ามส่งมอบ" : "Payment not checked yet. Don't hand over."}</p>
                {preview.unpaid.map((l) => <p key={l.itemId} style={{ overflowWrap: "anywhere" }}>{lineText(l)}</p>)}
              </div>
            )}

            {preview.mailed.length > 0 && (
              <div style={alertBox("rgb(var(--blue-500-rgb) / 0.1)", "var(--blue-700)")}>
                <p style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}><Truck size={16} aria-hidden="true" />{th ? "ส่งทางไปรษณีย์แล้ว ไม่ต้องส่งมอบที่นี่" : "Sent by mail. Don't hand over here."}</p>
                {preview.mailed.map((l) => <p key={l.itemId} style={{ overflowWrap: "anywhere" }}>{lineText(l)}</p>)}
              </div>
            )}

            {preview.toHand.length === 0 ? null : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 14, fontWeight: 700 }}>{th ? "หยิบให้ตรงตามนี้" : "Hand over exactly this"}</p>
                {preview.toHand.map((l) => {
                  const on = selected.has(l.itemId);
                  const v = variantOf(l);
                  return (
                    <label key={l.itemId} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px", borderRadius: 12, cursor: "pointer", border: `2px solid ${on ? "var(--accent-primary)" : "var(--border-subtle)"}`, background: on ? "var(--bg-base)" : "transparent", minHeight: 64 }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(l.itemId)) n.delete(l.itemId); else n.add(l.itemId);
                          return n;
                        })}
                        style={{ width: 24, height: 24, flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 22, fontWeight: 900, padding: "2px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", overflowWrap: "anywhere" }}>
                            {v ?? (th ? "แบบปกติ" : "Standard")}
                          </span>
                          <span style={{ fontSize: 22, fontWeight: 900, color: l.quantity > 1 ? "var(--accent-primary)" : "inherit" }}>×{l.quantity}</span>
                        </div>
                        {l.customValues && l.customValues.length > 0 && (
                          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-primary)", marginTop: 4, overflowWrap: "anywhere" }}>{l.customValues.map((cv) => `${cv.label}: ${cv.value}`).join(" · ")}</p>
                        )}
                        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {l.fulfillment === "delivery" ? <Truck size={13} aria-hidden="true" /> : <Store size={13} aria-hidden="true" />}
                          {l.fulfillment === "delivery" ? (th ? "ส่งในมหาวิทยาลัย" : "On-campus delivery") : (th ? "รับเอง" : "Self-pickup")}
                          {l.orderCreatedAt ? ` · ${th ? "สั่ง" : "ordered"} ${when(l.orderCreatedAt)}` : ""}
                        </p>
                      </div>
                    </label>
                  );
                })}
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  aria-label={th ? "หมายเหตุ (ไม่บังคับ)" : "Note (optional)"}
                  placeholder={th ? "หมายเหตุ (ไม่บังคับ) เช่น เพื่อนมารับแทน" : "Note (optional), e.g. collected by a friend"}
                  style={{ padding: "12px 12px", borderRadius: 10 }}
                />
              </div>
            )}

            {preview.otherWaiting.length > 0 && (
              <div style={{ fontSize: 14, color: "var(--text-muted)", border: "1px dashed var(--border-subtle)", padding: "10px 12px", borderRadius: 10 }}>
                <p style={{ fontWeight: 700 }}>{th ? "ยังรอรับสินค้าอื่นด้วย (ไม่ใช่ที่จุดนี้)" : "Also waiting for other products (not this counter)"}</p>
                {preview.otherWaiting.map((l) => <p key={l.itemId} style={{ overflowWrap: "anywhere" }}>{lineText(l)}</p>)}
              </div>
            )}

            {error && <p role="alert" style={{ fontSize: 14, color: "var(--red-600)" }}>{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
