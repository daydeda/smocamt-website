"use client";

import { useCallback, useEffect, useState } from "react";
import { type FinanceBucket, type ProductFinanceRow } from "@/lib/shop/shop-finance";
import { Loader2, Download, Wallet, Clock, XCircle } from "lucide-react";
import { EmptyState, ErrorState, Panel, StatCard, TableScroll, Toolbar, useToast } from "@/components/admin/ui";
import { baht } from "./shop-model";
import { Spinner, thStyle } from "./ui";

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
  const toast = useToast();

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
      toast.success(th ? "ส่งออกไฟล์แล้ว" : "Export downloaded", `shop_finance_${stamp}.xlsx`);
    } catch (e) {
      toast.error(th ? "ส่งออกไม่สำเร็จ" : "Couldn't export", e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  if (loadError) return <ErrorState title={th ? "โหลดสรุปการเงินไม่สำเร็จ" : "Couldn't load the financial summary"} onRetry={load} />;
  if (!data) return <Spinner />;

  const { totals } = data;
  const ordersLabel = (n: number) => `${n} ${th ? "คำสั่งซื้อ" : n === 1 ? "order" : "orders"}`;
  const tiles = [
    { label: th ? "รายรับที่ยืนยันแล้ว" : "Confirmed income", value: totals.approved.net, sub: ordersLabel(totals.approved.orders), tone: "success" as const, icon: <Wallet size={18} /> },
    { label: th ? "รอตรวจสลิป" : "Awaiting review", value: totals.pending.net, sub: ordersLabel(totals.pending.orders), tone: "warning" as const, icon: <Clock size={18} /> },
    { label: th ? "ถูกปฏิเสธ" : "Rejected", value: totals.rejected.net, sub: ordersLabel(totals.rejected.orders), tone: "danger" as const, icon: <XCircle size={18} /> },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        {tiles.map((t) => (
          <StatCard key={t.label} label={t.label} value={baht(t.value)} hint={t.sub} tone={t.tone} icon={t.icon} />
        ))}
      </div>

      <Toolbar>
        <p style={{ fontSize: 13, color: "var(--text-muted)", flex: "1 1 320px", lineHeight: 1.6 }}>
          {th
            ? "สุทธิ = ราคาสินค้า − ส่วนลด + ค่าจัดส่ง (ส่วนลด/ค่าส่งของคำสั่งซื้อที่มีหลายสินค้าจะแบ่งตามสัดส่วนราคา)"
            : "Net = subtotal − discount + shipping (an order's discount/shipping is split across its products by price)."}
          {data.scoped ? (th ? " แสดงเฉพาะสินค้าของคุณ" : " Showing only your products.") : ""}
        </p>
        <button onClick={exportXlsx} disabled={exporting || data.rows.length === 0} className="btn btn-ghost" style={{ fontSize: 13 }}>
          {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{exporting ? (th ? "กำลังส่งออก…" : "Exporting…") : (th ? "ส่งออก .xlsx" : "Export .xlsx")}
        </button>
      </Toolbar>

      {data.rows.length === 0 ? (
        <EmptyState
          title={th ? "ยังไม่มีคำสั่งซื้อ" : "No orders yet"}
          description={th ? "เมื่อมีคนสั่งสินค้า ยอดเงินแยกตามสินค้าจะแสดงที่นี่" : "Once people order, the money per product shows up here."}
        />
      ) : (
        <Panel padded={false}>
          <TableScroll label={th ? "สรุปการเงินแยกตามสินค้า" : "Money per product"}>
            <table className="data-table" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{th ? "สินค้า" : "Product"}</th>
                  <th className="num" style={thStyle}>{th ? "ชิ้น (อนุมัติ)" : "Units"}</th>
                  <th className="num" style={thStyle}>{th ? "ราคาสินค้า" : "Gross"}</th>
                  <th className="num" style={thStyle}>{th ? "ส่วนลด" : "Discount"}</th>
                  <th className="num" style={thStyle}>{th ? "ค่าจัดส่ง" : "Shipping"}</th>
                  <th className="num" style={thStyle}>{th ? "รับสุทธิ" : "Net received"}</th>
                  <th className="num" style={thStyle}>{th ? "รอตรวจ (คำสั่งซื้อ)" : "Pending (orders)"}</th>
                  <th className="num" style={thStyle}>{th ? "ปฏิเสธ (คำสั่งซื้อ)" : "Rejected (orders)"}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ minWidth: 180, whiteSpace: "normal" }}>
                      <span style={{ fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{r.productName}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>{r.sellerName || (th ? "ส่วนกลาง (SMO)" : "Central (SMO)")} · {ordersLabel(r.approved.orders)}</span>
                    </td>
                    <td className="num">{r.approved.units.toLocaleString()}</td>
                    <td className="num">{baht(r.approved.gross)}</td>
                    <td className="num" style={{ color: r.approved.discount ? "var(--emerald-600)" : undefined }}>{r.approved.discount ? `−${baht(r.approved.discount)}` : "—"}</td>
                    <td className="num">{r.approved.shipping ? baht(r.approved.shipping) : "—"}</td>
                    <td className="num" style={{ fontWeight: 800, color: "var(--text-primary)" }}>{baht(r.approved.net)}</td>
                    <td className="num" style={{ color: r.pending.net ? "var(--amber-700)" : undefined }}>{r.pending.net ? `${baht(r.pending.net)} (${r.pending.orders})` : "—"}</td>
                    <td className="num" style={{ color: r.rejected.net ? "var(--red-600)" : undefined }}>{r.rejected.net ? `${baht(r.rejected.net)} (${r.rejected.orders})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, color: "var(--text-primary)" }}>
                  <th scope="row" style={{ ...thStyle, fontSize: 14, color: "var(--text-primary)", textAlign: "left", borderTop: "2px solid var(--border-subtle)" }}>{th ? "รวม" : "Total"}</th>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{totals.approved.units.toLocaleString()}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{baht(totals.approved.gross)}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{totals.approved.discount ? `−${baht(totals.approved.discount)}` : "—"}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{totals.approved.shipping ? baht(totals.approved.shipping) : "—"}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{baht(totals.approved.net)}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)", color: "var(--amber-700)" }}>{baht(totals.pending.net)}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)", color: "var(--red-600)" }}>{baht(totals.rejected.net)}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------- Sellers -------------------------------- */
