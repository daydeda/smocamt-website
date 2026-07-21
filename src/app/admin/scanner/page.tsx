"use client";

import { useEffect, useRef, useState } from "react";
// Type-only: the runtime module is imported dynamically inside startScanner so the
// (heavy) scanner lib stays out of the initial page bundle.
import type { Html5Qrcode } from "html5-qrcode";
import { 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  UserCheck, 
  UserMinus,
  RefreshCcw,
  ArrowRight,
  ShieldCheck,
  House,
  RotateCcw,
  Download,
  ChevronDown,
  Calendar,
  Users,
  UserX,
  Award,
  Plus,
  Minus
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { useSession } from "next-auth/react";
import { canGiveIndividualScoreAny, effectiveRoles } from "@/lib/admin-access";
import { usePolling } from "@/lib/usePolling";
import dynamic from "next/dynamic";

// Pre-test warning QR — client-only (qrcode.react reads the DOM). Same component
// the dashboard uses to render the student QR.
const QRCodeSVG = dynamic(() => import("qrcode.react").then((mod) => mod.QRCodeSVG), {
  ssr: false,
});

type ScanStatus = "success" | "success_walk_in" | "pending_confirmation" | "already_checked_in" | "walk_ins_disabled" | "not_found" | "quota_full" | "found" | "not_registered" | "error";

type ScanResult = {
  status: ScanStatus;
  student?: { 
    name: string; 
    nickname: string; 
    studentId?: string; 
    house?: string; 
    houseId?: string;
    houseColor?: string;
    hasMedicalCondition?: boolean;
    chronicDiseases?: string | null;
    medicalHistory?: string | null;
    drugAllergies?: string | null;
    foodAllergies?: string | null;
    dietaryRestrictions?: string | null;
    faintingHistory?: boolean;
    emergencyMedication?: string | null;
    points?: number;
  };
  isWalkIn?: boolean;
  checkedInAt?: string;
  error?: string;
  rawToken?: string;
  // Set by the scan API on a confirmed check-in when the event has a pre-test (K_pre)
  // this attendee hasn't completed — drives the warning + QR shown below the result.
  preTestWarning?: { formId: string; title: string } | null;
};

type EventSession = {
  id: string;
  title: string | null;
  startTime: string;
  endTime: string;
  sortOrder: number;
};
type Event = { id: string; title: string; startTime: string; endTime: string; sessions?: EventSession[]; songsueLinked?: boolean };

// Sessions sorted into display order ("Day 1", "Day 2", …).
function sortedSessions(sessions?: EventSession[]): EventSession[] {
  return [...(sessions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

// Mirrors the server's resolveCurrentSessionId: the session whose window contains
// now → the nearest upcoming → the most recent past. Keeps the default day in sync
// with what the server would pick when sessionId is omitted.
function pickCurrentSessionId(sessions?: EventSession[]): string {
  const sorted = sortedSessions(sessions);
  if (sorted.length === 0) return "";
  const now = Date.now();
  const current = sorted.find(
    (s) => new Date(s.startTime).getTime() <= now && now <= new Date(s.endTime).getTime()
  );
  if (current) return current.id;
  const upcoming = sorted.find((s) => new Date(s.startTime).getTime() > now);
  if (upcoming) return upcoming.id;
  return sorted[sorted.length - 1].id;
}

// Mirrors the "live" check used on the admin events page (src/app/admin/events/page.tsx):
// now falls within the event's own start/end window.
function isEventLive(e: Pick<Event, "startTime" | "endTime">): boolean {
  const now = Date.now();
  return now >= new Date(e.startTime).getTime() && now <= new Date(e.endTime).getTime();
}

// Events sorted for the scanner's picker: whichever event is live right now floats
// to the top (ties broken by the server's own desc-startTime order) so the staff
// sees the correct event first instead of having to hunt for it in the dropdown.
function sortedForScanner(events: Event[]): Event[] {
  return [...events].sort((a, b) => Number(isEventLive(b)) - Number(isEventLive(a)));
}

// Small pulsing "LIVE" pill — reused on the event selector, its dropdown list, and
// the camera overlay so a live event is unmistakable everywhere its name appears.
function LiveBadge({ label, small }: { label: string; small?: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: small ? "2px 6px" : "3px 8px",
      borderRadius: 999,
      background: "rgba(16, 185, 129, 0.15)",
      color: "#10b981",
      fontSize: small ? 10 : 11,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      flexShrink: 0,
      whiteSpace: "nowrap",
    }}>
      <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
      {label}
    </span>
  );
}

// Post-check-in notice for a songsueLinked event's confirmed attendance. This
// modal renders on the STAFF's own scanning device, not the student's — it
// must never navigate that device away to Songsue (that used to happen here
// via an auto-redirect and would kick the operator out of the scanner between
// every single student). It's purely informational: tell the admin the
// student checked in via ActiveCAMT and to ask them to open Songsue
// themselves to see their house color.
function SongsueCheckinNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        background: "rgba(99, 102, 241, 0.06)",
        border: "1.5px dashed rgba(99, 102, 241, 0.4)",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        textAlign: "left",
      }}
    >
      <House size={18} color="#6366f1" style={{ marginTop: 1, flexShrink: 0 }} />
      <p style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
        {message}
      </p>
    </div>
  );
}

