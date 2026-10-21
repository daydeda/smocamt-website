"use client";

import { X } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function BuilderHeader({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { closeFormBuilder, eventTitle, lang, t } = ctx;
  return (
    <div style={{ padding: "20px clamp(16px, 5vw, 40px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "th" ? "แบบประเมินผู้เข้าร่วม" : lang === "cn" ? "互动反馈" : lang === "mm" ? "အပြန်အလှန် အကြံပြုချက်" : "Interactive Feedback"}</span>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", overflowWrap: "break-word", wordBreak: "break-word" }}>{eventTitle || "Event"} {t.fbFormSuffix || "Form"}</h3>
              </div>
              <button
                className="btn btn-ghost"
                onClick={closeFormBuilder}
                style={{ borderRadius: "50%", width: 40, height: 40, padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>
  );
}
