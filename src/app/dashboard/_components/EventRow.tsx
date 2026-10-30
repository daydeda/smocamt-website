"use client";

import { MapPin, Clock, Calendar, CheckCircle2, Trophy, Sparkles, AlertCircle, DoorOpen, Eye, ChevronRight, Info, Users } from "lucide-react";
import { getRegisterState, type RegisterKind } from "@/lib/events/register-state";
import { formatEventWhen, formatShortDateTime } from "@/lib/events/event-when";
import { getPosters, type Event } from "./dashboard-parts";
import { RegisterButton } from "./RegisterButton";
import type { DashboardCtx } from "../_lib/useDashboard";

type Tone = "emerald" | "accent" | "amber" | "muted";

const TONES: Record<Tone, { color: string; bg: string }> = {
  emerald: { color: "var(--emerald-500)", bg: "rgb(var(--emerald-500-rgb) / 0.1)" },
  accent: { color: "var(--accent-primary)", bg: "rgb(var(--accent-rgb) / 0.08)" },
  amber: { color: "var(--amber-500)", bg: "rgb(var(--amber-500-rgb) / 0.1)" },
  muted: { color: "var(--text-muted)", bg: "var(--bg-elevated)" },
};

// Status shown in place of the action button when there is nothing to tap. Cancelling
// a registration or leaving the waitlist goes through the details modal, so a
// stray tap in a dense list can't release a seat.
function statusChip(kind: RegisterKind, e: Event, t: DashboardCtx["t"]): { label: string; tone: Tone; Icon: typeof Clock } | null {
  switch (kind) {
    case "attended": return { label: t.attended, tone: "emerald", Icon: CheckCircle2 };
    case "registered": return { label: t.registered, tone: "accent", Icon: CheckCircle2 };
    case "ended": return { label: t.eventEnded, tone: "muted", Icon: Calendar };
    case "waitlisted": return { label: t.dashWaitlistChip.replace("{n}", String(e.waitlistPosition)), tone: "amber", Icon: Clock };
    case "notYetOpen":
      return {
        label: e.registrationOpenTime ? t.dashOpensChip.replace("{date}", formatShortDateTime(e.registrationOpenTime)) : t.registrationNotOpen,
        tone: "amber",
        Icon: Clock,
      };
    case "closed": return { label: t.registrationClosed, tone: "muted", Icon: AlertCircle };
    case "walkInsOnly": return { label: t.walkInsOnlyBadge, tone: "muted", Icon: DoorOpen };
    case "viewOnly": return { label: t.eventViewOnlyBadge, tone: "muted", Icon: Eye };
    default: return null;
  }
}

