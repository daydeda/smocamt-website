"use client";

import { useEffect, useState } from "react";
import { Trophy, User, ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type Activity = 
  | { type: "checkin"; studentName: string; studentId: string; eventTitle: string; timestamp: string }
  | { type: "score"; houseId?: string; houseName: string; houseColor: string; delta: number; reason: string; timestamp: string };

export default function AdminActivityPage() {
  const { t, lang } = useLanguage();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const getTranslatedHouseName = (idOrName: string, defaultName: string) => {
    const key = idOrName.toLowerCase();
    if (key === "red" || key === "mom") return t.houseMom || "Mom";
    if (key === "green" || key === "to") return t.houseTo || "To";
    if (key === "yellow" || key === "luang") return t.houseLuang || "Luang";
    if (key === "blue" || key === "makara") return t.houseMakara || "Makon";
    return defaultName;
  };

  const translateActivityReason = (reason: string) => {
    if (!reason) return "";

    // 1. Awarded X pts to Y - Reason: Z (from activity "W")
    const match1 = reason.match(/^Awarded (\d+) pts to (.+?) - Reason: (.+?) \(from activity "(.+?)"\)$/);
    if (match1) {
      const [_, pts, student, res, activity] = match1;
      if (lang === "th") return `มอบ ${pts} คะแนนให้กับ ${student} - เหตุผล: ${res} (จากกิจกรรม "${activity}")`;
      if (lang === "mm") return `${student} သို့ ${pts} မှတ်ပေးအပ်သည် - အကြောင်းပြချက်: ${res} (လှုပ်ရှားမှု "${activity}" မှ)`;
      if (lang === "cn") return `向 ${student} 奖励 ${pts} 积分 - 原因: ${res} (来自活动 "${activity}")`;
      return reason;
    }

    // 2. Awarded X individual points to Y from activity "W"
    const match2 = reason.match(/^Awarded (\d+) individual points to (.+?) from activity "(.+?)"$/);
    if (match2) {
      const [_, pts, student, activity] = match2;
      if (lang === "th") return `มอบคะแนนรายบุคคล ${pts} คะแนนให้กับ ${student} จากกิจกรรม "${activity}"`;
      if (lang === "mm") return `${student} သို့ လှုပ်ရှားမှု "${activity}" မှ တစ်ဦးချင်းရမှတ် ${pts} မှတ်ပေးအပ်သည်`;
      if (lang === "cn") return `向 ${student} 奖励个人积分 ${pts} 分 (来自活动 "${activity}")`;
      return reason;
    }

    // 3. Student Y reached 100 point milestone (+Z total points) from activity "W"
    const match3 = reason.match(/^Student (.+?) reached 100 point milestone \(\+(\d+) total points\) from activity "(.+?)"$/);
    if (match3) {
      const [_, student, total, activity] = match3;
      if (lang === "th") return `นักศึกษา ${student} สะสมคะแนนครบ 100 คะแนน (รวมเป็น ${total} คะแนน) จากกิจกรรม "${activity}"`;
      if (lang === "mm") return `ကျောင်းသား ${student} သည် လှုပ်ရှားမှု "${activity}" မှ တစ်ဦးချင်းရမှတ် ၁၀၀ ပြည့်သွားပါသည် (စုစုပေါင်း ${total} မှတ်)`;
      if (lang === "cn") return `学生 ${student} 累计积分达到 100 分里程碑 (共计 ${total} 分，来自活动 "${activity}")`;
      return reason;
    }

    // 4. Event Form Contest Winner: X House completed the evaluation form "Y" most with Z submissions! Received W PTS.
    const match4 = reason.match(/^Event Form Contest Winner: (.+?) House completed the evaluation form "(.+?)" most with (\d+) submissions! Received (\d+) PTS\.$/);
    if (match4) {
      const [_, house, formTitle, subs, pts] = match4;
      const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
      if (lang === "th") return `ผู้ชนะการประกวดฟอร์มกิจกรรม: ${translatedHouse} ส่งแบบประเมิน "${formTitle}" มากที่สุดจำนวน ${subs} ครั้ง! ได้รับ ${pts} คะแนน`;
      if (lang === "mm") return `အကဲဖြတ်လွှา တင်သွင်းမှုအများဆုံးဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ရရှိခဲ့သည်!`;
      if (lang === "cn") return `活动表单竞赛优胜者：${translatedHouse} 学院以 ${subs} 次提交最多完成了评估表 "${formTitle}"！获得 ${pts} 积分。`;
      return reason;
    }

    // 5. Event Form Contest Tie Winner: X House completed the evaluation form "Y" most with Z submissions! Shared W PTS.
    const match5 = reason.match(/^Event Form Contest Tie Winner: (.+?) House completed the evaluation form "(.+?)" most with (\d+) submissions! Shared (\d+) PTS\.$/);
    if (match5) {
      const [_, house, formTitle, subs, pts] = match5;
      const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
      if (lang === "th") return `ผู้ชนะร่วมประกวดฟอร์มกิจกรรม: ${translatedHouse} ส่งแบบประเมิน "${formTitle}" มากที่สุดจำนวน ${subs} ครั้ง! แบ่งกันได้รับ ${pts} คะแนน`;
      if (lang === "mm") return `အကဲဖြတ်လွှာ တင်သွင်းမှုအများဆုံး ပူးတွဲဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ขွဲဝေရရှိခဲ့သည်!`;
      if (lang === "cn") return `活动表单竞赛并列优胜者：${translatedHouse} 学院以 ${subs} 次提交完成了评估表 "${formTitle}"！平分获得 ${pts} 积分。`;
      return reason;
    }

    // 6. Event "X" completed! WINNER: Y House won with Z attendees! Received W PTS.
    const match6 = reason.match(/^Event "(.+?)" completed! WINNER: (.+?) House won with (\d+) attendees! Received (\d+) PTS\.$/);
    if (match6) {
      const [_, eventTitle, house, atts, pts] = match6;
      const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
      if (lang === "th") return `กิจกรรม "${eventTitle}" เสร็จสิ้น! ${translatedHouse} ชนะด้วยจำนวนผู้เข้าร่วม ${atts} คน! ได้รับ ${pts} คะแนน`;
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးပါပြီ။ အနိုင်ရရှိသူ - ${translatedHouse} အိမ်သည် တက်ရောက်သူ ${atts} ဦးဖြင့် အနိုင်ရရှိပြီး ${pts} မှတ် ရရှိခဲ့သည်!`;
      if (lang === "cn") return `活动 "${eventTitle}" 已结束！获胜者：${translatedHouse} 学院以 ${atts} 位到场人数获胜！获得 ${pts} 积分。`;
      return reason;
    }

    // 7. Event "X" completed! TIE WINNER: Y House won with Z attendees! Shared W PTS.
    const match7 = reason.match(/^Event "(.+?)" completed! TIE WINNER: (.+?) House won with (\d+) attendees! Shared (\d+) PTS\.$/);
    if (match7) {
      const [_, eventTitle, house, atts, pts] = match7;
      const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
      if (lang === "th") return `กิจกรรม "${eventTitle}" เสร็จสิ้น! ผู้ชนะร่วม: ${translatedHouse} ชนะด้วยจำนวนผู้เข้าร่วม ${atts} คน! แบ่งกันได้รับ ${pts} คะแนน`;
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးပါပြီ။ ပူးတွဲအနိုင်ရရှိသူ - ${translatedHouse} အိမ်သည် တက်ရောက်သူ ${atts} ဦးဖြင့် အနိုင်ရရှိပြီး ${pts} မှတ် ခွဲဝေရရှိခဲ့သည်!`;
      if (lang === "cn") return `活动 "${eventTitle}" 已结束！并列获胜者：${translatedHouse} 学院以 ${atts} 位到场人数获胜！平分获得 ${pts} 积分。`;
      return reason;
    }

    // 8. Event "X" ended with no attendees. No points awarded.
    const match8 = reason.match(/^Event "(.+?)" ended with no attendees\. No points awarded\.$/);
    if (match8) {
      const [_, eventTitle] = match8;
      if (lang === "th") return `กิจกรรม "${eventTitle}" สิ้นสุดลงแต่ไม่มีผู้เข้าร่วม ไม่มีการมอบคะแนน`;
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးသော်လည်း တက်ရောက်သူမရှိပါ။ မည်သည့်အမှတ်မှ မရရှိပါ။`;
      if (lang === "cn") return `活动 "${eventTitle}" 已结束，但无到场人员。未授予积分。`;
      return reason;
    }

    // 9. Event "X" ended but all checked-in students were unassigned. No points awarded.
    const match9 = reason.match(/^Event "(.+?)" ended but all checked-in students were unassigned\. No points awarded\.$/);
    if (match9) {
      const [_, eventTitle] = match9;
      if (lang === "th") return `กิจกรรม "${eventTitle}" สิ้นสุดลงแต่ผู้เข้าเช็คอินไม่มีสังกัด ไม่มีการมอบคะแนน`;
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးသော်လည်း တက်ရောက်သူအားလုံးသည် အိမ်မသတ်မှတ်ရသေးသူများဖြစ်ကြသည်။ မည်သည့်အမှတ်မှ မရရှိပါ။`;
      if (lang === "cn") return `活动 "${eventTitle}" 已结束，但所有签到的学生均未分配学院。未授予积分。`;
      return reason;
    }

    return reason;
  };

  useEffect(() => {
    fetch("/api/admin/activity")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setActivities(d); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = activities.filter(a => {
    const q = search.toLowerCase();
    if (a.type === "checkin") {
      return a.studentName.toLowerCase().includes(q) || a.eventTitle.toLowerCase().includes(q) || a.studentId.includes(q);
    } else {
      const houseTranslated = getTranslatedHouseName(a.houseId || "", a.houseName);
      const reasonTranslated = translateActivityReason(a.reason);
      return houseTranslated.toLowerCase().includes(q) || reasonTranslated.toLowerCase().includes(q) || a.reason.toLowerCase().includes(q);
    }
  });

  return (
    <div className="animate-fade-in-up">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <Link href="/admin/dashboard" className="btn btn-ghost btn-sm" style={{ padding: 8, borderRadius: 12 }}>
          <ArrowLeft size={20} />
        </Link>
        <div>
          <p className="section-title">{t.adminPanel}</p>
          <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em" }}>{t.fullActivityLogTitle}</h1>
        </div>
      </div>

      <div style={{ marginBottom: 24, position: "relative", maxWidth: 400 }}>
        <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
        <input 
          type="text" 
          placeholder={t.searchActivityPlaceholder} 
          className="input" 
          style={{ paddingLeft: 44 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="stat-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 80, display: "flex", justifyContent: "center" }}><div className="spinner" /></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.thTimestamp}</th>
                  <th>{t.thType}</th>
                  <th>{t.thDetails}</th>
                  <th>{t.thValueContext}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>
                        {new Date(a.timestamp).toLocaleTimeString(lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB", { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(a.timestamp).toLocaleDateString(lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB", { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short' })}
                      </p>
                    </td>
                    <td>
                      <span className={`badge ${a.type === 'score' ? 'badge-yellow' : 'badge-blue'}`} style={{ gap: 6 }}>
                        {a.type === 'score' ? <Trophy size={12} /> : <User size={12} />}
                        {a.type === 'score' ? t.badgePointAward : t.badgeCheckin}
                      </span>
                    </td>
                    <td>
                      {a.type === 'checkin' ? (
                        <div>
                          <p style={{ fontWeight: 700, fontSize: 14 }}>{a.studentName}</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.studentId}</p>
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontWeight: 700, fontSize: 14, color: a.houseColor }}>
                            {getTranslatedHouseName(a.houseId || "", a.houseName)}
                          </p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.labelManualAdjustment}</p>
                        </div>
                      )}
                    </td>
                    <td>
                      {a.type === 'checkin' ? (
                        <p style={{ fontSize: 13 }}>{t.attended} <b>{a.eventTitle}</b></p>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ 
                            fontSize: 16, 
                            fontWeight: 800, 
                            color: a.delta > 0 ? "var(--emerald-500)" : a.delta === 0 ? "var(--text-muted)" : "var(--red-500)" 
                          }}>
                            {a.delta > 0 ? `+${a.delta}` : a.delta} {t.points.toLowerCase()}
                          </span>
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>&quot;{translateActivityReason(a.reason)}&quot;</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
                      {t.noActivityRecorded}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
