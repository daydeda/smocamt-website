"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { usePolling } from "@/lib/hooks/usePolling";
import Link from "next/link";
import {
  Users,
  Calendar,
  CheckCircle,
  RefreshCcw,
  Download,
  Trophy,
  Plus,
  ArrowUpRight,
  User
} from "lucide-react";
import { alpha } from "@/lib/ui/color";

type DashboardStats = {
  totalUsers: number;
  totalEvents: number;
  checkinsToday: number;
  userGrowthPct: number;
  recentActivity: (
    | { type: "checkin"; studentName: string; studentNickname: string; eventTitle: string; timestamp: string }
    | { type: "score"; houseId?: string; houseName: string; houseColor: string; delta: number; reason: string; timestamp: string }
  )[];
  houses: { id: string; name: string; points: number; members: number; faculty?: string; colorGroup?: string }[];
};

const HOUSE_GRADIENT: Record<string, string> = {
  red: "linear-gradient(135deg, var(--red-500), var(--red-700))", // Red (Mom)
  green: "linear-gradient(135deg, var(--slate-400), var(--slate-500))", // White → silver/pewter (To)
  yellow: "linear-gradient(135deg, var(--blue-500), var(--blue-700))", // Blue (Luang)
  blue: "linear-gradient(135deg, var(--green-500), var(--green-700))", // Green (Makon)
};

