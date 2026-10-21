"use client";

import { useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Upload, Loader2, X, Save, Check } from "lucide-react";
import { uploadImage } from "./shop-model";
import { Field, Spinner, inputStyle } from "./ui";

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
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/shop/settings").then((r) => r.json()).then((d) => {
      if (d) {
        setMode(d.mode === "seller" ? "seller" : "global");
        setEnabled(!!d.enabled); setPaymentInfo(d.paymentInfo ?? ""); setQrImageUrl(d.qrImageUrl ?? null);
        setDeliveryEnabled(!!d.deliveryEnabled); setDeliveryFee(String(d.deliveryFee ?? 0)); setPickupInfo(d.pickupInfo ?? "");
      }
    }).finally(() => setLoading(false));
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
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 24, maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
      {mode === "global" ? (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดร้านค้า" : "Shop open"}</span>
        </label>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {th ? "ข้อมูลด้านล่างใช้เฉพาะสินค้าของคุณ และผู้ซื้อจะชำระเงินถึงคุณโดยตรง" : "These details apply only to your products; buyers pay you directly."}
        </p>
      )}

      <Field label={th ? "QR พร้อมเพย์ / บัญชีธนาคาร" : "PromptPay / bank QR"}>
        {qrImageUrl ? (
          <div style={{ position: "relative", width: 200 }}>
            <img src={qrImageUrl} alt="QR" style={{ width: 200, height: 200, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--qr-surface)" }} />
            <button onClick={() => setQrImageUrl(null)} style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ width: 200, height: 200, borderRadius: "var(--radius-md)", border: "2px dashed var(--border-subtle)", background: "var(--bg-base)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)" }}>
            {uploading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
            <span style={{ fontSize: 12 }}>{th ? "อัปโหลด QR" : "Upload QR"}</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          setUploading(true); setError(null);
          try { setQrImageUrl(await uploadImage(f)); } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); } finally { setUploading(false); }
        }} />
      </Field>

      <Field label={th ? "คำแนะนำการชำระเงิน" : "Payment instructions"}>
        <RichTextEditor value={paymentInfo} onChange={setPaymentInfo} rows={4} placeholder={th ? "เช่น พร้อมเพย์ 08x-xxx-xxxx (ชื่อ) — โอนแล้วแนบสลิป" : "e.g. PromptPay 08x-xxx-xxxx (Name) — transfer then upload slip"} />
      </Field>

      {/* Delivery / fulfillment (flat fee) */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{th ? "เปิดให้จัดส่ง (พร้อมค่าส่งแบบเหมา)" : "Offer delivery (flat fee)"}</span>
        </label>
        {deliveryEnabled && (
          <Field label={th ? "ค่าจัดส่งเริ่มต้นของร้าน (บาท)" : "Default delivery fee (฿)"} style={{ maxWidth: 280 }}>
            <input type="number" min={0} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} style={inputStyle} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>
              {th ? "ใช้กับสินค้าที่ไม่ได้ตั้งค่าส่งของตัวเอง" : "Used for products that don't set their own delivery fee."}
            </p>
          </Field>
        )}
        <Field label={th ? "คำแนะนำการรับสินค้าเอง (ที่ไหน/เมื่อไหร่)" : "Self-pickup instructions (where / when)"}>
          <RichTextEditor value={pickupInfo} onChange={setPickupInfo} rows={3} placeholder={th ? "เช่น รับที่ห้อง SMO ชั้น 1 อาคาร CAMT จ.–ศ. 12:00–13:00" : "e.g. Collect at the SMO room, CAMT building, Mon–Fri 12:00–13:00"} />
        </Field>
      </div>

      {error && <p style={{ color: "var(--red-500)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={save} disabled={saving || uploading} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{th ? "บันทึก" : "Save"}
        </button>
        {savedAt && !saving && <span style={{ fontSize: 13, color: "var(--green-600)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={13} style={{ flexShrink: 0 }} /> {th ? "บันทึกแล้ว" : "Saved"}</span>}
      </div>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */
