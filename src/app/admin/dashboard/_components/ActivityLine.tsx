"use client";

import { Trophy, User } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { alpha } from "@/lib/ui/color";
import { translateActivityReason, translateHouseName } from "../_lib/activity-reason";

export type DashboardActivity =
  | { type: "checkin"; studentName: string; studentNickname: string; eventTitle: string; timestamp: string }
  | { type: "score"; houseId?: string; houseName: string; houseColor: string; delta: number; reason: string; timestamp: string };

/** One row of "Recent activity": icon, a sentence in the viewer's language, and the time. */
export function ActivityLine({ a }: { a: DashboardActivity }) {
  const { t, lang } = useLanguage();
  const house = a.type === "score" ? translateHouseName(t, a.houseId || "", a.houseName) : "";
  const reason = a.type === "score" ? translateActivityReason(a.reason, lang, t) : "";

  const delta =
    a.type === "score" ? (
      <span style={{ fontWeight: 800, margin: "0 2px", color: a.delta > 0 ? "var(--emerald-600)" : "var(--red-600)" }}>
        {a.delta > 0 ? `+${a.delta}` : a.delta}
      </span>
    ) : null;

  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px", background: "var(--bg-elevated)", borderRadius: 12 }}>
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: a.type === "score" ? alpha(a.houseColor, 0.12) : "var(--bg-glass)",
          color: a.type === "score" ? a.houseColor : "var(--text-secondary)",
        }}
      >
        {a.type === "score" ? <Trophy size={14} /> : <User size={14} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
          {a.type === "checkin" ? (
            lang === "th" ? (
              <><b>{a.studentName}</b> เช็คอินเข้าร่วม <b>{a.eventTitle}</b></>
            ) : lang === "mm" ? (
              <><b>{a.studentName}</b> သည် <b>{a.eventTitle}</b> သို့ ချက်အင်ဝင်ခဲ့သည်</>
            ) : lang === "cn" ? (
              <><b>{a.studentName}</b> 已签到 <b>{a.eventTitle}</b></>
            ) : (
              <><b>{a.studentName}</b> checked in at <b>{a.eventTitle}</b></>
            )
          ) : a.delta === 0 ? (
            <i>&ldquo;{reason}&rdquo;</i>
          ) : lang === "th" ? (
            <><b>{house}</b> ได้รับ {delta} คะแนน: <i>&ldquo;{reason}&rdquo;</i></>
          ) : lang === "mm" ? (
            <><b>{house}</b> အိမ်သို့ {delta} မှတ် ပေးအပ်သည် - <i>&ldquo;{reason}&rdquo;</i></>
          ) : lang === "cn" ? (
            <><b>{house}</b> 学院获得 {delta} 积分: <i>&ldquo;{reason}&rdquo;</i></>
          ) : (
            <><b>{house}</b> awarded {delta} pts: <i>&ldquo;{reason}&rdquo;</i></>
          )}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {new Date(a.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })}
        </p>
      </div>
    </li>
  );
}
