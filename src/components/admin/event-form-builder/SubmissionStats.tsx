"use client";

import { BarChart3 } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SubmissionStats({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formStats, t } = ctx;
  return (
    <div>
                      <h4 style={{ fontSize: 16, fontWeight: 900, marginBottom: 20, display: "inline-flex", alignItems: "center", gap: 6 }}><BarChart3 size={16} style={{ flexShrink: 0 }} /> {t.fbHouseSubmissionStandings || "House Submission Standings"}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {["red", "green", "yellow", "blue"].map(hId => {
                          const houseColors: Record<string, string> = {
                            red: "var(--red-house)",
                            green: "var(--green-house)",
                            yellow: "var(--yellow-house)",
                            blue: "var(--blue-house)"
                          };
                          const houseNames: Record<string, string> = {
                            red: t.houseMom || "Mom",
                            green: t.houseTo || "To",
                            yellow: t.houseLuang || "Luang",
                            blue: t.houseMakara || "Makon"
                          };
                          const count = formStats?.[hId] || 0;
                          return (
                            <div 
                              key={hId} 
                              style={{ 
                                background: "var(--bg-elevated)", 
                                border: `1px solid var(--border-subtle)`,
                                borderTop: `5px solid ${houseColors[hId]}`,
                                borderRadius: 16, 
                                padding: 20, 
                                textAlign: "center" 
                              }}
                            >
                              <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{houseNames[hId]}</p>
                              <p style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)" }}>{count}</p>
                              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{t.fbSubmissionsCount || "submissions"}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
  );
}
