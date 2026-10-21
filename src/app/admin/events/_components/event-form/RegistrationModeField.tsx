"use client";

import { Calendar } from "lucide-react";
import { splitIntoDailySessions } from "@/lib/events/event-schema";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function RegistrationModeField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, registrationMode, sessions, setRegistrationMode, setSessions, t } = ctx;
  return (
    <div className="field" style={{ marginTop: 4 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.registrationModeLabel}
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: 999,
                      padding: "1px 8px",
                    }}>
                      {t.registrationModeOptional}
                    </span>
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    {t.registrationModeHint}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      // Not flagged "recommended" — it's the only supported mode today
                      // (per_session below is unbuilt), so a "recommended" badge next to
                      // the sole option would misleadingly imply it was chosen among
                      // real alternatives. See registrationModeHint for the full context.
                      { value: "once" as const, label: t.registrationModeOnce, desc: t.registrationModeOnceDesc, recommended: false },
                      // 'per_session' (separate sign-up each day) is intentionally
                      // hidden: the student registration flow has no per-day path yet,
                      // so picking it would create an event where Day-2 pre-registrants
                      // get pushed into the walk-in path. Re-enable once per-session
                      // registration ships. See docs/features/multi-day-checkin-implementation.md §10.
                      // { value: "per_session" as const, label: t.registrationModePerSession, desc: t.registrationModePerSessionDesc, recommended: false },
                    ]).map((opt) => {
                      const active = registrationMode === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => {
                            if (active) {
                              // Click again to un-select — collapse back to a single
                              // session row mirroring the main start/end, matching
                              // the registrationMode === null convention used above.
                              const first = sessions[0];
                              setRegistrationMode(null);
                              setSessions([{ title: first?.title ?? "", startTime: formData.startTime, endTime: formData.endTime, quotaWalkIn: first?.quotaWalkIn ?? null, evidenceNonce: first?.evidenceNonce ?? null, evidencePrompt: first?.evidencePrompt ?? null }]);
                            } else {
                              setRegistrationMode(opt.value);
                              // The sole row still mirrors the main start/end. If that
                              // range itself spans multiple calendar days, split it into
                              // one row per day right away — otherwise "Day 1" would
                              // silently cover the whole multi-day range as one session
                              // (see sessionSpansTooLong).
                              const first = sessions[0];
                              if (first?.startTime && first?.endTime) {
                                const split = splitIntoDailySessions(first.startTime, first.endTime);
                                if (split.length > 1) {
                                  setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: first.quotaWalkIn ?? null, evidenceNonce: first.evidenceNonce ?? null, evidencePrompt: first.evidencePrompt ?? null })));
                                }
                              }
                            }
                          }}
                          style={{
                            minHeight: 48,
                            background: "var(--bg-elevated)",
                            borderRadius: 16,
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 16px",
                            cursor: "pointer",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{
                            width: 22,
                            height: 22,
                            flexShrink: 0,
                            marginTop: 1,
                            borderRadius: "50%",
                            border: active ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.1s",
                          }}>
                            {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.35 }}>
                                {opt.label}
                              </span>
                              {opt.recommended && (
                                <span style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: "var(--accent-primary)",
                                  background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
                                  border: "1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)",
                                  borderRadius: 999,
                                  padding: "1px 8px",
                                  letterSpacing: 0.2,
                                  whiteSpace: "nowrap",
                                }}>
                                  {t.registrationModeRecommended}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {opt.desc}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
  );
}
