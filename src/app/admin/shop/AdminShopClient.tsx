"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Package, ReceiptText, Settings as SettingsIcon, Users, Wallet } from "lucide-react";
import { InlineAlert, PageHeader, TabPanel, Tabs, type TabItem } from "@/components/admin/ui";
import { type ShopContext } from "./_components/shop-model";
import { ProductsTab } from "./_components/ProductsTab";
import { OrdersTab } from "./_components/OrdersTab";
import { FinanceTab } from "./_components/FinanceTab";
import { SellersTab } from "./_components/SellersTab";
import { SettingsTab } from "./_components/SettingsTab";

type ShopTab = "products" | "orders" | "finance" | "settings" | "sellers";

export default function AdminShopClient() {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [tab, setTab] = useState<ShopTab>("products");
  // null until the context loads. A scoped president (club/major) never sees the
  // Settings tab — shop settings (QR, payment info, delivery) stay admin-only.
  const [ctx, setCtx] = useState<ShopContext | null>(null);
  // "Needs action" counts, reported by each tab once it has loaded its data (the
  // tabs own their fetches). A tab you haven't opened yet shows no count.
  const [counts, setCounts] = useState<{ orders?: number; products?: number; sellers?: number }>({});
  const reportOrders = useCallback((n: number) => setCounts((c) => (c.orders === n ? c : { ...c, orders: n })), []);
  const reportProducts = useCallback((n: number) => setCounts((c) => (c.products === n ? c : { ...c, products: n })), []);
  const reportSellers = useCallback((n: number) => setCounts((c) => (c.sellers === n ? c : { ...c, sellers: n })), []);

  useEffect(() => {
    fetch("/api/admin/shop/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCtx(d); })
      .catch(() => {});
  }, []);

  const scoped = ctx?.scoped ?? false;
  const canEditSettings = ctx?.canEditSettings ?? false;
  const canReviewMarketplace = ctx?.canReviewMarketplace ?? false;
  const tabs: TabItem<ShopTab>[] = [
    { id: "products", icon: <Package size={16} />, label: th ? "สินค้า" : "Products", count: canReviewMarketplace && counts.products ? counts.products : undefined },
    { id: "orders", icon: <ReceiptText size={16} />, label: th ? "คำสั่งซื้อ" : "Orders", count: counts.orders ? counts.orders : undefined },
    { id: "finance", icon: <Wallet size={16} />, label: th ? "สรุปการเงิน" : "Finance" },
    ...(canReviewMarketplace ? [{ id: "sellers" as const, icon: <Users size={16} />, label: th ? "ผู้ขาย" : "Sellers", count: counts.sellers ? counts.sellers : undefined }] : []),
    ...(canEditSettings ? [{ id: "settings" as const, icon: <SettingsIcon size={16} />, label: th ? "ตั้งค่า" : "Settings" }] : []),
  ];
  const activeTab = (tab === "settings" && !canEditSettings) || (tab === "sellers" && !canReviewMarketplace) ? "products" : tab;

  return (
    <div className="pb-20">
      <PageHeader
        title={th ? "จัดการร้านค้า" : "Manage Shop"}
        description={th
          ? "ดูแลสินค้า ตรวจสลิปคำสั่งซื้อ ส่งมอบสินค้า และดูยอดเงิน ตัวเลขบนแท็บคือรายการที่รอให้คุณตรวจ"
          : "Manage products, review payment slips, hand items over and check the money. The number on a tab is how many items are waiting for your review."}
      />

      {scoped && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <InlineAlert tone="info">
            {th
              ? "คุณเห็นเฉพาะสินค้าและคำสั่งซื้อของผู้ขาย/ชมรม/สาขาที่คุณดูแล"
              : "You're seeing only the products and orders owned by you or your club / major."}
          </InlineAlert>
          {ctx?.seller?.status !== "approved" && (
            <InlineAlert tone="warning">
              {th ? "สมัครเป็นผู้ขายจากหน้าร้านค้าและรออนุมัติก่อนเพิ่มสินค้า/ตั้งค่าการรับเงิน" : "Apply to become a seller from the storefront and wait for approval before adding products or payout settings."}
            </InlineAlert>
          )}
        </div>
      )}

      {ctx && !scoped && !ctx.canDeleteProducts && (
        <div style={{ marginBottom: 16 }}>
          <InlineAlert tone="info">
            {th
              ? "ฝ่ายการเงิน: ดูและตรวจสอบได้ทุกอย่าง แต่ลบสินค้าไม่ได้ และสินค้าที่คุณเพิ่มต้องรอ Admin / Super Admin อนุมัติก่อนขึ้นร้าน"
              : "Finance: you can see and review everything, but can't delete products, and products you add wait for an Admin / Super Admin to approve them."}
          </InlineAlert>
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <Tabs tabs={tabs} value={activeTab} onChange={setTab} ariaLabel={th ? "ส่วนของร้านค้า" : "Shop sections"} idBase="shop" />
      </div>

      <TabPanel idBase="shop" id={activeTab}>
        {activeTab === "products" && <ProductsTab th={th} ctx={ctx} onPendingApprovals={reportProducts} />}
        {activeTab === "orders" && <OrdersTab th={th} ctx={ctx} onPendingCount={reportOrders} />}
        {activeTab === "finance" && <FinanceTab th={th} />}
        {activeTab === "sellers" && canReviewMarketplace && <SellersTab th={th} onPendingCount={reportSellers} />}
        {activeTab === "settings" && canEditSettings && <SettingsTab th={th} />}
      </TabPanel>
    </div>
  );
}
