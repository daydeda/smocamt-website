"use client";
 
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";
import { usePolling } from "@/lib/usePolling";
import {
  Trophy,
  Award,
  TrendingUp,
  History,
  Crown,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ArrowRight
} from "lucide-react";
import { houseSlug } from "@/lib/houses";
import { StudentNav } from "@/components/layout/StudentNav";
import { alpha } from "@/lib/color";

// Shared LINE group everyone joins (same group on both rankings tabs and every
// house page).
const LINE_GROUP_URL =
  "https://line.me/ti/g2/82BVV3y9-l4YuhV5uqFWNMY52Dqg42ZpvYYNFQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default";

// House mascot logos (background removed). Keyed by both the house id (color) and
// its name so it resolves whichever identifier the API returns.
const HOUSE_LOGOS: Record<string, string> = {
  red: "/house_logo/mom.png",    mom: "/house_logo/mom.png",
  green: "/house_logo/to.png",   to: "/house_logo/to.png",
  yellow: "/house_logo/luang.png", luang: "/house_logo/luang.png",
  blue: "/house_logo/makon.png", makara: "/house_logo/makon.png", makon: "/house_logo/makon.png",
};
const houseLogo = (idOrName?: string | null): string | null =>
  idOrName ? HOUSE_LOGOS[idOrName.toLowerCase()] ?? null : null;

type House = {
  id: string;
  name: string;
  color: string;
  points: number;
};
 
type Activity = {
  id: string;
  delta: number;
  reason: string;
  timestamp: string;
  // null for house-less activity (e.g. an event/survey that ended with no points):
  // it shows in the feed but is attributed to no house.
  house: { id: string; name: string; color: string } | null;
  event?: { title: string };
};

type StudentRanking = {
  id: string;
  name: string;
  nickname: string;
  points: number;
  houseId: string | null;
  house: {
    name: string;
    color: string;
  } | null;
};
 
