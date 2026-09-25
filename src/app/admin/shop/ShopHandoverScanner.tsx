"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { QR_SCANNER_CONSTRUCTOR_CONFIG, QR_SCANNER_START_CONFIG } from "@/lib/qr-scanner-config";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ScanLine, Store, Truck, X } from "lucide-react";

// The pickup counter: scan the buyer's Digital ID → see their paid orders this
// caller may hand over → tick → "Handed over". Also used at the door for
// on-campus delivery (the server knows each order's pickup/delivery type).
// Backed by POST /api/admin/shop/fulfillment/scan. Camera lifecycle follows
// PrizeAwardPanel: the camera runs only while the viewfinder is on screen, and
// every stop is chained so a restart never races the previous stream's teardown.

interface ScanOrder {
  id: string;
  fulfillment: string;
  fulfillmentStatus: string;
  totalAmount: number;
  createdAt: string | null;
  fulfilledAt: string | null;
  fulfilledByName: string | null;
  sellerName: string | null;
  items: { productName: string; variantLabel: string; customValues: { label: string; value: string }[] | null; quantity: number }[];
}
interface ScanPreview {
  buyer: { id: string; name: string; nickname: string | null; studentId: string | null };
  ready: ScanOrder[];
  unpaid: ScanOrder[];
  done: ScanOrder[];
}

const READER_ID = "shop-handover-reader";

