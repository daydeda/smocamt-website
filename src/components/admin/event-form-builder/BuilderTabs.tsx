"use client";

import { FileText, Trophy } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function BuilderTabs({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { canManageForms, formSubmissions, formTab, lang, setFormTab } = ctx;
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", flexShrink: 0, position: "sticky", top: 0, zIndex: 2 }}>
              {canManageForms && (
              <button
                style={{
                  flex: 1,
                  padding: "16px 20px",
                  fontSize: 14,
                  fontWeight: 800,
                  border: "none",
                  borderBottom: formTab === "edit" ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  background: "transparent",
                  color: formTab === "edit" ? "var(--accent-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => setFormTab("edit")}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <FileText size={16} style={{ flexShrink: 0 }} /> {lang === "th" ? "ออกแบบฟอร์มและกฎ" : lang === "cn" ? "设计表单与规则" : lang === "mm" ? "ပုံစံနှင့် စည်းကမ်းများ ဒီဇိုင်းဆွဲရန်" : "Design Form & Rules"}
                </span>
              </button>
              )}
              <button
                style={{
                  flex: 1,
                  padding: "16px 20px",
                  fontSize: 14,
                  fontWeight: 800,
                  border: "none",
                  borderBottom: formTab === "stats" ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  background: "transparent",
                  color: formTab === "stats" ? "var(--accent-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => setFormTab("stats")}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Trophy size={16} style={{ flexShrink: 0 }} /> {lang === "th" ? "กระดานผู้นำบ้านและการส่งข้อมูล" : lang === "cn" ? "学院排行榜与提交" : lang === "mm" ? "အိမ်တော် ဦးဆောင်သူစာရင်းနှင့် တင်သွင်းမှုများ" : "House Leaderboard & Submissions"} ({formSubmissions.length})
                </span>
              </button>
            </div>
  );
}
