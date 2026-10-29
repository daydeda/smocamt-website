"use client";

import Link from "next/link";
import { Calendar, CheckCircle2, RefreshCw, Clock, AlertCircle, DoorOpen, Eye, Camera } from "lucide-react";
import { getRegisterState } from "@/lib/events/register-state";
import type { Event } from "./dashboard-parts";
import type { DashboardCtx } from "../_lib/useDashboard";

// The register / cancel / waitlist button for one event. "card" fills the event
// card, "modal" sits in the details modal footer, "compact" fits a list row.
export function RegisterButton({ e, ctx, variant }: { e: Event; ctx: DashboardCtx; variant: "card" | "modal" | "compact" }) {
  const { lang, promptRegister, registeringId, t } = ctx;
  const { kind, canCancel, waitlisted, blocked, greyed } = getRegisterState(e);
  const notYetOpen = kind === "notYetOpen";
  const isDisabled = blocked || registeringId === e.id;
  const compact = variant === "compact";
  const iconSize = compact ? 15 : 18;

  // Evidence-mode events have no sign-up. The action is submitting that day's
  // proof, so the button links to the evidence page (same as the details modal).
  if (e.checkInMode === "evidence") {
    return (
      <Link
        href={`/dashboard/events/${e.id}/evidence`}
        onClick={(event) => event.stopPropagation()}
        className={`btn ${variant === "card" ? "btn-full " : ""}btn-primary`}
        style={{
          borderRadius: compact ? 12 : 16, height: compact ? 36 : 48, padding: compact ? "0 14px" : undefined,
          fontSize: compact ? 13 : undefined, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap",
          boxShadow: compact ? "none" : "0 10px 25px var(--accent-glow)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        <Camera size={compact ? 15 : 18} />
        {lang === "th" ? "ส่งหลักฐานวันนี้" : lang === "cn" ? "提交今日证据" : lang === "mm" ? "ယနေ့ သက်သေတင်ရန်" : "Submit today's evidence"}
      </Link>
    );
  }

  const sizing: React.CSSProperties =
    variant === "card" ? { borderRadius: 16, height: 48 }
    : variant === "modal" ? { borderRadius: 16, height: 48, padding: "0 24px", display: "flex", alignItems: "center", gap: "8px" }
    : { borderRadius: 12, height: 36, padding: "0 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={(event) => {
        event.stopPropagation();
        promptRegister(e.id, !!e.isRegistered || waitlisted, e.title);
      }}
      className={`btn ${variant === "card" ? "btn-full " : ""}${e.isRegistered ? "btn-success-solid" : "btn-primary"}`}
      style={{
        ...sizing,
        fontWeight: 800,
        background: notYetOpen ? "var(--amber-500)" : greyed ? "var(--bg-elevated)" : e.isRegistered ? (canCancel ? "var(--emerald-500)" : "var(--bg-elevated)") : undefined,
        color: notYetOpen ? "var(--text-on-color)" : greyed ? "var(--text-muted)" : e.isRegistered ? (canCancel ? "var(--text-on-color)" : "var(--text-muted)") : undefined,
        boxShadow: compact ? "none" : notYetOpen ? "0 10px 25px rgb(var(--amber-500-rgb) / 0.3)" : (e.isRegistered && canCancel) ? "0 10px 25px rgb(var(--emerald-500-rgb) / 0.3)" : (greyed ? "none" : "0 10px 25px var(--accent-glow)"),
        border: greyed ? "1px solid var(--border-subtle)" : "none",
        cursor: isDisabled && !registeringId ? "not-allowed" : "pointer",
        opacity: greyed ? 0.8 : 1,
      }}
    >
      {registeringId === e.id ? (
        <RefreshCw size={iconSize} className="animate-spin" />
      ) : kind === "attended" ? (
        <><CheckCircle2 size={iconSize} /> {t.attended || "Attended"}</>
      ) : kind === "ended" ? (
        <><Calendar size={iconSize} /> {t.eventEnded || "Event Ended"}</>
      ) : kind === "registered" ? (
        <><CheckCircle2 size={iconSize} /> {t.registered || "Registered"}</>
      ) : kind === "waitlisted" ? (
        <><Clock size={iconSize} /> {t.waitlistOn.replace("{n}", String(e.waitlistPosition))}</>
      ) : kind === "notYetOpen" ? (
        <><Clock size={iconSize} /> {t.registrationNotOpen}</>
      ) : kind === "closed" ? (
        <><AlertCircle size={iconSize} /> {t.registrationClosed}</>
      ) : kind === "walkInsOnly" ? (
        <><DoorOpen size={iconSize} /> {t.walkInsOnlyBadge}</>
      ) : kind === "viewOnly" ? (
        <><Eye size={iconSize} /> {t.eventViewOnlyBadge}</>
      ) : kind === "joinWaitlist" ? (
        t.waitlistJoin
      ) : (
        t.registerNow || "Register Now"
      )}
    </button>
  );
}