export default function ShopHandoverScanner({ th, onClose, onHandedOver }: { th: boolean; onClose: () => void; onHandedOver: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handedCount, setHandedCount] = useState<number | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const stopPromiseRef = useRef<Promise<void>>(Promise.resolve());
  // The camera fires many times a second; only the first decode per view counts.
  const lockedRef = useRef(false);

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

  const runPreview = useCallback(async (qrToken: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shop/fulfillment/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", qrToken }),
      });
      const d = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(d.error || (th ? "สแกนไม่สำเร็จ" : "Scan failed"));
        return;
      }
      setToken(qrToken);
      setPreview(d as ScanPreview);
      setSelected(new Set((d as ScanPreview).ready.map((o) => o.id)));
      if ("vibrate" in navigator) navigator.vibrate((d as ScanPreview).ready.length ? [90, 40, 90] : 200);
    } catch {
      if (mountedRef.current) setError(th ? "เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง" : "Connection error — try again.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [th]);

  const cameraActive = !preview && handedCount === null && !busy && !error;

  useEffect(() => {
    if (!cameraActive) {
      void stopCamera();
      return;
    }
    let cancelled = false;
    lockedRef.current = false;
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
            lockedRef.current = true;
            void runPreview(decodedText);
          },
          () => {},
        );
        if (cancelled) void stopCamera();
      } catch {
        if (mountedRef.current) setCameraError(th ? "เปิดกล้องไม่สำเร็จ — อนุญาตการใช้กล้องแล้วลองใหม่" : "Couldn't start the camera — allow camera access and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraActive, runPreview, stopCamera, th]);

  const confirm = async () => {
    if (!token || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shop/fulfillment/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", qrToken: token, orderIds: [...selected], note: note.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(d.error || (th ? "บันทึกไม่สำเร็จ" : "Couldn't record the handover"));
        return;
      }
      setHandedCount(Array.isArray(d.handed) ? d.handed.length : selected.size);
      setPreview(null);
      onHandedOver();
    } catch {
      if (mountedRef.current) setError(th ? "เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง" : "Connection error — try again.");
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
    setHandedCount(null);
  };

  const buyerLabel = preview
    ? `${preview.buyer.name}${preview.buyer.nickname ? ` (${preview.buyer.nickname})` : ""}`
    : "";

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 480, maxHeight: "92vh", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <p style={{ fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ScanLine size={18} style={{ color: "var(--accent-primary)" }} />
            {th ? "สแกน Digital ID เพื่อส่งมอบสินค้า" : "Scan Digital ID to hand over"}
          </p>
          <button onClick={onClose} disabled={busy} className="btn btn-ghost" style={{ padding: 6 }} aria-label={th ? "ปิด" : "Close"}><X size={20} /></button>
        </div>

        <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {cameraActive && (
            <>
              <div id={READER_ID} style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#000" }} />
              <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                {th ? "ให้ผู้ซื้อเปิด Digital ID แล้วส่องกล้องไปที่ QR" : "Ask the buyer to open their Digital ID and point the camera at the QR."}
              </p>
              {cameraError && <p style={{ fontSize: 13, color: "#ef4444" }}>{cameraError}</p>}
            </>
          )}

          {busy && !preview && (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 size={28} className="animate-spin" /></div>
          )}

          {error && !preview && (
            <>
              <p style={{ fontSize: 14, color: "#dc2626", background: "rgba(239,68,68,0.08)", padding: "10px 12px", borderRadius: 8, display: "flex", gap: 6 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />{error}
              </p>
              <button onClick={next} className="btn btn-primary">{th ? "สแกนใหม่" : "Scan again"}</button>
            </>
          )}

          {handedCount !== null && (
            <>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.1)", padding: "14px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={20} />
                {th ? `ส่งมอบแล้ว ${handedCount} คำสั่งซื้อ` : `Handed over ${handedCount} order${handedCount === 1 ? "" : "s"}`}
              </p>
              <button onClick={next} className="btn btn-primary">{th ? "สแกนคนถัดไป" : "Scan next person"}</button>
            </>
          )}

          {preview && (
            <>
              <div>
                <p style={{ fontWeight: 800, fontSize: 16 }}>{buyerLabel}</p>
                {preview.buyer.studentId && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{preview.buyer.studentId}</p>}
              </div>

              {preview.done.length > 0 && (
                <div style={{ fontSize: 13, color: "#b45309", background: "rgba(245,158,11,0.12)", padding: "8px 12px", borderRadius: 8 }}>
                  <p style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} />{th ? "รับไปแล้ว" : "Already handed over"}</p>
                  {preview.done.map((o) => (
                    <p key={o.id} style={{ marginTop: 2, overflowWrap: "anywhere" }}>
                      {summarize(o)} · {o.fulfilledAt ? new Date(o.fulfilledAt).toLocaleString(th ? "th-TH" : "en-GB") : ""}{o.fulfilledByName ? ` · ${o.fulfilledByName}` : ""}
                    </p>
                  ))}
                </div>
              )}

              {preview.unpaid.length > 0 && (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-base)", border: "1px solid var(--border-subtle)", padding: "8px 12px", borderRadius: 8 }}>
                  <p style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><Clock size={14} />{th ? "ยังไม่ได้ตรวจสลิป — ห้ามส่งมอบ" : "Payment not checked yet — don't hand over"}</p>
                  {preview.unpaid.map((o) => <p key={o.id} style={{ marginTop: 2, overflowWrap: "anywhere" }}>{summarize(o)}</p>)}
                </div>
              )}

              {preview.ready.length === 0 ? (
                <p style={{ fontSize: 14, color: "var(--text-muted)", padding: "8px 0" }}>
                  {th ? "ไม่มีคำสั่งซื้อที่รอส่งมอบสำหรับคนนี้" : "Nothing waiting to be handed over for this person."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{th ? "เลือกคำสั่งซื้อที่ส่งมอบ" : "Choose what you're handing over"}</p>
                  {preview.ready.map((o) => {
                    const on = selected.has(o.id);
                    return (
                      <label key={o.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? "var(--accent-primary)" : "var(--border-subtle)"}`, background: on ? "var(--bg-base)" : "transparent" }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(o.id)) n.delete(o.id); else n.add(o.id);
                            return n;
                          })}
                          style={{ marginTop: 3 }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {o.fulfillment === "delivery" ? <Truck size={12} /> : <Store size={12} />}
                            {o.fulfillment === "delivery" ? (th ? "จัดส่ง (ส่งเองในมหาวิทยาลัย)" : "Delivery (on campus)") : (th ? "รับเอง" : "Self-pickup")}
                            {o.sellerName ? ` · ${o.sellerName}` : ""}
                          </p>
                          {o.items.map((i, k) => (
                            <div key={k}>
                              <p style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{i.productName}{i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × {i.quantity}</p>
                              {i.customValues && i.customValues.length > 0 && (
                                <p style={{ fontSize: 12, color: "var(--accent-primary)", overflowWrap: "anywhere" }}>{i.customValues.map((cv) => `${cv.label}: ${cv.value}`).join(" · ")}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </label>
                    );
                  })}
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    placeholder={th ? "หมายเหตุ (ไม่บังคับ) เช่น เพื่อนมารับแทน" : "Note (optional), e.g. collected by a friend"}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)" }}
                  />
                </div>
              )}

              {error && <p style={{ fontSize: 13, color: "#dc2626" }}>{error}</p>}
            </>
          )}
        </div>

        {preview && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 16px", display: "flex", gap: 10 }}>
            <button onClick={next} disabled={busy} className="btn btn-ghost" style={{ flex: 1 }}>{th ? "สแกนใหม่" : "Rescan"}</button>
            {preview.ready.length > 0 && (
              <button onClick={confirm} disabled={busy || selected.size === 0} className="btn btn-primary" style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {th ? `ส่งมอบแล้ว (${selected.size})` : `Handed over (${selected.size})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function summarize(o: ScanOrder): string {
  return o.items.map((i) => `${i.productName}${i.variantLabel && i.variantLabel !== "Standard" ? ` · ${i.variantLabel}` : ""} × ${i.quantity}`).join(", ");
}
