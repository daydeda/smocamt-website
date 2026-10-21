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

      <main className="page-container" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 40 }}>
        
        {/* Header Section */}
        <section className="animate-fade-in-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
          <div style={{ minWidth: 280, maxWidth: "100%" }}>
            <h1 className="text-fluid-h1" style={{ color: "var(--text-primary)", fontWeight: 900, letterSpacing: "-0.04em", wordBreak: "break-word", overflowWrap: "break-word" }}>
              {t.hey} <span className="gradient-text">{user ? (user.name?.split(" ")[0] || "Student") : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest")}!</span>
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
          
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
          .event-card-ig:hover {
            transform: translateY(-8px);
            box-shadow: 0 30px 60px rgb(var(--shadow-rgb) / 0.08) !important;
            border-color: var(--accent-primary) !important;
          }
          .event-card-ig img {
            transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .event-card-ig:hover img {
            transform: scale(1.05);
          }
          .timeline-row:hover {
            border-color: var(--accent-primary) !important;
            box-shadow: 0 6px 20px rgb(var(--shadow-rgb) / 0.06);
            transform: translateX(2px);
          }
        `}</style>
      </div>
  );
}
