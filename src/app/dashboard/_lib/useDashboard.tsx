"use client";

import { loginHref } from "@/lib/util/safe-callback-url";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { usePolling } from "@/lib/hooks/usePolling";
import { useQrToken } from "@/lib/hooks/useQrToken";
import { Calendar, CalendarClock, CheckCircle2, Trophy, Users, DoorOpen } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useRouter } from "next/navigation";
import { NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import { eventRef, matchesEventRef } from "@/lib/events/event-slug";
import { type Event, type HouseItem } from "../_components/dashboard-parts";

// State, effects and handlers for DashboardClient.tsx. Moved out of the page
// component so its JSX can be split into section components that read from
// this hook's result (passed down as `ctx`).
export function useDashboard({ initialSession }: { initialSession: Session | null }) {
  const router = useRouter();

  const { data: sessionData, status: sessionStatus } = useSession();

  const session = sessionData || initialSession;

  const status = sessionStatus !== "loading"
    ? sessionStatus
    : (initialSession ? "authenticated" : "loading");

  const { t, lang } = useLanguage();

  const [events, setEvents] = useState<Event[]>([]);

  const [loadingEvents, setLoadingEvents] = useState(true);

  // How the events section is rendered. "grid" is the action-first card grid
  // (upcoming only, default). "timeline" is the at-a-glance agenda — every event,
  // past included, grouped by Today / This Week / Upcoming / Past.
  const [eventView, setEventView] = useState<"grid" | "timeline">("grid");

  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const [errorModal, setErrorModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({
    show: false,
    title: "",
    message: "",
  });

  const [successModal, setSuccessModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    type?: "success" | "info";
  }>({
    show: false,
    title: "",
    message: "",
    type: "success",
  });

  // Confirmation gate for cancelling a registration. Un-registering is
  // destructive (the seat is released and may be taken), so we ask the user to
  // confirm before firing the DELETE. New sign-ups skip this and register directly.
  const [confirmUnregister, setConfirmUnregister] = useState<{
    show: boolean;
    eventId: string;
    eventTitle: string;
    // True when the student has already submitted this event's pre-test, so the
    // confirm dialog can warn that cancelling will discard it (un-registering
    // clears an un-awarded K_pre submission and forces a retake on re-register).
    losesPreTest: boolean;
  }>({ show: false, eventId: "", eventTitle: "", losesPreTest: false });

  // Pre-test gate. Shown right after registering for an event whose K_pre form is
  // open and not yet completed, so the student is pushed straight into the
  // pre-test (rendered on the history page, which is deep-linked here).
  const [preTestModal, setPreTestModal] = useState<{
    show: boolean;
    eventId: string;
    formId: string;
    eventTitle: string;
  }>({ show: false, eventId: "", formId: "", eventTitle: "" });

  const [houses, setHouses] = useState<HouseItem[]>([]);

  const [loadingHouses, setLoadingHouses] = useState(true);

  // Admin-editable dashboard announcement. null = not loaded yet or fetch failed
  // → fall back to the built-in text so the banner never disappears unexpectedly.
  const [announcement, setAnnouncement] = useState<{ body: string; enabled: boolean } | null>(null);

  // No-show strike-out (US-STRI-15c): the student's own strike count / block
  // state, polled alongside events/houses so the badge and the blocked notice
  // stay live if staff apply or reset strikes while the dashboard is open.
  const [strikes, setStrikes] = useState<{ noShowCount: number; registrationBlocked: boolean } | null>(null);

  // The student's authoritative individual balance (users.points) — the same number
  // the leaderboard ranks on. Read from the same /api/profile poll as strikes.
  const [myPoints, setMyPoints] = useState<number | null>(null);

  // Which events caused the strikes currently on the account (US-STRI-15c),
  // each carrying its OWN appeal (if any) — appeals are per-event, not one
  // blanket appeal for the account, so a student with 2 strikes can appeal
  // just one of them and leave the other untouched.
  type NoShowEvent = {
    id: string;
    title: string;
    endTime: string;
    appeal: { id: string; status: "pending" | "approved" | "rejected"; message: string; reviewNote: string | null; createdAt: string } | null;
  };

  const [noShowEvents, setNoShowEvents] = useState<NoShowEvent[]>([]);

  const [appealModal, setAppealModal] = useState<{ eventId: string; eventTitle: string } | null>(null);

  const [appealMessage, setAppealMessage] = useState("");

  const [submittingAppeal, setSubmittingAppeal] = useState(false);

  // Fullscreen poster viewer — carries the whole poster list + which one was tapped
  // so the user can keep swiping at full size.
  const [previewImage, setPreviewImage] = useState<{ posters: string[]; index: number } | null>(null);

  // The open event-preview modal, tracked by id rather than the event object so the
  // URL stays the single source of truth (and a /dashboard?event=<id> deep-link can
  // seed it before the events list has loaded). previewEvent is derived from this id
  // below. Seeded once from the address bar via a lazy initializer — SSR-guarded, and
  // safe against hydration mismatch because the events list is empty on first render,
  // so the modal renders closed on both server and client regardless of the id.
  const [previewEventId, setPreviewEventId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("event")
  );

  // Whether the in-modal "Copy link" button just copied, so we can flash a
  // "Copied!" confirmation for a moment.
  const [linkCopied, setLinkCopied] = useState(false);

  // The event preview modal is shareable: its open/closed state is mirrored in the
  // URL as /dashboard?event=<id>, so a student (or an organizer) can copy the
  // address bar — or hit the in-modal "Copy link" — and send a direct link to one
  // event. openPreview pushes a history entry so the phone/browser Back button
  // closes the modal instead of leaving the dashboard; closePreview unwinds it.
  const openPreview = (e: Event) => {
    setLinkCopied(false);
    setPreviewEventId(e.id);
    // The address bar carries the short, readable ref (owner's custom link name, or
    // title + id prefix); the full id is still accepted when a link arrives with it.
    const ref = eventRef(e.id, e.title, e.shortSlug);
    const current = new URLSearchParams(window.location.search).get("event");
    if (current !== ref) {
      window.history.pushState({ event: e.id }, "", `${window.location.pathname}?event=${encodeURIComponent(ref)}`);
    }
  };

  const closePreview = () => {
    setLinkCopied(false);
    if (window.history.state?.event) {
      // We pushed this entry when opening — pop it so Back history stays clean.
      // The popstate handler below clears previewEventId once the param is gone.
      window.history.back();
    } else {
      // Landed straight on a shared ?event= link (no pushed entry of our own) —
      // strip the param in place instead of navigating off the site.
      window.history.replaceState(null, "", window.location.pathname);
      setPreviewEventId(null);
    }
  };

  // Drive the modal from Back/Forward: when the URL's ?event= changes or clears via
  // history navigation, mirror it into previewEventId. setState here is fine — it
  // runs inside an event-listener callback, not synchronously in the effect body.
  useEffect(() => {
    const onPop = () => {
      setLinkCopied(false);
      setPreviewEventId(new URLSearchParams(window.location.search).get("event"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A link that arrived with the full id (or a stale ref) is rewritten in place to the
  // short ref once the events list has loaded, so the address bar always reads short.
  useEffect(() => {
    if (!previewEventId) return;
    const match = events.find((e) => matchesEventRef(e, previewEventId));
    if (!match) return;
    const ref = eventRef(match.id, match.title, match.shortSlug);
    const current = new URLSearchParams(window.location.search).get("event");
    if (current && current !== ref) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?event=${encodeURIComponent(ref)}`);
    }
  }, [events, previewEventId]);

  const HOUSE_MAP: Record<string, { name: string, color: string }> = {
    red:    { name: t.houseMom || "Mom",   color: "var(--red-500)" }, // Red
    green:  { name: t.houseTo || "To",      color: "var(--slate-400)" }, // White → silver/pewter
    yellow: { name: t.houseLuang || "Luang",  color: "var(--blue-500)" }, // Blue
    blue:   { name: t.houseMakara || "Makon", color: "var(--green-500)" }, // Green
  };

  const fetchEvents = (signal?: AbortSignal) =>
    fetch("/api/events", { signal })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setEvents(d); })
      .finally(() => setLoadingEvents(false));

  const fetchHouses = (signal?: AbortSignal) =>
    fetch("/api/houses", { signal })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHouses(d); })
      .finally(() => setLoadingHouses(false));

  const fetchAnnouncement = (signal?: AbortSignal) =>
    fetch("/api/announcement", { signal })
      .then((r) => r.json())
      .then((d) => { setAnnouncement(d && typeof d.body === "string" ? d : null); })
      .catch(() => {});

  const fetchStrikes = (signal?: AbortSignal) =>
    fetch("/api/profile", { signal })
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.noShowCount === "number") {
          setStrikes({ noShowCount: d.noShowCount, registrationBlocked: !!d.registrationBlocked });
        }
        if (d && typeof d.points === "number") setMyPoints(d.points);
      })
      .catch(() => {});

  const fetchAppeal = (signal?: AbortSignal) =>
    fetch("/api/appeals", { signal })
      .then((r) => r.json())
      .then((d) => {
        setNoShowEvents(Array.isArray(d?.noShowEvents) ? d.noShowEvents : []);
      })
      .catch(() => {});

  // Live check-in / score toasts. The student's primary scan surface is the
  // Digital ID page (immediate modal); here on the dashboard a gentle toast on
  // the same 60s cadence catches anything that happened while they were
  // elsewhere. The shared hook owns the fetch / dedup / last-seen bookkeeping.
  // Desktop / iPad students live on the dashboard (not the QR page), so surface the
  // same live check-in / score / pre-test modal here. Poll at 15s — responsive
  // enough to feel live, but gentler than the QR page's 4s since the dashboard
  // stays open on many devices (hidden tabs pause polling, bounding the load).
  const { items: notifItems, dismiss: dismissNotif } = useNotifications(session?.user?.id, 15000);

  // Poll events + leaderboard. Slow interval (60s) because this is student-facing
  // across potentially ~1,500 devices — at 20s a single event hour approaches the
  // Vercel free-tier invocation budget. Polling also avoids the Supabase free-tier
  // 200 concurrent-connection cap and pauses while the tab is hidden. Return the
  // combined promise so the poller awaits both and never stacks requests.
  usePolling((signal) => Promise.all([fetchEvents(signal), fetchHouses(signal), fetchAnnouncement(signal), fetchStrikes(signal), fetchAppeal(signal)]), 60000);

  const submitAppeal = async () => {
    if (!appealModal) return;
    setSubmittingAppeal(true);
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: appealModal.eventId, message: appealMessage.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorModal({
          show: true,
          title: t.registrationFailed,
          message: res.status === 409 ? t.appealAlreadyPendingMessage : (d?.error || t.appealSubmitFailedMessage),
        });
        return;
      }
      setAppealModal(null);
      setAppealMessage("");
      fetchAppeal();
    } catch {
      setErrorModal({ show: true, title: t.registrationFailed, message: t.appealSubmitFailedMessage });
    } finally {
      setSubmittingAppeal(false);
    }
  };

  const handleRegister = async (eventId: string, registered: boolean) => {
    if (!session?.user) {
      router.push(loginHref(window.location.pathname + window.location.search));
      return;
    }
    setRegisteringId(eventId);
    try {
      const method = registered ? "DELETE" : "POST";
      const res = await fetch(`/api/events/${eventId}/register`, { method });
      if (res.ok) {
        // POST returns the event's fresh pre-test state (DELETE does not). Using the
        // server value avoids the stale cached status on an un-register → re-register,
        // where the events list would still read "submitted" until the next poll.
        const data = await res.json().catch(() => ({}));
        // Full event: the student was queued instead of registered.
        if (!registered && data?.waitlisted) {
          const title = events.find((e) => e.id === eventId)?.title ?? "";
          setEvents((evts) => evts.map((e) => (e.id === eventId ? { ...e, waitlistPosition: data.position ?? null } : e)));
          setSuccessModal({
            show: true,
            title: t.waitlistJoinedTitle,
            message: t.waitlistJoinedMessage.replace("{n}", String(data.position ?? "")).replace("{title}", title),
            type: "info",
          });
          return;
        }
        // Cancelling while only queued: they left the waitlist.
        if (registered && data?.leftWaitlist) {
          const title = events.find((e) => e.id === eventId)?.title ?? "";
          setEvents((evts) => evts.map((e) => (e.id === eventId ? { ...e, waitlistPosition: null } : e)));
          setSuccessModal({
            show: true,
            title: t.waitlistLeftTitle,
            message: t.waitlistLeftMessage.replace("{title}", title),
            type: "info",
          });
          return;
        }
        const freshPreTest = data?.preTest as { formId: string; title: string; status: string } | null | undefined;
        const targetEvent = events.find(e => e.id === eventId);
        setEvents((evts) =>
          evts.map((e) => (e.id === eventId
            ? { ...e, isRegistered: !registered, ...(freshPreTest !== undefined ? { preTest: freshPreTest } : {}) }
            : e))
        );
        const eventTitle = targetEvent ? targetEvent.title : "";
        if (!registered) {
          // If this event has an open pre-test the student hasn't completed, push
          // them straight into it instead of the generic success modal.
          const pre = freshPreTest ?? targetEvent?.preTest;
          if (pre && pre.status === "open") {
            // finally still clears registeringId on this early return.
            setPreTestModal({ show: true, eventId, formId: pre.formId, eventTitle });
            return;
          }
          setSuccessModal({
            show: true,
            title: lang === "th" ? "ลงทะเบียนสำเร็จ!" : lang === "cn" ? "注册成功！" : lang === "mm" ? "မှတ်ပုံတင်ခြင်း အောင်မြင်သည်!" : "Registration Complete!",
            message: lang === "th"
              ? `คุณได้ลงทะเบียนเข้าร่วมกิจกรรม "${eventTitle}" เรียบร้อยแล้ว`
              : lang === "cn"
              ? `您已成功注册活动 "${eventTitle}"`
              : lang === "mm"
              ? `သင်သည် "${eventTitle}" လှုပ်ရှားမှုအတွက် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ`
              : `You have successfully registered for the event "${eventTitle}".`,
            type: "success"
          });
        } else {
          setSuccessModal({
            show: true,
            title: lang === "th" ? "ยกเลิกการลงทะเบียนสำเร็จ" : lang === "cn" ? "取消注册成功" : lang === "mm" ? "မှတ်ပုံတင်ခြင်း ပယ်ဖျက်ပြီးပါပြီ" : "Registration Cancelled",
            message: lang === "th"
              ? `คุณได้ยกเลิกการลงทะเบียนสำหรับกิจกรรม "${eventTitle}" เรียบร้อยแล้ว`
              : lang === "cn"
              ? `您已成功取消活动 "${eventTitle}" 的注册`
              : lang === "mm"
              ? `သင်သည် "${eventTitle}" လှုပ်ရှားမှုအတွက် မှတ်ပုံတင်ခြင်းကို အောင်မြင်စွာ ပယ်ဖျက်ပြီးပါပြီ`
              : `You have successfully cancelled your registration for the event "${eventTitle}".`,
            type: "info"
          });
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.registrationBlocked
          ? t.registrationBlockedMessage.replace("{n}", String(NO_SHOW_STRIKE_THRESHOLD))
          : errorData.error || t.registrationFailed;
        setErrorModal({
          show: true,
          title: t.registrationFailed,
          message: errorMsg
        });
      }
    } catch {
      // Network/parse failure — surface an error instead of leaving the button
      // spinning forever on an unhandled rejection.
      setErrorModal({
        show: true,
        title: t.registrationFailed,
        message: lang === "th"
          ? "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"
          : lang === "cn"
          ? "网络连接出错，请重试。"
          : lang === "mm"
          ? "ချိတ်ဆက်မှု အမှားအယွင်း ဖြစ်ပွားသည်။ ထပ်စမ်းကြည့်ပါ။"
          : "A network error occurred. Please try again."
      });
    } finally {
      // ALWAYS clear the spinner, whether we succeeded, failed, or threw.
      setRegisteringId(null);
    }
  };

  // Entry point for the register/cancel button. A cancel (registered === true)
  // is routed through a confirmation modal first; a new sign-up fires immediately.
  const promptRegister = (eventId: string, registered: boolean, eventTitle: string) => {
    if (!session?.user) {
      router.push(loginHref(window.location.pathname + window.location.search));
      return;
    }
    // Leaving the waitlist holds no seat or pre-test, so it skips the cancel-registration confirmation.
    const target = events.find((e) => e.id === eventId);
    if (registered && !target?.isRegistered && target?.waitlistPosition != null) {
      handleRegister(eventId, true);
      return;
    }
    if (registered) {
      const losesPreTest = events.find(e => e.id === eventId)?.preTest?.status === "submitted";
      setConfirmUnregister({ show: true, eventId, eventTitle, losesPreTest });
    } else {
      handleRegister(eventId, false);
    }
  };

  // Hooks must run on every render, before any early return (Rules of Hooks).
  // Seed from session?.user?.id directly — `user` is derived after the guard below.
  const { qrValue, countdownMM, countdownSS, countdownColor } = useQrToken(session?.user?.id);

  return {
    router,
    sessionData,
    sessionStatus,
    session,
    status,
    t,
    lang,
    events,
    setEvents,
    loadingEvents,
    setLoadingEvents,
    eventView,
    setEventView,
    registeringId,
    setRegisteringId,
    errorModal,
    setErrorModal,
    successModal,
    setSuccessModal,
    confirmUnregister,
    setConfirmUnregister,
    preTestModal,
    setPreTestModal,
    houses,
    setHouses,
    loadingHouses,
    setLoadingHouses,
    announcement,
    setAnnouncement,
    strikes,
    setStrikes,
    myPoints,
    setMyPoints,
    noShowEvents,
    setNoShowEvents,
    appealModal,
    setAppealModal,
    appealMessage,
    setAppealMessage,
    submittingAppeal,
    setSubmittingAppeal,
    previewImage,
    setPreviewImage,
    previewEventId,
    setPreviewEventId,
    linkCopied,
    setLinkCopied,
    openPreview,
    closePreview,
    HOUSE_MAP,
    fetchEvents,
    fetchHouses,
    fetchAnnouncement,
    fetchStrikes,
    fetchAppeal,
    notifItems,
    dismissNotif,
    submitAppeal,
    handleRegister,
    promptRegister,
    qrValue,
    countdownMM,
    countdownSS,
    countdownColor,
    initialSession,
  };
}


type BaseDashboardCtx = ReturnType<typeof useDashboard>;

// Values derived after the page's early-return guard. No hooks in here, so it
// is safe to call after the guard.
export function deriveDashboard(base: BaseDashboardCtx) {
  const { HOUSE_MAP, events, myPoints, previewEventId, session, t } = base;
  const user = session?.user;

  const houseId = user?.houseId ?? null;

  const houseInfo = houseId ? (HOUSE_MAP[houseId] ?? { name: "Unknown", color: "var(--text-muted)" }) : { name: t.unassigned, color: "var(--text-muted)" };

  // The event whose preview modal is open, derived from the URL-backed id. Resolves
  // once the events list has loaded; if the id isn't found (bad/stale link) the modal
  // simply stays closed.
  const previewEvent = previewEventId ? (events.find((e) => matchesEventRef(e, previewEventId)) ?? null) : null;

  const now = new Date();

  // Events that are either happening now or in the future
  const upcoming = events.filter((e) => new Date(e.endTime) >= now);

  const past = events.filter((e) => new Date(e.endTime) < now);

  const getEventStatus = (evt: Event) => {
    const dNow = new Date();
    const start = new Date(evt.startTime);
    const end = new Date(evt.endTime);
    
    // If start and end are same, it's a "point" event, don't show as LIVE
    if (start.getTime() === end.getTime()) {
      return dNow > end ? "past" : "upcoming";
    }

    if (dNow >= start && dNow <= end) return "live";
    if (dNow > end) return "past";
    return "upcoming";
  };

  // --- Timeline view: group every event into Today / This Week / Upcoming / Past. ---
  const startOfToday = new Date(now);

 startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);

 endOfToday.setHours(23, 59, 59, 999);

  const weekEnd = new Date(startOfToday);

 weekEnd.setDate(weekEnd.getDate() + 7);

  const timelineGroupOf = (e: Event): "today" | "week" | "later" | "past" => {
    const start = new Date(e.startTime);
    if (new Date(e.endTime) < now) return "past";
    if (start <= endOfToday) return "today"; // happening now, or starts later today
    if (start < weekEnd) return "week";
    return "later";
  };

  const byStartAsc = (a: Event, b: Event) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime();

  const byStartDesc = (a: Event, b: Event) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime();

  const timelineSections = [
    { key: "today", label: t.secToday, items: events.filter((e) => timelineGroupOf(e) === "today").sort(byStartAsc) },
    { key: "week", label: t.secThisWeek, items: events.filter((e) => timelineGroupOf(e) === "week").sort(byStartAsc) },
    { key: "later", label: t.secLater, items: events.filter((e) => timelineGroupOf(e) === "later").sort(byStartAsc) },
    // Past sorted most-recent-first so the freshly-ended events are at the top.
    { key: "past", label: t.secPast, items: events.filter((e) => timelineGroupOf(e) === "past").sort(byStartDesc) },
  ].filter((s) => s.items.length > 0);

  // --- Overview stats strip (logged-in students only). Counts are derived from the
  // events list. Points is the stored users.points balance (same as the leaderboard),
  // NOT a sum over events: that sum missed form-submission points, staff score
  // awards, per-day awards on multi-day events and no-show deductions, so it
  // drifted from the leaderboard. ---
  const thisWeekCount = upcoming.filter((e) => new Date(e.startTime) < weekEnd).length;

  const attendedEvents = events.filter((e) => e.attendanceStatus === "attended");

  const pointsEarned = myPoints ?? 0;

  const stats: { key: string; label: string; value: number; icon: typeof Calendar }[] = [
    { key: "upcoming", label: t.statUpcoming, value: upcoming.length, icon: Calendar },
    { key: "week", label: t.statThisWeek, value: thisWeekCount, icon: CalendarClock },
    { key: "attended", label: t.statAttended, value: attendedEvents.length, icon: CheckCircle2 },
    { key: "points", label: t.statPoints, value: pointsEarned, icon: Trophy },
  ];

  // Registration window row — shown when either open or close time is set.
  // Colour shifts to muted once the window has closed so it doesn't distract.
  const regWindowRow = (ev: Event) => {
    const openAt = ev.registrationOpenTime ? new Date(ev.registrationOpenTime) : null;
    const closeAt = ev.registrationCloseTime ? new Date(ev.registrationCloseTime) : null;
    if (!openAt && !closeAt) return null;

    const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
    const fmtDT = (d: Date) => `${d.toLocaleDateString('en-GB', dateOpts)} ${d.toLocaleTimeString('en-GB', timeOpts)}`;

    const closed = !!closeAt && new Date() > closeAt;
    const iconBg = closed ? "rgb(var(--ink-rgb) / 0.04)" : "rgb(var(--amber-500-rgb) / 0.08)";
    const iconColor = closed ? "var(--text-muted)" : "var(--amber-500)";

    let text: string;
    if (openAt && closeAt) {
      text = `${fmtDT(openAt)} – ${fmtDT(closeAt)}`;
    } else if (openAt) {
      text = `${t.regOpens}: ${fmtDT(openAt)}`;
    } else {
      text = `${t.regCloses}: ${fmtDT(closeAt!)}`;
    }

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor, flexShrink: 0 }}>
          <CalendarClock size={16} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.regWindowLabel}: </span>
          <span style={{ color: closed ? "var(--text-muted)" : "var(--text-secondary)" }}>{text}</span>
        </div>
      </div>
    );
  };

  // Quota + walk-in availability rows, shared by the event card and the preview
  // modal. Quota is hidden when unset (null = unlimited); the walk-in line always
  // shows so a student can tell at a glance whether the door accepts walk-ins.
  const quotaWalkInRows = (ev: Event) => {
    const allowed = !!ev.walkInsEnabled;
    const registered = ev.registeredCount ?? 0;
    // A quota of 0 means unlimited (mirrors the register route's own
    // `quota !== null && quota > 0` convention) — treat it exactly like null.
    const hasQuota = ev.quota != null && ev.quota > 0;
    // "Full" only means something when a quota is set. When full, colour the count
    // red so a student can see at a glance the seats are gone.
    const isFull = hasQuota && registered >= ev.quota!;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)", fontWeight: 600 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgb(var(--accent-rgb) / 0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", flexShrink: 0 }}>
            <Users size={16} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            <span style={{ fontWeight: 800, color: isFull ? "var(--red-500)" : "var(--text-primary)" }}>
              {hasQuota ? `${registered} / ${ev.quota}` : registered}
            </span>
            <span style={{ color: "var(--text-muted)", fontWeight: 600 }}> {t.registered}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: allowed ? "rgb(var(--emerald-500-rgb) / 0.08)" : "rgb(var(--ink-rgb) / 0.04)", display: "flex", alignItems: "center", justifyContent: "center", color: allowed ? "var(--emerald-500)" : "var(--text-muted)", flexShrink: 0 }}>
            <DoorOpen size={16} />
          </div>
          <div style={{ fontSize: 13, color: allowed ? "var(--emerald-500)" : "var(--text-muted)", fontWeight: 700 }}>
            {ev.walkInsOnly ? t.walkInsOnlyBadge : allowed ? t.walkInsAllowedLabel : t.walkInsDisabledLabel}
            {allowed && !ev.walkInsOnly && ev.quotaWalkIn != null ? ` (${ev.quotaWalkIn})` : ""}
          </div>
        </div>
        {ev.walkInsOnly && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.5, marginTop: -4 }}>
            {t.walkInsOnlyNotice}
          </p>
        )}
      </>
    );
  };

  return {
    user,
    houseId,
    houseInfo,
    previewEvent,
    now,
    upcoming,
    past,
    getEventStatus,
    startOfToday,
    endOfToday,
    weekEnd,
    timelineGroupOf,
    byStartAsc,
    byStartDesc,
    timelineSections,
    thisWeekCount,
    attendedEvents,
    pointsEarned,
    stats,
    regWindowRow,
    quotaWalkInRows,
  };
}

export type DashboardCtx = BaseDashboardCtx & ReturnType<typeof deriveDashboard>;
