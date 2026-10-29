"use client";

import type { Session } from "next-auth";
import { CheckCircle2, Trophy, X, AlertCircle } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { NotificationModal } from "@/components/NotificationModal";
import { ProfileReviewGate } from "@/components/ProfileReviewGate";
import { FormsDueBanner } from "@/components/FormsDueBanner";
import { alpha } from "@/lib/ui/color";
import { houseLogo } from "./_components/dashboard-parts";
import { useDashboard, deriveDashboard } from "./_lib/useDashboard";
import { EventsColumn } from "./_components/EventsColumn";
import { SidebarColumn } from "./_components/SidebarColumn";
import { CompactHeader } from "./_components/CompactHeader";
import { StrikeBanner } from "./_components/StrikeBanner";
import { AppealModal } from "./_components/AppealModal";
import { PreTestGateModal } from "./_components/PreTestGateModal";
import { CancelRegistrationModal } from "./_components/CancelRegistrationModal";
import { ImagePreviewModal } from "./_components/ImagePreviewModal";
import { EventDetailsModal } from "./_components/EventDetailsModal";

export default function DashboardClient({ initialSession }: { initialSession: Session | null }) {
  const base = useDashboard({ initialSession });
  const { status } = base;

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

  const ctx = { ...base, ...deriveDashboard(base) };
  const { dismissNotif, errorModal, houseId, houseInfo, lang, notifItems, session, setErrorModal, setSuccessModal, successModal, t, upcoming, user } = ctx;

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", position: "relative", overflowX: "hidden" }}>
      {/* Decorative Orbs */}
      <div className="absolute top-[-200px] left-[-100px] w-[600px] h-[600px] rounded-full" 
           style={{ background: "radial-gradient(circle, rgb(var(--accent-rgb) / 0.03) 0%, transparent 70%)", pointerEvents: "none" }} />
      
      <StudentNav />

      <main className="page-container dash-main" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column" }}>
        
        {/* Header Section — large heading from lg up; below that CompactHeader is one line. */}
        <div className="hidden lg:block">
        <section className="animate-fade-in-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
          <div style={{ minWidth: 0, maxWidth: "100%" }}>
            <h1 className="text-fluid-h1" style={{ color: "var(--text-primary)", fontWeight: 900, letterSpacing: "-0.04em", wordBreak: "break-word", overflowWrap: "break-word" }}>
              {t.hey} <span className="gradient-text">{user ? (user.name?.split(" ")[0] || "Student") : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest")}!</span>
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <p className="dash-subtitle" style={{ color: "var(--text-secondary)", fontWeight: 500, wordBreak: "break-word", overflowWrap: "break-word" }}>
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
                boxShadow: `0 10px 30px rgb(var(--shadow-rgb) / 0.04), 0 0 0 1px ${alpha(houseInfo.color, 0.12)}`,
                flexDirection: "column",
                gap: 4,
                background: "var(--bg-glass-strong)"
              }}
            >
              {houseLogo(houseId) && (
                <img src={houseLogo(houseId)!} alt="" style={{ width: 64, height: 64, objectFit: "contain", margin: "0 auto", filter: "drop-shadow(0 2px 4px rgb(var(--shadow-rgb) / 0.12))" }} />
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
        </section>
        </div>

        {/* Phones and tablets: greeting, house and ID in one line. */}
        <CompactHeader ctx={ctx} />

        {/* Outstanding forms (pre-test / post-test / feedback) — persists until done. */}
        <FormsDueBanner userId={session?.user?.id} />

        {/* No-show strike-out (US-STRI-15c): visible from strike 1, escalates to a
            hard block notice at the threshold. registrationBlocked also surfaces at
            the point of attempting to register (server 403), but this banner warns
            proactively so a student isn't surprised mid-registration. */}
        <StrikeBanner ctx={ctx} />

        {/* No-show appeal submission modal — kept outside the banner so it isn't
            unmounted if strikes/appeal state changes mid-write. */}
        <AppealModal ctx={ctx} />

        {/* Dynamic Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
          
          {/* Left Column: Events */}
          <EventsColumn ctx={ctx} />
          {/* Right Column: Sidebar Stats */}
            <SidebarColumn ctx={ctx} />
          </div>
        </main>

      {errorModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2050,
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
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgb(var(--red-500-rgb) / 0.1)",
              color: "var(--red-500)",
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
          background: "rgb(var(--scrim-rgb) / 0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2050,
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
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: successModal.type === "info" ? "rgb(var(--amber-500-rgb) / 0.1)" : "rgb(var(--emerald-500-rgb) / 0.1)",
              color: successModal.type === "info" ? "var(--amber-500)" : "var(--emerald-500)",
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
                background: successModal.type === "info" ? "var(--amber-500)" : "var(--emerald-500)",
                color: "var(--text-on-color)",
                border: "none",
                boxShadow: successModal.type === "info" ? "0 10px 25px rgb(var(--amber-500-rgb) / 0.3)" : "0 10px 25px rgb(var(--emerald-500-rgb) / 0.3)"
              }}
              onClick={() => setSuccessModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "ตกลง" : "OK"}
            </button>
          </div>
        </div>
      )}

      {/* Pre-test gate. After registering for an event with an open K_pre form,
          the student is pushed to complete it. "Take the pre-test" deep-links to
          the history page, which auto-opens the form via ?form=&event= params. */}
      <PreTestGateModal ctx={ctx} />

      {/* Cancel-registration confirmation. Asks the student to confirm before the
          DELETE fires, since releasing the seat can't be silently undone. */}
      <CancelRegistrationModal ctx={ctx} />

      {/* Full Size Image Preview Modal */}
      <ImagePreviewModal ctx={ctx} />

      {/* Event Details Preview Modal */}
      <EventDetailsModal ctx={ctx} />

        <NotificationModal items={notifItems} onDismiss={dismissNotif} />
        <ProfileReviewGate />

        <style jsx global>{`
          /* Phone first: everything above the event list stays small so the first events
             show without scrolling. Wider screens override below. */
          .page-container.dash-main { padding: 12px 16px 32px; }
          .dash-main { gap: 12px; }
          .dash-events { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
          .dash-events-head { margin-bottom: 10px; flex-wrap: nowrap; }
          .dash-events-title { font-size: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

          /* One-line greeting + house + ID. Display lives in the media query, because an
             unlayered display here would beat Tailwind's lg:hidden. */
          .dash-compact-head { display: none; }
          @media (max-width: 1023px) {
            .dash-compact-head { display: flex; align-items: center; gap: 8px; min-height: 44px; }
          }
          .dash-compact-hello { flex: 1; min-width: 0; font-size: 17px; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .dash-chip {
            display: inline-flex; align-items: center; gap: 6px; min-width: 0; min-height: 36px; padding: 4px 10px;
            border-radius: 99px; font-size: 13px; font-weight: 800; text-decoration: none;
          }
          .dash-chip-id { flex-shrink: 0; color: var(--accent-primary); background: rgb(var(--accent-rgb) / 0.08); border: 1px solid rgb(var(--accent-rgb) / 0.2); }
          .dash-chip-id-label { display: none; }
          .dash-globe {
            width: 36px; height: 36px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
            border-radius: 99px; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer;
          }
          .dash-globe-menu {
            position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 140px; padding: 6px;
            display: flex; flex-direction: column; gap: 2px; border-radius: 14px;
            background: var(--bg-surface); border: 1px solid var(--border-medium); box-shadow: 0 12px 30px rgb(var(--shadow-rgb) / 0.15);
          }
          .dash-globe-option {
            text-align: left; min-height: 38px; padding: 6px 12px; border: none; border-radius: 10px; cursor: pointer;
            background: transparent; color: var(--text-primary); font-size: 14px; font-weight: 700;
          }
          .dash-globe-option.active { background: rgb(var(--accent-rgb) / 0.1); color: var(--accent-primary); }

          /* Announcement: a card with an accent edge. Collapsed on phones (two lines
             plus a visible Read more button and hint); the full text on tablets and up. */
          .dash-announce {
            position: relative; overflow: hidden; cursor: pointer; border-radius: 18px;
            padding: 12px 14px 12px 16px;
            background: linear-gradient(135deg, rgb(var(--accent-rgb) / 0.14) 0%, rgb(var(--accent-rgb) / 0.04) 100%);
            border: 1px solid rgb(var(--accent-rgb) / 0.35);
            box-shadow: 0 6px 18px rgb(var(--accent-rgb) / 0.12);
          }
          .dash-announce::before {
            content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--accent-primary);
          }
          .dash-announce-head { display: flex; align-items: center; gap: 10px; }
          .dash-announce-icon {
            width: 34px; height: 34px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
            border-radius: 12px; background: var(--accent-primary); color: var(--text-on-color);
          }
          .dash-announce-title { font-size: 15px; font-weight: 900; color: var(--text-primary); line-height: 1.3; }
          .dash-announce-body {
            margin-top: 8px; font-size: 14px; line-height: 1.5; color: var(--text-secondary);
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          }
          .dash-announce-open .dash-announce-body { display: block; -webkit-line-clamp: unset; overflow: visible; }
          .dash-announce-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
          .dash-announce-hint { font-size: 12px; font-weight: 600; color: var(--text-muted); }
          .dash-announce-more {
            display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 6px 14px;
            border-radius: 99px; background: var(--accent-primary); color: var(--text-on-color);
            font-size: 13px; font-weight: 900; box-shadow: 0 6px 14px var(--accent-glow); margin-left: auto;
          }
          /* Tablets and up: the whole announcement shows, so the hint and button go. */
          @media (min-width: 768px) {
            .dash-announce { padding: 18px 22px 18px 24px; cursor: default; }
            .dash-announce-icon { width: 40px; height: 40px; }
            .dash-announce-title { font-size: 16px; }
            .dash-announce-body { display: block; -webkit-line-clamp: unset; overflow: visible; font-size: 15px; }
            .dash-announce-footer { display: none; }
          }
          .dash-toggle-label { display: none; }
          /* The four stat tiles repeat the filter counts, so phones skip them. */
          .dash-stats { display: none; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
          .glass.dash-stat { padding: 10px 12px; gap: 10px; }
          .dash-stat-icon { width: 32px; height: 32px; }
          .dash-stat-value { font-size: 20px; }
          .dash-filters {
            display: flex; gap: 8px; margin: 0 -16px 12px; padding: 2px 16px;
            overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
          }
          .dash-filters::-webkit-scrollbar { display: none; }
          .dash-rows { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
          .dash-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 16px; }
          .dash-card-body { padding: 18px; }

          @media (min-width: 480px) {
            .dash-chip-id-label { display: inline; }
          }

          /* Tablet: two-up rows, roomier spacing, full announcement and stats. */
          @media (min-width: 768px) {
            .page-container.dash-main { padding: 24px; }
            .dash-main { gap: 24px; }
            .dash-events { gap: 24px; }
            .dash-events-head { margin-bottom: 16px; }
            .dash-events-title { font-size: 24px; }
            .dash-toggle-label { display: inline; }
            .dash-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
            .glass.dash-stat { padding: 16px 18px; gap: 14px; }
            .dash-stat-icon { width: 40px; height: 40px; }
            .dash-stat-value { font-size: 24px; }
            .dash-filters { flex-wrap: wrap; margin: 0 0 20px; padding: 0; overflow: visible; }
            .dash-rows { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .dash-cards { gap: 20px; }
            .dash-card-body { padding: 22px; }
          }
          /* Small laptop / landscape tablet: the sidebar takes 340px, so rows go back to one column. */
          @media (min-width: 1024px) {
            .page-container.dash-main { padding: 32px 24px; }
            .dash-main { gap: 40px; }
            .dash-events { gap: 28px; }
            .dash-rows { grid-template-columns: minmax(0, 1fr); }
          }
          @media (min-width: 1280px) {
            .dash-rows { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .dash-cards { gap: 24px; }
          }

          /* Hover lift only where there is a real pointer; on iPad a tap would leave it stuck. */
          @media (hover: hover) {
            .event-card-ig:hover {
              transform: translateY(-6px);
              box-shadow: 0 30px 60px rgb(var(--shadow-rgb) / 0.08) !important;
              border-color: var(--accent-primary) !important;
            }
            .event-card-ig img {
              transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .event-card-ig:hover img {
              transform: scale(1.05);
            }
            .event-row:hover {
              border-color: var(--accent-primary) !important;
              box-shadow: 0 6px 20px rgb(var(--shadow-rgb) / 0.06);
            }
          }
          .event-row:has(> button:first-child:focus-visible) {
            outline: 2px solid var(--accent-primary);
            outline-offset: 2px;
          }
        `}</style>
      </div>
  );
}
