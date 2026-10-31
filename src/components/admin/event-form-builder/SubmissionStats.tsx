"use client";

import { BarChart3 } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SubmissionStats({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formStats, t } = ctx;
  const houseColors: Record<string, string> = {
    red: "var(--red-house)",
    green: "var(--green-house)",
    yellow: "var(--yellow-house)",
    blue: "var(--blue-house)",
  };
  const houseNames: Record<string, string> = {
    red: t.houseMom,
    green: t.houseTo,
    yellow: t.houseLuang,
    blue: t.houseMakara,
  };
  return (
    <section aria-labelledby="evf-standings">
      <h3 id="evf-standings" className="mb-4 inline-flex items-center gap-2" style={{ fontSize: 16, fontWeight: 700 }}>
        <BarChart3 size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {t.fbHouseSubmissionStandings}
      </h3>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
        {["red", "green", "yellow", "blue"].map((hId) => (
          <li
            key={hId}
            className="text-center"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderTop: `5px solid ${houseColors[hId]}`, borderRadius: 16, padding: 16 }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{houseNames[hId]}</p>
            <p style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.3, color: "var(--text-primary)" }}>{formStats?.[hId] || 0}</p>
            <p className="adm-field-hint">{t.fbSubmissionsCount}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
