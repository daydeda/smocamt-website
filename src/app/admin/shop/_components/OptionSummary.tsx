"use client";

import { BarChart3 } from "lucide-react";
import { summarizeOptions, type OptionSummaryOrder } from "@/lib/shop/shop-option-summary";

// "How many of each option" panel for /admin/shop/[productId]. Counts the orders
// the page already has after its date/search/needs-review filters (not the status
// tab, since the columns split by status anyway), so it is computed in the browser
// and costs the server nothing.
export function OptionSummary({ th, orders, productId, filtered }: { th: boolean; orders: OptionSummaryOrder[]; productId: string; filtered: boolean }) {
  const { rows, total } = summarizeOptions(orders, productId);

  const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-subtle)" };
  const head: React.CSSProperties = { ...cell, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 };
  const first: React.CSSProperties = { ...cell, textAlign: "left", whiteSpace: "normal", minWidth: 180, overflowWrap: "anywhere" };
  const totalCell: React.CSSProperties = { ...cell, fontWeight: 800, borderBottom: "none" };

  return (
    <details open style={{ marginBottom: 20, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)" }}>
      <summary style={{ cursor: "pointer", padding: "12px 14px", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <BarChart3 size={16} style={{ color: "var(--accent-primary)" }} />
        {th ? "สรุปจำนวนตามตัวเลือก" : "Option summary"}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered ? (th ? "ตามตัวกรองที่เลือก" : "Following your filters") : (th ? "ทุกคำสั่งซื้อ" : "All orders")}
        </span>
      </summary>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "0 14px 14px" }}>{th ? "ไม่มีคำสั่งซื้อในช่วงนี้" : "No orders in this range."}</p>
      ) : (
        <div style={{ overflowX: "auto", borderTop: "1px solid var(--border-subtle)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: "left" }}>{th ? "ตัวเลือก" : "Option"}</th>
                <th style={head}>{th ? "อนุมัติ" : "Approved"}</th>
                <th style={head}>{th ? "รอตรวจสอบ" : "Pending"}</th>
                <th style={head} title={th ? "อนุมัติ + รอตรวจสอบ" : "Approved + pending"}>{th ? "รวม (ไม่นับปฏิเสธ)" : "Active total"}</th>
                <th style={head}>{th ? "ปฏิเสธ" : "Rejected"}</th>
                <th style={head}>{th ? "คำสั่งซื้อ" : "Orders"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.option}>
                  <td style={first}>{r.option}</td>
                  <td style={cell}>{r.approved}</td>
                  <td style={cell}>{r.pending}</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r.active}</td>
                  <td style={{ ...cell, color: "var(--text-muted)" }}>{r.rejected}</td>
                  <td style={cell}>{r.orders}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...first, fontWeight: 800, borderBottom: "none" }}>{th ? "รวม" : "Total"}</td>
                <td style={totalCell}>{total.approved}</td>
                <td style={totalCell}>{total.pending}</td>
                <td style={totalCell}>{total.active}</td>
                <td style={totalCell}>{total.rejected}</td>
                <td style={totalCell}>{total.orders}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 14px 12px" }}>
            {th ? "นับเป็นจำนวนชิ้น · คอลัมน์ “คำสั่งซื้อ” คือจำนวนคำสั่งซื้อที่มีตัวเลือกนั้น" : "Counts are units (quantity). “Orders” is how many orders include that option."}
          </p>
        </div>
      )}
    </details>
  );
}
