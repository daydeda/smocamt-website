"use client";

import { useState } from "react";
import { MapPin, Clock, Calendar, RefreshCw, Trophy, Sparkles, Megaphone, LayoutGrid, List, ChevronDown, Info } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import { getRegisterState } from "@/lib/events/register-state";
import { formatEventWhen } from "@/lib/events/event-when";
import { getPosters, PosterCarousel, type Event } from "./dashboard-parts";
import { EventRow } from "./EventRow";
import { RegisterButton } from "./RegisterButton";
import type { DashboardCtx } from "../_lib/useDashboard";

const DEFAULT_ANNOUNCEMENT = "ขณะนี้ Web Application ActiveCAMT อยู่ระหว่างการพัฒนาและทดสอบระบบเพื่อเพิ่มประสิทธิภาพในการใช้งานสูงสุด\nหากท่านพบข้อผิดพลาดหรือมีข้อสงสัยประการใด สามารถแจ้งปัญหาหรือติดต่อเราได้ที่ IG: smocamt.official";

type FilterKey = "all" | "mine" | "open" | "week";

export function EventsColumn({ ctx }: { ctx: DashboardCtx }) {
  const { announcement, byStartAsc, byStartDesc, eventView, getEventStatus, loadingEvents, openPreview, past, quotaWalkInRows, regWindowRow, setEventView, setEvents, setLoadingEvents, setPreviewImage, stats, t, timelineGroupOf, upcoming, user, weekEnd } = ctx;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showPast, setShowPast] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);

  const announcementBody = announcement?.body ?? DEFAULT_ANNOUNCEMENT;

  // Quick filters over the upcoming events. "My events" only makes sense signed in.
  const filters: { key: FilterKey; label: string; match: (e: Event) => boolean }[] = [
    { key: "all", label: t.dashFilterAll, match: () => true },
    ...(user ? [{ key: "mine" as const, label: t.dashFilterMine, match: (e: Event) => !!e.isRegistered || e.waitlistPosition != null }] : []),
    { key: "open", label: t.dashFilterOpen, match: (e: Event) => { const k = getRegisterState(e).kind; return k === "register" || k === "joinWaitlist"; } },
    { key: "week", label: t.secThisWeek, match: (e: Event) => new Date(e.startTime) < weekEnd },
  ];
  const activeFilter = filters.find((f) => f.key === filter) ?? filters[0];
  const shown = upcoming.filter(activeFilter.match);

  const sections = [
    { key: "today", label: t.secToday },
    { key: "week", label: t.secThisWeek },
    { key: "later", label: t.secLater },
  ]
    .map((s) => ({ ...s, items: shown.filter((e) => timelineGroupOf(e) === s.key).sort(byStartAsc) }))
    .filter((s) => s.items.length > 0);
  const pastSorted = [...past].sort(byStartDesc);

  const emptyState = (message: string) => (
    <div style={{ padding: "48px 24px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 24, border: "2px dashed var(--border-subtle)" }}>
      <p style={{ color: "var(--text-muted)", fontWeight: 500 }}>{message}</p>
    </div>
  );

  const sectionHeader = (label: string, count: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>{label}</h3>
      <span style={{ fontSize: 11, fontWeight: 900, background: "var(--bg-elevated)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 99 }}>{count}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
    </div>
  );

  return (
    <div className="dash-events order-2 lg:order-1">

            {/* Announcement — body is admin-editable via /admin/announcement.
                Hidden only when an announcement is loaded AND explicitly disabled.
                When none is loaded yet / fetch failed, fall back to the built-in text.
                On phones it is one tappable line (tap to read it all) so the events stay
                near the top; from tablet width it always shows in full. */}
            {!(announcement && announcement.enabled === false) && (
            <div
              className={`dash-announce${announcementOpen ? " dash-announce-open" : ""}`}
              onClick={() => setAnnouncementOpen((o) => !o)}
              role="button"
              tabIndex={0}
              aria-expanded={announcementOpen}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAnnouncementOpen((o) => !o); } }}
            >
              <div className="dash-announce-head">
                <div className="dash-announce-icon">
                  <Megaphone size={18} />
                </div>
                <p className="dash-announce-title">ประกาศสำคัญ | Important Announcement</p>
              </div>
              <div
                className="dash-announce-body"
                dangerouslySetInnerHTML={{ __html: parseRichText(announcementBody) }}
              />
              <div className="dash-announce-footer">
                {!announcementOpen && <span className="dash-announce-hint">{t.dashAnnounceHint}</span>}
                <span className="dash-announce-more">
                  {announcementOpen ? t.dashShowLess : t.dashAnnounceMore}
                  <ChevronDown size={16} style={{ transform: announcementOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </span>
              </div>
            </div>
            )}

            <div>
              <div className="dash-events-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h2 className="dash-events-title" style={{ color: "var(--text-primary)", fontWeight: 900, letterSpacing: "-0.03em" }}>{t.upcomingEvents}</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* View toggle — Cards (poster grid) vs List (compact rows). The choice is remembered per device. */}
                  <div style={{ display: "flex", background: "var(--bg-elevated)", borderRadius: 12, padding: 3, border: "1px solid var(--border-subtle)" }}>
                    {([
                      { key: "timeline", label: t.timelineView, Icon: List },
                      { key: "grid", label: t.gridView, Icon: LayoutGrid },
                    ] as const).map(({ key, label, Icon }) => {
                      const active = eventView === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEventView(key)}
                          aria-pressed={active}
                          aria-label={label}
                          className="dash-toggle"
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "7px 12px", minHeight: 36, borderRadius: 9, border: "none", cursor: "pointer",
                            fontSize: 13, fontWeight: 800,
                            background: active ? "var(--bg-surface)" : "transparent",
                            color: active ? "var(--accent-primary)" : "var(--text-muted)",
                            boxShadow: active ? "0 2px 8px rgb(var(--shadow-rgb) / 0.06)" : "none",
                            transition: "all 0.2s",
                          }}
                        >
                          <Icon size={14} />
                          <span className="dash-toggle-label">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={t.refresh}
                    onClick={() => {
                      setLoadingEvents(true);
                      fetch("/api/events")
                        .then(r => r.json())
                        .then(d => { if (Array.isArray(d)) setEvents(d); })
                        .finally(() => setLoadingEvents(false));
                    }}
                    style={{ gap: 6, minHeight: 36 }}
                  >
                     <RefreshCw size={14} />
                     <span className="hidden sm:inline">{t.refresh}</span>
                  </button>
                </div>
              </div>

              {/* Overview stats strip — quick counts regardless of which view is active. */}
              {user && (
                <div className="dash-stats">
                  {stats.map(({ key, label, value, icon: Icon }) => (
                    <div key={key} className="glass dash-stat" style={{ borderRadius: 18, display: "flex", alignItems: "center", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                      <div className="dash-stat-icon" style={{ borderRadius: 12, background: "rgb(var(--accent-rgb) / 0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", flexShrink: 0 }}>
                        <Icon size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p className="dash-stat-value" style={{ fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>{value}</p>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick filters. Scrolls sideways on a narrow phone instead of wrapping. */}
              <div className="dash-filters" role="group" aria-label={t.upcomingEvents}>
                {filters.map((f) => {
                  const active = f.key === filter;
                  const count = upcoming.filter(f.match).length;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      aria-pressed={active}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
                        minHeight: 36, padding: "6px 14px", borderRadius: 99, cursor: "pointer",
                        fontSize: 13, fontWeight: 800, whiteSpace: "nowrap",
                        border: `1px solid ${active ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                        background: active ? "rgb(var(--accent-rgb) / 0.08)" : "var(--bg-surface)",
                        color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {f.label}
                      <span style={{ fontSize: 11, fontWeight: 900, padding: "1px 7px", borderRadius: 99, background: active ? "var(--accent-primary)" : "var(--bg-elevated)", color: active ? "var(--text-on-color)" : "var(--text-muted)" }}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {loadingEvents ? (
                eventView === "timeline" ? (
                  <div className="dash-rows">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="animate-pulse" style={{ height: 96, borderRadius: 18, background: "var(--bg-elevated)" }} />
                    ))}
                  </div>
                ) : (
                  <div className="dash-cards">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="glass animate-pulse"
                        style={{ height: 340, borderRadius: 28, background: "rgb(var(--ink-rgb) / 0.01)", border: "1px solid var(--border-subtle)" }}
                      />
                    ))}
                  </div>
                )
              ) : eventView === "timeline" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {sections.length > 0
                    ? sections.map((section) => (
                        <div key={section.key}>
                          {sectionHeader(section.label, section.items.length)}
                          <div className="dash-rows">
                            {section.items.map((e) => (
                              <EventRow key={e.id} e={e} ctx={ctx} featured={section.key === "today"} />
                            ))}
                          </div>
                        </div>
                      ))
                    : emptyState(upcoming.length === 0 ? t.noEvents : t.dashNoEventsFilter)}

                  {/* Past events stay out of the way until asked for. */}
                  {filter === "all" && pastSorted.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowPast((s) => !s)}
                        aria-expanded={showPast}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
                          minHeight: 44, borderRadius: 14, cursor: "pointer", marginBottom: showPast ? 12 : 0,
                          border: "1px dashed var(--border-subtle)", background: "transparent",
                          color: "var(--text-muted)", fontSize: 13, fontWeight: 800,
                        }}
                      >
                        {showPast ? t.dashHidePast : t.dashShowPast.replace("{n}", String(pastSorted.length))}
                        <ChevronDown size={16} style={{ transform: showPast ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </button>
                      {showPast && (
                        <div className="dash-rows">
                          {pastSorted.map((e) => (
                            <EventRow key={e.id} e={e} ctx={ctx} dimmed />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : shown.length > 0 ? (
                <div className="dash-cards">
                  {shown.map((e) => (
                    <div
                      key={e.id}
                      className="glass animate-fade-in-up event-card-ig"
                      style={{
                        height: "100%",
                        borderRadius: 28,
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
                      {/* Poster Area — 4:3 rather than square keeps a card under a screen tall on a tablet. */}
                      <div style={{ position: "relative", aspectRatio: "4/3", background: "var(--media-bg)", overflow: "hidden" }}>
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
                         <div style={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}>
                            <div style={{
                               background: "var(--bg-surface)",
                               padding: "8px 12px",
                               borderRadius: 16,
                               boxShadow: "0 8px 24px rgb(var(--shadow-rgb) / 0.15)",
                               textAlign: "center",
                               minWidth: 56,
                               border: "1px solid rgb(var(--ink-rgb) / 0.05)"
                            }}>
                               <p style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Bangkok" })}
                               </p>
                               <p style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>
                                 {new Date(e.startTime).toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Bangkok" })}
                               </p>
                            </div>
                         </div>

                         <div style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }}>
                           <span style={{
                             padding: "6px 14px",
                             background: getEventStatus(e) === 'live' ? "var(--red-500)" : "var(--accent-primary)",
                             color: "var(--text-on-color)",
                             borderRadius: 20,
                             fontSize: 11,
                             fontWeight: 900,
                             textTransform: "uppercase",
                             letterSpacing: "0.05em",
                             boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.1)"
                           }}>
                             {getEventStatus(e)}
                           </span>
                         </div>

                         {/* Points Badges — house winner bonus + (when set) the individual points the student earns just by checking in */}
                         <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                        className="dash-card-body"
                        onClick={() => openPreview(e)}
                        style={{ flex: 1, display: "flex", flexDirection: "column", cursor: "pointer" }}
                      >
                        <h3 style={{ fontSize: 19, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 14, overflowWrap: "break-word", wordBreak: "break-word" }}>{e.title}</h3>

                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", flexShrink: 0 }}>
                               <Clock size={16} />
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, lineHeight: 1.4 }}>
                              {formatEventWhen(e.startTime, e.endTime, true)}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", flexShrink: 0 }}>
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
                            marginBottom: 20,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
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
                              display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
                              minHeight: 36, marginTop: -8, marginBottom: 16, padding: "6px 12px", borderRadius: 99,
                              border: "1px solid rgb(var(--accent-rgb) / 0.25)", background: "rgb(var(--accent-rgb) / 0.06)",
                              color: "var(--accent-primary)", fontSize: 13, fontWeight: 800, cursor: "pointer",
                            }}
                          >
                            <Info size={14} />
                            {t.dashReadMore}
                          </button>
                        )}

                        <div style={{ marginTop: "auto", paddingTop: 8 }}>
                          <RegisterButton e={e} ctx={ctx} variant="card" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                emptyState(upcoming.length === 0 ? t.noEvents : t.dashNoEventsFilter)
              )}
            </div>
          </div>
  );
}
