"use client";

import { Plus, Trash2, Calendar, Clock, Users, AlertCircle } from "lucide-react";
import { sessionSpansTooLong } from "@/lib/events/event-schema";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function SessionsEditor({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { addSessionRow, formData, lang, registrationMode, removeSessionRow, sessions, splitSessionRow, t, updateSessionRow } = ctx;
  return (
    <>{registrationMode !== null && (
                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Clock size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.sessionsHeading}
                  </label>
                  <div style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--accent-primary)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    marginBottom: 14,
                  }}>
                    <Calendar size={15} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                      {registrationMode === "per_session" ? t.sessionsNotePerSession : t.sessionsNoteOnce}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {sessions.map((s, idx) => (
                      <div
                        key={s.id ?? `new-${idx}`}
                        style={{
                          background: "var(--bg-elevated)",
                          borderRadius: 16,
                          padding: 16,
                          border: "1px solid var(--border-subtle, transparent)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            className="input"
                            value={s.title}
                            onChange={(e) => updateSessionRow(idx, { title: e.target.value })}
                            placeholder={`${t.sessionTitleLabel} (${lang === "th" ? "วันที่" : lang === "cn" ? "第" : lang === "mm" ? "နေ့" : "Day"} ${idx + 1})`}
                            style={{ flex: 1, minWidth: 0 }}
                          />
                          <button
                            type="button"
                            onClick={() => removeSessionRow(idx)}
                            disabled={sessions.length <= 1}
                            title={t.removeDay}
                            style={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              borderRadius: 12,
                              border: "1px solid var(--border-medium)",
                              background: "transparent",
                              color: sessions.length <= 1 ? "var(--text-muted)" : "var(--red-500)",
                              cursor: sessions.length <= 1 ? "not-allowed" : "pointer",
                              opacity: sessions.length <= 1 ? 0.4 : 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventStartTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.startTime}
                              onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })}
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventEndTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.endTime}
                              onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })}
                            />
                          </div>
                        </div>
                        {sessionSpansTooLong(s.startTime, s.endTime) && (
                          <div style={{
                            display: "flex", gap: 10, alignItems: "flex-start",
                            background: "color-mix(in srgb, var(--amber-500) 12%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--amber-500) 40%, transparent)",
                            borderRadius: 12, padding: "10px 14px",
                          }}>
                            <AlertCircle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                                {t.multiDaySessionWarning}
                              </span>
                              <button
                                type="button"
                                onClick={() => splitSessionRow(idx)}
                                className="btn btn-ghost"
                                style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 12px", borderRadius: 10 }}
                              >
                                {t.splitIntoDays}
                              </button>
                            </div>
                          </div>
                        )}
                        {formData.walkInsEnabled && !formData.walkInsOnly && (
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.sessionWalkInQuota}</label>
                            <div style={{ position: "relative" }}>
                              <Users size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                              <input
                                className="input"
                                type="number"
                                min={1}
                                value={s.quotaWalkIn ?? ""}
                                onChange={(e) => updateSessionRow(idx, { quotaWalkIn: e.target.value ? Number(e.target.value) : null })}
                                placeholder={t.unlimitedIfEmpty}
                                style={{ paddingLeft: 40 }}
                              />
                            </div>
                          </div>
                        )}
                        {formData.checkInMode === "evidence" && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{
                            background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                            borderRadius: 12, padding: 12,
                          }}>
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="label" style={{ fontSize: 12 }}>
                                {lang === "th" ? "รหัสประจำวันนี้ *" : lang === "cn" ? "当日代码词 *" : lang === "mm" ? "ယနေ့ ကုဒ် *" : "This day's code word *"}
                              </label>
                              <input
                                className="input"
                                type="text"
                                value={s.evidenceNonce ?? ""}
                                onChange={(e) => updateSessionRow(idx, { evidenceNonce: e.target.value || null })}
                                placeholder={lang === "th" ? "เช่น สบาย (ประกาศวันนี้)" : lang === "cn" ? "例如：sabai（当天公布）" : lang === "mm" ? "ဥပမာ - sabai (ယနေ့ကြေညာ)" : "e.g. sabai — announced that day"}
                              />
                            </div>
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="label" style={{ fontSize: 12 }}>
                                {lang === "th" ? "คำแนะนำสำหรับวันนี้ (ไม่บังคับ)" : lang === "cn" ? "当日提示（可选）" : lang === "mm" ? "ယနေ့ညွှန်ကြားချက် (ရွေးချယ်နိုင်)" : "Prompt for this day (optional)"}
                              </label>
                              <input
                                className="input"
                                type="text"
                                value={s.evidencePrompt ?? ""}
                                onChange={(e) => updateSessionRow(idx, { evidencePrompt: e.target.value || null })}
                                placeholder={lang === "th" ? "เช่น แนบภาพหน้าจอ Strava ที่แสดงระยะทางวันนี้" : lang === "cn" ? "例如：附上显示今日里程的 Strava 截图" : lang === "mm" ? "ဥပမာ - ယနေ့အကွာအဝေး ပြသော Strava screenshot ပူးတွဲပါ" : "e.g. Attach today's Strava distance screenshot"}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addSessionRow}
                    className="btn btn-ghost"
                    style={{ marginTop: 12, gap: 8, borderRadius: 14 }}
                  >
                    <Plus size={16} /> {t.addDay}
                  </button>
                </div>
                )}</>
  );
}