// One event as a compact list row: thumbnail, title, when/where, points, and the
// register action or a status chip. Tapping anywhere else opens the details modal.
export function EventRow({ e, ctx, featured = false, dimmed = false }: { e: Event; ctx: DashboardCtx; featured?: boolean; dimmed?: boolean }) {
  const { getEventStatus, openPreview, t } = ctx;
  const live = getEventStatus(e) === "live";
  const poster = getPosters(e)[0];
  const { kind } = getRegisterState(e);
  const evidence = e.checkInMode === "evidence";
  const actionable = evidence || kind === "register" || kind === "joinWaitlist";
  const chip = actionable ? null : statusChip(kind, e, t);
  const hasDescription = !!e.description && e.description.trim().length > 0;
  const housePts = e.pointsAwarded;
  const youPts = e.individualPointsAwarded ?? 0;
  // Seats: shown only when a quota is set (0/null = unlimited), so a student sees
  // how full an event is without opening the card.
  const hasQuota = e.quota != null && e.quota > 0;
  const taken = e.registeredCount ?? 0;
  const seatsFull = hasQuota && taken >= e.quota!;
  const waitlistCount = e.waitlistCount ?? 0;
  const seatsPct = hasQuota ? Math.min(100, (taken / e.quota!) * 100) : 0;
  const thumb = featured ? 88 : 64;

  return (
    <div
      className="event-row"
      style={{
        position: "relative",
        display: "flex",
        gap: 12,
        padding: 12,
        borderRadius: 18,
        background: "var(--bg-surface)",
        border: `1px solid ${live ? "rgb(var(--red-500-rgb) / 0.35)" : "var(--border-subtle)"}`,
        opacity: dimmed ? 0.65 : 1,
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      {/* Covers the whole row so it is one big tap target; the action button sits above it. */}
      <button
        type="button"
        onClick={() => openPreview(e)}
        aria-label={e.title}
        style={{ position: "absolute", inset: 0, borderRadius: 18, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      />

      <div style={{ position: "relative", width: thumb, height: thumb, flexShrink: 0, borderRadius: 12, overflow: "hidden", background: "var(--media-bg)", pointerEvents: "none" }}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-elevated)" }}>
            <Calendar size={22} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
          </div>
        )}
        {live && (
          <span style={{ position: "absolute", top: 4, left: 4, padding: "2px 6px", borderRadius: 6, background: "var(--red-500)", color: "var(--text-on-color)", fontSize: 9, fontWeight: 900, letterSpacing: "0.05em" }}>
            LIVE
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
        <p
          style={{
            fontSize: featured ? 16 : 15, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere",
          }}
        >
          {e.title}
        </p>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: live ? "var(--red-500)" : "var(--text-secondary)" }}>
          <Clock size={12} style={{ flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatEventWhen(e.startTime, e.endTime)}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          <MapPin size={12} style={{ flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.location || "CAMT Building"}</span>
        </span>
        {hasQuota && (
          // Filled/capacity with a thin bar. Full is amber, not red: the waitlist is still open,
          // so the label says so (or "Full" when the student can't join the waitlist).
          <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 8px", minWidth: 0, fontSize: 12, fontWeight: 700, color: seatsFull ? "var(--amber-500)" : "var(--text-secondary)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              <Users size={12} style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 800 }}>{taken}/{e.quota}</span>
            </span>
            <span aria-hidden style={{ width: 48, height: 4, flexShrink: 0, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden" }}>
              <span style={{ display: "block", width: `${seatsPct}%`, height: "100%", borderRadius: 99, background: seatsFull ? "var(--amber-500)" : "var(--accent-primary)" }} />
            </span>
            {seatsFull && <span style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{kind === "joinWaitlist" ? t.dashWaitlistOpen : t.eventFull}</span>}
            {waitlistCount > 0 && <span style={{ whiteSpace: "nowrap", fontWeight: 700, color: "var(--text-muted)" }}>· {t.dashWaitingCount.replace("{n}", String(waitlistCount))}</span>}
          </span>
        )}
        {hasDescription && (
          // Just the hint: a one-line description preview gets cut to a few words next to it.
          // The row is already tappable, so this only tells the student there is more to read.
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 12, fontWeight: 800, color: "var(--accent-primary)" }}>
            <Info size={12} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.dashReadMore}</span>
            <ChevronRight size={12} style={{ flexShrink: 0 }} />
          </span>
        )}

        {(housePts !== undefined || youPts > 0 || chip || actionable) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontWeight: 800, color: "var(--text-secondary)" }}>
              {housePts !== undefined && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Trophy size={12} style={{ color: "var(--amber-400)" }} /> {housePts}
                </span>
              )}
              {youPts > 0 && (
                <span title={t.dashIndividualPtsHint} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={12} style={{ color: "var(--accent-primary)" }} /> +{youPts} {t.dashIndividualPtsYou}
                </span>
              )}
            </div>
            {actionable ? (
              <div style={{ position: "relative", zIndex: 1, pointerEvents: "auto", marginLeft: "auto" }}>
                <RegisterButton e={e} ctx={ctx} variant="compact" />
              </div>
            ) : chip ? (
              <span
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 99,
                  fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", color: TONES[chip.tone].color, background: TONES[chip.tone].bg,
                }}
              >
                <chip.Icon size={12} /> {chip.label}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