export default function AdminDashboardOverview() {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<DashboardStats | { error: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const getTranslatedHouseName = (idOrName: string, defaultName: string) => {
    const key = idOrName.toLowerCase();
    if (key === "red" || key === "mom") return t.houseMom || "Mom";
    if (key === "green" || key === "to") return t.houseTo || "To";
    if (key === "yellow" || key === "luang") return t.houseLuang || "Luang";
    if (key === "blue" || key === "makara") return t.houseMakara || "Makon";
    return defaultName;
  };

  const houseLabel = (h: { id: string; name: string; faculty?: string; colorGroup?: string }) =>
    getTranslatedHouseName(h.colorGroup || h.id, h.name);

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
      if (lang === "mm") return `အကဲဖြတ်လွှာ တင်သွင်းမှုအများဆုံးဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ရရှိခဲ့သည်!`;
      if (lang === "cn") return `活动表单竞赛优胜者：${translatedHouse} 学院以 ${subs} 次提交最多完成了评估表 "${formTitle}"！获得 ${pts} 积分。`;
      return reason;
    }

    // 5. Event Form Contest Tie Winner: X House completed the evaluation form "Y" most with Z submissions! Shared W PTS.
    const match5 = reason.match(/^Event Form Contest Tie Winner: (.+?) House completed the evaluation form "(.+?)" most with (\d+) submissions! Shared (\d+) PTS\.$/);
    if (match5) {
      const [_, house, formTitle, subs, pts] = match5;
      const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
      if (lang === "th") return `ผู้ชนะร่วมประกวดฟอร์มกิจกรรม: ${translatedHouse} ส่งแบบประเมิน "${formTitle}" มากที่สุดจำนวน ${subs} ครั้ง! แบ่งกันได้รับ ${pts} คะแนน`;
      if (lang === "mm") return `အကဲဖြတ်လွှာ တင်သွင်းမှုအများဆုံး ပူးတွဲဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ခွဲဝေရရှိခဲ့သည်!`;
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
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးသော်လည်း တက်ရောက်သူမရှိပါ။ မည်သည့်အမှတ်မှ มရရှိပါ။`;
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

  // Returns the fetch chain so usePolling can await it and never stack requests.
  const fetchStats = (signal?: AbortSignal) =>
    fetch("/api/admin/dashboard", { signal })
      .then((r) => r.json())
      .then((d) => setStats(d));

  // Poll the dashboard endpoint for near-real-time updates. The endpoint already
  // returns the full fresh state (counts, houses, recent activity), so a refetch
  // replaces the previous incremental SSE logic. 10s is responsive for the handful
  // of admins watching this screen (who leave it open the whole event, so it is a
  // constant drain), and polling pauses when the tab is hidden.
  usePolling((signal) => fetchStats(signal), 10000);

  // Nudge the event-winner award check on its own slow cadence (every 60s), as a
  // separate fire-and-forget request. Decoupled from the data poll so it adds far
  // less load on the DB pooler; awarding the winner bonus a minute after an event
  // ends is invisible to everyone, so this is purely a background nudge. Errors are
  // ignored on purpose.
  usePolling((signal) => fetch("/api/admin/award-check", { signal }).catch(() => {}), 60000);

  const handleExportCSV = async () => {
    setExporting(true);
    const res = await fetch("/api/admin/dashboard?type=csv");
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activecamt_attendance_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    }
    setExporting(false);
  };

  const [selectedHouse, setSelectedHouse] = useState<{ id: string; label: string } | null>(null);
  const [scoreForm, setScoreForm] = useState({ delta: "", reason: "" });
  const [submittingScore, setSubmittingScore] = useState(false);

  const handleGiveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHouse || !scoreForm.delta || !scoreForm.reason) return;

    setSubmittingScore(true);
    try {
      const res = await fetch("/api/admin/houses/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId: selectedHouse.id,
          delta: scoreForm.delta,
          reason: scoreForm.reason
        })
      });

      if (res.ok) {
        // Full re-fetch to ensure activity log is updated too
        fetchStats();
        setSelectedHouse(null);
        setScoreForm({ delta: "", reason: "" });
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update score");
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong");
    } finally {
      setSubmittingScore(false);
    }
  };

  const sortedHouses = stats && "houses" in stats && Array.isArray(stats.houses)
    ? [...stats.houses].sort((a, b) => b.points - a.points)
    : [];

  return (
    <>
      {/* House Point Modal Overlay */}
      {selectedHouse && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.55)",
          backdropFilter: "blur(12px)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(16px, 5vw, 32px)"
        }}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            padding: "clamp(24px, 6vw, 40px)",
            borderRadius: 32,
            width: "100%",
            maxWidth: 480,
            boxShadow: "0 40px 120px rgb(var(--shadow-rgb) / 0.25)"
          }}>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
                Award Points to {selectedHouse.label}
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>Enter the amount of points to add (positive) or subtract (negative).</p>
            </div>

            <form onSubmit={handleGiveScore} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="field">
                <label className="label">Point Delta</label>
                <input
                  type="number"
                  className="input"
                  placeholder="e.g. 50 or -20"
                  required
                  value={scoreForm.delta}
                  onChange={(e) => setScoreForm({ ...scoreForm, delta: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label">Reason / Activity Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Morning Drill Excellence"
                  required
                  value={scoreForm.reason}
                  onChange={(e) => setScoreForm({ ...scoreForm, reason: e.target.value })}
                />
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setSelectedHouse(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={submittingScore}
                >
                  {submittingScore ? <div className="spinner" /> : "Confirm Points"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="animate-fade-in-up">
        {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.3 }}>{t.dashboard}</h1>
        <div className="flex gap-3 flex-wrap">
          <button
            id="refresh-stats-btn"
            className="btn btn-ghost"
            style={{ gap: 8, minHeight: 48, paddingInline: 20, borderRadius: 16 }}
            onClick={() => window.location.reload()}
          >
            <RefreshCcw size={16} />
            {t.refresh}
          </button>
          <button
            id="export-csv-btn"
            className="btn btn-success"
            style={{ gap: 8, minHeight: 48, paddingInline: 24, borderRadius: 99 }}
            onClick={handleExportCSV}
            disabled={exporting}
          >
            {exporting ? <><div className="spinner" />{t.exporting}</> : <><Download size={16} /> {t.exportCSV}</>}
          </button>
        </div>
      </div>

      {(!stats) ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 120, gap: 16 }}>
          <div className="spinner" style={{ width: 40, height: 40 }} />
          <p style={{ color: "var(--text-muted)", fontWeight: 500 }}>Fetching latest analytics...</p>
        </div>
      ) : ("error" in stats) ? (
        <div style={{ padding: 40, background: "rgb(var(--red-500-rgb) / 0.1)", borderRadius: 24, textAlign: "center", border: "1px solid rgb(var(--red-500-rgb) / 0.2)" }}>
          <p style={{ color: "var(--red-500)", fontWeight: 700 }}>Failed to load dashboard data</p>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>{(stats as { error: string }).error}</p>
          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => fetchStats()}>Retry</button>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" style={{ marginBottom: 64 }}>
            <div className="stat-card" style={{ background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)", padding: 32, position: "relative", overflow: "hidden" }}>
              <Users size={80} style={{ position: "absolute", right: -10, bottom: -10, opacity: 0.03 }} />
              <p className="section-title">Total Students</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <p style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)" }}>
                  {stats.totalUsers}
                </p>
                {stats.userGrowthPct > 0 && (
                  <span title="New registrations in the last 30 days" style={{ fontSize: 16, fontWeight: 700, color: "var(--emerald-500)", display: "flex", alignItems: "center", gap: 2 }}>
                    <ArrowUpRight size={14} />
                    {stats.userGrowthPct}%
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>Verified @cmu.ac.th accounts</p>
            </div>

            <div className="stat-card" style={{ background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)", padding: 32, position: "relative", overflow: "hidden" }}>
              <Calendar size={80} style={{ position: "absolute", right: -10, bottom: -10, opacity: 0.03 }} />
              <p className="section-title">Total Events</p>
              <p style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-0.04em", color: "var(--accent-primary)" }}>
                {stats.totalEvents}
              </p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>Across all categories</p>
            </div>

            <div className="stat-card" style={{ background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)", padding: 32, position: "relative", overflow: "hidden" }}>
              <CheckCircle size={80} style={{ position: "absolute", right: -10, bottom: -10, opacity: 0.03 }} />
              <p className="section-title">Check-ins Today</p>
              <p style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)" }}>
                {stats.checkinsToday}
              </p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>Real-time attendance tracking</p>
            </div>
          </div>

          {/* House Leaderboard */}
          <section style={{ marginBottom: 48 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 12 }}>
                <Trophy size={24} color="var(--accent-primary)" />
                House Leaderboard
              </h2>
              <div className="badge badge-yellow">Season 1 Active</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {sortedHouses.map((house, idx) => (
                <div
                  key={house.id}
                  className="stat-card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    border: idx === 0 ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    boxShadow: idx === 0 ? "0 20px 40px rgb(var(--accent-rgb) / 0.08)" : "none",
                    background: "var(--bg-surface)",
                    position: "relative"
                  }}
                >
                  <div style={{
                    height: 6,
                    background: HOUSE_GRADIENT[house.colorGroup || house.id] || "var(--accent-primary)"
                  }} />

                  <div style={{ padding: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 24 }}>{idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "🏅"}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>Rank #{idx + 1}</span>
                    </div>

                    <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
                      {houseLabel(house)}
                    </h3>

                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, position: "relative" }}>
                      <p style={{
                        fontSize: 42,
                        fontWeight: 900,
                        color: "var(--text-primary)",
                        letterSpacing: "-0.02em"
                      }}>
                        {house.points}
                      </p>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)", marginRight: 8 }}>pts</span>

                      {/* Give Score Button Inline */}
                      <button
                        onClick={() => setSelectedHouse({ id: house.id, label: houseLabel(house) })}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 12,
                          background: "var(--accent-glow)",
                          border: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "var(--accent-primary)",
                          transition: "all 0.2s",
                          alignSelf: "center",
                          flexShrink: 0
                        }}
                        title="Give points"
                        aria-label={`Award points to ${houseLabel(house)}`}
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    <div style={{ marginTop: 20, height: 4, background: "rgb(var(--ink-rgb) / 0.03)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        width: `${(house.points / (sortedHouses[0].points || 1)) * 100}%`,
                        height: "100%",
                        background: HOUSE_GRADIENT[house.colorGroup || house.id] || "var(--accent-primary)",
                        transition: "width 1s ease-out"
                      }} />
                    </div>

                    <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{house.members} Members</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>{Math.round((house.points / (house.members || 1)) * 10) / 10} avg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="stat-card" style={{ padding: 32 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>{t.recentActivity}</h3>
                <Link
                  href="/admin/activity"
                  style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                  className="hover-opacity"
                >
                  {t.viewAll}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {!stats.recentActivity || stats.recentActivity.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>{t.noActivityRecorded}</p>
                ) : (
                  stats.recentActivity.map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px", background: "var(--bg-elevated)", borderRadius: 12 }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: a.type === "score" ? alpha(a.houseColor, 0.12) : "var(--bg-glass)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        color: a.type === "score" ? a.houseColor : "inherit"
                      }}>
                        {a.type === "score" ? <Trophy size={14} /> : <User size={14} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, overflowWrap: "break-word", wordBreak: "break-word" }}>
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
                          ) : (
                            <>
                              {a.delta === 0 ? (
                                <i>&ldquo;{translateActivityReason(a.reason)}&rdquo;</i>
                              ) : lang === "th" ? (
                                <>
                                   <b>{getTranslatedHouseName(a.houseId || "", a.houseName)}</b> ได้รับ{" "}
                                  <span style={{
                                    margin: "0 4px",
                                    color: a.delta > 0 ? "var(--emerald-500)" : "var(--red-500)",
                                    fontWeight: 800
                                  }}>
                                    {a.delta > 0 ? `+${a.delta}` : a.delta}
                                  </span>
                                  คะแนน: <i>&ldquo;{translateActivityReason(a.reason)}&rdquo;</i>
                                </>
                              ) : lang === "mm" ? (
                                <>
                                  <b>{getTranslatedHouseName(a.houseId || "", a.houseName)}</b> အိမ်သို့{" "}
                                  <span style={{
                                    margin: "0 4px",
                                    color: a.delta > 0 ? "var(--emerald-500)" : "var(--red-500)",
                                    fontWeight: 800
                                  }}>
                                    {a.delta > 0 ? `+${a.delta}` : a.delta}
                                  </span>
                                  မှတ် ပေးအပ်သည် - <i>&ldquo;{translateActivityReason(a.reason)}&rdquo;</i>
                                </>
                              ) : lang === "cn" ? (
                                <>
                                  <b>{getTranslatedHouseName(a.houseId || "", a.houseName)}</b> 学院获得{" "}
                                  <span style={{
                                    margin: "0 4px",
                                    color: a.delta > 0 ? "var(--emerald-500)" : "var(--red-500)",
                                    fontWeight: 800
                                  }}>
                                    {a.delta > 0 ? `+${a.delta}` : a.delta}
                                  </span>
                                  积分: <i>&ldquo;{translateActivityReason(a.reason)}&rdquo;</i>
                                </>
                              ) : (
                                <>
                                  <b>{getTranslatedHouseName(a.houseId || "", a.houseName)}</b> awarded{" "}
                                  <span style={{
                                    margin: "0 4px",
                                    color: a.delta > 0 ? "var(--emerald-500)" : "var(--red-500)",
                                    fontWeight: 800
                                  }}>
                                    {a.delta > 0 ? `+${a.delta}` : a.delta}
                                  </span>
                                  pts: <i>&ldquo;{translateActivityReason(a.reason)}&rdquo;</i>
                                </>
                              )}
                            </>
                          )}
                        </p>
                        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {new Date(a.timestamp).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                            timeZone: 'Asia/Bangkok'
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="stat-card" style={{ padding: 32 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 20 }}>Admin Quick Links</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <a
                  href="/admin/events"
                  className="btn btn-ghost"
                  style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, height: "auto", border: "1px solid var(--border-subtle)", textDecoration: "none", alignItems: "center" }}
                >
                  <Plus size={24} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 700 }}>New Event</span>
                </a>
                <a
                  href="/admin/students"
                  className="btn btn-ghost"
                  style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, height: "auto", border: "1px solid var(--border-subtle)", textDecoration: "none", alignItems: "center" }}
                >
                  <Users size={24} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 700 }}>Manage Students</span>
                </a>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </>
  );
}