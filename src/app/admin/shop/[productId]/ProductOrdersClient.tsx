"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { PageHeader } from "@/components/admin/ui";
import { OrdersTab } from "../_components/OrdersTab";
import type { ShopContext } from "../_components/shop-model";

export default function ProductOrdersClient({ productId }: { productId: string }) {
  const { lang } = useLanguage();
  const th = lang === "th";
  const [ctx, setCtx] = useState<ShopContext | null>(null);

  useEffect(() => {
    fetch("/api/admin/shop/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCtx(d); })
      .catch(() => {});
  }, []);

  return (
    <div className="pb-20">
      <PageHeader
        back={{ href: "/admin/shop", label: th ? "กลับไปจัดการร้านค้า" : "Back to Manage Shop" }}
        title={th ? "คำสั่งซื้อของสินค้า" : "Product orders"}
        description={th
          ? "คำสั่งซื้อที่มีสินค้านี้ พร้อมสรุปจำนวนตามตัวเลือก ใช้ตรวจสลิปและส่งมอบสินค้า"
          : "Every order that includes this product, with a count per option. Review slips and hand items over from here."}
      />
      <OrdersTab th={th} ctx={ctx} productId={productId} />
    </div>
  );
}
