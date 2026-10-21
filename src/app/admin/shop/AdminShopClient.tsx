"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ShoppingBag, Package, ReceiptText, Settings as SettingsIcon, Users, Wallet } from "lucide-react";
import { type ShopContext } from "./_components/shop-model";
import { ProductsTab } from "./_components/ProductsTab";
import { OrdersTab } from "./_components/OrdersTab";
import { FinanceTab } from "./_components/FinanceTab";
import { SellersTab } from "./_components/SellersTab";
import { SettingsTab } from "./_components/SettingsTab";

export default function AdminShopClient() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [tab, setTab] = useState<"products" | "orders" | "finance" | "settings" | "sellers">("products");
  // null until the context loads. A scoped president (club/major) never sees the
  // Settings tab — shop settings (QR, payment info, delivery) stay admin-only.
  const [ctx, setCtx] = useState<ShopContext | null>(null);

  useEffect(() => {
    fetch("/api/admin/shop/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCtx(d); })
      .catch(() => {});
  }, []);

  const scoped = ctx?.scoped ?? false;
  const canEditSettings = ctx?.canEditSettings ?? false;
  const canReviewMarketplace = ctx?.canReviewMarketplace ?? false;
  const tabs = ([
    ["products", Package, th ? "สินค้า" : "Products"],
    ["orders", ReceiptText, th ? "คำสั่งซื้อ" : "Orders"],
    ["finance", Wallet, th ? "สรุปการเงิน" : "Finance"],
    ...(canReviewMarketplace ? [["sellers", Users, th ? "ผู้ขาย" : "Sellers"] as const] : []),
    ...(canEditSettings ? [["settings", SettingsIcon, th ? "ตั้งค่า" : "Settings"] as const] : []),
  ] as const);
  const activeTab = (tab === "settings" && !canEditSettings) || (tab === "sellers" && !canReviewMarketplace) ? "products" : tab;

  return (
    <div className="pb-20">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <ShoppingBag size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em" }}>{th ? "จัดการร้านค้า" : "Manage Shop"}</h1>
      </div>

      {scoped && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, fontWeight: 600 }}>
          <p>{th
            ? "คุณเห็นเฉพาะสินค้าและคำสั่งซื้อของผู้ขาย/ชมรม/สาขาที่คุณดูแล"
            : "You're seeing only the products and orders owned by you or your club / major."}</p>
          {ctx?.seller?.status !== "approved" && (
            <p style={{ marginTop: 4, color: "var(--amber-700)" }}>
              {th ? "สมัครเป็นผู้ขายจากหน้าร้านค้าและรออนุมัติก่อนเพิ่มสินค้า/ตั้งค่าการรับเงิน" : "Apply to become a seller from the storefront and wait for approval before adding products or payout settings."}
            </p>
          )}
        </div>
      )}

      {ctx && !scoped && !ctx.canDeleteProducts && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, fontWeight: 600 }}>
          {th
            ? "ฝ่ายการเงิน: ดูและตรวจสอบได้ทุกอย่าง แต่ลบสินค้าไม่ได้ และสินค้าที่คุณเพิ่มต้องรอ Admin / Super Admin อนุมัติก่อนขึ้นร้าน"
            : "Finance: you can see and review everything, but can't delete products, and products you add wait for an Admin / Super Admin to approve them."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {tabs.map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k)} className={activeTab === k ? "btn btn-primary" : "btn btn-ghost"} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {activeTab === "products" && <ProductsTab th={th} ctx={ctx} />}
      {activeTab === "orders" && <OrdersTab th={th} ctx={ctx} />}
      {activeTab === "finance" && <FinanceTab th={th} />}
      {activeTab === "sellers" && canReviewMarketplace && <SellersTab th={th} />}
      {activeTab === "settings" && canEditSettings && <SettingsTab th={th} />}
    </div>
  );
}

/* ------------------------------- Products ------------------------------- */
