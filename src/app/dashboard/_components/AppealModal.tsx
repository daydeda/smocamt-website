"use client";

import type { DashboardCtx } from "../_lib/useDashboard";

export function AppealModal({ ctx }: { ctx: DashboardCtx }) {
  const { appealMessage, appealModal, setAppealMessage, setAppealModal, submitAppeal, submittingAppeal, t } = ctx;
  return (
    <>{appealModal && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgb(var(--scrim-rgb) / 0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={() => !submittingAppeal && setAppealModal(null)}
          >
            <div
              style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", padding: 24, maxWidth: 480, width: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>{t.appealModalTitle}</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6, overflowWrap: "anywhere" }}>
                {t.appealModalEventLabel} {appealModal.eventTitle}
              </p>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 14 }}>{t.appealModalDescription}</p>
              <textarea
                value={appealMessage}
                onChange={(e) => setAppealMessage(e.target.value)}
                rows={5}
                maxLength={1000}
                placeholder={t.appealMessagePlaceholder}
                style={{
                  width: "100%",
                  padding: 14,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  resize: "vertical",
                  fontFamily: "inherit",
                  background: "var(--bg-base)",
                }}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button
                  onClick={() => setAppealModal(null)}
                  disabled={submittingAppeal}
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                >
                  {t.appealCancelButton}
                </button>
                <button
                  onClick={submitAppeal}
                  disabled={submittingAppeal || appealMessage.trim().length < 10}
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                >
                  {submittingAppeal ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t.appealSubmitButton}
                </button>
              </div>
            </div>
          </div>
        )}</>
  );
}
