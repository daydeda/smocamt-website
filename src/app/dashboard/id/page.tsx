"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import dynamic from "next/dynamic";
// Canvas, not SVG: Android/Chrome "force dark" auto-inverts inline <svg> DOM
// content like any other element, even with `color-scheme: only light` set
// (see globals.css) — but it treats <canvas> like a raster image and leaves
// it alone, so the black-on-white attendance QR stays scannable on phones
// with system/browser dark mode forced on. See DashboardClient and this file.
const QRCodeCanvas = dynamic(
  () => import("qrcode.react").then((mod) => mod.QRCodeCanvas),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: 240, height: 240, background: "#ffffff", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#9ca3af", fontSize: 14 }}>Loading...</span>
      </div>
    )
  }
);
import Link from "next/link";
import {
  Trophy,
  User,
  ArrowLeft,
  RefreshCw,
  Star
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { StudentNav } from "@/components/layout/StudentNav";
import { useQrToken } from "@/lib/useQrToken";
import { useNotifications } from "@/lib/useNotifications";
import { NotificationModal } from "@/components/NotificationModal";
import { FormsDueBanner } from "@/components/FormsDueBanner";

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

interface HouseItem {
  id: string;
  name: string;
  color: string;
  points: number;
}

export default function DigitalIdPage() {
  const { data: session, status } = useSession();
  const { t, lang } = useLanguage();
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [loadingHouses, setLoadingHouses] = useState(true);
  const [myStanding, setMyStanding] = useState<{ points: number; rank: number | null; total: number } | null>(null);

  const { qrValue, countdownMM, countdownSS, countdownColor } = useQrToken(session?.user?.id);

  // Live check-in / score modal. Polls fairly fast (8s) because the student is on
  // this page holding up their QR to be scanned, so the confirmation must feel
  // immediate. The page is open only transiently (while being scanned) and the
  // poll pauses on a hidden tab, so the added load stays bounded.
  const { items: notifItems, dismiss: dismissNotif } = useNotifications(session?.user?.id, 8000);

  const HOUSE_MAP: Record<string, { name: string, color: string }> = {
    red:    { name: t.houseMom || "Mom",   color: "#ef4444" }, // Red
    green:  { name: t.houseTo || "To",      color: "#94a3b8" }, // White → silver/pewter
    yellow: { name: t.houseLuang || "Luang",  color: "#3b82f6" }, // Blue
    blue:   { name: t.houseMakara || "Makon", color: "#22c55e" }, // Green
  };

  const fetchHouses = (signal?: AbortSignal) => {
    const houseReq = fetch("/api/houses", { signal })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHouses(d); })
      .finally(() => setLoadingHouses(false));

    // Only signed-in students have an individual standing to fetch.
    const standingReq = session?.user?.id
      ? fetch("/api/houses/individual/me", { signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d && typeof d.points === "number") setMyStanding(d); })
          .catch(() => {})
      : Promise.resolve();

    return Promise.all([houseReq, standingReq]);
  };

  // Poll the leaderboard. Slow interval (60s) because this is student-facing across
  // potentially ~1,500 devices — a leaderboard does not need sub-second freshness,
  // and this keeps invocations well under the Vercel free-tier budget while also
  // avoiding the Supabase free-tier 200 concurrent-connection cap.
  usePolling(fetchHouses, 60000);

  // Fetch the user's individual standing immediately once the session is ready,
  // rather than waiting for the next 20s poll tick (the first poll fires before
  // the session has loaded, so without this the score card lags on first paint).
  useEffect(() => {
    if (!session?.user?.id) return;
    const ac = new AbortController();
    fetch("/api/houses/individual/me", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.points === "number") setMyStanding(d); })
      .catch(() => {});
    return () => ac.abort();
  }, [session?.user?.id]);

  if (status === "loading") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-base)" }}
      >
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  const user = session?.user;
  const houseId = user?.houseId ?? null;
  const houseInfo = houseId ? (HOUSE_MAP[houseId] ?? { name: "Unknown", color: "var(--text-muted)" }) : { name: t.unassigned, color: "var(--text-muted)" };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", position: "relative", overflowX: "hidden" }}>
      {/* Decorative Orbs */}
      <div className="absolute top-[-200px] left-[-100px] w-[600px] h-[600px] rounded-full" 
           style={{ background: "radial-gradient(circle, rgba(255,107,0,0.03) 0%, transparent 70%)", pointerEvents: "none" }} />

      <StudentNav />

      <main className="page-container animate-fade-in-up" style={{ position: "relative", zIndex: 1, padding: "24px 16px", maxWidth: "480px", margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        
        {/* Back Link */}
        <Link href="/dashboard" style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--text-secondary)",
          textDecoration: "none",
          alignSelf: "flex-start",
          padding: "8px 12px",
          borderRadius: 12,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.02)"
        }}>
          <ArrowLeft size={16} />
          {lang === "th" ? "กลับไปที่หน้ากิจกรรม" : lang === "cn" ? "返回活动" : lang === "mm" ? "လှုပ်ရှားမှုများသို့ ပြန်သွားရန်" : "Back to Events"}
        </Link>

        {/* Page Title */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.03em" }}>
            {t.digitalId || "Digital Student ID"}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
            {lang === "th" ? "บัตรประจำตัวกิจกรรมและคะแนนบ้านของคุณ" : "Your activity pass and house standing"}
          </p>
        </div>

        {/* Outstanding forms (pre-test / post-test / feedback) — persists until done.
            Sits right above the QR so a walk-in sees it before being scanned. */}
        <FormsDueBanner userId={user?.id} />

        {/* House Stats Card */}
        {user && (
          <div
            className="glass animate-fade-in-up"
            style={{
              padding: "20px",
              textAlign: "center",
              borderRadius: 24,
              boxShadow: `0 10px 30px rgba(0,0,0,0.04), 0 0 0 1px ${houseInfo.color}20`,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              background: "rgba(255,255,255,0.7)",
              border: `1px solid ${houseInfo.color}30`
            }}
          >
            {houseLogo(houseId) && (
              <img src={houseLogo(houseId)!} alt="" style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.12))" }} />
            )}
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: houseInfo.color, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Trophy size={12} />
              {lang === "th" ? houseInfo.name : `${houseInfo.name} ${t.house}`}
            </p>
            <p style={{ fontSize: 32, fontWeight: 900, color: houseInfo.color, filter: "brightness(0.8)" }}>
              {houseInfo.name.toUpperCase()}
            </p>
          </div>
        )}

        {/* My Individual Score Card */}
        {user && myStanding && (
          <div
            className="glass animate-fade-in-up"
            style={{
              padding: "18px 20px",
              borderRadius: 24,
              background: "linear-gradient(135deg, rgba(255,107,0,0.08), rgba(255,255,255,0.7))",
              border: "1px solid rgba(255,107,0,0.25)",
              boxShadow: "0 10px 30px rgba(255,107,0,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                <Star size={12} />
                {lang === "th" ? "คะแนนรายบุคคลของคุณ" : "Your Individual Score"}
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 34, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>
                  {myStanding.points}
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  {t.points}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "center", flexShrink: 0, padding: "8px 16px", borderRadius: 16, background: "rgba(255,255,255,0.6)", border: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", display: "block" }}>
                {lang === "th" ? "อันดับ" : "Rank"}
              </span>
              {myStanding.rank ? (
                <>
                  <span style={{ fontSize: 24, fontWeight: 900, color: "var(--accent-primary)", lineHeight: 1.1 }}>
                    #{myStanding.rank}
                  </span>
                  {myStanding.total > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block" }}>
                      {lang === "th" ? `จาก ${myStanding.total}` : `of ${myStanding.total}`}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span style={{ fontSize: 22, fontWeight: 900, color: "var(--text-muted)", lineHeight: 1.1 }}>
                    —
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", display: "block", maxWidth: 92, lineHeight: 1.3, marginTop: 2 }}>
                    {lang === "th" ? "ทำคะแนนเพื่อรับอันดับ" : "Earn points to get ranked"}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Digital ID Card / Guest Promo Card */}
        {user ? (
          <div
            className="stat-card animate-fade-in-up"
            style={{ 
              padding: "32px 24px", 
              background: "var(--bg-surface)",
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              gap: 28,
              boxShadow: "0 20px 50px rgba(0,0,0,0.06)",
              border: "1px solid var(--border-medium)",
              borderRadius: "28px",
              width: "100%"
            }}
          >
            <div
              style={{
                background: "#fff",
                padding: "20px",
                borderRadius: 28,
                border: "1px solid var(--border-medium)",
                boxShadow: "0 0 50px rgba(0,0,0,0.03)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                width: "100%",
                maxWidth: 280
              }}
            >
              {user.image ? (
                <div style={{ width: 80, height: 80, borderRadius: 16, overflow: "hidden", border: "1px solid var(--border-subtle)", position: "relative" }}>
                  <img 
                    src={user.image} 
                    alt="" 
                    style={{ 
                      position: "absolute",
                      width: "100%", 
                      height: "100%", 
                      objectFit: "cover",
                      transform: user.imageTransform ? `scale(${user.imageTransform.scale}) translate(${user.imageTransform.x}%, ${user.imageTransform.y}%)` : 'none'
                    }} 
                  />
                </div>
              ) : (
                <div style={{ width: 80, height: 80, borderRadius: 16, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <User size={32} color="var(--text-muted)" />
                </div>
              )}
              <QRCodeCanvas
                value={qrValue}
                size={240}
                style={{ width: "100%", height: "auto", maxWidth: 220 }}
                level="H"
                bgColor="#ffffff"
                fgColor="#000000"
              />

              {/* Countdown pill */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 99,
                background: `${countdownColor}15`,
                border: `1px solid ${countdownColor}40`,
              }}>
                <RefreshCw size={11} color={countdownColor} />
                <span style={{ fontSize: 12, fontWeight: 700, color: countdownColor, fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em" }}>
                  {countdownMM}:{countdownSS}
                </span>
                <span style={{ fontSize: 11, color: countdownColor, opacity: 0.8 }}>
                  {lang === "th" ? "รีเฟรช" : "refresh"}
                </span>
              </div>
            </div>

            <div style={{ textAlign: "center", width: "100%" }}>
              <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text-primary)", wordBreak: "break-word", overflowWrap: "break-word" }}>{user.name}</p>
              <p style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 }}>ID: {user.studentId || "212110XXX"}</p>
            </div>
          </div>
        ) : (
          <div
            className="stat-card animate-fade-in-up"
            style={{ 
              padding: "36px 24px", 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center",
              textAlign: "center",
              gap: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.06)",
              border: "1px solid var(--border-medium)",
              borderRadius: "28px",
              width: "100%",
              minHeight: "320px",
              background: "linear-gradient(135deg, rgba(255, 107, 0, 0.03) 0%, rgba(255, 255, 255, 0.8) 100%)"
            }}
          >
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(255, 107, 0, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", marginBottom: 4 }}>
              <User size={32} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", margin: 0 }}>
              {lang === "th" ? "สัมผัสประสบการณ์เต็มรูปแบบ" : "Get the Full Experience"}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
              {lang === "th" 
                ? "ลงทะเบียนเข้าสู่ระบบเพื่อเช็กชั่วโมงกิจกรรม สะสมคะแนนบ้าน และรับคิวอาร์โค้ดประจำตัวนักศึกษาสำหรับเข้าร่วมงาน" 
                : "Sign in to track your activities, earn house points, and get your digital Student ID QR code."}
            </p>
            <Link 
              href="/login" 
              className="btn btn-primary"
              style={{ 
                width: "100%", 
                borderRadius: 16, 
                height: 48, 
                fontWeight: 800, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                boxShadow: "0 8px 20px var(--accent-glow)",
                textDecoration: "none"
              }}
            >
              {lang === "th" ? "ลงทะเบียน / เข้าสู่ระบบ" : "Sign In / Register"}
            </Link>
          </div>
        )}

        {/* Live Leaderboard Standings */}
        <div className="glass animate-fade-in-up" style={{ padding: 24, borderRadius: 24, background: "rgba(255,255,255,0.7)", width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
              <Trophy size={14} className="text-accent" />
              {t.leaderboard}
            </h3>
            <span style={{ fontSize: 10, fontWeight: 900, background: "var(--bg-elevated)", padding: "4px 8px", borderRadius: 8, color: "var(--text-muted)" }}>LIVE</span>
          </div>
          
          {loadingHouses ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
              <div className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {houses.map((h, idx) => {
                const isUserHouse = h.id === houseId;
                const maxPoints = Math.max(...houses.map(x => x.points || 0), 1);
                const percentage = Math.min(100, ((h.points || 0) / maxPoints) * 100);
                
                return (
                  <div key={h.id} style={{ 
                    padding: "12px 16px", 
                    background: isUserHouse ? `${h.color}10` : "var(--bg-elevated)",
                    borderRadius: 16,
                    border: `1px solid ${isUserHouse ? `${h.color}30` : "transparent"}`,
                    position: "relative",
                    overflow: "hidden"
                  }}>
                    {isUserHouse && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: h.color }} />}
                    
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: idx === 0 ? "#fbbf24" : "var(--text-muted)", width: 14 }}>{idx + 1}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>
                          {h.id === 'red' ? t.houseMom : h.id === 'green' ? t.houseTo : h.id === 'yellow' ? t.houseLuang : h.id === 'blue' ? t.houseMakara : h.name}
                        </span>
                        {isUserHouse && <span style={{ fontSize: 9, fontWeight: 900, background: h.color, color: "#fff", padding: "2px 6px", borderRadius: 6 }}>YOU</span>}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 900, color: h.color }}>{h.points || 0} <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>PTS</span></span>
                    </div>
                    
                    <div style={{ width: "100%", height: 6, background: "rgba(0,0,0,0.05)", borderRadius: 99 }}>
                      <div style={{ 
                        width: `${percentage}%`, 
                        height: "100%", 
                        background: h.color, 
                        borderRadius: 99,
                        boxShadow: idx === 0 ? `0 0 10px ${h.color}40` : "none",
                        transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)"
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          <Link href="/dashboard/houses" style={{ 
            marginTop: 20, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            gap: 8, 
            fontSize: 12, 
            fontWeight: 800, 
            color: "var(--accent-primary)",
            textDecoration: "none",
            padding: "12px",
            borderRadius: 16,
            background: "rgba(255,107,0,0.05)"
          }}>
            {t.houseRankings}
            <RefreshCw size={12} className="animate-spin-slow" style={{ animationDuration: "10s" }} />
          </Link>
        </div>
      </main>

      <NotificationModal items={notifItems} onDismiss={dismissNotif} />
    </div>
  );
}
