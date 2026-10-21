"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { type SellerReviewRow } from "./shop-model";
import { Spinner } from "./ui";

export function SellersTab({ th }: { th: boolean }) {
  const [sellers, setSellers] = useState<SellerReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/shop/sellers");
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body)) throw new Error(body?.error || "Couldn't load sellers");
      setSellers(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load sellers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const review = async (seller: SellerReviewRow, action: "approve" | "reject" | "suspend") => {
    const note = action === "approve" ? undefined : prompt(
      action === "reject"
        ? (th ? "เหตุผลที่ปฏิเสธ (ผู้สมัครจะเห็น)" : "Rejection reason (shown to applicant)")
        : (th ? "เหตุผลที่ระงับ (ผู้ขายจะเห็น)" : "Suspension reason (shown to seller)"),
    );
    if (action === "reject" && !note?.trim()) return;
    if (action === "suspend" && note === null) return;
    setBusy(seller.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shop/sellers/${seller.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note?.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Review failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;
  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        {th
          ? "ผู้สมัครต้องทำ onboarding แล้ว บัญชี Google ทุกโดเมนสมัครได้ การอนุมัติก่อนขายจึงเป็นด่านความไว้วางใจสำหรับการรับเงินและข้อมูลผู้ซื้อ"
          : "Applicants must complete onboarding. Every Google email domain may apply, so approval is the trust gate for receiving payments and buyer data."}
      </p>
      {error && <p style={{ color: "var(--red-500)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {sellers.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{th ? "ยังไม่มีคำขอผู้ขาย" : "No seller applications yet."}</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sellers.map((seller) => {
            const pending = seller.status === "pending";
            const approved = seller.status === "approved";
            const color = approved ? "var(--green-700)" : seller.status === "rejected" ? "var(--red-600)" : "var(--amber-700)";
            return (
              <div key={seller.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 800, fontSize: 15 }}>{seller.displayName}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{seller.accountName} · {seller.accountEmail}</p>
                  <p style={{ fontSize: 12, color, fontWeight: 700, marginTop: 3 }}>{seller.status}</p>
                  {seller.reviewNote && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{seller.reviewNote}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {approved ? (
                    <button onClick={() => review(seller, "suspend")} disabled={busy === seller.id} className="btn btn-ghost" style={{ color: "var(--amber-700)", fontSize: 13 }}>
                      {busy === seller.id && <Loader2 size={14} className="animate-spin" />} {th ? "ระงับ" : "Suspend"}
                    </button>
                  ) : (
                    <>
                      {pending && <button onClick={() => review(seller, "reject")} disabled={busy === seller.id} className="btn btn-ghost" style={{ color: "var(--red-600)", fontSize: 13 }}>{th ? "ปฏิเสธ" : "Reject"}</button>}
                      <button onClick={() => review(seller, "approve")} disabled={busy === seller.id} className="btn btn-primary" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {busy === seller.id && <Loader2 size={14} className="animate-spin" />}{seller.status === "suspended" ? (th ? "คืนสถานะ" : "Restore") : (th ? "อนุมัติ" : "Approve")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Settings ------------------------------- */
