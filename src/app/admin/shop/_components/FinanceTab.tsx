"use client";

import { useCallback, useEffect, useState } from "react";
import { type FinanceBucket, type ProductFinanceRow } from "@/lib/shop/shop-finance";
import { Loader2, Download } from "lucide-react";
import { baht } from "./shop-model";
import { Spinner } from "./ui";

export interface FinanceData {
  rows: ProductFinanceRow[];
  totals: Record<"approved" | "pending" | "rejected", FinanceBucket>;
  scoped: boolean;
}

// Money per product, split by order status: approved = confirmed income,
// pending = awaiting slip review, rejected = not collected. Order-level
// discount/shipping are split across products server-side (src/lib/shop-finance.ts).
export function FinanceTab({ th }: { th: boolean }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/shop/finance");
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const exportXlsx = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const header = [
        "Product", "Paid to",
        "Approved orders", "Approved units", "Gross (THB)", "Discount (THB)", "Shipping (THB)", "Net received (THB)",
        "Pending orders", "Pending amount (THB)", "Rejected orders", "Rejected amount (THB)",
      ];
      const toRow = (name: string, payee: string, r: { approved: FinanceBucket; pending: FinanceBucket; rejected: FinanceBucket }) => [
        name, payee,
        r.approved.orders, r.approved.units, r.approved.gross, r.approved.discount, r.approved.shipping, r.approved.net,
        r.pending.orders, r.pending.net, r.rejected.orders, r.rejected.net,
      ];
      const aoa: (string | number)[][] = [
        header,
        ...data.rows.map((r) => toRow(r.productName, r.sellerName || "Central (SMO)", r)),
        toRow("TOTAL", "", data.totals),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = header.map((h, i) => ({ wch: i === 0 ? 32 : Math.max(12, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Finance");
      const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      XLSX.writeFile(wb, `shop_finance_${stamp}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  if (loadError) return (
    <p style={{ color: "var(--red-500)", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {th ? "โหลดสรุปการเงินไม่สำเร็จ" : "Couldn't load the financial summary."}
      <button onClick={load} className="btn btn-ghost" style={{ fontSize: 13, padding: "4px 10px" }}>{th ? "ลองอีกครั้ง" : "Retry"}</button>
    </p>
  );
  if (!data) return <Spinner />;

  const { totals } = data;
  const ordersLabel = (n: number) => `${n} ${th ? "คำสั่งซื้อ" : n === 1 ? "order" : "orders"}`;
  const tiles = [
    { label: th ? "รายรับที่ยืนยันแล้ว" : "Confirmed income", value: totals.approved.net, sub: `${ordersLabel(totals.approved.orders)}`, color: "var(--green-700)" },
    { label: th ? "รอตรวจสลิป" : "Awaiting review", value: totals.pending.net, sub: `${ordersLabel(totals.pending.orders)}`, color: "var(--amber-700)" },
    { label: th ? "ถูกปฏิเสธ" : "Rejected", value: totals.rejected.net, sub: `${ordersLabel(totals.rejected.orders)}`, color: "var(--red-600)" },
  ];
  const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-subtle)" };
  const head: React.CSSProperties = { ...cell, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 };
  const first: React.CSSProperties = { ...cell, textAlign: "left", whiteSpace: "normal", minWidth: 160 };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 14 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>{t.label}</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: t.color }}>{baht(t.value)}</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {th
            ? "สุทธิ = ราคาสินค้า − ส่วนลด + ค่าจัดส่ง (ส่วนลด/ค่าส่งของคำสั่งซื้อที่มีหลายสินค้าจะแบ่งตามสัดส่วนราคา)"
            : "Net = subtotal − discount + shipping (an order's discount/shipping is split across its products by price)."}
          {data.scoped ? (th ? " แสดงเฉพาะสินค้าของคุณ" : " Showing only your products.") : ""}
        </p>
        <button onClick={exportXlsx} disabled={exporting || data.rows.length === 0} className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{th ? "ส่งออก .xlsx" : "Export .xlsx"}
        </button>
      </div>

      {data.rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ยังไม่มีคำสั่งซื้อ" : "No orders yet."}</p>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: "left" }}>{th ? "สินค้า" : "Product"}</th>
                <th style={head}>{th ? "ชิ้น (อนุมัติ)" : "Units"}</th>
                <th style={head}>{th ? "ราคาสินค้า" : "Gross"}</th>
                <th style={head}>{th ? "ส่วนลด" : "Discount"}</th>
                <th style={head}>{th ? "ค่าจัดส่ง" : "Shipping"}</th>
                <th style={head}>{th ? "รับสุทธิ" : "Net received"}</th>
                <th style={head}>{th ? "รอตรวจ" : "Pending"}</th>
                <th style={head}>{th ? "ปฏิเสธ" : "Rejected"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <td style={first}>
                    <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{r.productName}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{r.sellerName || (th ? "ส่วนกลาง (SMO)" : "Central (SMO)")} · {ordersLabel(r.approved.orders)}</span>
                  </td>
                  <td style={cell}>{r.approved.units.toLocaleString()}</td>
                  <td style={cell}>{baht(r.approved.gross)}</td>
                  <td style={{ ...cell, color: r.approved.discount ? "var(--emerald-500)" : undefined }}>{r.approved.discount ? `−${baht(r.approved.discount)}` : "—"}</td>
                  <td style={cell}>{r.approved.shipping ? baht(r.approved.shipping) : "—"}</td>
                  <td style={{ ...cell, fontWeight: 800 }}>{baht(r.approved.net)}</td>
                  <td style={{ ...cell, color: "var(--amber-700)" }}>{r.pending.net ? `${baht(r.pending.net)} (${r.pending.orders})` : "—"}</td>
                  <td style={{ ...cell, color: "var(--red-600)" }}>{r.rejected.net ? `${baht(r.rejected.net)} (${r.rejected.orders})` : "—"}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 800 }}>
                <td style={{ ...first, fontWeight: 800 }}>{th ? "รวม" : "Total"}</td>
                <td style={cell}>{totals.approved.units.toLocaleString()}</td>
                <td style={cell}>{baht(totals.approved.gross)}</td>
                <td style={cell}>{totals.approved.discount ? `−${baht(totals.approved.discount)}` : "—"}</td>
                <td style={cell}>{totals.approved.shipping ? baht(totals.approved.shipping) : "—"}</td>
                <td style={cell}>{baht(totals.approved.net)}</td>
                <td style={{ ...cell, color: "var(--amber-700)" }}>{baht(totals.pending.net)}</td>
                <td style={{ ...cell, color: "var(--red-600)" }}>{baht(totals.rejected.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Sellers -------------------------------- */
