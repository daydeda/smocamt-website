"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { EmptyState, ErrorState, Modal, useToast } from "@/components/admin/ui";
import { type SellerReviewRow } from "./shop-model";
import { ApprovalBadge, Field, Spinner } from "./ui";

type ReviewAction = "approve" | "reject" | "suspend";

export function SellersTab({ th, onPendingCount }: { th: boolean; onPendingCount?: (n: number) => void }) {
  const toast = useToast();
  const [sellers, setSellers] = useState<SellerReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Reject / suspend need a reason, so they open a small form instead of prompt().
  const [reasonFor, setReasonFor] = useState<{ seller: SellerReviewRow; action: "reject" | "suspend" } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/shop/sellers");
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body)) throw new Error(body?.error || "Couldn't load sellers");
      setSellers(body);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load sellers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const pendingCount = sellers.filter((s) => s.status === "pending").length;
  useEffect(() => { onPendingCount?.(pendingCount); }, [onPendingCount, pendingCount]);

  // Same request as before; the note is collected by the caller.
  const send = async (seller: SellerReviewRow, action: ReviewAction, note?: string) => {
    setBusy(seller.id);
    try {
      const res = await fetch(`/api/admin/shop/sellers/${seller.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note?.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Review failed");
      await load();
      const name = seller.displayName;
      const restored = action === "approve" && seller.status === "suspended";
      toast.success(
        action === "reject" ? (th ? `ปฏิเสธ ${name} แล้ว` : `Rejected ${name}`)
          : action === "suspend" ? (th ? `ระงับ ${name} แล้ว` : `Suspended ${name}`)
          : restored ? (th ? `คืนสถานะ ${name} แล้ว` : `Restored ${name}`)
          : (th ? `อนุมัติ ${name} แล้ว` : `Approved ${name}`),
      );
      return true;
    } catch (e) {
      toast.error(
        action === "approve" ? (th ? "อนุมัติไม่สำเร็จ" : "Couldn't approve") : action === "reject" ? (th ? "ปฏิเสธไม่สำเร็จ" : "Couldn't reject") : (th ? "ระงับไม่สำเร็จ" : "Couldn't suspend"),
        e instanceof Error ? e.message : "Review failed",
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openReason = (seller: SellerReviewRow, action: "reject" | "suspend") => {
    setReason("");
    setReasonError(null);
    setReasonFor({ seller, action });
  };

  const submitReason = async () => {
    if (!reasonFor) return;
    // Rejecting needs a reason the applicant can act on; a suspension note is optional.
    if (reasonFor.action === "reject" && !reason.trim()) {
      setReasonError(th ? "กรุณาระบุเหตุผล ผู้สมัครจะเห็นข้อความนี้" : "Enter a reason. The applicant will see it.");
      reasonRef.current?.focus();
      return;
    }
    const ok = await send(reasonFor.seller, reasonFor.action, reason);
    if (ok) setReasonFor(null);
  };

  if (loading) return <Spinner />;
  if (loadError) return <ErrorState title={th ? "โหลดรายชื่อผู้ขายไม่สำเร็จ" : "Couldn't load sellers"} message={loadError} onRetry={() => { setLoading(true); load(); }} />;

  const rejecting = reasonFor?.action === "reject";
  const reasonBusy = !!reasonFor && busy === reasonFor.seller.id;

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
        {th
          ? "ผู้สมัครต้องทำ onboarding แล้ว บัญชี Google ทุกโดเมนสมัครได้ การอนุมัติก่อนขายจึงเป็นด่านความไว้วางใจสำหรับการรับเงินและข้อมูลผู้ซื้อ"
          : "Applicants must complete onboarding. Every Google email domain may apply, so approval is the trust gate for receiving payments and buyer data."}
      </p>
      {sellers.length === 0 ? (
        <EmptyState
          title={th ? "ยังไม่มีคำขอเป็นผู้ขาย" : "No seller applications yet"}
          description={th ? "เมื่อมีนักศึกษาสมัครเป็นผู้ขายจากหน้าร้านค้า คำขอจะมาอยู่ที่นี่เพื่อรอให้คุณตรวจ" : "When someone applies to sell from the storefront, the request shows up here for you to review."}
        />
      ) : (
        <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
          {sellers.map((seller) => {
            const pending = seller.status === "pending";
            const approved = seller.status === "approved";
            const isBusy = busy === seller.id;
            return (
              <li key={seller.id} className="adm-panel" style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <p style={{ fontWeight: 800, fontSize: 15, overflowWrap: "anywhere" }}>{seller.displayName}</p>
                    <ApprovalBadge status={seller.status} th={th} />
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere", marginTop: 2 }}>{seller.accountName} · {seller.accountEmail}</p>
                  {seller.reviewNote && <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{th ? "หมายเหตุ: " : "Note: "}{seller.reviewNote}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {approved ? (
                    <button onClick={() => openReason(seller, "suspend")} disabled={isBusy} className="btn btn-ghost" style={{ color: "var(--amber-700)", fontSize: 13 }}>
                      <Ban size={15} aria-hidden="true" />{th ? "ระงับ" : "Suspend"}
                    </button>
                  ) : (
                    <>
                      {pending && (
                        <button onClick={() => openReason(seller, "reject")} disabled={isBusy} className="btn btn-ghost" style={{ color: "var(--red-600)", fontSize: 13, marginRight: 8 }}>
                          <XCircle size={15} aria-hidden="true" />{th ? "ปฏิเสธ" : "Reject"}
                        </button>
                      )}
                      <button onClick={() => send(seller, "approve")} disabled={isBusy} className="btn btn-primary" style={{ fontSize: 13 }}>
                        {isBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : seller.status === "suspended" ? <RotateCcw size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                        {seller.status === "suspended" ? (th ? "คืนสถานะ" : "Restore") : (th ? "อนุมัติ" : "Approve")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        dismissible={!reasonBusy}
        size="sm"
        icon={rejecting ? <XCircle size={20} /> : <Ban size={20} />}
        title={rejecting
          ? (th ? `ปฏิเสธ ${reasonFor?.seller.displayName ?? ""}` : `Reject ${reasonFor?.seller.displayName ?? ""}`)
          : (th ? `ระงับ ${reasonFor?.seller.displayName ?? ""}` : `Suspend ${reasonFor?.seller.displayName ?? ""}`)}
        description={rejecting
          ? (th ? "ผู้สมัครจะเห็นเหตุผลนี้" : "The applicant will see this reason.")
          : (th ? "ผู้ขายจะเห็นเหตุผลนี้ และจะเข้าถึงการจัดการร้านไม่ได้จนกว่าจะคืนสถานะ" : "The seller will see this reason and loses shop access until you restore them.")}
        initialFocusRef={reasonRef}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReasonFor(null)} disabled={reasonBusy}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button type="button" className={rejecting ? "btn adm-btn-danger-solid" : "btn btn-primary"} onClick={submitReason} disabled={reasonBusy}>
              {reasonBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {rejecting ? (th ? "ปฏิเสธผู้สมัคร" : "Reject applicant") : (th ? "ระงับผู้ขาย" : "Suspend seller")}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field
            label={rejecting ? (th ? "เหตุผลที่ปฏิเสธ" : "Rejection reason") : (th ? "เหตุผลที่ระงับ (ไม่บังคับ)" : "Suspension reason (optional)")}
            required={rejecting}
            error={reasonError}
          >
            <textarea
              ref={reasonRef}
              className="input"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
              placeholder={rejecting ? (th ? "เช่น ข้อมูลบัญชีรับเงินไม่ครบ" : "e.g. Payout details are incomplete") : (th ? "เช่น ได้รับการร้องเรียนจากผู้ซื้อ" : "e.g. Buyer complaints under review")}
              style={{ resize: "vertical" }}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
