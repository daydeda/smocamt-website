"use client";

import { Search, ArrowRight, ShieldCheck, Users } from "lucide-react";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

export function ScannerSideColumn({ ctx }: { ctx: ScannerScreenCtx }) {
  const { checkedInCount, checkingIn, handleManualSearch, lang, manualCheckIn, manualResults, manualSearch, scanMode, t } = ctx;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Live check-in count — updates as students are scanned in, no reload. */}
          <div className="stat-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Users size={20} color="var(--accent-primary)" />
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  {lang === "th" ? "เช็คอินแล้ว" : lang === "cn" ? "已签到" : lang === "mm" ? "ချက်အင်ပြီးသူ" : "Checked In"}
                </h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--emerald-500)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {lang === "th" ? "สด" : lang === "cn" ? "实时" : lang === "mm" ? "တိုက်ရိုက်" : "Live"}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 48, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.1, marginTop: 12, letterSpacing: "-0.03em" }}>
              {checkedInCount ?? "—"}
            </p>
          </div>

          <div className="stat-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <Search size={20} color="var(--accent-primary)" />
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {scanMode === "score"
                  ? (lang === "th" ? "ค้นหาเพื่อมอบคะแนน" : lang === "cn" ? "搜索学生以给分" : lang === "mm" ? "အမှတ်ပေးရန် ရှာဖွေခြင်း" : "Manual Score Search")
                  : t.manualCheckinTitle}
              </h3>
            </div>

            <div style={{ position: "relative" }}>
              <input
                className="input"
                placeholder={scanMode === "score"
                  ? (lang === "th" ? "ค้นหาชื่อหรือรหัสนักศึกษาเพื่อมอบคะแนน..." : lang === "cn" ? "搜索学生姓名或学号以给分..." : lang === "mm" ? "အမှတ်ပေးရန် ကျောင်းသားအမည်/ID ရှာပါ..." : "Search student to give score...")
                  : t.manualSearchPlaceholder}
                style={{ paddingLeft: 12 }}
                value={manualSearch}
                onChange={(e) => handleManualSearch(e.target.value)}
              />
            </div>

            {manualResults.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {manualResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => manualCheckIn(s.id)}
                    disabled={checkingIn === s.id}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      minHeight: 64,
                      padding: "12px 16px",
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "all 0.2s",
                      cursor: "pointer"
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{s.name}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.studentId}</p>
                    </div>
                    <ArrowRight size={18} color="var(--accent-primary)" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="stat-card" style={{ padding: 32, background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)" }}>
             <ShieldCheck size={40} style={{ marginBottom: 16, opacity: 0.2 }} />
             <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>{t.immutableLogsBadge.replace("🔒 ", "").toUpperCase()}</p>
             <p style={{ fontSize: 15, color: "var(--text-primary)", marginTop: 8, lineHeight: 1.6 }}>
               {t.auditAlertText}
             </p>
          </div>
        </div>
  );
}
