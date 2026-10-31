"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Calendar, ChevronDown, Download, Keyboard, Loader2, Plus, ScanLine, Users, WifiOff } from "lucide-react";
import viewfinderStyles from "@/components/admin/QrViewfinder.module.css";
import { EmptyState, ErrorState, LoadingState, Modal, StatusBadge } from "@/components/admin/ui";
import { type EventSession, sortedSessions, pickCurrentSessionId, isEventLive, sortedForScanner, LiveBadge } from "./scanner-parts";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

// Browser connectivity as an external store, so the offline banner updates the
// moment the phone loses signal (no polling, no setState-in-effect).
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** Moves the keyboard to the manual lookup (the fallback when the camera can't be used). */
function focusManualInput() {
  const el = document.querySelector<HTMLInputElement>("[data-scanner-manual]");
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus();
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  background: "var(--bg-surface)",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
};

// A big, full-width selector card. The whole card is the tap target, so the
// current choice is always readable and changing it is one easy tap.
const selectorStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 56,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 4px 10px 0",
  background: "none",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  color: "var(--text-primary)",
  font: "inherit",
};

const changePillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
  minHeight: 36,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid var(--border-medium)",
  background: "var(--bg-elevated)",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text-primary)",
};

export function ScannerMainColumn({ ctx }: { ctx: ScannerScreenCtx }) {
  const { canGoLiveNow, checkedInCount, countError, dayDropdownOpen, dropdownOpen, eventId, events, eventsError, fmtClock, goLiveBusy, goLiveConfirming, goLiveErrorMsg, goLiveNow, isScanning, lang, lastScan, loadingEvents, otherLiveEvent, retryLoadEvents, scannerError, selectedEvent, selectedEventIsLive, selectedEventUpcoming, sessionId, setDayDropdownOpen, setDropdownOpen, setEventId, setGoLiveConfirmFor, setGoLiveError, setSessionId, startScanner, t } = ctx;
  const online = useOnline();
  const locale = lang === "th" ? "th-TH" : "en-GB";
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });

  const sessions = sortedSessions(selectedEvent?.sessions);
  const dayWord = t.scanDayLabel || "Day";
  const labelFor = (s: EventSession, i: number) => s.title?.trim() || `${dayWord} ${i + 1}`;
  const selectedSessionIdx = sessions.findIndex((s) => s.id === sessionId);
  const selectedSession = selectedSessionIdx >= 0 ? sessions[selectedSessionIdx] : sessions[0];
  const dayLabel = sessions.length > 1 && selectedSession ? labelFor(selectedSession, Math.max(selectedSessionIdx, 0)) : null;

  const pickEvent = (id: string, evSessions?: EventSession[]) => {
    setEventId(id);
    setSessionId(pickCurrentSessionId(evSessions));
  };

  const camReady = !loadingEvents && !eventsError && events.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Offline: scans cannot be recorded. Say so loudly, before a student is turned away. */}
      {!online && (
        <div className="adm-inline-alert adm-inline-alert-error" role="alert" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <WifiOff size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontWeight: 700 }}>{t.adminScnOffline}</p>
            <p>{t.adminScnOfflineBody}</p>
          </div>
        </div>
      )}

      {/* Current event + day: always visible, the first thing staff read. */}
      <section aria-label={t.adminScnScanningFor} className="stat-card" style={{ padding: "4px 16px", borderColor: selectedEvent && !selectedEventIsLive ? "var(--amber-500)" : undefined }}>
        <button
          type="button"
          style={selectorStyle}
          onClick={() => setDropdownOpen(true)}
          disabled={events.length === 0}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Calendar size={20} color="var(--accent-primary)" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.adminScnScanningFor}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 18, fontWeight: 800, lineHeight: 1.4, overflowWrap: "anywhere" }}>
              {selectedEvent?.title || t.adminScnNoEventSelected}
              {selectedEventIsLive && <LiveBadge label={t.statusLive} />}
            </span>
          </span>
          {events.length > 0 && (
            <span style={changePillStyle}>
              {t.adminScnChange}
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          )}
        </button>

        {sessions.length > 1 && selectedSession && (
          <button
            type="button"
            style={{ ...selectorStyle, borderTop: "1px solid var(--border-subtle)" }}
            onClick={() => setDayDropdownOpen(true)}
            aria-haspopup="dialog"
          >
            <span aria-hidden="true" style={{ width: 40, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.scanSessionLabel || "Day / Session"}</span>
              <span style={{ display: "block", fontSize: 16, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {dayLabel} · {fmtDate(selectedSession.startTime)}
              </span>
            </span>
            <span style={changePillStyle}>
              {t.adminScnChange}
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </button>
        )}
      </section>

      {/* Wrong-event nudge — the selected event isn't live but a different one
          is, right now. This is the exact "forgot to switch the event" mistake
          staff have hit before, so call it out with a one-tap fix. Also shown
          for a not-yet-started event, where staff who can edit events get
          "Go live now" to start it early. */}
      {(otherLiveEvent || selectedEventUpcoming) && (
        <div className="adm-inline-alert adm-inline-alert-warning" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {otherLiveEvent && (
            <p style={{ fontWeight: 700 }}>
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
            <p style={{ fontWeight: 700 }}>
              {lang === "th"
                ? `กิจกรรมนี้ยังไม่เริ่ม — เริ่มเวลา ${fmtClock(selectedEvent.startTime)} น.`
                : lang === "cn"
                ? `该活动尚未开始 — 开始时间 ${fmtClock(selectedEvent.startTime)}`
                : lang === "mm"
                ? `ဤပွဲ မစတင်သေးပါ — ${fmtClock(selectedEvent.startTime)} တွင် စတင်မည်`
                : `This event hasn't started yet — it starts at ${fmtClock(selectedEvent.startTime)}.`}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {otherLiveEvent && (
              <button
                type="button"
                onClick={() => pickEvent(otherLiveEvent.id, otherLiveEvent.sessions)}
                className="btn btn-primary"
                style={{ minHeight: 44 }}
              >
                {lang === "th" ? "เปลี่ยนไปกิจกรรมที่กำลังจัดอยู่" : lang === "cn" ? "切换到进行中的活动" : lang === "mm" ? "ကျင်းပနေသော ပွဲသို့ ပြောင်းရန်" : "Switch to live event"}
              </button>
            )}
            {canGoLiveNow && !goLiveConfirming && (
              <button
                type="button"
                onClick={() => { setGoLiveConfirmFor(eventId); setGoLiveError(null); }}
                className="btn btn-ghost"
                style={{ minHeight: 44 }}
              >
                {lang === "th" ? "เริ่มกิจกรรมนี้ตอนนี้" : lang === "cn" ? "立即开始此活动" : lang === "mm" ? "ဤပွဲကို ယခု စတင်ရန်" : "Go live now"}
              </button>
            )}
          </div>
          {canGoLiveNow && goLiveConfirming && selectedEvent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p>
                {lang === "th"
                  ? `เปลี่ยนเวลาเริ่มของ "${selectedEvent.title}" จาก ${fmtClock(selectedEvent.startTime)} น. เป็นตอนนี้ใช่ไหม? ระบบจะบันทึกไว้ใน Audit log`
                  : lang === "cn"
                  ? `将「${selectedEvent.title}」的开始时间从 ${fmtClock(selectedEvent.startTime)} 改为现在？此操作会记录在审计日志中。`
                  : lang === "mm"
                  ? `"${selectedEvent.title}" ၏ စတင်ချိန်ကို ${fmtClock(selectedEvent.startTime)} မှ ယခုသို့ ပြောင်းမည်လား? Audit log တွင် မှတ်တမ်းတင်ပါမည်။`
                  : `Move "${selectedEvent.title}"'s start time from ${fmtClock(selectedEvent.startTime)} to now? This is recorded in the audit log.`}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" onClick={() => setGoLiveConfirmFor(null)} disabled={goLiveBusy} className="btn btn-ghost" style={{ minHeight: 44 }}>
                  {t.adminUiCancel}
                </button>
                <button type="button" onClick={goLiveNow} disabled={goLiveBusy} className="btn btn-primary" style={{ minHeight: 44 }}>
                  {goLiveBusy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  {lang === "th" ? "ยืนยัน เริ่มเลย" : lang === "cn" ? "确认开始" : lang === "mm" ? "အတည်ပြု၍ စတင်ရန်" : "Confirm, go live"}
                </button>
              </div>
            </div>
          )}
          {goLiveErrorMsg && (
            <p role="alert" style={{ fontWeight: 700, color: "var(--red-600)" }}>{goLiveErrorMsg}</p>
          )}
        </div>
      )}

      {/* QR camera — the shared viewfinder (square, white scan guide) so
          check-in matches the prize, shop and tag cameras. */}
      <div className={viewfinderStyles.viewfinder}>
        <div id="qr-reader" className={viewfinderStyles.reader} />
        {isScanning && <div className={viewfinderStyles.scanGuide} aria-hidden="true" />}

        {/* 1. Loading events */}
        {loadingEvents && (
          <div style={overlayStyle}>
            <LoadingState label={t.adminScnLoadingEvents} compact />
          </div>
        )}

        {/* 2. Events failed to load */}
        {!loadingEvents && eventsError && (
          <div style={overlayStyle}>
            <ErrorState compact title={t.adminScnEventsErrorTitle} message={eventsError} onRetry={retryLoadEvents} />
          </div>
        )}

        {/* 3. No events at all */}
        {!loadingEvents && !eventsError && events.length === 0 && (
          <div style={overlayStyle}>
            <EmptyState
              compact
              title={t.adminScnNoEventsTitle}
              description={t.adminScnNoEventsBody}
              action={
                <Link href="/admin/events" className="btn btn-primary" style={{ minHeight: 44 }}>
                  <Plus size={16} aria-hidden="true" /> {t.adminScnCreateEvent}
                </Link>
              }
            />
          </div>
        )}

        {/* 4. Camera starting */}
        {camReady && !isScanning && !scannerError && (
          <div style={overlayStyle}>
            <LoadingState label={t.adminScnCamStarting} compact />
          </div>
        )}

        {/* 5. Camera failed (permission denied, no camera, in use…): explain + retry + manual fallback */}
        {camReady && scannerError && (
          <div style={overlayStyle}>
            <ErrorState compact title={t.adminScnCamErrorTitle} message={scannerError} onRetry={startScanner} />
            <button type="button" className="btn btn-primary" style={{ minHeight: 44, marginBottom: 8 }} onClick={focusManualInput}>
              <Keyboard size={16} aria-hidden="true" /> {t.adminScnUseManual}
            </button>
          </div>
        )}

        {/* Always-visible "scanning for" reminder on the camera itself, so a stale
            event selection is obvious mid-scan. Amber when the event isn't live. */}
        {isScanning && selectedEvent && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 2 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background: selectedEventIsLive ? "rgb(var(--scrim-rgb) / 0.65)" : "rgb(var(--amber-700-rgb) / 0.85)",
                padding: "8px 14px",
                backdropFilter: "blur(4px)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--text-on-color)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Calendar size={14} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.85 }} />
                {selectedEvent.title}
                {dayLabel && <span style={{ opacity: 0.8, fontWeight: 600 }}>· {dayLabel}</span>}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span className="animate-pulse" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--emerald-500)" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-on-color)" }}>{t.scanningActive}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* System status: live count + the last scan outcome. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div className="adm-stat" style={{ padding: 16 }}>
          <div className="adm-stat-top">
            <p className="adm-stat-label">{t.adminScnCheckedIn}</p>
            <span className="adm-stat-icon adm-tone-success" aria-hidden="true"><Users size={18} /></span>
          </div>
          <p className="adm-stat-value" aria-live="polite" style={{ fontSize: 32 }}>{checkedInCount ?? "—"}</p>
          <p className="adm-stat-hint" style={{ color: countError ? "var(--red-600)" : undefined, fontWeight: countError ? 700 : undefined }}>
            {countError ? t.adminScnCountStale : t.adminScnCountHint}
          </p>
        </div>

        <div className="adm-stat" style={{ padding: 16 }}>
          <div className="adm-stat-top">
            <p className="adm-stat-label">{t.adminScnLastScan}</p>
            <span className="adm-stat-icon adm-tone-neutral" aria-hidden="true"><ScanLine size={18} /></span>
          </div>
          {lastScan ? (
            <>
              <p style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, overflowWrap: "anywhere" }}>{lastScan.name ?? lastScan.title}</p>
              <p className="adm-stat-hint">
                {lastScan.studentId ? `${lastScan.studentId} · ` : ""}{fmtClock(new Date(lastScan.at).toISOString())}
              </p>
              <div><StatusBadge tone={lastScan.tone}>{lastScan.title}</StatusBadge></div>
            </>
          ) : (
            <p className="adm-stat-hint">{t.adminScnLastScanNone}</p>
          )}
        </div>
      </div>

      {eventId && (
        <a
          href={`/api/admin/events/${eventId}/report`}
          download
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start", minHeight: 44 }}
        >
          <Download size={16} aria-hidden="true" />
          {t.adminScnDownloadReport}
        </a>
      )}

      {/* Event picker. A sheet on phones: big rows, Escape and swipe-free dismissal. */}
      <Modal
        open={dropdownOpen && events.length > 0}
        onClose={() => setDropdownOpen(false)}
        size="sm"
        title={t.adminScnPickEvent}
        description={t.adminScnPickEventDesc}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedForScanner(events).map((e) => {
            const isSelected = e.id === eventId;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => { pickEvent(e.id, e.sessions); setDropdownOpen(false); }}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    padding: "10px 14px",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 14,
                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    background: isSelected ? "var(--bg-elevated)" : "var(--bg-surface)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 16, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                      {e.title}
                      {isEventLive(e) && <LiveBadge label={t.statusLive} small />}
                    </span>
                    <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                      {fmtDate(e.startTime)} · {fmtClock(e.startTime)}–{fmtClock(e.endTime)}
                    </span>
                  </span>
                  {isSelected && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: "var(--accent-primary)", flexShrink: 0 }}>
                      <CheckCircle2 size={18} aria-hidden="true" /> {t.adminScnSelected}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>

      {/* Day / session picker (multi-day events only) */}
      <Modal
        open={dayDropdownOpen && sessions.length > 1}
        onClose={() => setDayDropdownOpen(false)}
        size="sm"
        title={t.adminScnPickDay}
        description={t.adminScnPickDayDesc}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s, i) => {
            const isSelected = s.id === (selectedSession?.id ?? sessionId);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => { setSessionId(s.id); setDayDropdownOpen(false); }}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    padding: "10px 14px",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 14,
                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    background: isSelected ? "var(--bg-elevated)" : "var(--bg-surface)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                    {labelFor(s, i)} · {fmtDate(s.startTime)}
                  </span>
                  {isSelected && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: "var(--accent-primary)", flexShrink: 0 }}>
                      <CheckCircle2 size={18} aria-hidden="true" /> {t.adminScnSelected}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}
