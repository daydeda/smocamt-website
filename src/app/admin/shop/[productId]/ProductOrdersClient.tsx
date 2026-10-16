"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { OrdersTab, type ShopContext } from "../AdminShopClient";

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
      <Link href="/admin/shop" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, padding: "6px 12px", marginBottom: 16 }}>
        <ChevronLeft size={15} />{th ? "กลับไปจัดการร้านค้า" : "Back to Manage Shop"}
      </Link>
      <OrdersTab th={th} ctx={ctx} productId={productId} />
    </div>
  );
}
