"use client";

import { BarChart3 } from "lucide-react";
import { TableScroll } from "@/components/admin/ui";
import { thStyle } from "./ui";
import { summarizeOptions, type OptionSummaryOrder } from "@/lib/shop/shop-option-summary";

// "How many of each option" panel for /admin/shop/[productId]. Counts the orders
// the page already has after its date/search/needs-review filters (not the status
// tab, since the columns split by status anyway), so it is computed in the browser
// and costs the server nothing.
export function OptionSummary({ th, orders, productId, filtered }: { th: boolean; orders: OptionSummaryOrder[]; productId: string; filtered: boolean }) {
  const { rows, total } = summarizeOptions(orders, productId);

  return (
    <details open className="adm-panel" style={{ marginBottom: 20 }}>
      <summary style={{ cursor: "pointer", padding: "12px 16px", minHeight: 44, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
        <BarChart3 size={16} aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
        {th ? "สรุปจำนวนตามตัวเลือก" : "Option summary"}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered ? (th ? "ตามตัวกรองที่เลือก" : "Following your filters") : (th ? "ทุกคำสั่งซื้อ" : "All orders")}
        </span>
      </summary>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "0 16px 16px" }}>{th ? "ไม่มีคำสั่งซื้อในช่วงนี้ ลองล้างตัวกรองเพื่อดูทั้งหมด" : "No orders in this range. Clear the filters to see everything."}</p>
      ) : (
        <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <TableScroll label={th ? "จำนวนชิ้นตามตัวเลือก" : "Units per option"}>
            <table className="data-table" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{th ? "ตัวเลือก" : "Option"}</th>
                  <th className="num" style={thStyle}>{th ? "อนุมัติ" : "Approved"}</th>
                  <th className="num" style={thStyle}>{th ? "รอตรวจสอบ" : "Pending"}</th>
                  <th className="num" style={thStyle} title={th ? "อนุมัติ + รอตรวจสอบ" : "Approved + pending"}>{th ? "รวม (ไม่นับปฏิเสธ)" : "Active total"}</th>
                  <th className="num" style={thStyle}>{th ? "ปฏิเสธ" : "Rejected"}</th>
                  <th className="num" style={thStyle}>{th ? "คำสั่งซื้อ" : "Orders"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.option}>
                    <td style={{ minWidth: 180, whiteSpace: "normal", overflowWrap: "anywhere", color: "var(--text-primary)" }}>{r.option}</td>
                    <td className="num">{r.approved}</td>
                    <td className="num">{r.pending}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--text-primary)" }}>{r.active}</td>
                    <td className="num" style={{ color: "var(--text-muted)" }}>{r.rejected}</td>
                    <td className="num">{r.orders}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800, color: "var(--text-primary)" }}>
                  <th scope="row" style={{ ...thStyle, fontSize: 14, color: "var(--text-primary)", textAlign: "left", borderTop: "2px solid var(--border-subtle)" }}>{th ? "รวม" : "Total"}</th>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{total.approved}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{total.pending}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{total.active}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{total.rejected}</td>
                  <td className="num" style={{ borderTop: "2px solid var(--border-subtle)" }}>{total.orders}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
          <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 16px 14px", lineHeight: 1.6 }}>
            {th ? "นับเป็นจำนวนชิ้น · คอลัมน์ “คำสั่งซื้อ” คือจำนวนคำสั่งซื้อที่มีตัวเลือกนั้น" : "Counts are units (quantity). “Orders” is how many orders include that option."}
          </p>
        </div>
      )}
    </details>
  );
}
