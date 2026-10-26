"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Canvas, not SVG: Android/Chrome "force dark" auto-inverts inline <svg> DOM
// content like any other element, even with `color-scheme: only light` set
// (see globals.css) — but it treats <canvas> like a raster image and leaves
// it alone, so the black-on-white attendance QR stays scannable on phones
// with system/browser dark mode forced on. See /dashboard/id and this file.
export const QRCodeCanvas = dynamic(
  () => import("qrcode.react").then((mod) => mod.QRCodeCanvas),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: 240, height: 240, background: "var(--qr-surface)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</span>
      </div>
    )
  }
);

// House mascot logos (background removed). Keyed by both the house id (color) and
// its name so it resolves whichever identifier the API returns.
export const HOUSE_LOGOS: Record<string, string> = {
  red: "/house_logo/mom.png",    mom: "/house_logo/mom.png",
  green: "/house_logo/to.png",   to: "/house_logo/to.png",
  yellow: "/house_logo/luang.png", luang: "/house_logo/luang.png",
  blue: "/house_logo/makon.png", makara: "/house_logo/makon.png", makon: "/house_logo/makon.png",
};
export const houseLogo = (idOrName?: string | null): string | null =>
  idOrName ? HOUSE_LOGOS[idOrName.toLowerCase()] ?? null : null;

export type Event = {
  id: string;
  title: string;
  // Owner-chosen /e/<slug> link name; null/absent = the automatic link.
  shortSlug?: string | null;
  // false = SMO/admin can see this event but is not eligible to register (view-only).
  canRegister?: boolean;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  registrationOpenTime?: string | null;
  registrationCloseTime?: string | null;
  quota?: number | null;
  // Live headcount: distinct students currently holding a seat for this event.
  // Shown as "registeredCount / quota" so students see how full an event is.
  registeredCount?: number;
  // 1-based place in the waitlist when the student is queued for this full event.
  waitlistPosition?: number | null;
  // Whether the event accepts walk-ins (unregistered students scanned in at the
  // door), and the optional extra walk-in seat sub-cap on top of `quota`.
  walkInsEnabled?: boolean;
  // Walk-ins-only: no pre-registration accepted, see api/events/[id]/register.
  walkInsOnly?: boolean;
  quotaWalkIn?: number | null;
  // 'evidence' = no registration/scan at all — the event card's action links
  // straight to the evidence submission page instead. See events.checkInMode.
  checkInMode?: "qr" | "evidence";
  isRegistered?: boolean;
  attendanceStatus?: string | null;
  imageUrl?: string;
  imageUrls?: string[] | null;
  pointsAwarded?: number;
  individualPointsAwarded?: number;
  requireCheckOut?: boolean;
  // True once individualPointsAwarded has actually been credited to this student
  // for this event — for a requireCheckOut event, that's only after check-OUT is
  // confirmed (see /api/events GET), not merely on arrival (attendanceStatus
  // 'attended' is set on arrival, before the points award).
  pointsCredited?: boolean;
  // Pre-test (K_pre) gate. Present when the event has a pre-test form; `status`
  // is "open" (student must complete it), "submitted" (already done), or
  // "upcoming"/"closed"/"awarded" (can't be submitted, so not forced).
  preTest?: { formId: string; title: string; status: string } | null;
};

// An event's posters as an ordered list. Falls back to the single legacy imageUrl
// so events created before multi-poster support still render in the carousel.
export const getPosters = (e: Pick<Event, "imageUrls" | "imageUrl">): string[] => {
  if (e.imageUrls && e.imageUrls.length > 0) return e.imageUrls;
  return e.imageUrl ? [e.imageUrl] : [];
};

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const touchDist = (t: React.TouchList) =>
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
export function PosterCarousel({
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
    background: "rgb(var(--scrim-rgb) / 0.45)",
    color: "var(--text-on-color)",
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
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 4, background: "rgb(var(--scrim-rgb) / 0.55)", color: "var(--text-on-color)", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99, backdropFilter: "blur(4px)", pointerEvents: "none", letterSpacing: "0.03em" }}>
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
                style={{ width: i === safeIdx ? 22 : 7, height: 7, borderRadius: 99, border: "none", padding: 0, background: i === safeIdx ? "var(--white)" : "rgb(var(--white-rgb) / 0.5)", cursor: "pointer", transition: "all 0.25s", boxShadow: "0 1px 3px rgb(var(--shadow-rgb) / 0.35)" }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export interface HouseItem {
  id: string;
  name: string;
  color: string;
  points: number;
}
