"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function SongsueToggle({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, editingId, formData, resyncSongsue, set, songsueResyncMessage, songsueResyncing, t } = ctx;
  return (
    <div className="field" style={{ marginTop: 20, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <div
                    onClick={() => set("songsueLinked", !formData.songsueLinked)}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.songsueLinked ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.songsueLinked ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.songsueLinked ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.1s"
                    }}>
                      {formData.songsueLinked && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <ExternalLink size={18} style={{ flexShrink: 0, color: formData.songsueLinked ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.songsueLinked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.songsueLinkedLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.songsueLinkedHint}
                      </span>
                    </div>
                  </div>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginTop: 8 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {canEditRestrictedFields && editingId && formData.songsueLinked && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ borderRadius: 12 }}
                        disabled={songsueResyncing}
                        onClick={resyncSongsue}
                      >
                        {songsueResyncing ? t.songsueResyncing : t.songsueResyncButton}
                      </button>
                      {songsueResyncMessage && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{songsueResyncMessage}</span>
                      )}
                    </div>
                  )}
                </div>
  );
}
