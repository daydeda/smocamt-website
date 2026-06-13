
"use client";

import type { Session } from "next-auth";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import { useQrToken } from "@/lib/useQrToken";
import dynamic from "next/dynamic";
const QRCodeSVG = dynamic(
  () => import("qrcode.react").then((mod) => mod.QRCodeSVG),
  { 
    ssr: false, 
    loading: () => (
      <div style={{ width: 240, height: 240, background: "var(--bg-elevated)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</span>
      </div>
    ) 
  }
);
import Link from "next/link";
import {
  LogOut,
  MapPin,
  Clock,
  Calendar,
  CheckCircle2,
  Zap,
  User,
  RefreshCw,
  Trophy,
  ArrowRight,
  Settings,
  X,
  AlertCircle,
  Megaphone,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { parseRichText } from "@/lib/rich-text";
import { useLanguage } from "@/lib/LanguageContext";
import { StudentNav } from "@/components/layout/StudentNav";
import { useRouter } from "next/navigation";

type Event = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  registrationOpenTime?: string | null;
  registrationCloseTime?: string | null;
  quota?: number;
  isRegistered?: boolean;
  attendanceStatus?: string | null;
  imageUrl?: string;
  imageUrls?: string[] | null;
  pointsAwarded?: number;
};

// An event's posters as an ordered list. Falls back to the single legacy imageUrl
// so events created before multi-poster support still render in the carousel.
const getPosters = (e: Pick<Event, "imageUrls" | "imageUrl">): string[] => {
  if (e.imageUrls && e.imageUrls.length > 0) return e.imageUrls;
  return e.imageUrl ? [e.imageUrl] : [];
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const touchDist = (t: React.TouchList) =>
  Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

// A swipeable / clickable poster carousel. Renders as an absolute fill layer, so
// the parent supplies the sized (relative) container and any overlay badges. With
// a single poster it looks identical to a plain <img>; arrows, dots and a counter
// only appear when there are multiple. onExpand fires on tap (not on swipe).
//
// When `zoomable` is set (the fullscreen viewer), the current poster can be zoomed:
// double-tap / double-click toggles 1×↔2.5×, pinch and wheel zoom continuously, and
// dragging pans while zoomed. Swiping only changes posters at 1× — once zoomed, a
// one-finger drag pans instead. Zoom resets whenever the poster changes.
function PosterCarousel({
  posters,
  objectFit = "contain",
  onExpand,
  backdrop = false,
  arrowSize = 20,
  initialIndex = 0,
  zoomable = false,
}: {
  posters: string[];
  objectFit?: "contain" | "cover";
  onExpand?: (index: number) => void;
  backdrop?: boolean;
  arrowSize?: number;
  initialIndex?: number;
  zoomable?: boolean;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);
  const count = posters.length;
  const wrap = (i: number) => ((i % count) + count) % count;
  const safeIdx = wrap(idx);
  const cur = posters[safeIdx] ?? posters[0];

  // Zoom/pan state for the fullscreen viewer.
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [smooth, setSmooth] = useState(false);
  const zoomed = scale > 1;
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  const resetZoom = () => { setScale(1); setTx(0); setTy(0); };

  // Keep the pan within bounds so the image can't be dragged off the stage. The
  // stage is the (unscaled) parent element the image fills via inset:0.
  const clampPan = (s: number, x: number, y: number) => {
    const stage = imgRef.current?.parentElement?.getBoundingClientRect();
    if (!stage) return { x, y };
    const maxX = (stage.width * (s - 1)) / 2;
    const maxY = (stage.height * (s - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  // Zoom to `target`, keeping the point under (clientX, clientY) stationary.
  const zoomTo = (target: number, clientX?: number, clientY?: number) => {
    const s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, target));
    const stage = imgRef.current?.parentElement?.getBoundingClientRect();
    if (!stage) { setScale(s); return; }
    const fx = (clientX ?? stage.left + stage.width / 2) - (stage.left + stage.width / 2);
    const fy = (clientY ?? stage.top + stage.height / 2) - (stage.top + stage.height / 2);
    const px = (fx - tx) / scale;
    const py = (fy - ty) / scale;
    const c = clampPan(s, fx - px * s, fy - py * s);
    setScale(s); setTx(c.x); setTy(c.y);
  };

  // Wheel zoom (desktop). Attached natively so we can preventDefault — React's
  // onWheel is passive and can't stop the page from scrolling underneath. The
  // listener is re-bound on scale/pan changes so it always sees current values.
  useEffect(() => {
    if (!zoomable) return;
    const el = imgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSmooth(true);
      zoomTo(scale * (e.deltaY < 0 ? 1.2 : 0.83), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, scale, tx, ty]);

  // Change posters and drop any active zoom in one step (a zoomed-in poster
  // shouldn't carry its zoom over to the next one).
  const navigate = (next: number | ((p: number) => number)) => {
    resetZoom();
    setIdx(next);
  };

  const go = (dir: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigate((p) => wrap(p + dir));
  };

  const arrowBtn: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    background: "rgba(0,0,0,0.45)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    zIndex: 4,
  };

  return (
    <>
      {backdrop && (
        <img
          src={cur}
          alt=""
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(20px) brightness(0.4)", transform: "scale(1.1)", zIndex: 0 }}
        />
      )}
      <img
        ref={imgRef}
        src={cur}
        alt=""
        onClick={() => { if (!moved.current) onExpand?.(safeIdx); }}
        onDoubleClick={zoomable ? (e) => {
          e.stopPropagation();
          setSmooth(true);
          if (zoomed) resetZoom(); else zoomTo(2.5, e.clientX, e.clientY);
        } : undefined}
        onMouseDown={zoomable && zoomed ? (e) => {
          e.preventDefault();
          setSmooth(false);
          panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
        } : undefined}
        onMouseMove={zoomable && zoomed ? (e) => {
          if (!panStart.current) return;
          const c = clampPan(scale, panStart.current.tx + (e.clientX - panStart.current.x), panStart.current.ty + (e.clientY - panStart.current.y));
          setTx(c.x); setTy(c.y);
        } : undefined}
        onMouseUp={zoomable ? () => { panStart.current = null; } : undefined}
        onMouseLeave={zoomable ? () => { panStart.current = null; } : undefined}
        onTouchStart={(e) => {
          if (zoomable && e.touches.length === 2) {
            pinch.current = { dist: touchDist(e.touches), scale };
            panStart.current = null; startX.current = null; moved.current = true;
            return;
          }
          const t = e.touches[0];
          if (zoomable) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
              setSmooth(true);
              if (zoomed) resetZoom(); else zoomTo(2.5, t.clientX, t.clientY);
              lastTap.current = 0; moved.current = true;
              return;
            }
            lastTap.current = now;
            if (zoomed) {
              setSmooth(false);
              panStart.current = { x: t.clientX, y: t.clientY, tx, ty };
              moved.current = true;
              return;
            }
          }
          startX.current = t.clientX; moved.current = false;
        }}
        onTouchMove={(e) => {
          if (zoomable && pinch.current && e.touches.length === 2) {
            setSmooth(false);
            zoomTo(pinch.current.scale * (touchDist(e.touches) / pinch.current.dist),
              (e.touches[0].clientX + e.touches[1].clientX) / 2,
              (e.touches[0].clientY + e.touches[1].clientY) / 2);
            moved.current = true;
            return;
          }
          if (zoomable && zoomed && panStart.current) {
            const t = e.touches[0];
            const c = clampPan(scale, panStart.current.tx + (t.clientX - panStart.current.x), panStart.current.ty + (t.clientY - panStart.current.y));
            setTx(c.x); setTy(c.y); moved.current = true;
            return;
          }
          if (startX.current !== null && Math.abs(e.touches[0].clientX - startX.current) > 10) moved.current = true;
        }}
        onTouchEnd={(e) => {
          if (zoomable) {
            if (e.touches.length > 0) return;
            pinch.current = null;
            if (panStart.current) { panStart.current = null; return; }
            if (zoomed) return;
          }
          if (startX.current === null) return;
          const dx = e.changedTouches[0].clientX - startX.current;
          startX.current = null;
          if (count > 1 && Math.abs(dx) > 40) navigate((p) => wrap(p + (dx < 0 ? 1 : -1)));
        }}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", objectFit, zIndex: 1,
          cursor: zoomable ? (zoomed ? "grab" : "zoom-in") : (onExpand ? "pointer" : "default"),
          transform: zoomable ? `translate(${tx}px, ${ty}px) scale(${scale})` : undefined,
          transition: zoomable && smooth ? "transform 0.2s ease" : "none",
          touchAction: zoomable ? "none" : undefined,
        }}
      />

      {count > 1 && (
        <>
          <button type="button" aria-label="Previous poster" onClick={(e) => go(-1, e)} style={{ ...arrowBtn, left: 10 }}>
            <ChevronLeft size={arrowSize} />
          </button>
          <button type="button" aria-label="Next poster" onClick={(e) => go(1, e)} style={{ ...arrowBtn, right: 10 }}>
            <ChevronRight size={arrowSize} />
          </button>

          {/* Counter pill (top-center, clear of the corner badges) */}
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99, backdropFilter: "blur(4px)", pointerEvents: "none", letterSpacing: "0.03em" }}>
            {safeIdx + 1} / {count}
          </div>

          {/* Dots */}
          <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, zIndex: 4 }}>
            {posters.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to poster ${i + 1}`}
                onClick={(e) => { e.stopPropagation(); navigate(i); }}
                style={{ width: i === safeIdx ? 22 : 7, height: 7, borderRadius: 99, border: "none", padding: 0, background: i === safeIdx ? "#fff" : "rgba(255,255,255,0.5)", cursor: "pointer", transition: "all 0.25s", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

interface HouseItem {
  id: string;
  name: string;
  color: string;
  points: number;
}

export default function DashboardClient({ initialSession }: { initialSession: Session | null }) {
  const router = useRouter();
  const { data: sessionData, status: sessionStatus } = useSession();
  const session = sessionData || initialSession;
  const status = sessionStatus !== "loading"
    ? sessionStatus
    : (initialSession ? "authenticated" : "loading");
  const { t, lang } = useLanguage();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({
    show: false,
    title: "",
    message: "",
  });
  const [successModal, setSuccessModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    type?: "success" | "info";
  }>({
    show: false,
    title: "",
    message: "",
    type: "success",
  });
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [loadingHouses, setLoadingHouses] = useState(true);
  // Admin-editable dashboard announcement. null = not loaded yet or fetch failed
  // → fall back to the built-in text so the banner never disappears unexpectedly.
  const [announcement, setAnnouncement] = useState<{ body: string; enabled: boolean } | null>(null);
  // Fullscreen poster viewer — carries the whole poster list + which one was tapped
  // so the user can keep swiping at full size.
  const [previewImage, setPreviewImage] = useState<{ posters: string[]; index: number } | null>(null);
  const [previewEvent, setPreviewEvent] = useState<Event | null>(null);
  
  const HOUSE_MAP: Record<string, { name: string, color: string }> = {
    red:    { name: t.houseMom || "Mom",   color: "#ef4444" },
    green:  { name: t.houseTo || "To",      color: "#14b8a6" },
    yellow: { name: t.houseLuang || "Luang",  color: "#f59e0b" },
    blue:   { name: t.houseMakara || "Makon", color: "#6366f1" },
  };

  const fetchEvents = (signal?: AbortSignal) =>
    fetch("/api/events", { signal })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setEvents(d); })
      .finally(() => setLoadingEvents(false));

  const fetchHouses = (signal?: AbortSignal) =>
    fetch("/api/houses", { signal })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHouses(d); })
      .finally(() => setLoadingHouses(false));

  const fetchAnnouncement = (signal?: AbortSignal) =>
    fetch("/api/announcement", { signal })
      .then((r) => r.json())
      .then((d) => { setAnnouncement(d && typeof d.body === "string" ? d : null); })
      .catch(() => {});

  // Poll events + leaderboard. Slow interval (60s) because this is student-facing
  // across potentially ~1,500 devices — at 20s a single event hour approaches the
  // Vercel free-tier invocation budget. Polling also avoids the Supabase free-tier
  // 200 concurrent-connection cap and pauses while the tab is hidden. Return the
  // combined promise so the poller awaits both and never stacks requests.
  usePolling((signal) => Promise.all([fetchEvents(signal), fetchHouses(signal), fetchAnnouncement(signal)]), 60000);

  const handleRegister = async (eventId: string, registered: boolean) => {
    if (!session?.user) {
      router.push("/login");
      return;
    }
    setRegisteringId(eventId);
    const method = registered ? "DELETE" : "POST";
    const res = await fetch(`/api/events/${eventId}/register`, { method });
    if (res.ok) {
      const targetEvent = events.find(e => e.id === eventId);
      setEvents((evts) =>
        evts.map((e) => (e.id === eventId ? { ...e, isRegistered: !registered } : e))
      );
      const eventTitle = targetEvent ? targetEvent.title : "";
      if (!registered) {
        setSuccessModal({
          show: true,
          title: lang === "th" ? "ลงทะเบียนสำเร็จ!" : lang === "cn" ? "注册成功！" : lang === "mm" ? "မှတ်ပုံတင်ခြင်း အောင်မြင်သည်!" : "Registration Complete!",
          message: lang === "th"
            ? `คุณได้ลงทะเบียนเข้าร่วมกิจกรรม "${eventTitle}" เรียบร้อยแล้ว`
            : lang === "cn"
            ? `您已成功注册活动 "${eventTitle}"`
            : lang === "mm"
            ? `သင်သည် "${eventTitle}" လှုပ်ရှားမှုအတွက် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ`
            : `You have successfully registered for the event "${eventTitle}".`,
          type: "success"
        });
      } else {
        setSuccessModal({
          show: true,
          title: lang === "th" ? "ยกเลิกการลงทะเบียนสำเร็จ" : lang === "cn" ? "取消注册成功" : lang === "mm" ? "မှတ်ပုံတင်ခြင်း ပယ်ဖျက်ပြီးပါပြီ" : "Registration Cancelled",
          message: lang === "th"
            ? `คุณได้ยกเลิกการลงทะเบียนสำหรับกิจกรรม "${eventTitle}" เรียบร้อยแล้ว`
            : lang === "cn"
            ? `您已成功取消活动 "${eventTitle}" 的注册`
            : lang === "mm"
            ? `သင်သည် "${eventTitle}" လှုပ်ရှားမှုအတွက် မှတ်ပုံတင်ခြင်းကို အောင်မြင်စွာ ပယ်ဖျက်ပြီးပါပြီ`
            : `You have successfully cancelled your registration for the event "${eventTitle}".`,
          type: "info"
        });
      }
    } else {
      const errorData = await res.json();
      const errorMsg = errorData.error || t.registrationFailed;
      setErrorModal({
        show: true,
        title: t.registrationFailed,
        message: errorMsg
      });
    }
    setRegisteringId(null);
  };

  // Hooks must run on every render, before any early return (Rules of Hooks).
  // Seed from session?.user?.id directly — `user` is derived after the guard below.
  const { qrValue, countdownMM, countdownSS, countdownColor } = useQrToken(session?.user?.id);

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

  const now = new Date();
  
  // Events that are either happening now or in the future
  const upcoming = events.filter((e) => new Date(e.endTime) >= now);
  const past = events.filter((e) => new Date(e.endTime) < now);

  const getEventStatus = (evt: Event) => {
    const dNow = new Date();
    const start = new Date(evt.startTime);
    const end = new Date(evt.endTime);
    
    // If start and end are same, it's a "point" event, don't show as LIVE
    if (start.getTime() === end.getTime()) {
      return dNow > end ? "past" : "upcoming";
    }

    if (dNow >= start && dNow <= end) return "live";
    if (dNow > end) return "past";
    return "upcoming";
  };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", position: "relative", overflowX: "hidden" }}>
      {/* Decorative Orbs */}
      <div className="absolute top-[-200px] left-[-100px] w-[600px] h-[600px] rounded-full" 
           style={{ background: "radial-gradient(circle, rgba(255,107,0,0.03) 0%, transparent 70%)", pointerEvents: "none" }} />
      
      <StudentNav />

      <main className="page-container" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 40 }}>
        
        {/* Header Section */}
        <section className="animate-fade-in-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
          <div style={{ minWidth: 280, maxWidth: "100%" }}>
            <h1 className="text-fluid-h1" style={{ fontWeight: 900, letterSpacing: "-0.04em", wordBreak: "break-word", overflowWrap: "break-word" }}>
              {t.hey}, <span className="gradient-text">{user ? (user.name?.split(" ")[0] || "Student") : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest")}!</span>
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
              <p style={{ color: "var(--text-secondary)", fontSize: 17, fontWeight: 500, wordBreak: "break-word", overflowWrap: "break-word" }}>
                {t.upcomingEventsCount.replace("{count}", upcoming.length.toString())}
              </p>
            </div>
          </div>

          {/* House Stats Card */}
{user && (
            <div
              className="glass hidden lg:flex"
              style={{
                padding: "20px 32px",
                textAlign: "center",
                minWidth: 160,
                boxShadow: `0 10px 30px rgba(0,0,0,0.04), 0 0 0 1px ${houseInfo.color}20`,
                flexDirection: "column",
                gap: 4,
                background: "rgba(255,255,255,0.6)"
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: houseInfo.color, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Trophy size={12} />
                {houseInfo.name} {t.house}
              </p>
              <p style={{ fontSize: 32, fontWeight: 900, color: houseInfo.color, filter: "brightness(0.8)" }}>
                {houseInfo.name.toUpperCase()}
              </p>
            </div>
          )}
        </section>

        {/* Dynamic Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
          
          {/* Left Column: Events */}
          <div className="order-2 lg:order-1" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            
            {/* Featured Event / Alert — body is admin-editable via /admin/announcement.
                Hidden only when an announcement is loaded AND explicitly disabled.
                When none is loaded yet / fetch failed, fall back to the built-in text. */}
            {!(announcement && announcement.enabled === false) && (
            <div className="alert alert-info" style={{ borderRadius: "var(--radius-lg)", padding: 20, background: "rgba(255,107,0,0.04)", border: "1px solid rgba(255,107,0,0.1)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)", padding: 8, borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.05)", color: "var(--accent-primary)", width: 40, height: 40, flexShrink: 0 }}>
                <Megaphone size={22} />
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>ประกาศสำคัญ | Important Announcement</p>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{announcement?.body ?? "ขณะนี้ Web Application ActiveCAMT อยู่ระหว่างการพัฒนาและทดสอบระบบเพื่อเพิ่มประสิทธิภาพในการใช้งานสูงสุด\nหากท่านพบข้อผิดพลาดหรือมีข้อสงสัยประการใด สามารถแจ้งปัญหาหรือติดต่อเราได้ที่ IG: smocamt.official"}</p>
              </div>
            </div>
            )}

            <div style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.03em" }}>{t.upcomingEvents}</h2>
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={() => {
                    setLoadingEvents(true);
                    fetch("/api/events")
                      .then(r => r.json())
                      .then(d => { if (Array.isArray(d)) setEvents(d); })
                      .finally(() => setLoadingEvents(false));
                  }}
                  style={{ gap: 6 }}
                >
                   <RefreshCw size={14} />
                   {t.refresh}
                </button>
              </div>

              {loadingEvents ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
                  {[1, 2, 3].map((i) => (
                    <div 
                      key={i} 
                      className="glass animate-pulse"
                      style={{ 
                        height: 340, 
                        borderRadius: 32, 
                        background: "rgba(0,0,0,0.01)",
                        border: "1px solid var(--border-subtle)"
                      }}
                    />
                  ))}
                </div>
              ) : upcoming.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
                  {upcoming.map((e) => (
                    <div 
                      key={e.id} 
                      className="glass animate-fade-in-up event-card-ig"
                      style={{ 
                        height: "100%",
                        borderRadius: 32,
                        border: "1px solid var(--border-subtle)",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        cursor: "default",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        background: "var(--bg-surface)",
                        boxShadow: "0 10px 40px rgba(0,0,0,0.03)"
                      }}
                    >
                      {/* Poster Area */}
                      <div style={{ position: "relative", aspectRatio: "1/1", background: "#1a1a1a", overflow: "hidden" }}>
                         {getPosters(e).length > 0 ? (
                           <PosterCarousel
                             posters={getPosters(e)}
                             objectFit="contain"
                             onExpand={(i) => setPreviewImage({ posters: getPosters(e), index: i })}
                           />
                         ) : (
                           <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(45deg, var(--bg-elevated), var(--bg-surface))" }}>
                             <Calendar size={48} style={{ color: "var(--text-muted)", opacity: 0.2 }} />
                           </div>
                         )}
                         
                         {/* Date Overlay */}
                         <div style={{ position: "absolute", top: 16, right: 16 }}>
                            <div style={{ 
                               background: "#fff", 
                               padding: "10px 14px", 
                               borderRadius: 18, 
                               boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                               textAlign: "center", 
                               minWidth: 64,
                               border: "1px solid rgba(0,0,0,0.05)"
                            }}>
                               <p style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Bangkok" })}
                               </p>
                               <p style={{ fontSize: 22, fontWeight: 900, color: "#111", lineHeight: 1 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Bangkok" })}
                               </p>
                            </div>
                         </div>

                         <div style={{ position: "absolute", top: 16, left: 16 }}>
                           <span style={{ 
                             padding: "8px 16px", 
                             background: getEventStatus(e) === 'live' ? "#ef4444" : "var(--accent-primary)", 
                             color: "#fff", 
                             borderRadius: 20, 
                             fontSize: 12, 
                             fontWeight: 900, 
                             textTransform: "uppercase", 
                             letterSpacing: "0.05em",
                             boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                           }}>
                             {getEventStatus(e)}
                           </span>
                         </div>

                         {/* Points Badge */}
                         {e.pointsAwarded !== undefined && (
                           <div style={{ position: "absolute", bottom: 16, left: 16 }}>
                             <div style={{ 
                               background: "rgba(0, 0, 0, 0.7)", 
                               backdropFilter: "blur(8px)", 
                               color: "#fff", 
                               padding: "6px 12px", 
                               borderRadius: 14, 
                               fontSize: 11, 
                               fontWeight: 900, 
                               display: "inline-flex", 
                               alignItems: "center", 
                               gap: 6, 
                               boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                               border: "1px solid rgba(255, 255, 255, 0.1)"
                             }}>
                               <Trophy size={12} style={{ color: "#fbbf24" }} />
                               <span>{e.pointsAwarded} PTS</span>
                             </div>
                           </div>
                         )}
                      </div>

                      {/* Content Area */}
                      <div 
                        onClick={() => setPreviewEvent(e)}
                        style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", cursor: "pointer" }}
                      >
                        <h3 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 16, overflowWrap: "break-word", wordBreak: "break-word" }}>{e.title}</h3>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,107,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                               <Clock size={16} />
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, lineHeight: 1.4 }}>
                              {(() => {
                                const start = new Date(e.startTime);
                                const end = new Date(e.endTime);
                                const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                                const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                                
                                return `${start.toLocaleDateString('en-GB', dateOpts)} ${start.toLocaleTimeString('en-GB', timeOpts)} — ${end.toLocaleDateString('en-GB', dateOpts)} ${end.toLocaleTimeString('en-GB', timeOpts)}`;
                              })()}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,107,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                               <MapPin size={16} />
                            </div>
                            {e.location || "CAMT Building"}
                          </div>
                        </div>

                        <div 
                          style={{ 
                            fontSize: 14, 
                            color: "var(--text-secondary)", 
                            lineHeight: 1.6, 
                            marginBottom: 24, 
                            display: "-webkit-box", 
                            WebkitLineClamp: 3, 
                            WebkitBoxOrient: "vertical", 
                            overflow: "hidden" 
                          }}
                          dangerouslySetInnerHTML={{ __html: parseRichText(e.description || "") }}
                        />
                        {e.description && e.description.trim().length > 0 && (
                          <button 
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPreviewEvent(e);
                            }}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "var(--accent-primary)",
                              fontSize: 13,
                              fontWeight: 800,
                              cursor: "pointer",
                              padding: 0,
                              marginTop: -16,
                              marginBottom: 24,
                              alignSelf: "flex-start"
                            }}
                          >
                            {lang === "th" ? "อ่านเพิ่มเติม..." : "Read more..."}
                          </button>
                        )}

                        <div style={{ marginTop: "auto", paddingTop: 8 }}>
                          {(() => {
                            const nowTs = new Date();
                            const isPastEvent = nowTs > new Date(e.endTime);
                            const isAttended = e.attendanceStatus === "attended";
                            const canCancel = !isPastEvent && !isAttended;
                            // The registration window only gates NEW sign-ups — an
                            // existing registration is never blocked by it.
                            const regOpenAt = e.registrationOpenTime ? new Date(e.registrationOpenTime) : null;
                            const regCloseAt = e.registrationCloseTime ? new Date(e.registrationCloseTime) : null;
                            const notYetOpen = !e.isRegistered && !!regOpenAt && nowTs < regOpenAt;
                            const regClosed = !e.isRegistered && !!regCloseAt && nowTs > regCloseAt;
                            const windowBlocked = notYetOpen || regClosed;
                            const isDisabled = (e.isRegistered && !canCancel) || windowBlocked || registeringId === e.id;
                            const greyed = regClosed || (e.isRegistered && !canCancel);

                            return (
                              <button
                                disabled={isDisabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRegister(e.id, !!e.isRegistered);
                                }}
                                className={`btn btn-full ${e.isRegistered ? "btn-success-solid" : "btn-primary"}`}
                                style={{
                                  borderRadius: 16,
                                  height: 48,
                                  fontWeight: 800,
                                  background: notYetOpen ? "#f59e0b" : greyed ? "var(--bg-elevated)" : e.isRegistered ? (canCancel ? "#10b981" : "var(--bg-elevated)") : undefined,
                                  color: notYetOpen ? "#fff" : greyed ? "var(--text-muted)" : e.isRegistered ? (canCancel ? "#fff" : "var(--text-muted)") : undefined,
                                  boxShadow: notYetOpen ? "0 10px 25px rgba(245,158,11,0.3)" : (e.isRegistered && canCancel) ? "0 10px 25px rgba(16,185,129,0.3)" : (greyed ? "none" : "0 10px 25px var(--accent-glow)"),
                                  border: greyed ? "1px solid var(--border-subtle)" : "none",
                                  cursor: isDisabled && !registeringId ? "not-allowed" : "pointer",
                                  opacity: greyed ? 0.8 : 1
                                }}
                              >
                                {registeringId === e.id ? (
                                  <RefreshCw size={18} className="animate-spin" />
                                ) : e.isRegistered ? (
                                  isAttended ? (
                                    <><CheckCircle2 size={18} /> {t.attended || "Attended"}</>
                                  ) : isPastEvent ? (
                                    <><Calendar size={18} /> {t.eventEnded || "Event Ended"}</>
                                  ) : (
                                    <><CheckCircle2 size={18} /> {t.registered || "Registered"}</>
                                  )
                                ) : notYetOpen ? (
                                  <><Clock size={18} /> {t.registrationNotOpen}</>
                                ) : regClosed ? (
                                  <><AlertCircle size={18} /> {t.registrationClosed}</>
                                ) : (
                                  t.registerNow || "Register Now"
                                )}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: "80px 40px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 24, border: "2px dashed var(--border-subtle)" }}>
                   <p style={{ color: "var(--text-muted)", fontWeight: 500 }}>{t.noEvents}</p>
                </div>
              )}
            </div>
          </div>
          {/* Right Column: Sidebar Stats */}
            <div className="hidden lg:flex lg:order-2" style={{ flexDirection: "column", gap: 32 }}>
              {/* Digital ID Card / Guest Promo Card */}
              {user ? (
                <div
                  className="stat-card animate-fade-in-up"
                  style={{ 
                    padding: "24px", 
                    background: "var(--bg-surface)",
                    display: "flex", 
                    flexDirection: "column", 
                    alignItems: "center", 
                    gap: 24,
                    boxShadow: "0 20px 50px rgba(0,0,0,0.06)",
                    border: "1px solid var(--border-medium)",
                    width: "100%",
                    maxWidth: "340px",
                    alignSelf: "center"
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
                       maxWidth: 300
                     }}
                   >
                    {user?.image ? (
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
                    <QRCodeSVG
                      value={qrValue}
                      size={240}
                      style={{ width: "100%", height: "auto", maxWidth: 240 }}
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
                     <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text-primary)", wordBreak: "break-word", overflowWrap: "break-word" }}>{user?.name}</p>
                     <p style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 }}>ID: {user?.studentId || "212110XXX"}</p>
                   </div>
                </div>
              ) : (
                <div
                  className="stat-card animate-fade-in-up"
                  style={{ 
                    padding: "32px 24px", 
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
                    maxWidth: "340px",
                    alignSelf: "center",
                    minHeight: "280px",
                    background: "linear-gradient(135deg, rgba(255, 107, 0, 0.03) 0%, rgba(255, 255, 255, 0.8) 100%)"
                  }}
                >
                   <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(255, 107, 0, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", marginBottom: 4 }}>
                     <User size={32} />
                   </div>
                   <h4 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)", margin: 0 }}>
                     {lang === "th" ? "สัมผัสประสบการณ์เต็มรูปแบบ" : "Get the Full Experience"}
                   </h4>
                   <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
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

              {/* Leaderboard Sidebar */}
              <div className="glass" style={{ padding: 24, borderRadius: 24, background: "rgba(255,255,255,0.6)" }}>
                 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                   <h3 style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                      <Trophy size={14} className="text-accent" />
                      {t.leaderboard}
                   </h3>
                   <span style={{ fontSize: 10, fontWeight: 900, background: "var(--bg-elevated)", padding: "4px 8px", borderRadius: 8, color: "var(--text-muted)" }}>LIVE</span>
                 </div>
                 
                 {loadingHouses ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[1, 2, 3, 4].map((i) => (
                        <div 
                          key={i} 
                          className="animate-pulse"
                          style={{ 
                            height: 54, 
                            background: "var(--bg-elevated)", 
                            borderRadius: 16 
                          }}
                        />
                      ))}
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
                    <ArrowRight size={14} />
                 </Link>
              </div>
            </div>
          </div>
        </main>

      {errorModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 1350,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <X size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {errorModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {errorModal.message}
            </p>
            <button
              className="btn btn-ghost"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, border: "1px solid var(--border-medium)" }}
              onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "ปิด" : "Close"}
            </button>
          </div>
        </div>
      )}

      {successModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 1350,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setSuccessModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: successModal.type === "info" ? "rgba(245, 158, 11, 0.1)" : "rgba(16, 185, 129, 0.1)",
              color: successModal.type === "info" ? "#f59e0b" : "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              {successModal.type === "info" ? <AlertCircle size={28} /> : <CheckCircle2 size={28} />}
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {successModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {successModal.message}
            </p>
            <button
              className="btn"
              style={{
                width: "100%",
                height: 46,
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 800,
                background: successModal.type === "info" ? "#f59e0b" : "#10b981",
                color: "#fff",
                border: "none",
                boxShadow: successModal.type === "info" ? "0 10px 25px rgba(245,158,11,0.3)" : "0 10px 25px rgba(16,185,129,0.3)"
              }}
              onClick={() => setSuccessModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "ตกลง" : "OK"}
            </button>
          </div>
        </div>
      )}

      {/* Full Size Image Preview Modal */}
      {previewImage && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(20px)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "pointer"
          }}
          onClick={() => setPreviewImage(null)}
        >
          {/* Close Button */}
          <button 
            style={{
              position: "absolute",
              top: 24,
              right: 24,
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            onClick={() => setPreviewImage(null)}
          >
            <X size={24} />
          </button>
          
          {/* Image Container — a fixed-size stage so the carousel can fill it and
              the user can keep swiping between posters at full size. */}
          <div
            style={{
              position: "relative",
              width: "min(900px, 92vw)",
              height: "85vh",
              borderRadius: 24,
              overflow: "hidden"
            }}
            onClick={e => e.stopPropagation()}
          >
            <PosterCarousel
              posters={previewImage.posters}
              objectFit="contain"
              arrowSize={24}
              initialIndex={previewImage.index}
              zoomable
            />
          </div>
        </div>
      )}

      {/* Event Details Preview Modal */}
      {previewEvent && (() => {
        const liveEvent = events.find(x => x.id === previewEvent.id) || previewEvent;
        const nowTs = new Date();
        const isPastEvent = nowTs > new Date(liveEvent.endTime);
        const isAttended = liveEvent.attendanceStatus === "attended";
        const canCancel = !isPastEvent && !isAttended;
        // Registration window only gates NEW sign-ups, not an existing registration.
        const regOpenAt = liveEvent.registrationOpenTime ? new Date(liveEvent.registrationOpenTime) : null;
        const regCloseAt = liveEvent.registrationCloseTime ? new Date(liveEvent.registrationCloseTime) : null;
        const notYetOpen = !liveEvent.isRegistered && !!regOpenAt && nowTs < regOpenAt;
        const regClosed = !liveEvent.isRegistered && !!regCloseAt && nowTs > regCloseAt;
        const windowBlocked = notYetOpen || regClosed;
        const greyed = regClosed || (liveEvent.isRegistered && !canCancel);
        const isDisabled = (liveEvent.isRegistered && !canCancel) || windowBlocked || registeringId === liveEvent.id;
        const previewPosters = getPosters(liveEvent);

        return (
          <div 
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.75)",
              backdropFilter: "blur(12px)",
              zIndex: 1999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
            onClick={() => setPreviewEvent(null)}
          >
            <div 
              style={{
                width: "100%",
                maxWidth: "600px",
                maxHeight: "85vh",
                background: "var(--bg-surface)",
                borderRadius: "28px",
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                type="button"
                onClick={() => setPreviewEvent(null)}
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  background: liveEvent.imageUrl ? "rgba(0,0,0,0.5)" : "var(--bg-elevated)",
                  backdropFilter: liveEvent.imageUrl ? "blur(4px)" : undefined,
                  border: liveEvent.imageUrl ? "1px solid rgba(255,255,255,0.2)" : "1px solid var(--border-subtle)",
                  borderRadius: "50%",
                  width: "36px",
                  height: "36px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: liveEvent.imageUrl ? "#fff" : "var(--text-primary)",
                  cursor: "pointer",
                  zIndex: 10,
                  transition: "all 0.2s"
                }}
              >
                <X size={18} />
              </button>

              {/* Scrollable Content */}
              <div className="custom-scrollbar" style={{ overflowY: "auto", flex: 1 }}>
                {/* Top Banner (if any posters exist) */}
                {previewPosters.length > 0 ? (
                  <div style={{
                    position: "relative",
                    width: "100%",
                    background: "#000",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // A multi-poster carousel needs a fixed stage; a single poster keeps
                    // its natural height exactly as before.
                    ...(previewPosters.length > 1 ? { height: "min(70vh, 520px)" } : {})
                  }}>
                    {previewPosters.length > 1 ? (
                      <PosterCarousel
                        posters={previewPosters}
                        objectFit="contain"
                        backdrop
                        arrowSize={22}
                        onExpand={(i) => setPreviewImage({ posters: previewPosters, index: i })}
                      />
                    ) : (
                      <>
                        <img
                          src={previewPosters[0]}
                          alt=""
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            filter: "blur(20px) brightness(0.4)",
                            transform: "scale(1.1)"
                          }}
                        />
                        <img
                          src={previewPosters[0]}
                          alt={liveEvent.title}
                          style={{
                            position: "relative",
                            width: "100%",
                            height: "auto",
                            objectFit: "contain",
                            zIndex: 1,
                            cursor: "pointer"
                          }}
                          onClick={() => {
                            setPreviewImage({ posters: previewPosters, index: 0 });
                          }}
                        />
                      </>
                    )}

                    {/* Status Overlay */}
                    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 2 }}>
                      <span style={{ 
                        padding: "6px 12px", 
                        background: getEventStatus(liveEvent) === 'live' ? "#ef4444" : "var(--accent-primary)", 
                        color: "#fff", 
                        borderRadius: "12px", 
                        fontSize: "11px", 
                        fontWeight: 900, 
                        textTransform: "uppercase", 
                        letterSpacing: "0.05em",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
                      }}>
                        {getEventStatus(liveEvent)}
                      </span>
                    </div>

                    {/* Points Badge */}
                    {liveEvent.pointsAwarded !== undefined && (
                      <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 2 }}>
                        <div style={{ 
                          background: "rgba(0, 0, 0, 0.7)", 
                          backdropFilter: "blur(8px)", 
                          color: "#fff", 
                          padding: "6px 12px", 
                          borderRadius: 12, 
                          fontSize: 11, 
                          fontWeight: 900, 
                          display: "inline-flex", 
                          alignItems: "center", 
                          gap: 6, 
                          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                          border: "1px solid rgba(255, 255, 255, 0.1)"
                        }}>
                          <Trophy size={12} style={{ color: "#fbbf24" }} />
                          <span>{liveEvent.pointsAwarded} PTS</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Text Content */}
                <div style={{ padding: liveEvent.imageUrl ? "24px" : "64px 24px 24px" }}>
                  {/* Title */}
                  <h3 style={{ 
                    fontSize: "24px", 
                    fontWeight: 900, 
                    color: "var(--text-primary)", 
                    letterSpacing: "-0.03em", 
                    marginBottom: "16px",
                    lineHeight: 1.2,
                    overflowWrap: "break-word",
                    wordBreak: "break-word"
                  }}>
                    {liveEvent.title}
                  </h3>

                  {/* Metadata List */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,107,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                         <Clock size={16} />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, lineHeight: 1.4 }}>
                        {(() => {
                          const start = new Date(liveEvent.startTime);
                          const end = new Date(liveEvent.endTime);
                          const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                          const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                          
                          return `${start.toLocaleDateString('en-GB', dateOpts)} ${start.toLocaleTimeString('en-GB', timeOpts)} — ${end.toLocaleDateString('en-GB', dateOpts)} ${end.toLocaleTimeString('en-GB', timeOpts)}`;
                        })()}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,107,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                         <MapPin size={16} />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                        {liveEvent.location || "CAMT Building"}
                      </div>
                    </div>
                  </div>

                  {/* Description Divider */}
                  <div style={{ height: "1px", background: "var(--border-subtle)", marginBottom: "20px" }} />

                  {/* Description Body */}
                  <div 
                    style={{ 
                      fontSize: 15, 
                      color: "var(--text-secondary)", 
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word"
                    }}
                    dangerouslySetInnerHTML={{ __html: parseRichText(liveEvent.description || "") }}
                  />
                </div>
              </div>

              {/* Action Button Footer */}
              <div style={{ 
                padding: "20px 24px", 
                borderTop: "1px solid var(--border-subtle)", 
                background: "var(--bg-surface)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
                alignItems: "center"
              }}>
                <button
                  type="button"
                  onClick={() => setPreviewEvent(null)}
                  style={{
                    padding: "0 20px",
                    height: 48,
                    borderRadius: 16,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer"
                  }}
                >
                  {lang === "th" ? "ปิด" : "Close"}
                </button>

                <button
                  disabled={isDisabled}
                  onClick={() => handleRegister(liveEvent.id, !!liveEvent.isRegistered)}
                  className={`btn ${liveEvent.isRegistered ? "btn-success-solid" : "btn-primary"}`}
                  style={{
                    borderRadius: 16,
                    height: 48,
                    padding: "0 24px",
                    fontWeight: 800,
                    background: notYetOpen ? "#f59e0b" : greyed ? "var(--bg-elevated)" : liveEvent.isRegistered ? (canCancel ? "#10b981" : "var(--bg-elevated)") : undefined,
                    color: notYetOpen ? "#fff" : greyed ? "var(--text-muted)" : liveEvent.isRegistered ? (canCancel ? "#fff" : "var(--text-muted)") : undefined,
                    boxShadow: notYetOpen ? "0 10px 25px rgba(245,158,11,0.3)" : (liveEvent.isRegistered && canCancel) ? "0 10px 25px rgba(16,185,129,0.3)" : (greyed ? "none" : "0 10px 25px var(--accent-glow)"),
                    border: greyed ? "1px solid var(--border-subtle)" : "none",
                    cursor: isDisabled && !registeringId ? "not-allowed" : "pointer",
                    opacity: greyed ? 0.8 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  {registeringId === liveEvent.id ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : liveEvent.isRegistered ? (
                    isAttended ? (
                      <><CheckCircle2 size={18} /> {t.attended || "Attended"}</>
                    ) : isPastEvent ? (
                      <><Calendar size={18} /> {t.eventEnded || "Event Ended"}</>
                    ) : (
                      <><CheckCircle2 size={18} /> {t.registered || "Registered"}</>
                    )
                  ) : notYetOpen ? (
                    <><Clock size={18} /> {t.registrationNotOpen}</>
                  ) : regClosed ? (
                    <><AlertCircle size={18} /> {t.registrationClosed}</>
                  ) : (
                    t.registerNow || "Register Now"
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

        <style jsx global>{`
          .event-card-ig:hover {
            transform: translateY(-8px);
            box-shadow: 0 30px 60px rgba(0,0,0,0.08) !important;
            border-color: var(--accent-primary) !important;
          }
          .event-card-ig img {
            transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .event-card-ig:hover img {
            transform: scale(1.05);
          }
        `}</style>
      </div>
    );
}