"use client";

import { Sparkles, Trophy } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function PointPoolsFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, set, t } = ctx;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Trophy size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--amber-400)" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.pointsAwarded} onChange={(e) => set("pointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "var(--amber-500)", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventHousePointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                  <div className="field">
                    <label className="label">{t.eventIndividualPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Sparkles size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--accent-primary)" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.individualPointsAwarded} onChange={(e) => set("individualPointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "var(--amber-500)", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventIndividualPointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                </div>
  );
}
