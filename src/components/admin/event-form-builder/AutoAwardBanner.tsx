"use client";

import { Calendar, CheckCircle2, Lock, Trophy } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function AutoAwardBanner({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formClosesAt, formIsAwarded, formPoints, t } = ctx;
  return (
    <>{(() => {
                      const now = new Date();
                      const closes = formClosesAt ? new Date(formClosesAt) : null;
                      const hasClosed = !!closes && now > closes;

                      if (formIsAwarded) {
                        return (
                          <div
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
                            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 24, padding: "24px 32px" }}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "rgb(var(--emerald-500-rgb) / 0.1)", color: "var(--emerald-500)", flexShrink: 0 }}>
                                <CheckCircle2 size={22} />
                              </div>
                              <div>
                                <h4 style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)", marginBottom: 4 }}>{t.fbContestFinalizedTitle || "Contest Finalized & Closed"}</h4>
                                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                  {t.fbContestFinalizedDesc || "Points have been awarded to the winning house and this evaluation form is frozen."}
                                </p>
                              </div>
                            </div>
                            <div style={{ padding: "8px 16px", borderRadius: 10, background: "rgb(var(--emerald-500-rgb) / 0.1)", color: "var(--emerald-500)", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
                              <Lock size={14} style={{ flexShrink: 0 }} /> {t.fbPermanentLock || "Permanent Lock"}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
                          style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb) / 0.08) 0%, rgb(var(--accent-deep-rgb) / 0.08) 100%)", border: "1px solid rgb(var(--accent-rgb) / 0.2)", borderRadius: 24, padding: "24px 32px" }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "rgb(var(--accent-rgb) / 0.1)", color: "var(--accent-primary)", flexShrink: 0 }}>
                              {hasClosed ? <Trophy size={22} /> : <Calendar size={22} />}
                            </div>
                            <div>
                              <h4 style={{ fontSize: 16, fontWeight: 900, color: "var(--accent-primary)", marginBottom: 4 }}>
                                {hasClosed ? (t.fbClosedAwaitingAward || "Closed — awaiting automatic award") : (t.fbAwardsWhenFormCloses || "Awards automatically when the form closes")}
                              </h4>
                              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                {hasClosed
                                  ? <>The close time has passed. The house with the most submissions will automatically receive <b>+{formPoints} PTS</b> — it settles the next time the dashboard or scoreboard is opened, or at the daily 23:00 run.</>
                                  : formClosesAt
                                  ? <>When the close time passes, the house with the most submissions automatically receives <b>+{formPoints} PTS</b>. No manual action needed.</>
                                  : <>No <b>Closes at</b> time is set, so this form stays open and will <b>not</b> auto-award. Set a close time under Design &amp; Rules to enable automatic awarding.</>}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}</>
  );
}
