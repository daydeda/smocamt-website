"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import HandoverProductList, { type HandoverProduct } from "../shop/ShopHandoverProducts";
import ShopHandoverScanner from "../shop/ShopHandoverScanner";

// The scanner's "Shop" tab — the pickup counter next to check-in and prizes,
// so staff running a booth don't have to leave the scanner to hand out shop
// orders. It is ONLY a product picker: the handover itself goes through the
// same ShopHandoverScanner (and POST /api/admin/shop/fulfillment/scan, with its
// scope checks) as the button on /admin/shop.
//
// Like the Prize tab, the parent page stops its own camera while this tab is
// active — ShopHandoverScanner starts its own html5-qrcode instance and two
// can't share the camera.
export default function ScannerShopTab() {
  const { t, lang } = useLanguage();
  const th = lang === "th";
  const [product, setProduct] = useState<HandoverProduct | null>(null);
  // Remount the list after a handover so the "waiting" counts refresh.
  const [listKey, setListKey] = useState(0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
      <div className="stat-card" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <p style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
          <ShoppingBag size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          {t.scannerShopHint}
        </p>
        <Link href="/admin/shop" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--accent-primary)" }}>
          {t.scannerShopManageLink} <ArrowRight size={14} />
        </Link>
      </div>

      <HandoverProductList key={listKey} th={th} onPick={setProduct} />

      {product && (
        <ShopHandoverScanner
          th={th}
          product={product}
          onClose={() => { setProduct(null); setListKey((k) => k + 1); }}
          onHandedOver={() => {}}
        />
      )}
    </div>
  );
}
