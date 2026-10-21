"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { NO_SHOW_PENALTY_MAX, NO_SHOW_PENALTY_MIN, NO_SHOW_PENALTY_POINTS, NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

export function StrikesModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { confirmApplyStrikes, lang, setShowStrikesModal, setStrikesPoints, setStrikesPreview, setStrikesResult, setStrikesSelected, showStrikesModal, strikesLoading, strikesPoints, strikesPreview, strikesResult, strikesSelected, strikesSubmitting, t } = ctx;
  return (
    <>{showStrikesModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(var(--scrim-rgb) / 0.5)",
            zIndex: 2300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            className="animate-fade-in-up"
            style={{
              background: "var(--bg-elevated)",
              borderRadius: 20,
              border: "1px solid var(--border-medium)",
              width: "100%",
              maxWidth: 520,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "24px 28px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: "rgb(var(--red-500-rgb) / 0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <AlertTriangle size={22} color="var(--red-500)" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)" }}>
                  {lang === "th" ? "ยืนยันการลงโทษผู้ไม่มา" : "Confirm no-show strikes"}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                  {lang === "th"
                    ? `บันทึกการลงโทษ 1 ครั้งต่อคน (ครบ ${NO_SHOW_STRIKE_THRESHOLD} ครั้งจะถูกระงับการลงทะเบียน)`
                    : `Records 1 strike per student (registration auto-blocks at ${NO_SHOW_STRIKE_THRESHOLD} strikes).`}
                </p>
              </div>
            </div>

            {!strikesResult && (
              <div style={{ padding: "0 28px 4px", display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="strikes-points-input" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                  {lang === "th" ? "หักคะแนนต่อคน" : "Points to deduct per student"}
                </label>
                <input
                  id="strikes-points-input"
                  type="number"
                  min={NO_SHOW_PENALTY_MIN}
                  max={NO_SHOW_PENALTY_MAX}
                  value={strikesPoints}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setStrikesPoints(v);
                  }}
                  onBlur={() => setStrikesPoints((v) => Math.min(NO_SHOW_PENALTY_MAX, Math.max(NO_SHOW_PENALTY_MIN, Math.round(v) || NO_SHOW_PENALTY_POINTS)))}
                  style={{
                    width: 72, height: 34, borderRadius: 8, border: "1px solid var(--border-medium)",
                    background: "var(--bg-surface)", color: "var(--text-primary)", fontWeight: 700,
                    textAlign: "center", fontSize: 14,
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {NO_SHOW_PENALTY_MIN}–{NO_SHOW_PENALTY_MAX}
                </span>
              </div>
            )}

            <div style={{ padding: "0 28px", flex: 1, overflowY: "auto" }}>
              {strikesLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
                  {lang === "th" ? "กำลังโหลด..." : "Loading…"}
                </div>
              ) : strikesResult ? (
                <div style={{ padding: "8px 0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--emerald-500)", fontWeight: 800, fontSize: 15 }}>
                    <CheckCircle2 size={18} />
                    {lang === "th" ? "ดำเนินการเสร็จสิ้น" : "Strikes applied"}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {lang === "th"
                      ? `ลงโทษ ${strikesResult.struck} คน · หักคะแนนรวม ${strikesResult.pointsDeducted} · ระงับการลงทะเบียน ${strikesResult.blocked} คน`
                      : `Struck ${strikesResult.struck} student(s) · deducted ${strikesResult.pointsDeducted} total points · newly blocked ${strikesResult.blocked} student(s)`}
                  </p>
                </div>
              ) : strikesPreview.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
                  {lang === "th" ? "ไม่มีผู้ไม่มาที่ต้องลงโทษ" : "No no-shows to strike for this event."}
                </div>
              ) : (
                <div style={{ padding: "4px 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {lang === "th"
                        ? `เลือก ${strikesSelected.size}/${strikesPreview.length} คนที่ลงทะเบียนแต่ไม่มาเช็คอิน`
                        : `${strikesSelected.size}/${strikesPreview.length} selected — registered, never checked in`}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ height: 26, paddingInline: 10, fontSize: 12, fontWeight: 700, borderRadius: 8, flexShrink: 0 }}
                      onClick={() => setStrikesSelected(
                        strikesSelected.size === strikesPreview.length
                          ? new Set()
                          : new Set(strikesPreview.map((s) => s.id))
                      )}
                    >
                      {strikesSelected.size === strikesPreview.length
                        ? (lang === "th" ? "ไม่เลือกทั้งหมด" : "Deselect all")
                        : (lang === "th" ? "เลือกทั้งหมด" : "Select all")}
                    </button>
                  </div>
                  {strikesPreview.map((s) => {
                    const checked = strikesSelected.has(s.id);
                    return (
                      <label
                        key={s.id}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                          padding: "10px 12px", borderRadius: 10, background: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          opacity: checked ? 1 : 0.55, cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setStrikesSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                              return next;
                            })}
                            style={{ width: 16, height: 16, flexShrink: 0, accentColor: "var(--red-500)" }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{s.name}{s.nickname ? ` (${s.nickname})` : ""}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.studentId || "—"}</div>
                          </div>
                        </div>
                        {s.noShowCount > 0 && (
                          <span style={{
                            fontSize: 11, fontWeight: 800, color: "var(--red-500)", background: "rgb(var(--red-500-rgb) / 0.12)",
                            borderRadius: 99, padding: "3px 10px", flexShrink: 0,
                          }}>
                            {s.noShowCount + 1}/{NO_SHOW_STRIKE_THRESHOLD}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: "16px 28px 24px", display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid var(--border-subtle)" }}>
              <button
                className="btn btn-ghost"
                style={{ borderRadius: 12, height: 42, paddingInline: 18, fontWeight: 700 }}
                onClick={() => { setShowStrikesModal(false); setStrikesResult(null); setStrikesPreview([]); setStrikesSelected(new Set()); }}
              >
                {strikesResult ? (lang === "th" ? "ปิด" : "Close") : t.cancel}
              </button>
              {!strikesResult && strikesPreview.length > 0 && (
                <button
                  className="btn btn-primary"
                  style={{ borderRadius: 12, height: 42, paddingInline: 18, fontWeight: 700, background: "linear-gradient(135deg, var(--red-500), var(--red-600))", border: "1px solid var(--red-600)" }}
                  disabled={strikesSubmitting || strikesSelected.size === 0}
                  onClick={confirmApplyStrikes}
                >
                  {strikesSubmitting
                    ? (lang === "th" ? "กำลังลงโทษ..." : "Applying…")
                    : (lang === "th" ? `ลงโทษ ${strikesSelected.size} คน` : `Strike ${strikesSelected.size} student(s)`)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}</>
  );
}