function JoinLineButton() {
  const { t } = useLanguage();
  return (
    <a
      href={LINE_GROUP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="join-line-btn"
    >
      <MessageCircle size={20} />
      {t.joinLineGroup}
    </a>
  );
}

export default function HousesPage() {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  // The student's own house — its standings row is highlighted as "Your House" and
  // links to its member roster.
  const myHouseId = session?.user?.houseId;
  const [houses, setHouses] = useState<House[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [individuals, setIndividuals] = useState<StudentRanking[]>([]);
  const [activeTab, setActiveTab] = useState<"house" | "individual">("house");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Set when a poll tick fails before anything has loaded — surfaces an error
  // screen instead of leaving the page stuck on the spinner forever.
  const [error, setError] = useState(false);
  const [myStanding, setMyStanding] = useState<{ points: number; rank: number | null; total: number } | null>(null);

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

    // 10. Event "X" ended. No points awarded. (event configured with 0 points)
    const match10 = reason.match(/^Event "(.+?)" ended\. No points awarded\.$/);
    if (match10) {
      const [_, eventTitle] = match10;
      if (lang === "th") return `กิจกรรม "${eventTitle}" สิ้นสุดลง ไม่มีการมอบคะแนน`;
      if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးပါပြီ။ မည်သည့်အမှတ်မှ မရရှိပါ။`;
      if (lang === "cn") return `活动 "${eventTitle}" 已结束。未授予积分。`;
      return reason;
    }

    // 11. Evaluation form "X" closed. No points awarded. (survey/form with 0 points)
    const match11 = reason.match(/^Evaluation form "(.+?)" closed\. No points awarded\.$/);
    if (match11) {
      const [_, formTitle] = match11;
      if (lang === "th") return `แบบประเมิน "${formTitle}" ปิดรับแล้ว ไม่มีการมอบคะแนน`;
      if (lang === "mm") return `အကဲဖြတ်လွှာ "${formTitle}" ပိတ်ပါပြီ။ မည်သည့်အမှတ်မှ မရရှိပါ။`;
      if (lang === "cn") return `评估表 "${formTitle}" 已关闭。未授予积分。`;
      return reason;
    }

    return reason;
  };
 
  // Auto-refresh the standings, activity feed and individual rankings on a short
  // interval so the leaderboard updates live without a manual page reload. Uses the
  // shared overlap-safe poller (fires immediately on mount, pauses when the tab is
  // hidden, and never stacks requests). The student's own authoritative rank (/me)
  // is refreshed in the same tick so the "Your rank" banner stays current too.
  usePolling(async (signal) => {
    try {
      const [hData, aData, iData] = await Promise.all([
        fetch("/api/houses", { signal }).then((r) => r.json()),
        fetch("/api/houses/activity", { signal }).then((r) => r.json()),
        fetch("/api/houses/individual", { signal }).then((r) => r.json()),
      ]);
      if (Array.isArray(hData)) setHouses(hData);
      if (Array.isArray(aData)) setActivities(aData);
      if (Array.isArray(iData)) setIndividuals(iData);
      if (myId) {
        const meRes = await fetch("/api/houses/individual/me", { signal });
        if (meRes.ok) {
          const d = await meRes.json();
          if (d && typeof d.points === "number") setMyStanding(d);
        }
      }
      setError(false);
    } catch {
      // A genuine fetch failure (not a navigation/visibility abort) surfaces the
      // error screen; the poller keeps retrying, so it recovers on its own.
      if (!signal.aborted) setError(true);
    } finally {
      // ALWAYS clear loading, even on throw, so a failed first fetch can't strand
      // the page on the spinner.
      setLoading(false);
    }
  }, 30000);

  // Fetch the current user's authoritative rank + score as soon as the session is
  // ready. This is independent of the top-50 list above, so it stays correct even
  // when the student is ranked outside the visible leaderboard page.
  useEffect(() => {
    if (!myId) return;
    const ac = new AbortController();
    fetch("/api/houses/individual/me", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.points === "number") setMyStanding(d); })
      .catch(() => {});
    return () => ac.abort();
  }, [myId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  // Nothing loaded and the last poll failed — show an error instead of a blank
  // leaderboard. The 30s poll keeps retrying, so it recovers automatically.
  if (error && houses.length === 0 && individuals.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>
            {lang === "th" ? "โหลดกระดานคะแนนไม่สำเร็จ" : lang === "cn" ? "无法加载排行榜" : lang === "mm" ? "အမှတ်ဇယား ဖွင့်၍မရပါ" : "Couldn't load the leaderboard"}
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
            {lang === "th" ? "กรุณาตรวจสอบการเชื่อมต่อ ระบบกำลังลองใหม่ให้อัตโนมัติ" : lang === "cn" ? "请检查您的网络连接，系统会自动重试。" : lang === "mm" ? "အင်တာနက်ချိတ်ဆက်မှုကို စစ်ဆေးပါ။ စနစ်က အလိုအလျောက် ထပ်စမ်းနေပါသည်။" : "Please check your connection — it will keep retrying automatically."}
          </p>
        </div>
      </div>
    );
  }

  const maxPoints = Math.max(...houses.map(h => h.points), 1);

  // The student's own house and its rank within the (points-sorted) standings —
  // surfaced as a dedicated "Your House" card so it has real presence instead of
  // being a cramped badge inside a list row.
  const myHouseIndex = myHouseId ? houses.findIndex(h => h.id === myHouseId) : -1;
  const myHouse = myHouseIndex >= 0 ? houses[myHouseIndex] : null;
  const myHouseRank = myHouseIndex >= 0 ? myHouseIndex + 1 : null;
  const myHouseName = myHouse ? getTranslatedHouseName(myHouse.id, myHouse.name) : "";

  // Individual pagination calculations
  const itemsPerPage = 10;
  const totalPages = Math.ceil(individuals.length / itemsPerPage);
  // A poll can shrink the list below the current page, which would otherwise
  // strand the user on an empty page. Snap back during render (React's supported
  // pattern) instead of a setState-in-effect — keeps currentPage authoritative
  // for the pagination controls below with no extra render commit.
  const maxPage = Math.max(1, totalPages);
  if (currentPage > maxPage) setCurrentPage(maxPage);
  const page = Math.min(currentPage, maxPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedIndividuals = individuals.slice(startIndex, startIndex + itemsPerPage);
  const topThreeIndividuals = individuals.slice(0, 3);
  const maxIndividualPoints = Math.max(...individuals.map(ind => ind.points), 1);

  // Locate the current user within the individual leaderboard
  const myIndex = myId ? individuals.findIndex(ind => ind.id === myId) : -1;
  const myRank = myIndex >= 0 ? myIndex + 1 : null;
  const myEntry = myIndex >= 0 ? individuals[myIndex] : null;
  const myPage = myRank ? Math.ceil(myRank / itemsPerPage) : null;
 
  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", paddingBottom: 80 }}>
      <StudentNav />
 
      <main className="page-container" style={{ marginTop: 40 }}>
        {/* Header Section */}
        <header className="leaderboard-header animate-fade-in" style={{ marginBottom: 32 }}>
          <h1 className="text-fluid-h1 font-black" style={{ letterSpacing: "-0.04em", margin: 0 }}>
            {t.leaderboard}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 17, fontWeight: 500, marginTop: 8 }}>
            {activeTab === "house" ? t.houseRankings : t.individualLeaderboard}
          </p>
        </header>

        {/* Tab Switcher */}
        <div style={{ 
          display: "flex", 
          gap: 12, 
          marginBottom: 40,
          background: "var(--bg-elevated)", 
          padding: 6, 
          borderRadius: 20,
          maxWidth: 400,
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 4px 20px rgb(var(--shadow-rgb) / 0.02)"
        }}>
          <button
            onClick={() => setActiveTab("house")}
            style={{
              flex: 1,
              padding: "12px 24px",
              borderRadius: 16,
              fontSize: 15,
              fontWeight: 800,
              background: activeTab === "house" ? "var(--bg-surface)" : "transparent",
              color: activeTab === "house" ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: activeTab === "house" ? "0 4px 12px rgb(var(--shadow-rgb) / 0.05)" : "none",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {t.houseRankingsTab}
          </button>
          <button
            onClick={() => setActiveTab("individual")}
            style={{
              flex: 1,
              padding: "12px 24px",
              borderRadius: 16,
              fontSize: 15,
              fontWeight: 800,
              background: activeTab === "individual" ? "var(--bg-surface)" : "transparent",
              color: activeTab === "individual" ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: activeTab === "individual" ? "0 4px 12px rgb(var(--shadow-rgb) / 0.05)" : "none",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {t.individualRankingsTab}
          </button>
        </div>
 
        {/* Podium for Top 3 Houses */}
        {activeTab === "house" && houses.length >= 3 && (
          <section className="podium-section animate-fade-in-up">
            <div className="podium-container">
              
              {/* 2nd Place */}
              {houses[1] && (
                <div className="podium-card second-place" style={{ borderBottom: `8px solid ${houses[1].color}` }}>
                  <div className="podium-rank-badge rank-second">2</div>
                  <div className="podium-avatar" style={{ background: alpha(houses[1].color, 0.06), color: houses[1].color }}>
                    {houseLogo(houses[1].id) ? (
                      <img src={houseLogo(houses[1].id)!} alt="" className="house-logo-img" />
                    ) : <Trophy size={28} />}
                  </div>
                  <h3 className="podium-name">{getTranslatedHouseName(houses[1].id, houses[1].name)}</h3>
                  <div className="podium-points">
                    <span className="points-num">{houses[1].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
              {/* 1st Place */}
              {houses[0] && (
                <div className="podium-card first-place" style={{ borderBottom: `8px solid ${houses[0].color}` }}>
                  <div className="crown-floating">
                    <Crown size={32} fill="var(--amber-400)" strokeWidth={1.5} />
                  </div>
                  <div className="podium-rank-badge rank-first">1</div>
                  <div className="podium-avatar" style={{ background: alpha(houses[0].color, 0.06), color: houses[0].color, boxShadow: `0 10px 25px ${alpha(houses[0].color, 0.14)}` }}>
                    {houseLogo(houses[0].id) ? (
                      <img src={houseLogo(houses[0].id)!} alt="" className="house-logo-img" />
                    ) : <Trophy size={36} />}
                  </div>
                  <h3 className="podium-name">{getTranslatedHouseName(houses[0].id, houses[0].name)}</h3>
                  <div className="podium-points">
                    <span className="points-num highlight-points">{houses[0].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
              {/* 3rd Place */}
              {houses[2] && (
                <div className="podium-card third-place" style={{ borderBottom: `8px solid ${houses[2].color}` }}>
                  <div className="podium-rank-badge rank-third">3</div>
                  <div className="podium-avatar" style={{ background: alpha(houses[2].color, 0.06), color: houses[2].color }}>
                    {houseLogo(houses[2].id) ? (
                      <img src={houseLogo(houses[2].id)!} alt="" className="house-logo-img" />
                    ) : <Trophy size={24} />}
                  </div>
                  <h3 className="podium-name">{getTranslatedHouseName(houses[2].id, houses[2].name)}</h3>
                  <div className="podium-points">
                    <span className="points-num">{houses[2].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
            </div>
          </section>
        )}
 
        {/* Full Rankings List for Houses */}
        {activeTab === "house" && (
          <section className="standings-section animate-fade-in-up" style={{ marginBottom: 56 }}>

            {/* "Your House" card — a dedicated, branded entry point into the member
                roster (your own house only). Replaces the old in-row badge/chevron so
                the call-to-action reads clearly instead of being lost in the list. */}
            {myHouse && (
              <Link
                href={`/dashboard/houses/${houseSlug(myHouse.id)}`}
                className="my-house-card"
                style={{ ["--house-color" as string]: myHouse.color }}
              >
                <span className="mh-accent" />
                <div className="mh-avatar">
                  {houseLogo(myHouse.id) ? (
                    <img src={houseLogo(myHouse.id)!} alt="" className="house-logo-img" />
                  ) : <Trophy size={28} />}
                </div>
                <div className="mh-info">
                  <span className="mh-eyebrow">{t.yourHouse}</span>
                  <span className="mh-name">{myHouseName}</span>
                  <div className="mh-meta">
                    {myHouseRank && (
                      <span className="mh-rank-chip">#{myHouseRank}</span>
                    )}
                    <span className="mh-points">{myHouse.points} {t.points}</span>
                  </div>
                </div>
                <span className="mh-cta">
                  {t.viewMembers}
                  <ArrowRight size={18} />
                </span>
              </Link>
            )}

            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 24 }}>Full Standings</h2>
            <div className="standings-list">
              {houses.map((h, idx) => {
                const isMyHouse = h.id === myHouseId;
                const houseName = getTranslatedHouseName(h.id, h.name);
                return (
                  <div className={`standings-row${isMyHouse ? " is-my-house" : ""}`} key={h.id}>
                    <div className={`standings-rank rank-${idx + 1}`}>
                      {idx + 1}
                    </div>
                    <div className="standings-avatar" style={{ background: alpha(h.color, 0.06), color: h.color }}>
                      {houseLogo(h.id) ? (
                        <img src={houseLogo(h.id)!} alt="" className="house-logo-img" />
                      ) : <Trophy size={18} />}
                    </div>
                    <div className="standings-info">
                      <span className="standings-name">{houseName}</span>
                      <span className="standings-subtitle" style={{ color: h.color }}>
                        {houseName}{lang === "th" ? "" : " House"}
                      </span>
                    </div>
                    <div className="standings-progress-container">
                      <div className="standings-progress-bar" style={{ width: `${(h.points / maxPoints) * 100}%`, background: h.color }} />
                    </div>
                    <div className="standings-points">
                      <span className="points-value">{h.points}</span>
                      <span className="points-label">{t.points}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="join-line-wrap">
              <JoinLineButton />
            </div>
          </section>
        )}

        {/* Podium for Top 3 Individuals */}
        {activeTab === "individual" && topThreeIndividuals.length > 0 && (
          <section className="podium-section animate-fade-in-up">
            <div className="podium-container">
              
              {/* 2nd Place Individual */}
              {topThreeIndividuals[1] && (
                <div className="podium-card second-place" style={{ borderBottom: `8px solid ${topThreeIndividuals[1].house?.color || "var(--accent-primary)"}` }}>
                  <div className="podium-rank-badge rank-second">2</div>
                  <div className="podium-avatar" style={{ background: alpha(topThreeIndividuals[1].house?.color || "var(--indigo-500)", 0.06), color: topThreeIndividuals[1].house?.color || "var(--accent-primary)" }}>
                    <Trophy size={28} />
                  </div>
                  <h3 className="podium-name podium-person" title={topThreeIndividuals[1].name}>
                    <span className="podium-person-name">{topThreeIndividuals[1].name}</span>
                    {topThreeIndividuals[1].nickname && (
                      <span className="podium-person-nick">({topThreeIndividuals[1].nickname})</span>
                    )}
                  </h3>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: topThreeIndividuals[1].house?.color || "var(--text-muted)", marginTop: -4 }}>
                    {topThreeIndividuals[1].houseId ? getTranslatedHouseName(topThreeIndividuals[1].houseId, topThreeIndividuals[1].house?.name || "") : t.unassigned}
                  </div>
                  <div className="podium-points">
                    <span className="points-num">{topThreeIndividuals[1].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
              {/* 1st Place Individual */}
              {topThreeIndividuals[0] && (
                <div className="podium-card first-place" style={{ borderBottom: `8px solid ${topThreeIndividuals[0].house?.color || "var(--accent-primary)"}` }}>
                  <div className="crown-floating">
                    <Crown size={32} fill="var(--amber-400)" strokeWidth={1.5} />
                  </div>
                  <div className="podium-rank-badge rank-first">1</div>
                  <div className="podium-avatar" style={{ background: alpha(topThreeIndividuals[0].house?.color || "var(--indigo-500)", 0.06), color: topThreeIndividuals[0].house?.color || "var(--accent-primary)", boxShadow: `0 10px 25px ${alpha(topThreeIndividuals[0].house?.color || "var(--indigo-500)", 0.14)}` }}>
                    <Trophy size={36} />
                  </div>
                  <h3 className="podium-name podium-person" title={topThreeIndividuals[0].name}>
                    <span className="podium-person-name">{topThreeIndividuals[0].name}</span>
                    {topThreeIndividuals[0].nickname && (
                      <span className="podium-person-nick">({topThreeIndividuals[0].nickname})</span>
                    )}
                  </h3>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: topThreeIndividuals[0].house?.color || "var(--text-muted)", marginTop: -4 }}>
                    {topThreeIndividuals[0].houseId ? getTranslatedHouseName(topThreeIndividuals[0].houseId, topThreeIndividuals[0].house?.name || "") : t.unassigned}
                  </div>
                  <div className="podium-points">
                    <span className="points-num highlight-points">{topThreeIndividuals[0].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
              {/* 3rd Place Individual */}
              {topThreeIndividuals[2] && (
                <div className="podium-card third-place" style={{ borderBottom: `8px solid ${topThreeIndividuals[2].house?.color || "var(--accent-primary)"}` }}>
                  <div className="podium-rank-badge rank-third">3</div>
                  <div className="podium-avatar" style={{ background: alpha(topThreeIndividuals[2].house?.color || "var(--indigo-500)", 0.06), color: topThreeIndividuals[2].house?.color || "var(--accent-primary)" }}>
                    <Trophy size={24} />
                  </div>
                  <h3 className="podium-name podium-person" title={topThreeIndividuals[2].name}>
                    <span className="podium-person-name">{topThreeIndividuals[2].name}</span>
                    {topThreeIndividuals[2].nickname && (
                      <span className="podium-person-nick">({topThreeIndividuals[2].nickname})</span>
                    )}
                  </h3>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: topThreeIndividuals[2].house?.color || "var(--text-muted)", marginTop: -4 }}>
                    {topThreeIndividuals[2].houseId ? getTranslatedHouseName(topThreeIndividuals[2].houseId, topThreeIndividuals[2].house?.name || "") : t.unassigned}
                  </div>
                  <div className="podium-points">
                    <span className="points-num">{topThreeIndividuals[2].points}</span>
                    <span className="points-unit">{t.points}</span>
                  </div>
                </div>
              )}
 
            </div>
          </section>
        )}
 
        {/* Full Rankings List for Individuals */}
        {activeTab === "individual" && (
          <section className="standings-section animate-fade-in-up" style={{ marginBottom: 56 }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 24 }}>Full Standings</h2>

            {/* "Your rank" banner — authoritative rank/score from /me, so it shows even
                when the student is ranked outside the visible top-50 list. The jump
                button only appears when they're within the loaded (paginated) list. */}
            {myStanding && (
              <button
                onClick={() => myPage && setCurrentPage(myPage)}
                className="my-rank-banner"
                style={{ cursor: myPage ? "pointer" : "default" }}
                title={myPage ? (lang === "th" ? "ไปยังอันดับของฉัน" : "Jump to my position") : undefined}
              >
                <div className={`my-rank-badge${myStanding.rank ? "" : " unranked"}`}>
                  {myStanding.rank ? `#${myStanding.rank}` : (lang === "th" ? "—" : "—")}
                </div>
                <div className="my-rank-info">
                  <span className="my-rank-label">{lang === "th" ? "อันดับของคุณ" : "Your rank"}</span>
                  <span className="my-rank-name">
                    {(myEntry?.name ?? session?.user?.name) || ""} {myEntry?.nickname ? `(${myEntry.nickname})` : ""}
                  </span>
                </div>
                <div className="my-rank-points">
                  <span className="points-value">{myStanding.points}</span>
                  <span className="points-label">{t.points}</span>
                </div>
                <span className="my-rank-jump">
                  {!myStanding.rank
                    ? (lang === "th" ? "ทำคะแนนเพื่อรับอันดับ" : "Earn points to get ranked")
                    : myPage
                      ? (currentPage === myPage
                          ? (lang === "th" ? "อยู่หน้านี้" : "On this page")
                          : (lang === "th" ? "ไปดู →" : "View →"))
                      : (myStanding.total ? (lang === "th" ? `จาก ${myStanding.total}` : `of ${myStanding.total}`) : "")}
                </span>
              </button>
            )}

            <div className="standings-list" style={{ marginBottom: 32 }}>
              {paginatedIndividuals.map((ind, idx) => {
                const rank = startIndex + idx + 1;
                const progressWidth = (ind.points / maxIndividualPoints) * 100;
                const houseColor = ind.house?.color || "var(--border-subtle)";
                const houseName = ind.houseId ? getTranslatedHouseName(ind.houseId, ind.house?.name || "") : t.unassigned;
                const isMe = ind.id === myId;

                return (
                  <div className={`standings-row${isMe ? " is-me" : ""}`} key={ind.id}>
                    <div className={`standings-rank rank-${rank <= 4 ? rank : 4}`}>
                      {rank}
                    </div>
                    <div className="standings-avatar" style={{ background: alpha(houseColor, 0.06), color: houseColor }}>
                      <Trophy size={18} />
                    </div>
                    <div className="standings-info" style={{ flex: 2 }}>
                      <span className="standings-name">
                        {ind.name} {ind.nickname ? `(${ind.nickname})` : ""}
                        {isMe && <span className="you-badge">{lang === "th" ? "คุณ" : "YOU"}</span>}
                      </span>
                      <span className="standings-subtitle" style={{ color: houseColor || "var(--text-muted)" }}>
                        {houseName}{ind.houseId && lang !== "th" ? " House" : ""}
                      </span>
                    </div>
                    <div className="standings-progress-container" style={{ flex: 3 }}>
                      <div className="standings-progress-bar" style={{ width: `${progressWidth}%`, background: houseColor }} />
                    </div>
                    <div className="standings-points">
                      <span className="points-value">{ind.points}</span>
                      <span className="points-label">{t.points}</span>
                    </div>
                  </div>
                );
              })}
              {individuals.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: 15, fontWeight: 600 }}>
                  No students found.
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                gap: 16,
                marginTop: 24
              }}>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-surface)",
                    color: currentPage === 1 ? "var(--text-muted)" : "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    opacity: currentPage === 1 ? 0.5 : 1,
                    transition: "all 0.2s"
                  }}
                >
                  <ChevronLeft size={20} />
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                  {lang === "th" ? `หน้า ${currentPage} จาก ${totalPages}` : `Page ${currentPage} of ${totalPages}`}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    border: "1px solid var(--border-subtle)",
                    background: "var(--bg-surface)",
                    color: currentPage === totalPages ? "var(--text-muted)" : "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    transition: "all 0.2s"
                  }}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}

            <div className="join-line-wrap">
              <JoinLineButton />
            </div>
          </section>
        )}

        {/* Recent Activity */}
        <section className="glass recent-activity-section animate-fade-in-up">
          <h2 className="recent-activity-title">
            <History size={24} className="text-accent" />
            {t.recentActivity}
          </h2>

          <div className="activity-list">
            {activities.map((a) => {
              // House-less rows (a.house === null) show in the feed but aren't tied to
              // any house — render a neutral icon colour and omit the house-name chip.
              const iconColor = a.house?.color ?? "var(--text-muted)";
              return (
              <div key={a.id} className="activity-item hover-scale">
                 <div className="activity-icon-container" style={{ color: iconColor, background: alpha(iconColor, 0.06) }}>
                    <Award className="activity-icon" />
                 </div>
                 <div className="activity-content">
                    <div className="activity-header-row">
                      <p className="activity-reason">
                        <span>{translateActivityReason(a.reason)}</span>
                      </p>
                      <span className="activity-points" style={{ color: a.delta > 0 ? "var(--emerald-500)" : a.delta === 0 ? "var(--text-muted)" : "var(--red-500)" }}>
                        {a.delta > 0 ? `+${a.delta}` : a.delta}
                      </span>
                    </div>
                    <div className="activity-sub-info">
                       {a.house && (
                         <>
                           <span style={{ color: a.house.color }}>{getTranslatedHouseName(a.house.id, a.house.name)}</span>
                           <span className="bullet">•</span>
                         </>
                       )}
                       <span className="activity-event-title">{a.event?.title || "Special Points"}</span>
                       <span className="bullet">•</span>
                       <span>{new Date(a.timestamp).toLocaleDateString("en-GB", { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })}</span>
                    </div>
                 </div>
              </div>
              );
            })}
          </div>
        </section>
 
      </main>
 
      <style jsx>{`
        .podium-section {
          margin-bottom: 48px;
        }
        .podium-container {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 24px;
          max-width: 800px;
          margin: 0 auto;
          padding: 32px 0;
        }
        .podium-card {
          flex: 1;
          /* Without this a long unbreakable name widens its card past its 1/3 share. */
          min-width: 0;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 28px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          position: relative;
          box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.02);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .podium-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px rgb(var(--shadow-rgb) / 0.06);
        }
        .first-place {
          min-height: 280px;
          z-index: 2;
          background: linear-gradient(180deg, var(--bg-surface) 0%, rgb(var(--amber-400-rgb) / 0.02) 100%);
          border: 1.5px solid rgb(var(--amber-400-rgb) / 0.3);
          box-shadow: 0 15px 35px rgb(var(--amber-400-rgb) / 0.06);
        }
        .second-place {
          min-height: 230px;
          z-index: 1;
          border: 1.5px solid rgb(var(--slate-400-rgb) / 0.25);
        }
        .third-place {
          min-height: 200px;
          z-index: 0;
          border: 1.5px solid rgb(var(--amber-700-rgb) / 0.2);
        }
        .crown-floating {
          position: absolute;
          top: -26px;
          left: 50%;
          transform: translateX(-50%);
          animation: float 3s ease-in-out infinite;
        }
        @keyframes float {
          0%, 100% { transform: translate(-50%, 0px); }
          50% { transform: translate(-50%, -6px); }
        }
        .podium-rank-badge {
          position: absolute;
          top: 16px;
          left: 16px;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 900;
          color: white;
        }
        .rank-first { background: linear-gradient(135deg, var(--yellow-400), var(--yellow-500)); }
        .rank-second { background: linear-gradient(135deg, var(--slate-300), var(--slate-400)); }
        .rank-third { background: linear-gradient(135deg, var(--yellow-600), var(--yellow-800)); }
        
        .podium-avatar {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .first-place .podium-avatar {
          width: 76px;
          height: 76px;
          border-radius: 24px;
        }
        /* House mascot logo inside podium/standings avatars (transparent PNG) */
        .house-logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          padding: 4px;
          filter: drop-shadow(0 2px 4px rgb(var(--shadow-rgb) / 0.12));
        }
        .podium-name {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.02em;
        }
        /* Individual podium: long full names clamp to 2 lines so every card keeps
           the same content height and the 1st > 2nd > 3rd podium shape holds. */
        .podium-person {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          text-align: center;
          font-size: 16px;
          line-height: 1.3;
        }
        .podium-person-name {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          overflow-wrap: anywhere;
        }
        .podium-person-nick {
          max-width: 100%;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .podium-points {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .points-num {
          font-size: 28px;
          font-weight: 900;
          color: var(--text-primary);
          line-height: 1;
        }
        .highlight-points {
          font-size: 34px;
          color: var(--text-primary);
          background: linear-gradient(135deg, var(--text-primary), var(--text-secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .points-unit {
          font-size: 9px;
          font-weight: 800;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 4px;
        }
 
        /* Join LINE group button */
        .join-line-wrap {
          display: flex;
          justify-content: center;
          margin-top: 28px;
        }
        :global(a.join-line-btn) {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 28px;
          border-radius: 16px;
          background: var(--brand-line);
          color: var(--text-on-color);
          font-size: 15px;
          font-weight: 800;
          text-decoration: none;
          box-shadow: 0 8px 24px rgb(var(--brand-line-rgb) / 0.28);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        :global(a.join-line-btn:hover) {
          transform: translateY(-2px);
          box-shadow: 0 14px 32px rgb(var(--brand-line-rgb) / 0.36);
        }

        /* Standings list */
        .standings-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .standings-row {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 16px 24px;
          background: var(--bg-surface);
          border-radius: 20px;
          border: 1px solid var(--border-subtle);
          transition: all 0.2s ease;
        }
        .standings-row:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.03);
          border-color: rgb(var(--accent-rgb) / 0.15);
        }
        .standings-row.is-me {
          border-color: var(--accent-primary);
          background: rgb(var(--accent-rgb) / 0.05);
          box-shadow: 0 0 0 1px var(--accent-primary), 0 8px 24px rgb(var(--accent-rgb) / 0.08);
        }
        /* The student's own house row — a quiet locator highlight only; the real
           call-to-action lives in the "Your House" card above the list. */
        .standings-row.is-my-house {
          border-color: rgb(var(--accent-rgb) / 0.35);
          background: rgb(var(--accent-rgb) / 0.04);
        }

        /* "Your House" card — branded entry point into the member roster */
        :global(a.my-house-card) {
          display: flex;
          align-items: center;
          gap: 20px;
          width: 100%;
          padding: 20px 24px;
          margin-bottom: 24px;
          border-radius: 24px;
          text-decoration: none;
          color: inherit;
          position: relative;
          overflow: hidden;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--house-color) 8%, transparent), transparent 60%),
            var(--bg-surface);
          border: 1.5px solid color-mix(in srgb, var(--house-color) 30%, var(--border-subtle));
          box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.03);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        :global(a.my-house-card:hover) {
          transform: translateY(-2px);
          box-shadow: 0 18px 44px color-mix(in srgb, var(--house-color) 18%, transparent);
        }
        .mh-accent {
          position: absolute;
          top: 0;
          left: 0;
          width: 6px;
          height: 100%;
          background: var(--house-color);
        }
        .mh-avatar {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--house-color) 12%, transparent);
          color: var(--house-color);
        }
        .mh-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }
        .mh-eyebrow {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--house-color);
        }
        .mh-name {
          font-size: 22px;
          font-weight: 900;
          color: var(--text-primary);
          line-height: 1.1;
          letter-spacing: -0.02em;
        }
        .mh-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 2px;
        }
        .mh-rank-chip {
          font-size: 12px;
          font-weight: 900;
          color: var(--house-color);
          background: color-mix(in srgb, var(--house-color) 14%, transparent);
          padding: 2px 10px;
          border-radius: 999px;
        }
        .mh-points {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .mh-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          padding: 12px 20px;
          border-radius: 14px;
          background: var(--accent-primary);
          color: var(--text-on-color);
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
          transition: gap 0.2s ease;
        }
        :global(a.my-house-card:hover) .mh-cta {
          gap: 12px;
        }
        .you-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--accent-primary);
          color: var(--text-on-color);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          vertical-align: middle;
        }

        /* "Your rank" banner */
        .my-rank-banner {
          display: flex;
          align-items: center;
          gap: 20px;
          width: 100%;
          text-align: left;
          padding: 16px 24px;
          margin-bottom: 20px;
          background: linear-gradient(135deg, rgb(var(--accent-rgb) / 0.1), rgb(var(--accent-rgb) / 0.03));
          border: 1.5px solid var(--accent-primary);
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .my-rank-banner:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgb(var(--accent-rgb) / 0.12);
        }
        .my-rank-badge {
          min-width: 44px;
          height: 44px;
          padding: 0 10px;
          border-radius: 14px;
          background: var(--accent-primary);
          color: var(--text-on-color);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 16px;
          flex-shrink: 0;
        }
        .my-rank-badge.unranked {
          background: var(--bg-elevated);
          color: var(--text-muted);
        }
        .my-rank-info {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }
        .my-rank-label {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--accent-primary);
        }
        .my-rank-name {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .my-rank-points {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          flex-shrink: 0;
        }
        .my-rank-jump {
          font-size: 13px;
          font-weight: 800;
          color: var(--accent-primary);
          flex-shrink: 0;
          white-space: nowrap;
        }
        .standings-rank {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
        }
        .standings-rank.rank-1 { background: var(--yellow-200); color: var(--yellow-700); }
        .standings-rank.rank-2 { background: var(--slate-100); color: var(--slate-600); }
        .standings-rank.rank-3 { background: var(--orange-100); color: var(--orange-800); }
        .standings-rank.rank-4 { background: var(--bg-elevated); color: var(--text-muted); }
 
        .standings-avatar {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .standings-info {
          display: flex;
          flex-direction: column;
          min-width: 120px;
        }
        .standings-name {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .standings-subtitle {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 2px;
        }
        .standings-progress-container {
          flex: 1;
          height: 8px;
          background: var(--bg-elevated);
          border-radius: 4px;
          overflow: hidden;
        }
        .standings-progress-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .standings-points {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          min-width: 80px;
        }
        .points-value {
          font-size: 20px;
          font-weight: 900;
          color: var(--text-primary);
          line-height: 1;
        }
        .points-label {
          font-size: 10px;
          font-weight: 800;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-top: 4px;
        }
 
        :global(.hover-scale) {
          transition: all 0.2s ease;
        }
        :global(.hover-scale:hover) {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.03);
          border-color: rgb(var(--accent-rgb) / 0.15);
        }

        /* Recent Activity */
        .recent-activity-section {
          padding: 40px;
          border-radius: 40px;
        }
        .recent-activity-title {
          font-size: 24px;
          font-weight: 900;
          margin-bottom: 32px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .activity-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .activity-item {
          display: flex;
          gap: 20px;
          padding: 20px;
          background: var(--bg-surface);
          border-radius: 24px;
          border: 1px solid var(--border-subtle);
          transition: transform 0.2s ease;
        }
        .activity-icon-container {
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .activity-icon {
          width: 24px;
          height: 24px;
        }
        .activity-content {
          flex: 1;
          min-width: 0;
        }
        .activity-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 4px;
          gap: 12px;
        }
        .activity-reason {
          font-weight: 800;
          font-size: 16px;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.4;
          word-break: break-word;
        }
        .activity-points {
          font-size: 16px;
          font-weight: 900;
          white-space: nowrap;
        }
        .activity-sub-info {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px 8px;
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 600;
          line-height: 1.4;
        }
        .bullet {
          color: var(--text-muted);
        }
 
        @media (max-width: 640px) {
          .podium-container {
            gap: 12px;
            padding: 16px 0;
          }
          .podium-card {
            padding: 16px;
            gap: 12px;
          }
          .first-place { min-height: 220px; }
          .second-place { min-height: 180px; }
          .third-place { min-height: 160px; }
          .crown-floating { top: -22px; }
          .podium-avatar { width: 48px; height: 48px; }
          .first-place .podium-avatar { width: 56px; height: 56px; }
          .podium-name { font-size: 14px; }
          .podium-person { font-size: 13px; }
          .podium-person-nick { font-size: 11px; }
          .points-num { font-size: 20px; }
          .highlight-points { font-size: 24px; }
          
          .standings-row {
            padding: 12px 16px;
            gap: 12px;
          }
          .standings-progress-container {
            display: none;
          }
          :global(a.my-house-card) {
            flex-wrap: wrap;
            gap: 14px;
            padding: 16px 18px;
          }
          .mh-avatar {
            width: 52px;
            height: 52px;
            border-radius: 16px;
          }
          .mh-name {
            font-size: 19px;
          }
          .mh-cta {
            width: 100%;
            justify-content: center;
            padding: 12px 16px;
          }
          .my-rank-banner {
            padding: 12px 16px;
            gap: 12px;
          }
          .my-rank-points {
            display: none;
          }
          .standings-info {
            flex: 1;
          }

          /* Recent Activity Mobile */
          .recent-activity-section {
            padding: 24px;
            border-radius: 24px;
          }
          .recent-activity-title {
            font-size: 20px;
            margin-bottom: 24px;
          }
          .activity-list {
            gap: 12px;
          }
          .activity-item {
            padding: 16px;
            gap: 12px;
            border-radius: 18px;
          }
          .activity-icon-container {
            width: 40px;
            height: 40px;
            border-radius: 12px;
          }
          .activity-icon {
            width: 20px;
            height: 20px;
          }
          .activity-reason {
            font-size: 14px;
          }
          .activity-points {
            font-size: 14px;
          }
          .activity-sub-info {
            font-size: 11px;
          }
          .activity-sub-info .bullet {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
