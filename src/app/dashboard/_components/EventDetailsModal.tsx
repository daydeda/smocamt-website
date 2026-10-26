"use client";

import Link from "next/link";
import { eventPath } from "@/lib/events/event-slug";
import { MapPin, Clock, Calendar, CheckCircle2, RefreshCw, Trophy, Sparkles, X, AlertCircle, DoorOpen, Share2, Check, Camera } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import { getPosters, PosterCarousel } from "./dashboard-parts";
import type { DashboardCtx } from "../_lib/useDashboard";

export function EventDetailsModal({ ctx }: { ctx: DashboardCtx }) {
  const { closePreview, events, getEventStatus, lang, linkCopied, previewEvent, promptRegister, quotaWalkInRows, regWindowRow, registeringId, setLinkCopied, setPreviewImage, t } = ctx;
  return (
    <>{previewEvent && (() => {
        const liveEvent = events.find(x => x.id === previewEvent.id) || previewEvent;
        const nowTs = new Date();
        const isPastEvent = nowTs > new Date(liveEvent.endTime);
        const isAttended = liveEvent.attendanceStatus === "attended";
        const regOpenAt = liveEvent.registrationOpenTime ? new Date(liveEvent.registrationOpenTime) : null;
        const regCloseAt = liveEvent.registrationCloseTime ? new Date(liveEvent.registrationCloseTime) : null;
        // Once the registration window closes the headcount locks in both
        // directions: no new sign-ups AND no cancellations.
        const regWindowClosed = !!regCloseAt && nowTs > regCloseAt;
        const canCancel = !isPastEvent && !isAttended && !regWindowClosed;
        const notYetOpen = !liveEvent.isRegistered && !!regOpenAt && nowTs < regOpenAt;
        const regClosed = !liveEvent.isRegistered && regWindowClosed;
        const walkInsOnlyMode = !liveEvent.isRegistered && !!liveEvent.walkInsOnly;
        const windowBlocked = notYetOpen || regClosed || walkInsOnlyMode;
        const greyed = regClosed || walkInsOnlyMode || (liveEvent.isRegistered && !canCancel);
        const isDisabled = (liveEvent.isRegistered && !canCancel) || windowBlocked || registeringId === liveEvent.id;
        const waitlisted = !liveEvent.isRegistered && liveEvent.waitlistPosition != null;
        const isFull = liveEvent.quota != null && liveEvent.quota > 0 && (liveEvent.registeredCount ?? 0) >= liveEvent.quota;
        const previewPosters = getPosters(liveEvent);

        // Copy a direct, shareable link to this event to the clipboard. Falls back
        // to a hidden-textarea copy for in-app webviews where navigator.clipboard
        // is unavailable (insecure context / restricted permissions).
        const copyShareLink = async () => {
          const url = `${window.location.origin}${eventPath(liveEvent.id, liveEvent.title, liveEvent.shortSlug)}`;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
            } else {
              throw new Error("clipboard unavailable");
            }
          } catch {
            const ta = document.createElement("textarea");
            ta.value = url;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand("copy"); } catch {}
            document.body.removeChild(ta);
          }
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        };

        return (
          <div 
            style={{
              position: "fixed",
              inset: 0,
              background: "rgb(var(--scrim-rgb) / 0.75)",
              backdropFilter: "blur(12px)",
              zIndex: 1999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
            onClick={closePreview}
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
                boxShadow: "0 25px 50px -12px rgb(var(--shadow-rgb) / 0.5)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                type="button"
                onClick={closePreview}
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  background: liveEvent.imageUrl ? "rgb(var(--scrim-rgb) / 0.5)" : "var(--bg-elevated)",
                  backdropFilter: liveEvent.imageUrl ? "blur(4px)" : undefined,
                  border: liveEvent.imageUrl ? "1px solid rgb(var(--white-rgb) / 0.2)" : "1px solid var(--border-subtle)",
                  borderRadius: "50%",
                  width: "36px",
                  height: "36px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: liveEvent.imageUrl ? "var(--text-on-color)" : "var(--text-primary)",
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
                    background: "var(--black)",
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
                        background: getEventStatus(liveEvent) === 'live' ? "var(--red-500)" : "var(--accent-primary)", 
                        color: "var(--text-on-color)", 
                        borderRadius: "12px", 
                        fontSize: "11px", 
                        fontWeight: 900, 
                        textTransform: "uppercase", 
                        letterSpacing: "0.05em",
                        boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.2)"
                      }}>
                        {getEventStatus(liveEvent)}
                      </span>
                    </div>

                    {/* Points Badges — house winner bonus + (when set) the individual points the student earns just by checking in */}
                    <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {liveEvent.pointsAwarded !== undefined && (
                        <div style={{
                          background: "rgb(var(--scrim-rgb) / 0.7)",
                          backdropFilter: "blur(8px)",
                          color: "var(--text-on-color)",
                          padding: "6px 12px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 900,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                          border: "1px solid rgb(var(--white-rgb) / 0.1)"
                        }}>
                          <Trophy size={12} style={{ color: "var(--amber-400)" }} />
                          <span>{liveEvent.pointsAwarded} PTS</span>
                        </div>
                      )}
                      {(liveEvent.individualPointsAwarded ?? 0) > 0 && (
                        <div style={{
                          background: "rgb(var(--scrim-rgb) / 0.7)",
                          backdropFilter: "blur(8px)",
                          color: "var(--text-on-color)",
                          padding: "6px 12px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 900,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                          border: "1px solid rgb(var(--white-rgb) / 0.1)"
                        }} title={t.dashIndividualPtsHint}>
                          <Sparkles size={12} style={{ color: "var(--accent-primary)" }} />
                          <span>+{liveEvent.individualPointsAwarded} {t.dashIndividualPtsYou}</span>
                        </div>
                      )}
                    </div>
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
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
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
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                         <MapPin size={16} />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                        {liveEvent.location || "CAMT Building"}
                      </div>
                    </div>

                    {quotaWalkInRows(liveEvent)}
                    {regWindowRow(liveEvent)}
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
                alignItems: "center",
                flexWrap: "wrap"
              }}>
                {/* Copy a direct link to this event so it can be shared. Pushed to
                    the left (marginRight:auto) away from Close/Register. */}
                <button
                  type="button"
                  onClick={copyShareLink}
                  style={{
                    marginRight: "auto",
                    padding: "0 18px",
                    height: 48,
                    borderRadius: 16,
                    fontSize: 14,
                    fontWeight: 800,
                    color: linkCopied ? "var(--emerald-500)" : "var(--text-primary)",
                    background: "var(--bg-elevated)",
                    border: `1px solid ${linkCopied ? "var(--emerald-500)" : "var(--border-subtle)"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s"
                  }}
                >
                  {linkCopied ? <Check size={16} /> : <Share2 size={16} />}
                  {linkCopied
                    ? (lang === "th" ? "คัดลอกแล้ว!" : lang === "cn" ? "已复制！" : lang === "mm" ? "ကူးယူပြီး!" : "Copied!")
                    : (lang === "th" ? "คัดลอกลิงก์" : lang === "cn" ? "复制链接" : lang === "mm" ? "လင့်ခ်ကူးယူ" : "Copy link")}
                </button>

                <button
                  type="button"
                  onClick={closePreview}
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

                {liveEvent.checkInMode === "evidence" ? (
                  // Evidence-mode events have no registration step at all — the
                  // "action" is going to submit that day's proof, not a seat sign-up.
                  // See events.checkInMode in schema.ts.
                  <Link
                    href={`/dashboard/events/${liveEvent.id}/evidence`}
                    className="btn btn-primary"
                    style={{
                      borderRadius: 16, height: 48, padding: "0 24px", fontWeight: 800,
                      boxShadow: "0 10px 25px var(--accent-glow)",
                      display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    }}
                  >
                    <Camera size={18} />
                    {lang === "th" ? "ส่งหลักฐานวันนี้" : lang === "cn" ? "提交今日证据" : lang === "mm" ? "ယနေ့ သက်သေတင်ရန်" : "Submit today's evidence"}
                  </Link>
                ) : (
                <button
                  disabled={isDisabled}
                  onClick={() => promptRegister(liveEvent.id, !!liveEvent.isRegistered || waitlisted, liveEvent.title)}
                  className={`btn ${liveEvent.isRegistered ? "btn-success-solid" : "btn-primary"}`}
                  style={{
                    borderRadius: 16,
                    height: 48,
                    padding: "0 24px",
                    fontWeight: 800,
                    background: notYetOpen ? "var(--amber-500)" : greyed ? "var(--bg-elevated)" : liveEvent.isRegistered ? (canCancel ? "var(--emerald-500)" : "var(--bg-elevated)") : undefined,
                    color: notYetOpen ? "var(--text-on-color)" : greyed ? "var(--text-muted)" : liveEvent.isRegistered ? (canCancel ? "var(--text-on-color)" : "var(--text-muted)") : undefined,
                    boxShadow: notYetOpen ? "0 10px 25px rgb(var(--amber-500-rgb) / 0.3)" : (liveEvent.isRegistered && canCancel) ? "0 10px 25px rgb(var(--emerald-500-rgb) / 0.3)" : (greyed ? "none" : "0 10px 25px var(--accent-glow)"),
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
                  ) : waitlisted ? (
                    <><Clock size={18} /> {t.waitlistOn.replace("{n}", String(liveEvent.waitlistPosition))}</>
                  ) : notYetOpen ? (
                    <><Clock size={18} /> {t.registrationNotOpen}</>
                  ) : regClosed ? (
                    <><AlertCircle size={18} /> {t.registrationClosed}</>
                  ) : walkInsOnlyMode ? (
                    <><DoorOpen size={18} /> {t.walkInsOnlyBadge}</>
                  ) : isFull ? (
                    t.waitlistJoin
                  ) : (
                    t.registerNow || "Register Now"
                  )}
                </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}</>
  );
}
