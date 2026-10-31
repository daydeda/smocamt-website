"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Package, Search } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/admin/ui";

// Step 1 of the handover counter: choose WHICH product you're handing out
// before scanning anyone. Shared by the /admin/shop scan dialog and the Shop
// tab of /admin/scanner. Backed by GET /api/admin/shop/fulfillment/products.

export interface HandoverProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  isActive: boolean;
  sellerName: string;
  waitingQuantity: number;
  waitingBuyers: number;
}

const baht = (n: number) => `฿${n.toLocaleString()}`;

export function ProductThumb({ product, size = 48 }: { product: Pick<HandoverProduct, "imageUrl" | "name">; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {product.imageUrl
        ? <img src={product.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <Package size={Math.round(size * 0.45)} style={{ color: "var(--text-muted)" }} />}
    </div>
  );
}

export default function HandoverProductList({ th, onPick }: { th: boolean; onPick: (p: HandoverProduct) => void }) {
  const [products, setProducts] = useState<HandoverProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/shop/fulfillment/products");
      if (!res.ok) throw new Error();
      const d = await res.json();
      setProducts(d.products ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the setState calls land after this render commits
    // (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (loading) return <LoadingState compact label={th ? "กำลังโหลดสินค้า" : "Loading products"} />;
  if (error) {
    return <ErrorState compact title={th ? "โหลดรายการสินค้าไม่สำเร็จ" : "Couldn't load products"} onRetry={() => { setLoading(true); void load(); }} />;
  }
  if (products.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Package size={24} />}
        title={th ? "ยังไม่มีสินค้าที่คุณดูแล" : "You don't manage any products yet"}
        description={th ? "สินค้าที่คุณเป็นเจ้าของ (ชมรม สาขา หรือผู้ขาย) จะมาแสดงที่นี่ให้เลือกส่งมอบ" : "Products owned by you, your club or your major show up here to hand out."}
      />
    );
  }

  // Two products with the same name (e.g. every club sells a "T-shirt") are the
  // easiest thing to mix up here, so flag them and make the seller stand out.
  const nameCount = new Map<string, number>();
  for (const p of products) {
    const key = p.name.trim().toLowerCase();
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }
  const q = query.trim().toLowerCase();
  const matches = q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sellerName.toLowerCase().includes(q)) : products;
  const waiting = matches.filter((p) => p.waitingBuyers > 0);
  const idle = matches.filter((p) => p.waitingBuyers === 0);

  const row = (p: HandoverProduct) => {
    const duplicate = (nameCount.get(p.name.trim().toLowerCase()) ?? 0) > 1;
    return (
      <li key={p.id}>
        <button
          onClick={() => onPick(p)}
          type="button"
          style={{ width: "100%", minHeight: 64, display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: `1px solid ${duplicate ? "rgb(var(--amber-500-rgb) / 0.5)" : "var(--border-subtle)"}`, background: "var(--bg-surface)", cursor: "pointer", textAlign: "left", color: "inherit", fontFamily: "inherit" }}
        >
          <ProductThumb product={p} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 800, overflowWrap: "anywhere" }}>{p.name}</p>
            <p style={{ fontSize: 13, color: duplicate ? "var(--amber-700)" : "var(--text-muted)", fontWeight: duplicate ? 700 : 400, overflowWrap: "anywhere" }}>
              {p.sellerName} · {baht(p.price)}{!p.isActive ? (th ? " · ปิดขายแล้ว" : " · not on sale") : ""}
            </p>
            {duplicate && (
              <p style={{ fontSize: 12, color: "var(--amber-700)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                <AlertTriangle size={13} style={{ flexShrink: 0 }} />{th ? "มีสินค้าชื่อซ้ำ ตรวจชื่อผู้ขายให้ตรง" : "Another product has this name. Check the seller."}
              </p>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {p.waitingBuyers > 0 ? (
              <>
                <p style={{ fontSize: 15, fontWeight: 800, color: "var(--accent-primary)" }}>{p.waitingQuantity}</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{th ? `ชิ้น · ${p.waitingBuyers} คน` : `to hand · ${p.waitingBuyers} ${p.waitingBuyers === 1 ? "person" : "people"}`}</p>
              </>
            ) : null}
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        </button>
      </li>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {products.length > 6 && (
        <div style={{ position: "relative" }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input
            type="search"
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={th ? "ค้นหาสินค้าหรือผู้ขาย" : "Search product or seller"}
            placeholder={th ? "ค้นหาสินค้าหรือผู้ขาย" : "Search product or seller"}
            style={{ padding: "11px 12px 11px 36px", borderRadius: 12 }}
          />
        </div>
      )}
      {waiting.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 8 }}>{th ? "มีคนรอรับ" : "People waiting"}</h3>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>{waiting.map(row)}</ul>
        </section>
      )}
      {idle.length > 0 && (
        waiting.length > 0 && !q ? (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", padding: "6px 0", minHeight: 44, display: "flex", alignItems: "center" }}>
              {th ? `สินค้าที่ไม่มีคนรอ (${idle.length})` : `Nothing waiting (${idle.length})`}
            </summary>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{idle.map(row)}</ul>
          </details>
        ) : (
          <section>
            {waiting.length === 0 && !q && <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>{th ? "ตอนนี้ไม่มีใครรอรับสินค้า" : "Nobody is waiting for a handover right now."}</p>}
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>{idle.map(row)}</ul>
          </section>
        )
      )}
      {matches.length === 0 && <EmptyState compact icon={<Search size={24} />} title={th ? "ไม่พบสินค้า" : "No matching products"} description={th ? "ลองค้นหาด้วยชื่ออื่น หรือล้างช่องค้นหา" : "Try another name, or clear the search box."} />}
    </div>
  );
}
