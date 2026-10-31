"use client";

import { useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Upload, Loader2, X, Save } from "lucide-react";
import { ErrorState, IconButton, InlineAlert, Panel, useToast } from "@/components/admin/ui";
import { uploadImage } from "./shop-model";
import { Field, Spinner } from "./ui";

export function SettingsTab({ th }: { th: boolean }) {
  const [mode, setMode] = useState<"global" | "seller">("global");
  const [enabled, setEnabled] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState("");
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState<string>("0");
  const [pickupInfo, setPickupInfo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const loadSettings = () => {
    setLoadFailed(false);
    fetch("/api/admin/shop/settings").then((r) => r.json()).then((d) => {
      if (d) {
        setMode(d.mode === "seller" ? "seller" : "global");
        setEnabled(!!d.enabled); setPaymentInfo(d.paymentInfo ?? ""); setQrImageUrl(d.qrImageUrl ?? null);
        setDeliveryEnabled(!!d.deliveryEnabled); setDeliveryFee(String(d.deliveryFee ?? 0)); setPickupInfo(d.pickupInfo ?? "");
      }
    }).catch(() => setLoadFailed(true)).finally(() => setLoading(false));
  };
  useEffect(() => {
    // Deferred so the state updates land after this render commits.
    const timer = setTimeout(loadSettings, 0);
    return () => clearTimeout(timer);
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shop/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, paymentInfo, qrImageUrl: qrImageUrl || null, deliveryEnabled, deliveryFee: Math.max(0, Math.round(Number(deliveryFee) || 0)), pickupInfo }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      toast.success(th ? "บันทึกการตั้งค่าร้านแล้ว" : "Shop settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      toast.error(th ? "บันทึกไม่สำเร็จ" : "Couldn't save settings", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadFailed) return <ErrorState title={th ? "โหลดการตั้งค่าร้านไม่สำเร็จ" : "Couldn't load shop settings"} onRetry={() => { setLoading(true); loadSettings(); }} />;

  const checkRow: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", minHeight: 44 };

  return (
    <div style={{ maxWidth: 680 }}>
      <Panel
        title={mode === "global" ? (th ? "ร้านค้า การชำระเงิน และการรับสินค้า" : "Shop, payment and pickup") : (th ? "การรับเงินและรับสินค้าของคุณ" : "Your payment and pickup details")}
        description={mode === "global" ? undefined : (th ? "ข้อมูลด้านล่างใช้เฉพาะสินค้าของคุณ และผู้ซื้อจะชำระเงินถึงคุณโดยตรง" : "These details apply only to your products; buyers pay you directly.")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {mode === "global" && (
            <label style={checkRow}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดร้านค้า" : "Shop open"}</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{enabled ? (th ? "· กำลังเปิด" : "· Open") : (th ? "· ปิดอยู่" : "· Closed")}</span>
            </label>
          )}

          <Field label={th ? "QR พร้อมเพย์ / บัญชีธนาคาร" : "PromptPay / bank QR"} hint={th ? "ผู้ซื้อจะเห็นรูปนี้ตอนชำระเงิน" : "Buyers see this image when they pay."}>
            <div>
              {qrImageUrl ? (
                <div style={{ position: "relative", width: 200 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrImageUrl} alt={th ? "QR รับเงินปัจจุบัน" : "Current payment QR"} style={{ width: 200, height: 200, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--qr-surface)" }} />
                  <div style={{ position: "absolute", top: 4, right: 4 }}>
                    <IconButton size="sm" label={th ? "ลบรูป QR" : "Remove QR image"} icon={<X size={16} />} onClick={() => setQrImageUrl(null)} style={{ background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)" }} />
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ width: 200, height: 200, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)" }}>
                  {uploading ? <Loader2 size={24} className="animate-spin" aria-hidden="true" /> : <Upload size={24} aria-hidden="true" />}
                  <span style={{ fontSize: 13 }}>{uploading ? (th ? "กำลังอัปโหลด…" : "Uploading…") : (th ? "อัปโหลด QR" : "Upload QR")}</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" aria-label={th ? "เลือกรูป QR" : "Choose QR image"} style={{ display: "none" }} onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                setUploading(true); setError(null);
                try { setQrImageUrl(await uploadImage(f)); } catch (err) {
                  const msg = err instanceof Error ? err.message : "Upload failed";
                  setError(msg);
                  toast.error(th ? "อัปโหลดรูปไม่สำเร็จ" : "Couldn't upload the image", msg);
                } finally { setUploading(false); }
              }} />
            </div>
          </Field>

          <Field label={th ? "คำแนะนำการชำระเงิน" : "Payment instructions"}>
            <RichTextEditor value={paymentInfo} onChange={setPaymentInfo} rows={4} placeholder={th ? "เช่น พร้อมเพย์ 08x-xxx-xxxx (ชื่อ) — โอนแล้วแนบสลิป" : "e.g. PromptPay 08x-xxx-xxxx (Name) — transfer then upload slip"} />
          </Field>

          {/* Delivery / fulfillment (flat fee) */}
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={checkRow}>
              <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดให้จัดส่ง (พร้อมค่าส่งแบบเหมา)" : "Offer delivery (flat fee)"}</span>
            </label>
            {deliveryEnabled && (
              <Field label={th ? "ค่าจัดส่งเริ่มต้นของร้าน (บาท)" : "Default delivery fee (฿)"} hint={th ? "ใช้กับสินค้าที่ไม่ได้ตั้งค่าส่งของตัวเอง" : "Used for products that don't set their own delivery fee."} style={{ maxWidth: 280 }}>
                <input type="number" inputMode="numeric" min={0} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className="input" />
              </Field>
            )}
            <Field label={th ? "คำแนะนำการรับสินค้าเอง (ที่ไหน/เมื่อไหร่)" : "Self-pickup instructions (where / when)"}>
              <RichTextEditor value={pickupInfo} onChange={setPickupInfo} rows={3} placeholder={th ? "เช่น รับที่ห้อง SMO ชั้น 1 อาคาร CAMT จ.–ศ. 12:00–13:00" : "e.g. Collect at the SMO room, CAMT building, Mon–Fri 12:00–13:00"} />
            </Field>
          </div>

          {error && <InlineAlert tone="error">{error}</InlineAlert>}

          <div>
            <button onClick={save} disabled={saving || uploading} className="btn btn-primary">
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save")}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */
