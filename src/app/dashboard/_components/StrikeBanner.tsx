"use client";

import { AlertTriangle, CalendarX2 } from "lucide-react";
import { NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import type { DashboardCtx } from "../_lib/useDashboard";

export function StrikeBanner({ ctx }: { ctx: DashboardCtx }) {
  const { lang, noShowEvents, setAppealModal, strikes, t } = ctx;
  return (
    <>{strikes && strikes.noShowCount > 0 && (() => {
          // Danger (red) from one strike before the block onward, not just once
          // actually blocked — a student on the last warning should already feel
          // the urgency, not be soothed by amber until it's too late.
          const isDanger = strikes.registrationBlocked || strikes.noShowCount >= NO_SHOW_STRIKE_THRESHOLD - 1;
          return (
            <div
              className="alert"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                borderRadius: "var(--radius-lg)",
                padding: 20,
                background: isDanger ? "rgb(var(--red-500-rgb) / 0.06)" : "rgb(var(--amber-500-rgb) / 0.06)",
                border: `1px solid ${isDanger ? "rgb(var(--red-500-rgb) / 0.2)" : "rgb(var(--amber-500-rgb) / 0.2)"}`,
                minWidth: 0,
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-surface)", padding: 8, borderRadius: 12,
                boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.05)",
                color: isDanger ? "var(--red-500)" : "var(--amber-500)",
                width: 40, height: 40, flexShrink: 0,
              }}>
                <AlertTriangle size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 800, fontSize: 15, color: isDanger ? "var(--red-500)" : "var(--amber-500)" }}>
                  {lang === "th"
                    ? `ไม่มาเช็คอิน: ${strikes.noShowCount}/${NO_SHOW_STRIKE_THRESHOLD}`
                    : lang === "cn"
                    ? `缺席次数：${strikes.noShowCount}/${NO_SHOW_STRIKE_THRESHOLD}`
                    : lang === "mm"
                    ? `မလာသူ: ${strikes.noShowCount}/${NO_SHOW_STRIKE_THRESHOLD}`
                    : `No-show strikes: ${strikes.noShowCount}/${NO_SHOW_STRIKE_THRESHOLD}`}
                </p>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 2 }}>
                  {strikes.registrationBlocked
                    ? t.registrationBlockedMessage.replace("{n}", String(NO_SHOW_STRIKE_THRESHOLD))
                    : (lang === "th"
                        ? `หากลงทะเบียนแล้วไม่มาเช็คอินครบ ${NO_SHOW_STRIKE_THRESHOLD} ครั้ง คุณจะถูกระงับสิทธิ์ลงทะเบียนล่วงหน้าชั่วคราว`
                        : lang === "cn"
                        ? `如果您连续${NO_SHOW_STRIKE_THRESHOLD}次注册活动但未签到，您的预注册权限将被暂时封锁。`
                        : lang === "mm"
                        ? `${NO_SHOW_STRIKE_THRESHOLD} ကြိမ်ပြည့်လျှင် ကြိုတင်စာရင်းသွင်းခြင်းကို ယာယီပိတ်ပါမည်။`
                        : `Registering but not checking in ${NO_SHOW_STRIKE_THRESHOLD} times will temporarily block your pre-registration.`)}
                </p>
                {/* Which event(s) triggered these strikes — each gets its OWN appeal
                    action (US-STRI-15c: per-event appeals). A student with 2 strikes
                    can appeal just one and leave the other untouched. */}
                {noShowEvents.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {t.noShowStrikeEventsLabel}
                    </p>
                    {noShowEvents.map((e) => (
                      <div
                        key={e.id}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                          background: "var(--bg-surface)", borderRadius: 10, padding: "8px 12px",
                          minWidth: 0,
                        }}
                      >
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                          <CalendarX2 size={13} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{e.title}</span>
                        </span>
                        {e.appeal?.status === "pending" ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--amber-500)", flexShrink: 0 }}>{t.appealStatusPendingBadge}</span>
                        ) : (
                          <button
                            onClick={() => setAppealModal({ eventId: e.id, eventTitle: e.title })}
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, flexShrink: 0 }}
                          >
                            {t.appealButtonLabel}
                          </button>
                        )}
                      </div>
                    ))}
                    {noShowEvents
                      .filter((e) => e.appeal?.status === "rejected")
                      .map((e) => (
                        <p key={`${e.id}-rejected`} style={{ fontSize: 12, color: "var(--red-500)", fontWeight: 700 }}>
                          {t.appealRejectedNotice} ({e.title})
                          {e.appeal?.reviewNote ? ` ${t.appealStaffNoteLabel} ${e.appeal.reviewNote}` : ""}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}</>
  );
}
