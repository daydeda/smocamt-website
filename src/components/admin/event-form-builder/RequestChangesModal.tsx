"use client";

import { createPortal } from "react-dom";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function RequestChangesModal({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formReviewSaving, requestChangesNote, requestChangesOpen, reviewActiveForm, setRequestChangesNote, setRequestChangesOpen, t } = ctx;
  return (
    <>{requestChangesOpen && createPortal(
                  <div
                    style={{
                      position: "fixed", inset: 0, background: "rgb(var(--scrim-rgb) / 0.4)",
                      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      zIndex: 2500, padding: "clamp(12px, 4vw, 24px)",
                    }}
                    onClick={() => { if (!formReviewSaving) setRequestChangesOpen(false); }}
                  >
                    <div
                      className="animate-fade-in-up"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--bg-surface)", width: "100%", maxWidth: 440,
                        borderRadius: "clamp(20px, 5vw, 32px)", overflow: "hidden",
                        boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.2)", border: "1px solid var(--border-medium)",
                      }}
                    >
                      <div style={{ padding: "24px 28px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <h3 style={{ fontSize: 18, fontWeight: 800 }}>{t.fbReviewRequestChangesBtn || "Request Changes"}</h3>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                          {t.fbReviewRequestChangesPrompt || "What needs to change? (visible to the president)"}
                        </p>
                      </div>
                      <div style={{ padding: "20px 28px" }}>
                        <textarea
                          autoFocus
                          value={requestChangesNote}
                          onChange={(e) => setRequestChangesNote(e.target.value)}
                          maxLength={1000}
                          rows={4}
                          className="input"
                          style={{ width: "100%", resize: "vertical", borderRadius: 12, padding: "10px 14px", fontSize: 14 }}
                        />
                      </div>
                      <div style={{ padding: "16px 28px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
                        <button className="btn btn-ghost" onClick={() => setRequestChangesOpen(false)} disabled={formReviewSaving}>
                          {t.adminProposalsCancelButton || "Cancel"}
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={formReviewSaving || !requestChangesNote.trim()}
                          onClick={async () => {
                            const note = requestChangesNote.trim();
                            setRequestChangesOpen(false);
                            await reviewActiveForm("requestChanges", note);
                          }}
                        >
                          {formReviewSaving ? <div className="spinner w-3 h-3 border-2" /> : null}
                          {t.adminProposalsConfirmButton || "Confirm"}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}</>
  );
}