export default function QRScannerPage() {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  // Club/Major presidents are check-in only — hide the Individual Score mode.
  // The server (scan API + ScannerService) is the real gate; this is UX only.
  const canScore = canGiveIndividualScoreAny(effectiveRoles(session?.user?.role, session?.user?.roles));
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState<string>("");
  // Which session (day) check-ins are recorded against. Defaults to "today".
  const [sessionId, setSessionId] = useState<string>("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<{ id: string; name: string; studentId: string }[]>([]);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [medsCheckOption, setMedsCheckOption] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<"checkin" | "score">("checkin");
  const [scoreInput, setScoreInput] = useState<string>("");
  const [scoreSign, setScoreSign] = useState<1 | -1>(1);
  const [scoreReason, setScoreReason] = useState<string>("");
  const [submittingScore, setSubmittingScore] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dayDropdownOpen, setDayDropdownOpen] = useState(false);
  const dayDropdownRef = useRef<HTMLDivElement>(null);
  // Live count of check-ins for the selected event + day, shown so the organiser
  // watches attendance climb in real time. null until the first fetch lands.
  const [checkedInCount, setCheckedInCount] = useState<number | null>(null);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastTokenRef = useRef<string | null>(null);
  const eventIdRef = useRef<string>("");
  // The camera decode callback is registered once; mirror sessionId into a ref so
  // it never sends a scan against a stale day after the staff switches sessions.
  const sessionIdRef = useRef<string>("");
  const scanModeRef = useRef<"checkin" | "score">("checkin");
  const isMountedRef = useRef(true);
  const scanSessionIdRef = useRef(0);
  // The decode callback is registered once; mirror showModal into a ref so a
  // different student's QR drifting into frame mid-confirmation can't overwrite
  // the open result modal (every other value the callback reads is already a ref).
  const showModalRef = useRef(false);
  // Manual-search debounce timer + a sequence counter to drop stale responses.
  const manualSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualSearchSeqRef = useRef(0);

  // Manage component mounted lifecycle state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Handle closing the custom event / day selector dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (dayDropdownRef.current && !dayDropdownRef.current.contains(event.target as Node)) {
        setDayDropdownOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
    };
  }, []);

  // Update ref whenever state changes
  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Keep scan mode in a ref: the camera's decode callback is registered once and
  // would otherwise capture a stale mode, sending check-in scans while in score mode.
  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  // Keep showModal in a ref for the once-registered decode callback (see above).
  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  // Drop any pending manual-search debounce on unmount.
  useEffect(() => () => {
    if (manualSearchTimerRef.current) clearTimeout(manualSearchTimerRef.current);
  }, []);

  // Fetch events for the selector. Runs once on mount, so loadingEvents/eventsError
  // are intentionally left at their initial values (true/null) rather than reset here.
  useEffect(() => {
    fetch("/api/admin/events")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `HTTP error! status: ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (isMountedRef.current) {
          if (Array.isArray(d)) {
            setEvents(d);
            if (d.length > 0) {
              // Default to whichever event is live right now, if any — falls back to
              // the newest event (server's default order) when nothing is live.
              const defaultEvent = d.find(isEventLive) ?? d[0];
              setEventId(defaultEvent.id);
              setSessionId(pickCurrentSessionId(defaultEvent.sessions));
            }
          } else {
            throw new Error("Invalid events list format received");
          }
          setLoadingEvents(false);
        }
      })
      .catch((err) => {
        console.error("Fetch events failed:", err);
        if (isMountedRef.current) {
          setEventsError(err.message || "Failed to load events");
          setLoadingEvents(false);
        }
      });
  }, []);

  // Live check-in count for the selected event + day. Hits the lightweight /count
  // endpoint (no roster, no PII, no audit log) so it's cheap to call repeatedly.
  // Reads the event/session from refs so the poller always uses the current
  // selection even though its callback was registered once.
  const refreshCheckedInCount = async (signal?: AbortSignal) => {
    const ev = eventIdRef.current;
    if (!ev) return;
    const qs = new URLSearchParams({ eventId: ev });
    if (sessionIdRef.current) qs.set("sessionId", sessionIdRef.current);
    try {
      const res = await fetch(`/api/admin/scan/count?${qs.toString()}`, signal ? { signal } : undefined);
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current && typeof data.checkedIn === "number") {
          setCheckedInCount(data.checkedIn);
        }
      }
    } catch {
      // Best-effort: the poller retries on the next tick.
    }
  };

  // Poll the count on a short interval (overlap-safe, pauses on hidden tab). A
  // successful check-in also refreshes it immediately (see confirmAttendance) so
  // the number jumps the moment a student is scanned in.
  usePolling((signal) => refreshCheckedInCount(signal), 8000);

  // Reset + refetch the count immediately whenever the staff switches event or day,
  // so the displayed number always matches the current selection without waiting
  // for the next poll tick. The event/session refs are synced in effects declared
  // above, so they hold the new ids by the time this runs.
  useEffect(() => {
    // Deferred (matching the scanner-start effect below) to avoid a synchronous
    // setState inside the effect body.
    const id = setTimeout(() => {
      setCheckedInCount(null);
      refreshCheckedInCount();
    }, 0);
    return () => clearTimeout(id);
  }, [eventId, sessionId]);

  const startScanner = async () => {
    if (!isMountedRef.current) return;
    const currentSessionId = ++scanSessionIdRef.current;

    // 1. Clean up any existing instance first
    if (scannerRef.current) {
        try {
            await scannerRef.current.stop();
        } catch {
            // ignore
        }
        scannerRef.current = null;
    }

    // 2. Ensure container is empty and ready
    const container = document.getElementById("qr-reader");
    if (container) {
      container.innerHTML = "";
    } else {
      return;
    }

    // Camera APIs only exist in a secure context (HTTPS or localhost). On a
    // plain-HTTP origin (e.g. http://192.168.x.x) the browser blocks the camera
    // outright and never shows a permission prompt — surface that clearly.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      if (isMountedRef.current) {
        setScannerError(
          typeof window !== "undefined" && window.isSecureContext === false
            ? "Camera blocked: open this site over its https:// address (or localhost). The browser disables the camera on non-secure connections."
            : "This browser/device does not expose a camera API."
        );
        setIsScanning(false);
      }
      return;
    }

    // 3. Initialize new instance (load the scanner lib on demand)
    const { Html5Qrcode } = await import("html5-qrcode");
    if (!isMountedRef.current || currentSessionId !== scanSessionIdRef.current) return;
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;
    if (isMountedRef.current) {
      setScannerError(null);
    }

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        async (decodedText) => {
          if (lastTokenRef.current === decodedText || showModalRef.current) return;
          lastTokenRef.current = decodedText;
          
          try {
            const res = await fetch("/api/admin/scan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                qrToken: decodedText,
                eventId: eventIdRef.current,
                sessionId: sessionIdRef.current || undefined,
                // Score mode just looks the student up (no check-in side effect);
                // check-in mode runs the real scan.
                action: scanModeRef.current === "score" ? "lookup" : "scan",
              }),
            });
            const data = await res.json();
            const result: ScanResult = { 
              status: data.status ?? (res.ok ? "success" : "error"), 
              ...data, 
              rawToken: decodedText 
            };
            if (isMountedRef.current && currentSessionId === scanSessionIdRef.current) {
              setScanResult(result);
              setShowModal(true);
            }
            if ("vibrate" in navigator) navigator.vibrate(result.status === "success" ? [100, 50, 100] : 200);
          } catch {
            if (isMountedRef.current && currentSessionId === scanSessionIdRef.current) {
              setScanResult({ status: "error", error: "Connection error" });
              setShowModal(true);
            }
          }
        },
        () => {}
      );

      // We request the rear ("environment") camera. Looking through a rear
      // camera is like looking through a viewfinder facing the same way you
      // are, so tilting the device/subject right shows right on screen —
      // no flip needed. But on devices with no rear camera (e.g. a laptop
      // used for testing), the browser falls back to a camera that faces
      // the admin — a face-to-face view, like a photo someone took of you,
      // where tilting your head right appears to tilt left on screen unless
      // mirrored. Desktop webcams frequently don't report facingMode as
      // "environment" at all (often "user", sometimes omitted entirely), so
      // treat anything that isn't a confirmed rear camera as needing the
      // mirror, rather than only matching the exact "user" value.
      try {
        const settings = scanner.getRunningTrackSettings();
        const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
        if (video) {
          video.style.transform = settings.facingMode === "environment" ? "none" : "scaleX(-1)";
        }
      } catch (settingsErr) {
        console.error("Failed to read camera track settings:", settingsErr);
      }

      // If component unmounted or another session started while starting, stop the scanner immediately!
      if (!isMountedRef.current || currentSessionId !== scanSessionIdRef.current) {
        try {
          await scanner.stop();
        } catch (stopErr) {
          console.error("Failed to stop scanner after unmount or session change:", stopErr);
        }
        if (currentSessionId === scanSessionIdRef.current) {
          scannerRef.current = null;
        }
        return;
      }

      if (isMountedRef.current) {
        setIsScanning(true);
      }
    } catch (err) {
      console.error("Scanner start error:", err);
      const errorObj = err as Error;
      let msg = errorObj?.message || "Could not start camera. Please check permissions.";
      // The browser caches the camera permission per-origin and will NOT
      // re-prompt once denied — tell the admin how to re-enable it manually.
      if (errorObj?.name === "NotAllowedError" || /permission|denied/i.test(msg)) {
        msg = "Camera permission is blocked. The browser won't ask again on its own — tap the camera/lock icon in the address bar, set Camera to \"Allow\", then press refresh.";
      } else if (errorObj?.name === "NotFoundError" || errorObj?.name === "OverconstrainedError") {
        msg = "No camera was found on this device.";
      } else if (errorObj?.name === "NotReadableError") {
        msg = "The camera is already in use by another app. Close it and press refresh.";
      }
      if (isMountedRef.current && currentSessionId === scanSessionIdRef.current) {
        setScannerError(msg);
        setIsScanning(false);
        scannerRef.current = null;
      }
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (events.length > 0) {
      // Avoid calling setState synchronously inside effect
      timer = setTimeout(() => {
        startScanner();
      }, 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (scannerRef.current) {
        const s = scannerRef.current;
        try {
          s.stop().catch(() => {});
        } catch {
          // ignore
        }
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length > 0]);

  // Restart scanner on window resize or device orientation change
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;

    const handleResize = () => {
      if (!isScanning) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        if (isMountedRef.current && isScanning) {
          console.log("Orientation/size changed. Restarting scanner...");
          startScanner();
        }
      }, 500); // 500ms debounce to let rotate animations settle
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [isScanning]);

  const closeModal = () => {
    setShowModal(false);
    setTimeout(() => {
      if (isMountedRef.current) {
        setScanResult(null);
        lastTokenRef.current = null;
        setMedsCheckOption(null);
        setScoreInput("");
        setScoreSign(1);
      }
    }, 300);
  };

  const confirmAttendance = async (token: string) => {
    setIsConfirming(true);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrToken: token,
          eventId,
          sessionId: sessionId || undefined,
          action: "confirm",
          medsCheckOption: medsCheckOption || null,
        }),
      });
      const data = await res.json();
      if (isMountedRef.current) {
        setScanResult({ status: data.status ?? (res.ok ? "success" : "error"), ...data, rawToken: token });
      }
      // A confirmed check-in changed the attendance total — refresh the live count
      // now instead of waiting for the next poll tick.
      if (res.ok) refreshCheckedInCount();
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    } catch {
      if (isMountedRef.current) {
        setScanResult({ status: "error", error: "Connection error" });
      }
    } finally {
      if (isMountedRef.current) {
        setIsConfirming(false);
      }
    }
  };

  const confirmScore = async (token: string) => {
    // Input holds the magnitude (always positive); scoreSign decides award vs deduct.
    const magnitude = parseInt(scoreInput);
    if (isNaN(magnitude) || magnitude <= 0) {
      alert(t.invalidScoreAlert);
      return;
    }
    const val = magnitude * scoreSign;

    setSubmittingScore(true);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          qrToken: token, 
          eventId, 
          action: "score",
          score: val,
          reason: scoreReason
        }),
      });
      const data = await res.json();
      if (isMountedRef.current) {
        if (res.ok) {
          setScanResult({ 
            status: "success", 
            ...data, 
            rawToken: token 
          });
          setScoreInput("");
          setScoreReason("");
        } else {
          setScanResult({ 
            status: "error", 
            error: data.error || "Failed to award score", 
            ...data, 
            rawToken: token 
          });
        }
      }
      if ("vibrate" in navigator) navigator.vibrate(res.ok ? [100, 50, 100] : 200);
    } catch {
      if (isMountedRef.current) {
        setScanResult({ status: "error", error: "Connection error" });
      }
    } finally {
      if (isMountedRef.current) {
        setSubmittingScore(false);
      }
    }
  };

  const handleManualSearch = (q: string) => {
    setManualSearch(q);
    if (manualSearchTimerRef.current) clearTimeout(manualSearchTimerRef.current);
    // Bump the sequence on every keystroke so a slower, older response can never
    // overwrite the results of a newer query.
    const seq = ++manualSearchSeqRef.current;
    if (q.length < 2) { setManualResults([]); return; }
    // Debounce so we fire one request after typing settles, not per keystroke.
    manualSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/scan?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isMountedRef.current && seq === manualSearchSeqRef.current) {
          setManualResults(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error("Manual search error:", err);
      }
    }, 250);
  };

  const manualCheckIn = async (qrToken: string) => {
    setCheckingIn(qrToken);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // In score mode, only resolve the student (no check-in side effect).
        body: JSON.stringify({ qrToken, eventId, sessionId: sessionId || undefined, action: scanMode === "score" ? "lookup" : "scan" }),
      });
      const data = await res.json();
      if (isMountedRef.current) {
        setScanResult({ status: data.status ?? (res.ok ? "success" : "error"), ...data, rawToken: qrToken });
        setShowModal(true);
        setManualResults([]);
        setManualSearch("");
      }
    } catch (err) {
      console.error("Manual checkin error:", err);
    } finally {
      if (isMountedRef.current) {
        setCheckingIn(null);
      }
    }
  };

  const STATUS_CONFIG: Record<ScanStatus, { 
    color: string; 
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; fill?: string; className?: string }>; 
    title: string; 
    desc: string;
    bg: string;
  }> = {
    success: { 
      color: "#10b981", 
      icon: UserCheck, 
      title: t.scanSuccess, 
      desc: t.scanSuccess,
      bg: "rgba(16, 185, 129, 0.1)"
    },
    success_walk_in: { 
      color: "#10b981", 
      icon: UserCheck, 
      title: t.scanSuccess + " (Walk-in)", 
      desc: t.scanSuccess,
      bg: "rgba(16, 185, 129, 0.1)"
    },
    pending_confirmation: { 
      color: "#6366f1", 
      icon: AlertCircle, 
      title: t.manualCheckinTitle, 
      desc: t.manualSearchPlaceholder,
      bg: "rgba(99, 102, 241, 0.1)"
    },
    already_checked_in: { 
      color: "#ef4444", 
      icon: RefreshCcw, 
      title: t.scanAlreadyCheckedIn, 
      desc: t.scanAlreadyCheckedIn,
      bg: "rgba(239, 68, 68, 0.1)"
    },
    walk_ins_disabled: {
      color: "#f59e0b",
      icon: UserMinus,
      title: t.walkInsDisabledLabel || "Walk-ins Not Allowed",
      desc: t.walkInsDisabledError,
      bg: "rgba(245, 158, 11, 0.1)"
    },
    not_found: { 
      color: "#ef4444", 
      icon: XCircle, 
      title: t.scanNotFound, 
      desc: t.scanNotFound,
      bg: "rgba(239, 68, 68, 0.1)"
    },
    quota_full: {
      color: "#f59e0b",
      icon: UserX,
      title: t.eventFull || "Event Full",
      desc: t.eventFull || "Event Full",
      bg: "rgba(245, 158, 11, 0.1)"
    },
    // Score-mode student lookup (no check-in). Always overridden by the score-mode
    // cfg block below; this entry just satisfies the Record<ScanStatus> type.
    found: {
      color: "var(--accent-primary)",
      icon: Award,
      title: t.scanModeScore,
      desc: t.scanModeScore,
      bg: "rgba(99, 102, 241, 0.1)"
    },
    not_registered: {
      color: "#ef4444",
      icon: UserX,
      title: lang === "th" ? "ยังไม่ได้ลงทะเบียน" : lang === "cn" ? "未报名此活动" : lang === "mm" ? "ဤပွဲအတွက် စာရင်းမသွင်းရသေးပါ" : "Not Registered",
      desc: lang === "th" ? "นักศึกษายังไม่ได้ลงทะเบียนกิจกรรมนี้" : lang === "cn" ? "该学生未报名此活动" : lang === "mm" ? "ဤကျောင်းသားသည် ဤပွဲတွင် စာရင်းမသွင်းထားပါ" : "This student is not registered for this event",
      bg: "rgba(239, 68, 68, 0.1)"
    },
    error: { 
      color: "#ef4444", 
      icon: AlertCircle, 
      title: t.scanError, 
      desc: t.scanError,
      bg: "rgba(239, 68, 68, 0.1)"
    },
  };

  const selectedEvent = events.find((e) => e.id === eventId);
  const selectedEventIsLive = selectedEvent ? isEventLive(selectedEvent) : false;
  // If the staff is scanning against a non-live event while a different event IS
  // live right now, that's exactly the "forgot to switch the dropdown" mistake —
  // surface it explicitly with a one-tap fix instead of hoping they notice.
  const otherLiveEvent = selectedEventIsLive ? undefined : events.find((e) => e.id !== eventId && isEventLive(e));

  // Show the "ask them to open Songsue" notice only on a fresh confirmed
  // attendance (not a re-scan of an already-checked-in student) for a
  // songsueLinked event — house color for these events lives in Songsue, not
  // ActiveCAMT's own scan result.
  const showSongsueNotice =
    scanMode === "checkin"
    && (scanResult?.status === "success" || scanResult?.status === "success_walk_in")
    && Boolean(selectedEvent?.songsueLinked);

  let cfg = scanResult ? (STATUS_CONFIG[scanResult.status] || STATUS_CONFIG.error) : null;

  if (cfg && scanMode === "score") {
    if (scanResult?.status === "success") {
      cfg = {
        color: "#10b981",
        icon: CheckCircle2,
        title: scoreSign === -1
          ? (lang === "th" ? "หักคะแนนสำเร็จ" : lang === "cn" ? "扣分成功" : lang === "mm" ? "အမှတ်နှုတ်ပြီး" : "Points Deducted")
          : (lang === "th" ? "มอบคะแนนสำเร็จ" : "Score Awarded"),
        desc: scoreSign === -1
          ? (lang === "th" ? "หักคะแนนเรียบร้อยแล้ว" : lang === "cn" ? "已成功扣分" : lang === "mm" ? "အမှတ်ကို အောင်မြင်စွာ နှုတ်ပြီးပါပြီ" : "The score has been deducted successfully")
          : (lang === "th" ? "มอบคะแนนเรียบร้อยแล้ว" : "The score has been added successfully"),
        bg: "rgba(16, 185, 129, 0.1)"
      };
    } else if (scanResult?.status === "not_registered") {
      // Keep the "Not Registered" error styling — don't fall through to the score prompt.
      cfg = STATUS_CONFIG.not_registered;
    } else {
      cfg = {
        color: "var(--accent-primary)",
        icon: Award,
        title: lang === "th" ? "มอบคะแนนรายบุคคล" : "Individual Score",
        desc: lang === "th" ? "กรอกคะแนนที่ต้องการมอบให้แก่นักศึกษา" : "Enter the score to award to this student",
        bg: "rgba(99, 102, 241, 0.1)"
      };
    }
  } else if (cfg && scanResult?.student?.hasMedicalCondition) {
    cfg = {
      ...cfg,
      color: "#ef4444",
      icon: AlertCircle,
      bg: "rgba(239, 68, 68, 0.12)",
      title: lang === "th" ? "คำเตือนด้านสุขภาพ!" : lang === "cn" ? "健康警告！" : lang === "mm" ? "ကျန်းမာရေး သတိပေးချက်!" : "Medical Warning!",
      desc: lang === "th" ? "นักศึกษามีข้อมูลสุขภาพที่ลงทะเบียนไว้ โปรดตรวจสอบข้อมูลยาฉุกเฉินและข้อจำกัดสุขภาพ" : lang === "cn" ? "学生有已记录的健康状况。请核对药品与健康限制。" : lang === "mm" ? "ကျောင်းသားတွင် ကျန်းမာရေးအခြေအနေရှိသည်။ ဆေးဝါးและ ကျန်းမာရေးကန့်สတ်ချက်များကို สစ်ဆေးပါ။" : "Student has a recorded health condition. Please verify medication.",
    };
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-10" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <h1 style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.3 }}>{t.qrScanner}</h1>
        
        {/* Mode Selector — hidden for check-in-only roles (Club/Major presidents) */}
        {canScore && (
        <div style={{
          display: "flex",
          background: "var(--bg-elevated)",
          padding: 4, 
          borderRadius: 12, 
          border: "1px solid var(--border-subtle)" 
        }}>
          <button
            onClick={() => setScanMode("checkin")}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              background: scanMode === "checkin" ? "var(--bg-surface)" : "transparent",
              color: scanMode === "checkin" ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: scanMode === "checkin" ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {t.scanModeCheckin}
          </button>
          <button
            onClick={() => setScanMode("score")}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              background: scanMode === "score" ? "var(--bg-surface)" : "transparent",
              color: scanMode === "score" ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: scanMode === "score" ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {t.scanModeScore}
          </button>
        </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6 items-start">
        
        {/* Left: Main Scanner Area */}
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
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
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
              mistake staff have hit before, so call it out with a one-tap fix. */}
          {otherLiveEvent && (
            <div
              className="stat-card"
              style={{
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                background: "rgba(245, 158, 11, 0.08)",
                border: "1.5px solid rgba(245, 158, 11, 0.35)",
              }}
            >
              <AlertCircle size={20} color="#f59e0b" style={{ flexShrink: 0 }} />
              <p style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                {lang === "th"
                  ? `กิจกรรมที่เลือกอยู่ไม่ได้กำลังจัดอยู่ตอนนี้ ในขณะที่ "${otherLiveEvent.title}" กำลังดำเนินการอยู่ — ต้องการเปลี่ยนไหม?`
                  : lang === "cn"
                  ? `当前选中的活动现在并未进行，而「${otherLiveEvent.title}」正在进行中 — 要切换吗？`
                  : lang === "mm"
                  ? `ရွေးထားသော ပွဲသည် အခုလက်ရှိ ကျင်းပနေခြင်း မဟုတ်ပါ၊ "${otherLiveEvent.title}" မှာ ကျင်းပနေဆဲဖြစ်သည် — ပြောင်းလိုပါသလား?`
                  : `The selected event isn't live right now — "${otherLiveEvent.title}" is. Did you mean to pick that one?`}
              </p>
              <button
                type="button"
                onClick={() => {
                  setEventId(otherLiveEvent.id);
                  setSessionId(pickCurrentSessionId(otherLiveEvent.sessions));
                }}
                className="btn btn-primary"
                style={{ padding: "8px 16px", fontSize: 12, flexShrink: 0, background: "#f59e0b", border: "none" }}
              >
                {lang === "th" ? "เปลี่ยนไปกิจกรรมที่กำลังจัดอยู่" : lang === "cn" ? "切换到进行中的活动" : lang === "mm" ? "ကျင်းပနေသော ပွဲသို့ ပြောင်းရန်" : "Switch to live event"}
              </button>
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
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
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

          {/* QR Camera Box */}
          <div
            style={{
              background: "#000",
              borderRadius: "var(--radius-xl)",
              overflow: "hidden",
              border: "8px solid var(--bg-surface)",
              boxShadow: "0 40px 80px rgba(0,0,0,0.15)",
              position: "relative",
              minHeight: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div id="qr-reader" style={{ width: "100%" }} />
            
            {/* 1. Loading Events State */}
            {loadingEvents && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#000", color: "#fff", gap: 16 }}>
                <div className="spinner" />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{t.eventLoadingLabel}</p>
              </div>
            )}

            {/* 2. Events Fetch Error State */}
            {(!loadingEvents && eventsError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.95)", color: "#fff", padding: 40, textAlign: "center" }}>
                <AlertCircle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Failed to Load Events</p>
                <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>{eventsError}</p>
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
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#1e293b", color: "#fff", padding: 24, textAlign: "center", gap: 16 }}>
                <AlertCircle size={48} color="#f59e0b" />
                <p style={{ fontSize: 16, fontWeight: 700 }}>No Events Available</p>
                <p style={{ fontSize: 14, color: "#cbd5e1", maxWidth: 320, lineHeight: 1.5 }}>
                  You must define at least one event in the database before you can scan student QR codes.
                </p>
                <a href="/admin/events" className="btn btn-primary" style={{ borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px" }}>
                  <Plus size={16} /> Create Event
                </a>
              </div>
            )}

            {/* 4. Scanner Loading State (when we have events but scanner has not started yet and no error) */}
            {(!loadingEvents && !eventsError && events.length > 0 && !isScanning && !scannerError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#000", color: "#fff", gap: 16 }}>
                <div className="spinner" />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{t.eventLoadingLabel}</p>
              </div>
            )}

            {/* 5. Scanner Startup Error State */}
            {(!loadingEvents && !eventsError && events.length > 0 && scannerError) && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.9)", color: "#fff", padding: 40, textAlign: "center" }}>
                <AlertCircle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{t.scanError}</p>
                <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>{scannerError}</p>
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
                    background: selectedEventIsLive ? "rgba(0,0,0,0.55)" : "rgba(180, 83, 9, 0.75)",
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
                      color: "#fff",
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
                        <div className="animate-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
                        <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.scanningActive}</span>
                      </div>
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right: Manual Override & Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Live check-in count — updates as students are scanned in, no reload. */}
          <div className="stat-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Users size={20} color="var(--accent-primary)" />
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  {lang === "th" ? "เช็คอินแล้ว" : lang === "cn" ? "已签到" : lang === "mm" ? "ချက်အင်ပြီးသူ" : "Checked In"}
                </h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {lang === "th" ? "สด" : lang === "cn" ? "实时" : lang === "mm" ? "တိုက်ရိုက်" : "Live"}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 48, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.1, marginTop: 12, letterSpacing: "-0.03em" }}>
              {checkedInCount ?? "—"}
            </p>
          </div>

          <div className="stat-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <Search size={20} color="var(--accent-primary)" />
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {scanMode === "score"
                  ? (lang === "th" ? "ค้นหาเพื่อมอบคะแนน" : lang === "cn" ? "搜索学生以给分" : lang === "mm" ? "အမှတ်ပေးရန် ရှာဖွေခြင်း" : "Manual Score Search")
                  : t.manualCheckinTitle}
              </h3>
            </div>

            <div style={{ position: "relative" }}>
              <input
                className="input"
                placeholder={scanMode === "score"
                  ? (lang === "th" ? "ค้นหาชื่อหรือรหัสนักศึกษาเพื่อมอบคะแนน..." : lang === "cn" ? "搜索学生姓名或学号以给分..." : lang === "mm" ? "အမှတ်ပေးရန် ကျောင်းသားအမည်/ID ရှာပါ..." : "Search student to give score...")
                  : t.manualSearchPlaceholder}
                style={{ paddingLeft: 12 }}
                value={manualSearch}
                onChange={(e) => handleManualSearch(e.target.value)}
              />
            </div>

            {manualResults.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {manualResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => manualCheckIn(s.id)}
                    disabled={checkingIn === s.id}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      minHeight: 64,
                      padding: "12px 16px",
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "all 0.2s",
                      cursor: "pointer"
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{s.name}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.studentId}</p>
                    </div>
                    <ArrowRight size={18} color="var(--accent-primary)" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="stat-card" style={{ padding: 32, background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)" }}>
             <ShieldCheck size={40} style={{ marginBottom: 16, opacity: 0.2 }} />
             <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>{t.immutableLogsBadge.replace("🔒 ", "").toUpperCase()}</p>
             <p style={{ fontSize: 15, color: "var(--text-primary)", marginTop: 8, lineHeight: 1.6 }}>
               {t.auditAlertText}
             </p>
          </div>
        </div>
      </div>

      {/* Result Modal */}
      {showModal && cfg && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={closeModal}
        >
          <div 
            className="animate-fade-in-up"
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-xl)",
              width: "100%",
              maxWidth: 440,
              maxHeight: "calc(100vh - 48px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 50px 100px rgba(0,0,0,0.3)",
              border: `1px solid var(--border-subtle)`
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header/Icon */}
            <div style={{ background: cfg.bg, padding: "32px 32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ 
                width: 72, 
                height: 72, 
                borderRadius: "50%", 
                background: "var(--bg-surface)", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                color: cfg.color,
                boxShadow: `0 10px 30px ${cfg.color}30`,
                border: `4px solid var(--bg-surface)`
              }}>
                <cfg.icon size={36} strokeWidth={3} />
              </div>
              <div style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)" }}>{cfg.title}</h2>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{cfg.desc}</p>
              </div>
            </div>

            {/* Modal Body: Student Info */}
            <div style={{ padding: "24px 32px 32px", overflowY: "auto", flex: 1 }}>
              {scanResult?.student ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.04em", overflowWrap: "break-word", wordBreak: "break-word" }}>
                      {scanResult.student.name}
                    </p>
                    <p style={{ fontSize: 18, color: "var(--text-secondary)", fontWeight: 700, marginTop: 4 }}>
                      {scanResult.student.studentId}
                    </p>
                    {scanResult.student.nickname && (
                      <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>
                        aka &quot;{scanResult.student.nickname}&quot;
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                    <div style={{ 
                      padding: "10px 20px", 
                      borderRadius: 12, 
                      background: "var(--bg-elevated)", 
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}>
                      <House size={16} color={scanResult.student.houseColor} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: scanResult.student.houseColor }}>
                        {scanResult.student.houseId === 'red' ? t.houseMom : scanResult.student.houseId === 'green' ? t.houseTo : scanResult.student.houseId === 'yellow' ? t.houseLuang : scanResult.student.houseId === 'blue' ? t.houseMakara : scanResult.student.house}
                      </span>
                    </div>
                    {scanResult.student.points !== undefined && (
                      <div style={{ 
                        padding: "10px 20px", 
                        borderRadius: 12, 
                        background: "var(--bg-elevated)", 
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                      }}>
                        <Award size={16} color="var(--accent-primary)" />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                          {scanResult.student.points} {lang === "th" ? "คะแนน" : "pts"}
                        </span>
                      </div>
                    )}
                  </div>

                  {scanMode === "checkin" && scanResult.student.hasMedicalCondition && (
                    <div style={{ 
                      marginTop: 8,
                      padding: 16, 
                      borderRadius: 16, 
                      background: "rgba(239, 68, 68, 0.04)", 
                      border: "1.5px dashed rgba(239, 68, 68, 0.25)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      textAlign: "left"
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <AlertCircle size={18} color="#ef4444" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {lang === "th" ? "ข้อมูลสุขภาพสำคัญ" : lang === "cn" ? "重要健康信息" : lang === "mm" ? "ကျန်းမာရေး သတိပေးချက်" : "Important Health Information"}
                          </p>
                          <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                            {scanResult.student.chronicDiseases && scanResult.student.chronicDiseases !== "-" && scanResult.student.chronicDiseases !== "" && (
                              <p>• <b>{t.chronicDiseases}</b></p>
                            )}
                            {scanResult.student.medicalHistory && scanResult.student.medicalHistory !== "-" && scanResult.student.medicalHistory !== "" && (
                              <p>• <b>{t.medicalHistory}</b></p>
                            )}
                            {scanResult.student.drugAllergies && scanResult.student.drugAllergies !== "-" && scanResult.student.drugAllergies !== "" && (
                              <p>• <b>{t.drugAllergies}</b></p>
                            )}
                            {scanResult.student.foodAllergies && scanResult.student.foodAllergies !== "-" && scanResult.student.foodAllergies !== "" && (
                              <p>• <b>{t.foodAllergies}</b></p>
                            )}
                            {scanResult.student.dietaryRestrictions && scanResult.student.dietaryRestrictions !== "-" && scanResult.student.dietaryRestrictions !== "" && (
                              <p>• <b>{t.dietaryRestrictions}</b></p>
                            )}
                            {scanResult.student.faintingHistory && (
                              <p>• <b>{t.faintingHistory}</b></p>
                            )}
                            {scanResult.student.emergencyMedication && scanResult.student.emergencyMedication !== "-" && scanResult.student.emergencyMedication !== "" && (
                              <p>• <b>{t.emergencyMed}</b></p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Safety Action Selector */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                        <p style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                          {lang === "th" ? "การดำเนินการโดยผู้ดูแล" : lang === "cn" ? "管理员操作选项" : lang === "mm" ? "အက်ဒမင်လုပ်ဆောင်ချက်" : "Admin Security Action"}
                        </p>
                        
                        {/* Option 1: Brought Medication */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "brought" ? "rgba(16, 185, 129, 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "brought" ? "1.5px solid #10b981" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "#10b981", cursor: "pointer" }} 
                            checked={medsCheckOption === "brought"}
                            onChange={() => setMedsCheckOption("brought")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "brought" ? "#10b981" : "var(--text-primary)" }}>
                              {lang === "th" ? "พกยาส่วนตัว/ยาฉุกเฉินมาด้วยแล้ว" : lang === "cn" ? "已携带个人/紧急药品" : lang === "mm" ? "ကိုယ်ပိုင်/အရေးပေါ်ဆေးဝါး ယူဆောင်လာပြီး" : "Brought personal/emergency medication"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              Brought Medication (Safe check-in)
                            </p>
                          </div>
                        </label>

                         {/* Option 2: Didn't Bring Medication */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "forgot" ? "rgba(245, 158, 11, 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "forgot" ? "1.5px solid #f59e0b" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "#f59e0b", cursor: "pointer" }} 
                            checked={medsCheckOption === "forgot"}
                            onChange={() => setMedsCheckOption("forgot")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "forgot" ? "#f59e0b" : "var(--text-primary)" }}>
                              {lang === "th" ? "ไม่ได้พกยามาด้วย / รับทราบความเสี่ยง" : lang === "cn" ? "未携带药品 / 已知悉风险" : lang === "mm" ? "ဆေးဝါးယူမလာပါ / အန္တရာယ်ရှိနိုင်မှုကို သိရှိပြီး" : "Didn't bring medication / Acknowledged risk"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              {"Didn't bring medication (Accept risk)"}
                            </p>
                          </div>
                        </label>
                        {/* Option 3: Acknowledge Dietary/Allergies Only */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "acknowledge" ? "rgba(99, 102, 241, 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "acknowledge" ? "1.5px solid #6366f1" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "#6366f1", cursor: "pointer" }} 
                            checked={medsCheckOption === "acknowledge"}
                            onChange={() => setMedsCheckOption("acknowledge")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "acknowledge" ? "#6366f1" : "var(--text-primary)" }}>
                              {lang === "th" ? "รับทราบข้อมูล (กรณีข้อจำกัดอาหาร / ข้อมูลทั่วไป)" : lang === "cn" ? "仅确认信息（饮食/过敏限制）" : lang === "mm" ? "အချက်အလက်ကို သိရှိပြီး (အစားအသောက်/ဓာတ်မတည့်မှု ကန့်သတ်ချက်)" : "Acknowledge info only (Dietary/Allergy restrictions)"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              Acknowledge (For Dietary / Allergies / General info)
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: "center", color: cfg.color, fontWeight: 700 }}>
                  {scanResult?.error === "Walk-in quota is full. Walk-ins cannot be accepted."
                    ? t.walkInQuotaFullError
                    : scanResult?.error === "Event is full. Walk-ins cannot be accepted."
                    ? t.eventFullError
                    : scanResult?.error === "Walk-ins are not enabled for this event and student is not pre-registered."
                    ? t.walkInsDisabledError
                    : scanResult?.error === "Student not found in the system."
                    ? t.studentNotFoundError
                    : scanResult?.error || "Unknown Student"}
                </div>
              )}

              {/* Check-in Mode buttons and banners */}
              {scanMode === "checkin" && scanResult?.status === "pending_confirmation" && scanResult.rawToken && (
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => confirmAttendance(scanResult.rawToken!)}
                  disabled={isConfirming || (scanResult?.student?.hasMedicalCondition && !medsCheckOption)}
                  style={{ 
                    marginTop: 24, 
                    background: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "var(--bg-elevated)" : "#6366f1", 
                    color: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "var(--text-muted)" : "white",
                    minHeight: 56, 
                    borderRadius: 16, 
                    fontSize: 16, 
                    fontWeight: 700,
                    opacity: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? 0.7 : 1,
                    cursor: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "not-allowed" : "pointer"
                  }}
                >
                  {isConfirming ? (lang === "th" ? "กำลังดำเนินการ..." : lang === "cn" ? "处理中..." : lang === "mm" ? "လုပ်ဆောင်နေသည်..." : "Processing...") : (scanResult?.isWalkIn ? (lang === "th" ? "ยืนยันการเช็คอินแบบ Walk-in" : lang === "cn" ? "确认现场签到" : lang === "mm" ? "Walk-in ချက်အင်ဝင်ခြင်းကို อတည်ပြုရန်" : "Confirm Walk-in Presence") : (lang === "th" ? "ยืนยันการเข้าร่วมกิจกรรม" : lang === "cn" ? "确认到场签到" : lang === "mm" ? "ကိုယ်ตိုင်ตက်ရောက်မှုကို อတည်ပြုရန်" : "Confirm Physical Presence"))}
                </button>
              )}

              {scanMode === "checkin" && (scanResult?.status === "success" || scanResult?.status === "success_walk_in" || scanResult?.status === "already_checked_in") && (
                <div 
                  style={{ 
                    marginTop: 24, 
                    padding: 16, 
                    borderRadius: 16, 
                    background: scanResult?.status === "already_checked_in" ? "#3b82f6" : "#10b981", 
                    color: "white", 
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    boxShadow: scanResult?.status === "already_checked_in" ? "0 10px 20px rgba(59, 130, 246, 0.3)" : "0 10px 20px rgba(16, 185, 129, 0.3)"
                  }}
                >
                  <CheckCircle2 size={24} />
                  {scanResult?.status === "already_checked_in" ? t.scanAlreadyCheckedIn : t.attended}
                </div>
              )}

              {/* Post-check-in "checked in via ActiveCAMT, ask them to open
                  Songsue" notice — only for events mirrored into Songsue
                  (songsueLinked), only on a fresh confirmed attendance (not a
                  re-scan of an already-checked-in student). Informational only
                  for the staff operating this scanner; never navigates them away. */}
              {showSongsueNotice && (
                <SongsueCheckinNotice message={t.scanSongsueRedirectMessage} />
              )}

              {/* Pre-test (K_pre) reminder — walk-ins skip the dashboard pre-test gate,
                  so on a confirmed check-in we warn and show a QR/link the attendee can
                  scan to complete it on their own phone. */}
              {scanMode === "checkin" && scanResult?.preTestWarning && (() => {
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const preTestUrl = `${origin}/dashboard/history?form=${scanResult.preTestWarning.formId}&event=${eventId}`;
                return (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 16,
                      borderRadius: 16,
                      background: "rgba(225, 29, 72, 0.06)",
                      border: "1.5px dashed rgba(225, 29, 72, 0.4)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertCircle size={18} color="#e11d48" style={{ flexShrink: 0 }} />
                      <p style={{ fontSize: 13, fontWeight: 800, color: "#e11d48", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {lang === "th" ? "ต้องทำแบบทดสอบ Pre-test" : lang === "cn" ? "需要完成前测" : lang === "mm" ? "Pre-Test ဖြေဆိုရန် လိုအပ်သည်" : "Pre-Test Required"}
                      </p>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                      {lang === "th"
                        ? `กิจกรรมนี้มีแบบทดสอบ Pre-test “${scanResult.preTestWarning.title}” ที่ผู้เข้าร่วมยังทำไม่เสร็จ ให้สแกนเพื่อทำให้เสร็จ`
                        : lang === "cn"
                        ? `本活动有一个前测「${scanResult.preTestWarning.title}」，该参与者尚未完成。请扫码完成。`
                        : lang === "mm"
                        ? `ဤပွဲတွင် ဤတက်ရောက်သူ မဖြေဆိုရသေးသော Pre-Test「${scanResult.preTestWarning.title}」ရှိသည်။ ဖြေဆိုရန် စကန်ဖတ်ပါ။`
                        : `This event has a pre-test “${scanResult.preTestWarning.title}” the attendee hasn't completed yet. Scan to complete it.`}
                    </p>
                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 12, lineHeight: 0 }}>
                      <QRCodeSVG value={preTestUrl} size={160} level="M" bgColor="#ffffff" fgColor="#000000" />
                    </div>
                    <a
                      href={preTestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 18px",
                        borderRadius: 12,
                        background: "#e11d48",
                        color: "white",
                        fontSize: 14,
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      {lang === "th" ? "เปิดแบบทดสอบ" : lang === "cn" ? "打开前测" : lang === "mm" ? "Pre-Test ဖွင့်ရန်" : "Open pre-test"}
                      <ArrowRight size={16} />
                    </a>
                  </div>
                );
              })()}

              {/* Score Mode — blocked: student is not registered for this event */}
              {scanMode === "score" && scanResult?.status === "not_registered" && (
                <div
                  style={{
                    marginTop: 24,
                    padding: 16,
                    borderRadius: 16,
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1.5px dashed rgba(239, 68, 68, 0.35)",
                    color: "#ef4444",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10
                  }}
                >
                  <UserX size={20} />
                  {lang === "th"
                    ? "ไม่สามารถมอบ/หักคะแนนได้ เนื่องจากนักศึกษายังไม่ได้ลงทะเบียนกิจกรรมนี้"
                    : lang === "cn"
                    ? "无法给分/扣分：该学生未报名此活动"
                    : lang === "mm"
                    ? "ဤကျောင်းသားသည် ဤပွဲတွင် စာရင်းမသွင်းထားသဖြင့် အမှတ်ပေး/နှုတ်၍မရပါ"
                    : "Can't award or deduct points — this student is not registered for this event."}
                </div>
              )}

              {/* Score Mode inputs — only for students registered for this event (status "found") */}
              {scanMode === "score" && scanResult?.status === "found" && scanResult?.rawToken && (
                <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.activityLabel}
                    </label>
                    <div style={{
                      padding: "12px 16px",
                      borderRadius: 12,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      overflowWrap: "break-word",
                      wordBreak: "break-word"
                    }}>
                      {events.find(e => e.id === eventId)?.title || (lang === "th" ? "ไม่ได้เลือกกิจกรรม" : "No event selected")}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.scoreToAward}
                    </label>

                    {/* Award / Deduct toggle — keeps the magnitude input positive and makes intent explicit */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <button
                        type="button"
                        onClick={() => setScoreSign(1)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          border: scoreSign === 1 ? "1.5px solid #10b981" : "1.5px solid var(--border-subtle)",
                          background: scoreSign === 1 ? "rgba(16,185,129,0.08)" : "var(--bg-elevated)",
                          color: scoreSign === 1 ? "#10b981" : "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          transition: "all 0.2s"
                        }}
                      >
                        <Plus size={16} /> {lang === "th" ? "เพิ่มคะแนน" : lang === "cn" ? "加分" : lang === "mm" ? "အမှတ်ပေါင်း" : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setScoreSign(-1)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          border: scoreSign === -1 ? "1.5px solid #ef4444" : "1.5px solid var(--border-subtle)",
                          background: scoreSign === -1 ? "rgba(239,68,68,0.08)" : "var(--bg-elevated)",
                          color: scoreSign === -1 ? "#ef4444" : "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          transition: "all 0.2s"
                        }}
                      >
                        <Minus size={16} /> {lang === "th" ? "หักคะแนน" : lang === "cn" ? "扣分" : lang === "mm" ? "အမှတ်နှုတ်" : "Deduct"}
                      </button>
                    </div>

                    <input
                      type="number"
                      className="input"
                      placeholder="e.g. 10"
                      min={1}
                      value={scoreInput}
                      onChange={(e) => setScoreInput(e.target.value)}
                      style={{ fontSize: 24, fontWeight: 900, textAlign: "center", padding: "12px 16px", color: scoreSign === -1 ? "#ef4444" : "var(--text-primary)" }}
                    />
                    {scoreInput && (parseInt(scoreInput) > 0) && (
                      <p style={{ fontSize: 13, fontWeight: 800, textAlign: "center", marginTop: 8, color: scoreSign === -1 ? "#ef4444" : "#10b981" }}>
                        {scoreSign === -1 ? "−" : "+"}{parseInt(scoreInput)} {lang === "th" ? "คะแนน" : "pts"}
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.scoreReasonLabel}
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder={t.scoreReasonPlaceholder}
                      value={scoreReason}
                      onChange={(e) => setScoreReason(e.target.value)}
                      style={{ fontSize: 16, fontWeight: 600, padding: "12px 16px" }}
                    />
                  </div>
                  
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => confirmScore(scanResult.rawToken!)}
                    disabled={submittingScore || !scoreInput}
                    style={{
                      background: !scoreInput ? "var(--bg-elevated)" : scoreSign === -1 ? "#ef4444" : "var(--accent-primary)",
                      color: !scoreInput ? "var(--text-muted)" : "white",
                      minHeight: 56,
                      borderRadius: 16,
                      fontSize: 16,
                      fontWeight: 700,
                      opacity: !scoreInput ? 0.7 : 1,
                      cursor: !scoreInput ? "not-allowed" : "pointer"
                    }}
                  >
                    {submittingScore
                      ? t.scoreAwarding
                      : scoreSign === -1
                        ? (lang === "th" ? "ยืนยันการหักคะแนน" : lang === "cn" ? "确认扣分" : lang === "mm" ? "အမှတ်နှုတ်ခြင်းကို အတည်ပြုရန်" : "Confirm Deduction")
                        : t.confirmScoreBtn}
                  </button>
                </div>
              )}

              {scanMode === "score" && scanResult?.status === "success" && (
                <div 
                  style={{ 
                    marginTop: 24, 
                    padding: 16, 
                    borderRadius: 16, 
                    background: "#10b981", 
                    color: "white", 
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    boxShadow: "0 10px 20px rgba(16, 185, 129, 0.3)"
                  }}
                >
                  <CheckCircle2 size={24} />
                  {scoreSign === -1
                    ? (lang === "th" ? "หักคะแนนเรียบร้อยแล้ว" : lang === "cn" ? "已成功扣分" : lang === "mm" ? "အမှတ်ကို အောင်မြင်စွာ နှုတ်ပြီးပါပြီ" : "Points Deducted Successfully")
                    : t.scoreAwardedSuccess}
                </div>
              )}

              {(() => {
                const isCloseDisabled = !!(
                  scanMode === "checkin" &&
                  scanResult?.student?.hasMedicalCondition && 
                  !medsCheckOption && 
                  scanResult?.status !== "pending_confirmation"
                );
                return (
                  <button 
                    className="btn btn-ghost btn-full" 
                    onClick={closeModal}
                    disabled={isCloseDisabled}
                    style={{ 
                      marginTop: 12, 
                      minHeight: 52, 
                      borderRadius: 16, 
                      fontSize: 16, 
                      fontWeight: 700,
                      opacity: isCloseDisabled ? 0.5 : 1,
                      cursor: isCloseDisabled ? "not-allowed" : "pointer"
                    }}
                  >
                    {lang === "th" ? "สแกนต่อ" : lang === "cn" ? "继续扫描" : lang === "mm" ? "စကင်ဖတ်ခြင်းကို ဆက်လုပ်ရန်" : "Continue Scanning"}
                  </button>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}