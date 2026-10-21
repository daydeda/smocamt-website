"use client";

import { AlertCircle } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function ConfirmModal({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { confirmModal, setConfirmModal } = ctx;
  return (
    <>{confirmModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: confirmModal.isDanger ? "rgb(var(--red-500-rgb) / 0.1)" : "rgb(var(--accent-rgb) / 0.1)",
              color: confirmModal.isDanger ? "var(--red-500)" : "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertCircle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {confirmModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {confirmModal.message}
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 700 }}
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              >
                {confirmModal.cancelText || "Cancel"}
              </button>
              <button
                className="btn"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  background: confirmModal.isDanger 
                    ? "linear-gradient(135deg, var(--red-500) 0%, var(--red-600) 100%)" 
                    : "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-deep) 100%)",
                  color: "var(--text-on-color)",
                  border: "none",
                  boxShadow: confirmModal.isDanger 
                    ? "0 4px 14px rgb(var(--red-500-rgb) / 0.3)" 
                    : "0 4px 14px rgb(var(--accent-rgb) / 0.3)"
                }}
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}</>
  );
}
