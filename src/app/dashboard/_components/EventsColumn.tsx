"use client";

import { MapPin, Clock, Calendar, CheckCircle2, RefreshCw, Trophy, Sparkles, AlertCircle, Megaphone, LayoutGrid, List, DoorOpen } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import { getPosters, PosterCarousel } from "./dashboard-parts";
import type { DashboardCtx } from "../_lib/useDashboard";

export function EventsColumn({ ctx }: { ctx: DashboardCtx }) {
  const { announcement, eventView, getEventStatus, lang, loadingEvents, openPreview, promptRegister, quotaWalkInRows, regWindowRow, registeringId, setEventView, setEvents, setLoadingEvents, setPreviewImage, stats, t, timelineSections, upcoming, user } = ctx;
  return (
    <div className="order-2 lg:order-1" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            
            {/* Featured Event / Alert — body is admin-editable via /admin/announcement.
                Hidden only when an announcement is loaded AND explicitly disabled.
                When none is loaded yet / fetch failed, fall back to the built-in text. */}
            {!(announcement && announcement.enabled === false) && (
            <div className="alert alert-info" style={{ borderRadius: "var(--radius-lg)", padding: 20, background: "rgb(var(--accent-rgb) / 0.04)", border: "1px solid rgb(var(--accent-rgb) / 0.1)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)", padding: 8, borderRadius: 12, boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.05)", color: "var(--accent-primary)", width: 40, height: 40, flexShrink: 0 }}>
                <Megaphone size={22} />
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>ประกาศสำคัญ | Important Announcement</p>
                <p
                  style={{ fontSize: 14, color: "var(--text-secondary)" }}
                  dangerouslySetInnerHTML={{ __html: parseRichText(announcement?.body ?? "ขณะนี้ Web Application ActiveCAMT อยู่ระหว่างการพัฒนาและทดสอบระบบเพื่อเพิ่มประสิทธิภาพในการใช้งานสูงสุด\nหากท่านพบข้อผิดพลาดหรือมีข้อสงสัยประการใด สามารถแจ้งปัญหาหรือติดต่อเราได้ที่ IG: smocamt.official") }}
                />
              </div>
            </div>
            )}

            <div style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900, letterSpacing: "-0.03em" }}>{t.upcomingEvents}</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* View toggle — Cards (action-first grid) vs Timeline (at-a-glance agenda). */}
                  <div style={{ display: "flex", background: "var(--bg-elevated)", borderRadius: 12, padding: 3, border: "1px solid var(--border-subtle)" }}>
                    {([
                      { key: "grid", label: t.gridView, Icon: LayoutGrid },
                      { key: "timeline", label: t.timelineView, Icon: List },
                    ] as const).map(({ key, label, Icon }) => {
                      const active = eventView === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEventView(key)}
                          aria-pressed={active}
                          aria-label={label}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "7px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                            fontSize: 13, fontWeight: 800,
                            background: active ? "var(--bg-surface)" : "transparent",
                            color: active ? "var(--accent-primary)" : "var(--text-muted)",
                            boxShadow: active ? "0 2px 8px rgb(var(--shadow-rgb) / 0.06)" : "none",
                            transition: "all 0.2s",
                          }}
                        >
                          <Icon size={14} />
                          <span className="hidden sm:inline">{label}</span>
                        </button>
                      );
                    })}
                  </div>
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
              </div>

              {/* Overview stats strip — quick counts regardless of which view is active. */}
              {user && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
                  {stats.map(({ key, label, value, icon: Icon }) => (
                    <div key={key} className="glass" style={{ padding: "16px 18px", borderRadius: 18, display: "flex", alignItems: "center", gap: 14, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgb(var(--accent-rgb) / 0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", flexShrink: 0 }}>
                        <Icon size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>{value}</p>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {loadingEvents ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
                  {[1, 2, 3].map((i) => (
                    <div 
                      key={i} 
                      className="glass animate-pulse"
                      style={{ 
                        height: 340, 
                        borderRadius: 32, 
                        background: "rgb(var(--ink-rgb) / 0.01)",
                        border: "1px solid var(--border-subtle)"
                      }}
                    />
                  ))}
                </div>
              ) : eventView === "timeline" ? (
                timelineSections.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                    {timelineSections.map((section) => (
                      <div key={section.key}>
                        {/* Section header with a count badge and a hairline rule. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                          <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>{section.label}</h3>
                          <span style={{ fontSize: 11, fontWeight: 900, background: "var(--bg-elevated)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 99 }}>{section.items.length}</span>
                          <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {section.items.map((e) => {
                            const st = getEventStatus(e);
                            const start = new Date(e.startTime);
                            const end = new Date(e.endTime);
                            const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" };
                            const attended = e.attendanceStatus === "attended";
                            const statusColor = st === "live" ? "var(--red-500)" : st === "past" ? "var(--text-muted)" : "var(--accent-primary)";
                            return (
                              <button
                                key={e.id}
                                type="button"
                                onClick={() => openPreview(e)}
                                className="timeline-row"
                                style={{
                                  display: "flex", alignItems: "center", gap: 16, width: "100%", textAlign: "left",
                                  padding: "12px 16px", borderRadius: 16, cursor: "pointer",
                                  background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
                                  opacity: section.key === "past" ? 0.65 : 1, transition: "all 0.2s",
                                }}
                              >
                                {/* Date chip */}
                                <div style={{ flexShrink: 0, width: 54, textAlign: "center", background: "var(--bg-elevated)", borderRadius: 12, padding: "8px 4px" }}>
                                  <p style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: statusColor }}>
                                    {start.toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Bangkok" })}
                                  </p>
                                  <p style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.1 }}>
                                    {start.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Bangkok" })}
                                  </p>
                                </div>
                                {/* Title + time + location */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</p>
                                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4, fontSize: 12, color: "var(--text-muted)", fontWeight: 600, flexWrap: "wrap" }}>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                      <Clock size={12} /> {start.toLocaleTimeString("en-GB", timeOpts)}–{end.toLocaleTimeString("en-GB", timeOpts)}
                                    </span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      <MapPin size={12} /> {e.location || "CAMT Building"}
                                    </span>
                                  </div>
                                </div>
                                {/* Status + registration state */}
                                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                                  <span style={{ padding: "4px 10px", background: statusColor, color: "var(--text-on-color)", borderRadius: 99, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em" }}>{st}</span>
                                  {attended ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--emerald-500)" }}><CheckCircle2 size={12} /> {t.attended}</span>
                                  ) : e.isRegistered ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--accent-primary)" }}><CheckCircle2 size={12} /> {t.registered}</span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "80px 40px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 24, border: "2px dashed var(--border-subtle)" }}>
                     <p style={{ color: "var(--text-muted)", fontWeight: 500 }}>{t.noEvents}</p>
                  </div>
                )
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
                        boxShadow: "0 10px 40px rgb(var(--shadow-rgb) / 0.03)"
                      }}
                    >
                      {/* Poster Area */}
                      <div style={{ position: "relative", aspectRatio: "1/1", background: "var(--media-bg)", overflow: "hidden" }}>
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
                         <div style={{ position: "absolute", top: 16, right: 16, zIndex: 2 }}>
                            <div style={{ 
                               background: "var(--bg-surface)",
                               padding: "10px 14px",
                               borderRadius: 18, 
                               boxShadow: "0 8px 24px rgb(var(--shadow-rgb) / 0.15)",
                               textAlign: "center", 
                               minWidth: 64,
                               border: "1px solid rgb(var(--ink-rgb) / 0.05)"
                            }}>
                               <p style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Bangkok" })}
                               </p>
                               <p style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Bangkok" })}
                               </p>
                            </div>
                         </div>

                         <div style={{ position: "absolute", top: 16, left: 16, zIndex: 2 }}>
                           <span style={{
                             padding: "8px 16px",
                             background: getEventStatus(e) === 'live' ? "var(--red-500)" : "var(--accent-primary)", 
                             color: "var(--text-on-color)", 
                             borderRadius: 20, 
                             fontSize: 12, 
                             fontWeight: 900, 
                             textTransform: "uppercase", 
                             letterSpacing: "0.05em",
                             boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.1)"
                           }}>
                             {getEventStatus(e)}
                           </span>
                         </div>

                         {/* Points Badges — house winner bonus + (when set) the individual points the student earns just by checking in */}
                         <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                           {e.pointsAwarded !== undefined && (
                             <div style={{
                               background: "rgb(var(--scrim-rgb) / 0.7)",
                               backdropFilter: "blur(8px)",
                               color: "var(--text-on-color)",
                               padding: "6px 12px",
                               borderRadius: 14,
                               fontSize: 11,
                               fontWeight: 900,
                               display: "inline-flex",
                               alignItems: "center",
                               gap: 6,
                               boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                               border: "1px solid rgb(var(--white-rgb) / 0.1)"
                             }}>
                               <Trophy size={12} style={{ color: "var(--amber-400)" }} />
                               <span>{e.pointsAwarded} PTS</span>
                             </div>
                           )}
                           {(e.individualPointsAwarded ?? 0) > 0 && (
                             <div style={{
                               background: "rgb(var(--scrim-rgb) / 0.7)",
                               backdropFilter: "blur(8px)",
                               color: "var(--text-on-color)",
                               padding: "6px 12px",
                               borderRadius: 14,
                               fontSize: 11,
                               fontWeight: 900,
                               display: "inline-flex",
                               alignItems: "center",
                               gap: 6,
                               boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                               border: "1px solid rgb(var(--white-rgb) / 0.1)"
                             }} title={t.dashIndividualPtsHint}>
                               <Sparkles size={12} style={{ color: "var(--accent-primary)" }} />
                               <span>+{e.individualPointsAwarded} {t.dashIndividualPtsYou}</span>
                             </div>
                           )}
                         </div>
                      </div>

                      {/* Content Area */}
                      <div
                        onClick={() => openPreview(e)}
                        style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", cursor: "pointer" }}
                      >
                        <h3 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 16, overflowWrap: "break-word", wordBreak: "break-word" }}>{e.title}</h3>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
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
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                               <MapPin size={16} />
                            </div>
                            {e.location || "CAMT Building"}
                          </div>
                          {quotaWalkInRows(e)}
                          {regWindowRow(e)}
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
                              openPreview(e);
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
                            const regOpenAt = e.registrationOpenTime ? new Date(e.registrationOpenTime) : null;
                            const regCloseAt = e.registrationCloseTime ? new Date(e.registrationCloseTime) : null;
                            // Once the registration window closes the headcount locks
                            // in both directions: no new sign-ups AND no cancellations.
                            const regWindowClosed = !!regCloseAt && nowTs > regCloseAt;
                            const canCancel = !isPastEvent && !isAttended && !regWindowClosed;
                            const notYetOpen = !e.isRegistered && !!regOpenAt && nowTs < regOpenAt;
                            const regClosed = !e.isRegistered && regWindowClosed;
                            const walkInsOnlyMode = !e.isRegistered && !!e.walkInsOnly;
                            const windowBlocked = notYetOpen || regClosed || walkInsOnlyMode;
                            const isDisabled = (e.isRegistered && !canCancel) || windowBlocked || registeringId === e.id;
                            const greyed = regClosed || walkInsOnlyMode || (e.isRegistered && !canCancel);
                            const waitlisted = !e.isRegistered && e.waitlistPosition != null;
                            const isFull = e.quota != null && e.quota > 0 && (e.registeredCount ?? 0) >= e.quota;

                            return (
                              <button
                                disabled={isDisabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  promptRegister(e.id, !!e.isRegistered || waitlisted, e.title);
                                }}
                                className={`btn btn-full ${e.isRegistered ? "btn-success-solid" : "btn-primary"}`}
                                style={{
                                  borderRadius: 16,
                                  height: 48,
                                  fontWeight: 800,
                                  background: notYetOpen ? "var(--amber-500)" : greyed ? "var(--bg-elevated)" : e.isRegistered ? (canCancel ? "var(--emerald-500)" : "var(--bg-elevated)") : undefined,
                                  color: notYetOpen ? "var(--text-on-color)" : greyed ? "var(--text-muted)" : e.isRegistered ? (canCancel ? "var(--text-on-color)" : "var(--text-muted)") : undefined,
                                  boxShadow: notYetOpen ? "0 10px 25px rgb(var(--amber-500-rgb) / 0.3)" : (e.isRegistered && canCancel) ? "0 10px 25px rgb(var(--emerald-500-rgb) / 0.3)" : (greyed ? "none" : "0 10px 25px var(--accent-glow)"),
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
                                ) : waitlisted ? (
                                  <><Clock size={18} /> {t.waitlistOn.replace("{n}", String(e.waitlistPosition))}</>
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
  );
}
