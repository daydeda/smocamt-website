"use client";

import { CheckCircle2, AlertCircle, RotateCcw, Download, ChevronDown, Calendar, Plus, Loader2 } from "lucide-react";
import viewfinderStyles from "@/components/admin/QrViewfinder.module.css";
import { type EventSession, sortedSessions, pickCurrentSessionId, isEventLive, sortedForScanner, LiveBadge } from "./scanner-parts";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

export function ScannerMainColumn({ ctx }: { ctx: ScannerScreenCtx }) {
  const { canGoLiveNow, dayDropdownOpen, dayDropdownRef, dropdownOpen, dropdownRef, eventId, events, eventsError, fmtClock, goLiveBusy, goLiveConfirming, goLiveErrorMsg, goLiveNow, isScanning, lang, loadingEvents, otherLiveEvent, scannerError, selectedEvent, selectedEventIsLive, selectedEventUpcoming, sessionId, setDayDropdownOpen, setDropdownOpen, setEventId, setGoLiveConfirmFor, setGoLiveError, setSessionId, startScanner, t } = ctx;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Event Selector */}
          <div 
            className="stat-card flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5" 
            style={{ 
              padding: 24, 
              position: "relative", 
              zIndex: dropdownOpen ? 10 : 1 
            }}
          >
            {/* Left Side: Icon & Dropdown Selector */}
            <div className="flex items-center gap-4 flex-1 min-w-0 w-full">
              <div style={{ width: 48, height: 48, background: "var(--bg-elevated)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Calendar size={24} color="var(--accent-primary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }} ref={dropdownRef}>
                <label className="label" style={{ marginBottom: 4, display: "block", fontSize: 12, color: "var(--text-muted)" }}>{t.eventsTitle.toUpperCase()}</label>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  style={{
                    width: "100%",
                    fontSize: 18,
                    fontWeight: 700,
                    padding: "4px 0",
                    border: "none",
                    background: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    color: "var(--text-primary)",
                  }}
                >
                  <span style={{
                    flex: 1,
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}>
                    {selectedEvent?.title || t.noEvents || "No events available"}
                    {selectedEventIsLive && <LiveBadge label={t.statusLive} />}
                  </span>
                  {events.length > 0 && (
                    <ChevronDown 
                      size={18} 
                      style={{ 
                        flexShrink: 0, 
                        opacity: 0.6, 
                        transform: dropdownOpen ? "rotate(180deg)" : "none", 
                        transition: "transform 0.2s" 
                      }} 
                    />
                  )}
                </button>

                {dropdownOpen && events.length > 0 && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    marginTop: 8,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-medium)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "0 10px 25px -5px rgb(var(--shadow-rgb) / 0.1), 0 8px 10px -6px rgb(var(--shadow-rgb) / 0.1)",
                    maxHeight: 240,
                    overflowY: "auto",
                    padding: 4
                  }}>
                    {sortedForScanner(events).map((e) => {
                      const isSelected = e.id === eventId;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => {
                            setEventId(e.id);
                            setSessionId(pickCurrentSessionId(e.sessions));
                            setDropdownOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 14px",
                            borderRadius: "var(--radius-sm)",
                            fontSize: 15,
                            fontWeight: isSelected ? 700 : 500,
                            background: isSelected ? "var(--bg-elevated)" : "transparent",
                            color: isSelected ? "var(--accent-primary)" : "var(--text-primary)",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            transition: "background 0.15s, color 0.15s",
                            overflowWrap: "break-word",
                            wordBreak: "break-word",
                            whiteSpace: "normal"
                          }}
                          onMouseEnter={(event) => {
                            if (event.currentTarget.style.background !== "var(--bg-elevated)") {
                              event.currentTarget.style.background = "var(--bg-glass)";
                            }
                          }}
                          onMouseLeave={(event) => {
                            if (event.currentTarget.style.background !== "var(--bg-elevated)") {
                              event.currentTarget.style.background = "transparent";
                            }
                          }}
                        >
                          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {e.title}
                            {isEventLive(e) && <LiveBadge label={t.statusLive} small />}
                          </span>
                          {isSelected && <CheckCircle2 size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Action Button */}
            {eventId && (
              <a 
                href={`/api/admin/events/${eventId}/report`}
                download
                className="btn btn-ghost w-full sm:w-auto justify-center"
                style={{ padding: "10px 16px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
              >
                <Download size={16} />
                {t.exportCSV ? t.exportCSV.replace(" CSV", "") : "Report"}
              </a>
            )}
          </div>

          {/* Wrong-event nudge — the selected event isn't live but a different one
              is, right now. This is the exact "forgot to switch the dropdown"
              mistake staff have hit before, so call it out with a one-tap fix.
              Also shown for a not-yet-started event on its own, where staff who
              can edit events get "Go live now" to start it early. */}
          {(otherLiveEvent || selectedEventUpcoming) && (
            <div
              className="stat-card"
              style={{
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                background: "rgb(var(--amber-500-rgb) / 0.08)",
                border: "1.5px solid rgb(var(--amber-500-rgb) / 0.35)",
              }}
            >
              <AlertCircle size={20} color="var(--amber-500)" style={{ flexShrink: 0 }} />
              {otherLiveEvent && (
              <p style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                {lang === "th"
                  ? `กิจกรรมที่เลือกอยู่ไม่ได้กำลังจัดอยู่ตอนนี้ ในขณะที่ "${otherLiveEvent.title}" กำลังดำเนินการอยู่ — ต้องการเปลี่ยนไหม?`
                  : lang === "cn"
                  ? `当前选中的活动现在并未进行，而「${otherLiveEvent.title}」正在进行中 — 要切换吗？`
                  : lang === "mm"
                  ? `ရွေးထားသော ပွဲသည် အခုလက်ရှိ ကျင်းပနေခြင်း မဟုတ်ပါ၊ "${otherLiveEvent.title}" မှာ ကျင်းပနေဆဲဖြစ်သည် — ပြောင်းလိုပါသလား?`
                  : `The selected event isn't live right now — "${otherLiveEvent.title}" is. Did you mean to pick that one?`}
              </p>
              )}
              {!otherLiveEvent && selectedEvent && (
              <p style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                {lang === "th"
                  ? `กิจกรรมนี้ยังไม่เริ่ม — เริ่มเวลา ${fmtClock(selectedEvent.startTime)} น.`
                  : lang === "cn"
                  ? `该活动尚未开始 — 开始时间 ${fmtClock(selectedEvent.startTime)}`
                  : lang === "mm"
                  ? `ဤပွဲ မစတင်သေးပါ — ${fmtClock(selectedEvent.startTime)} တွင် စတင်မည်`
                  : `This event hasn't started yet — it starts at ${fmtClock(selectedEvent.startTime)}.`}
              </p>
              )}
              {otherLiveEvent && (
              <button
                type="button"
                onClick={() => {
                  setEventId(otherLiveEvent.id);
                  setSessionId(pickCurrentSessionId(otherLiveEvent.sessions));
                }}
                className="btn btn-primary"
                style={{ padding: "8px 16px", fontSize: 12, flexShrink: 0, background: "var(--amber-500)", border: "none" }}
              >
                {lang === "th" ? "เปลี่ยนไปกิจกรรมที่กำลังจัดอยู่" : lang === "cn" ? "切换到进行中的活动" : lang === "mm" ? "ကျင်းပနေသော ပွဲသို့ ပြောင်းရန်" : "Switch to live event"}
              </button>
              )}
              {canGoLiveNow && !goLiveConfirming && (
                <button
                  type="button"
                  onClick={() => { setGoLiveConfirmFor(eventId); setGoLiveError(null); }}
                  className="btn btn-ghost"
                  style={{ padding: "8px 16px", fontSize: 12, flexShrink: 0, border: "1.5px solid var(--amber-500)", color: "var(--amber-700)" }}
                >
                  {lang === "th" ? "เริ่มกิจกรรมนี้ตอนนี้" : lang === "cn" ? "立即开始此活动" : lang === "mm" ? "ဤပွဲကို ယခု စတင်ရန်" : "Go live now"}
                </button>
              )}
              {canGoLiveNow && goLiveConfirming && selectedEvent && (
                <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <p style={{ flex: 1, minWidth: 200, fontSize: 12, color: "var(--text-secondary)" }}>
                    {lang === "th"
                      ? `เปลี่ยนเวลาเริ่มของ "${selectedEvent.title}" จาก ${fmtClock(selectedEvent.startTime)} น. เป็นตอนนี้ใช่ไหม? ระบบจะบันทึกไว้ใน Audit log`
                      : lang === "cn"
                      ? `将「${selectedEvent.title}」的开始时间从 ${fmtClock(selectedEvent.startTime)} 改为现在？此操作会记录在审计日志中。`
                      : lang === "mm"
                      ? `"${selectedEvent.title}" ၏ စတင်ချိန်ကို ${fmtClock(selectedEvent.startTime)} မှ ယခုသို့ ပြောင်းမည်လား? Audit log တွင် မှတ်တမ်းတင်ပါမည်။`
                      : `Move "${selectedEvent.title}"'s start time from ${fmtClock(selectedEvent.startTime)} to now? This is recorded in the audit log.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setGoLiveConfirmFor(null)}
                    disabled={goLiveBusy}
                    className="btn btn-ghost"
                    style={{ padding: "8px 14px", fontSize: 12, flexShrink: 0 }}
                  >
                    {lang === "th" ? "ยกเลิก" : lang === "cn" ? "取消" : lang === "mm" ? "မလုပ်တော့ပါ" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={goLiveNow}
                    disabled={goLiveBusy}
                    className="btn btn-primary"
                    style={{ padding: "8px 16px", fontSize: 12, flexShrink: 0, background: "var(--amber-500)", border: "none", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {goLiveBusy && <Loader2 size={14} className="animate-spin" />}
                    {lang === "th" ? "ยืนยัน เริ่มเลย" : lang === "cn" ? "确认开始" : lang === "mm" ? "အတည်ပြု၍ စတင်ရန်" : "Confirm, go live"}
                  </button>
                </div>
              )}
              {goLiveErrorMsg && (
                <p role="alert" style={{ flexBasis: "100%", fontSize: 12, fontWeight: 600, color: "var(--red-500)" }}>{goLiveErrorMsg}</p>
              )}
            </div>
          )}

          {/* Session (Day) Selector — only shown for multi-session events */}
          {(() => {
            const ev = events.find((e) => e.id === eventId);
            const sessions = sortedSessions(ev?.sessions);
            if (sessions.length <= 1) return null;
            const dayWord = t.scanDayLabel || "Day";
            const fmtDate = (iso: string) =>
              new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", {
                timeZone: "Asia/Bangkok",
                day: "numeric",
                month: "short",
              });
            const labelFor = (s: EventSession, i: number) => s.title?.trim() || `${dayWord} ${i + 1}`;
            const selectedIdx = sessions.findIndex((s) => s.id === sessionId);
            const selected = selectedIdx >= 0 ? sessions[selectedIdx] : sessions[0];
            return (
              <div
                className="stat-card flex items-center gap-4"
                style={{ padding: 24, position: "relative", zIndex: dayDropdownOpen ? 10 : 1 }}
              >
                <div style={{ width: 48, height: 48, background: "var(--bg-elevated)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Calendar size={24} color="var(--accent-primary)" />
                </div>
                <div style={{ flex: 1, minWidth: 0, position: "relative" }} ref={dayDropdownRef}>
                  <label className="label" style={{ marginBottom: 4, display: "block", fontSize: 12, color: "var(--text-muted)" }}>
                    {(t.scanSessionLabel || "Day / Session").toUpperCase()}
                  </label>
                  <button
                    type="button"
                    onClick={() => setDayDropdownOpen(!dayDropdownOpen)}
                    style={{
                      width: "100%",
                      fontSize: 18,
                      fontWeight: 700,
                      padding: "4px 0",
                      border: "none",
                      background: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      color: "var(--text-primary)",
                    }}
                  >
                    <span style={{ flex: 1, overflowWrap: "break-word", wordBreak: "break-word", whiteSpace: "normal" }}>
                      {selected ? `${labelFor(selected, selectedIdx >= 0 ? selectedIdx : 0)} — ${fmtDate(selected.startTime)}` : ""}
                    </span>
                    <ChevronDown
                      size={18}
                      style={{
                        flexShrink: 0,
                        opacity: 0.6,
                        transform: dayDropdownOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }}
                    />
                  </button>

                  {dayDropdownOpen && (
                    <div style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 50,
                      marginTop: 8,
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "0 10px 25px -5px rgb(var(--shadow-rgb) / 0.1), 0 8px 10px -6px rgb(var(--shadow-rgb) / 0.1)",
                      maxHeight: 240,
                      overflowY: "auto",
                      padding: 4,
                    }}>
                      {sessions.map((s, i) => {
                        const isSelected = s.id === sessionId;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSessionId(s.id);
                              setDayDropdownOpen(false);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 14px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: 15,
                              fontWeight: isSelected ? 700 : 500,
                              background: isSelected ? "var(--bg-elevated)" : "transparent",
                              color: isSelected ? "var(--accent-primary)" : "var(--text-primary)",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              transition: "background 0.15s, color 0.15s",
                              overflowWrap: "break-word",
                              wordBreak: "break-word",
                              whiteSpace: "normal",
                            }}
                            onMouseEnter={(event) => {
                              if (event.currentTarget.style.background !== "var(--bg-elevated)") {
                                event.currentTarget.style.background = "var(--bg-glass)";
                              }
                            }}
                            onMouseLeave={(event) => {
                              if (event.currentTarget.style.background !== "var(--bg-elevated)") {
                                event.currentTarget.style.background = "transparent";
                              }
                            }}
                          >
                            <span style={{ flex: 1 }}>{labelFor(s, i)} — {fmtDate(s.startTime)}</span>
                            {isSelected && <CheckCircle2 size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* QR Camera Box — the shared viewfinder (square, white scan guide) so
              check-in matches the prize, shop and tag cameras; it was the one
              reader with its own wide black box and no guide. */}
          <div className={viewfinderStyles.viewfinder}>
            <div id="qr-reader" className={viewfinderStyles.reader} />
            {isScanning && <div className={viewfinderStyles.scanGuide} aria-hidden="true" />}
            
            {/* 1. Loading Events State */}
            {loadingEvents && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--black)", color: "var(--text-on-color)", gap: 16 }}>
                <div className="spinner" />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{t.eventLoadingLabel}</p>
              </div>
            )}

            {/* 2. Events Fetch Error State */}
            {(!loadingEvents && eventsError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgb(var(--scrim-rgb) / 0.95)", color: "var(--text-on-color)", padding: 40, textAlign: "center" }}>
                <AlertCircle size={48} color="var(--red-500)" style={{ marginBottom: 16 }} />
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Failed to Load Events</p>
                <p style={{ fontSize: 14, color: "var(--slate-400)", marginBottom: 24 }}>{eventsError}</p>
                <button 
                    className="btn btn-primary" 
                    style={{ borderRadius: 12 }}
                    onClick={() => window.location.reload()}
                >
                    <RotateCcw size={16} /> Retry Connection
                </button>
              </div>
            )}

            {/* 3. Empty Events State */}
            {(!loadingEvents && !eventsError && events.length === 0) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--slate-800-fill)", color: "var(--text-on-color)", padding: 24, textAlign: "center", gap: 16 }}>
                <AlertCircle size={48} color="var(--amber-500)" />
                <p style={{ fontSize: 16, fontWeight: 700 }}>No Events Available</p>
                <p style={{ fontSize: 14, color: "var(--slate-300)", maxWidth: 320, lineHeight: 1.5 }}>
                  You must define at least one event in the database before you can scan student QR codes.
                </p>
                <a href="/admin/events" className="btn btn-primary" style={{ borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px" }}>
                  <Plus size={16} /> Create Event
                </a>
              </div>
            )}

            {/* 4. Scanner Loading State (when we have events but scanner has not started yet and no error) */}
            {(!loadingEvents && !eventsError && events.length > 0 && !isScanning && !scannerError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--black)", color: "var(--text-on-color)", gap: 16 }}>
                <div className="spinner" />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{t.eventLoadingLabel}</p>
              </div>
            )}

            {/* 5. Scanner Startup Error State */}
            {(!loadingEvents && !eventsError && events.length > 0 && scannerError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgb(var(--scrim-rgb) / 0.9)", color: "var(--text-on-color)", padding: 40, textAlign: "center" }}>
                <AlertCircle size={48} color="var(--red-500)" style={{ marginBottom: 16 }} />
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{t.scanError}</p>
                <p style={{ fontSize: 14, color: "var(--slate-400)", marginBottom: 24 }}>{scannerError}</p>
                <button 
                    className="btn btn-primary" 
                    style={{ borderRadius: 12 }}
                    onClick={startScanner}
                >
                    <RotateCcw size={16} /> {t.refresh}
                </button>
              </div>
            )}

            {/* Always-visible "scanning for" reminder — the actual bug being fixed here
                is staff watching the camera and never noticing the event dropdown
                above was left on the wrong event. Amber when the selected event isn't
                currently live, so a stale selection is visually obvious mid-scan too. */}
            {isScanning && selectedEvent && (() => {
              const sessions = sortedSessions(selectedEvent.sessions);
              const selectedSessionIdx = sessions.findIndex((s) => s.id === sessionId);
              const dayLabel = sessions.length > 1
                ? (sessions[selectedSessionIdx]?.title?.trim() || `${t.scanDayLabel || "Day"} ${selectedSessionIdx + 1}`)
                : null;
              return (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none" }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    background: selectedEventIsLive ? "rgb(var(--scrim-rgb) / 0.55)" : "rgb(var(--amber-700-rgb) / 0.75)",
                    padding: "8px 14px",
                    backdropFilter: "blur(4px)",
                  }}>
                    <span style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--text-on-color)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      <Calendar size={13} style={{ flexShrink: 0, opacity: 0.85 }} />
                      {selectedEvent.title}
                      {dayLabel && <span style={{ opacity: 0.75, fontWeight: 600 }}>· {dayLabel}</span>}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div className="animate-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--emerald-500)" }} />
                        <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-on-color)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.scanningActive}</span>
                      </div>
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
  );
}
