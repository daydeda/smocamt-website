"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { CheckCircle2, XCircle, AlertCircle, UserCheck, UserMinus, RefreshCcw, UserX, Award, Camera } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useSession } from "next-auth/react";
import { canAwardPrizes, canEditEventDirectly, canGiveIndividualScoreAny, canManagePropertyTags, effectiveRoles } from "@/lib/access/admin-access";
import { compressImageFile } from "@/lib/media/compress-image";
import { uploadFormViaXHR } from "@/lib/media/xhr-upload";
import { usePolling } from "@/lib/hooks/usePolling";
import { QR_SCANNER_CONSTRUCTOR_CONFIG, QR_SCANNER_START_CONFIG } from "@/lib/qr/qr-scanner-config";
import { isShopManager } from "@/lib/shop/shop-auth";
import { type ScanStatus, type ScanMode, ownsCamera, type ScanResult, type Event, pickCurrentSessionId, isEventLive, startsLaterToday, pruneAndCheckScannerCooldown, markScannerCooldown, SCANNER_SETTLED_STATUSES } from "../_components/scanner-parts";

// State, effects and handlers for ScannerScreen.tsx. Moved out of the page
// component so its JSX can be split into section components that read from
// this hook's result (passed down as `ctx`).
export function useScannerScreen({ embedded = false }: { embedded?: boolean }) {
  const { t, lang } = useLanguage();

  const { data: session } = useSession();

  const roles = effectiveRoles(session?.user?.role, session?.user?.roles);

  const canScore = canGiveIndividualScoreAny(roles);

  const canPrize = canAwardPrizes(roles);

  const canShop = isShopManager(session ?? null);

  const canProperty = canManagePropertyTags(roles);

  const canGoLive = canEditEventDirectly(
    effectiveRoles(session?.user?.role, session?.user?.roles),
    session?.user?.smoPosition,
    session?.user?.anusmoPosition,
  );

  const [events, setEvents] = useState<Event[]>([]);

  const [eventId, setEventId] = useState<string>("");

  const [sessionId, setSessionId] = useState<string>("");

  const [goLiveConfirmFor, setGoLiveConfirmFor] = useState<string | null>(null);

  const [goLiveBusy, setGoLiveBusy] = useState(false);

  const [goLiveError, setGoLiveError] = useState<{ eventId: string; message: string } | null>(null);

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

  const [checkoutFileKey, setCheckoutFileKey] = useState<string | null>(null);

  const [checkoutFileName, setCheckoutFileName] = useState<string | null>(null);

  const [uploadingCheckoutFile, setUploadingCheckoutFile] = useState(false);

  const [checkoutFileError, setCheckoutFileError] = useState<string | null>(null);

  const [isConfirmingCheckout, setIsConfirmingCheckout] = useState(false);

  const [scanMode, setScanMode] = useState<ScanMode>("checkin");

  const [scoreInput, setScoreInput] = useState<string>("");

  const [scoreSign, setScoreSign] = useState<1 | -1>(1);

  const [scoreReason, setScoreReason] = useState<string>("");

  const [submittingScore, setSubmittingScore] = useState(false);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const [dayDropdownOpen, setDayDropdownOpen] = useState(false);

  const dayDropdownRef = useRef<HTMLDivElement>(null);

  const [checkedInCount, setCheckedInCount] = useState<number | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const lastTokenRef = useRef<string | null>(null);

  const recentRef = useRef<Map<string, number>>(new Map());

  const eventIdRef = useRef<string>("");

  const sessionIdRef = useRef<string>("");

  const scanModeRef = useRef<ScanMode>("checkin");

  const isMountedRef = useRef(true);

  const scanSessionIdRef = useRef(0);

  const showModalRef = useRef(false);

  const manualSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const manualSearchSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  useEffect(() => () => {
    if (manualSearchTimerRef.current) clearTimeout(manualSearchTimerRef.current);
  }, []);

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

  usePolling((signal) => refreshCheckedInCount(signal), 8000);

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
    const scanner = new Html5Qrcode("qr-reader", QR_SCANNER_CONSTRUCTOR_CONFIG);
    scannerRef.current = scanner;
    if (isMountedRef.current) {
      setScannerError(null);
    }

    try {
      await scanner.start(
        { facingMode: "environment" },
        QR_SCANNER_START_CONFIG,
        async (decodedText) => {
          if (lastTokenRef.current === decodedText || showModalRef.current) return;
          // Same still-in-frame student re-decoding right after closing a
          // settled result (see SCANNER_COOLDOWN_MS) is not a new scan — drop
          // it before it ever reaches the server.
          if (pruneAndCheckScannerCooldown(recentRef.current, decodedText)) return;
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
            if (SCANNER_SETTLED_STATUSES.includes(result.status)) {
              recentRef.current.set(decodedText, Date.now());
            }
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

  const stopScanner = async () => {
    scanSessionIdRef.current++;
    const s = scannerRef.current;
    scannerRef.current = null;
    setIsScanning(false);
    if (!s) return;
    try {
      await s.stop();
      s.clear();
    } catch {
      // Already stopped / never started.
    }
  };

  const selectMode = (mode: ScanMode) => {
    if (mode === scanMode) return;
    const leavingPrize = ownsCamera(scanMode);
    setScanMode(mode);
    if (ownsCamera(mode)) {
      setShowModal(false);
      setScanResult(null);
      void stopScanner();
    } else if (leavingPrize && events.length > 0) {
      setTimeout(() => startScanner(), 0);
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

  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;
    // A mobile browser fires `resize` every time its URL bar collapses or
    // expands on scroll — several times during a single scanning session,
    // each one tearing the camera down and re-acquiring it (~1-2s of dead
    // scanner). Staff experienced this as "it randomly stops reading" while
    // just scrolling the page. Only restart when the width actually changed
    // by more than a trivial amount (an address-bar collapse moves the
    // viewport height, not the width) — a genuine layout change (rotating the
    // phone, resizing a desktop test window) still gets caught.
    let lastWidth = window.innerWidth;

    const scheduleRestart = () => {
      if (!isScanning) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (isMountedRef.current && isScanning) {
          startScanner();
        }
      }, 500); // 500ms debounce to let rotate animations settle
    };

    const handleResize = () => {
      const width = window.innerWidth;
      if (Math.abs(width - lastWidth) < 80) return;
      lastWidth = width;
      scheduleRestart();
    };

    const handleOrientationChange = () => {
      lastWidth = window.innerWidth;
      scheduleRestart();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, [isScanning]);

  const closeModal = () => {
    setShowModal(false);
    setTimeout(() => {
      if (isMountedRef.current) {
        setScanResult(null);
        // Safe to clear unconditionally: lastTokenRef only dedupes the camera
        // firing many times a second on ONE in-flight decode, never the ghost
        // "already checked in" case — that's the recentRef cooldown above,
        // which is deliberately time-based and NOT cleared here, so it keeps
        // suppressing a still-in-frame student's QR for the rest of its
        // window regardless of this close. Clearing lastTokenRef here is what
        // lets a genuine retry of the same code work immediately after a
        // transient error/mis-scan.
        lastTokenRef.current = null;
        setMedsCheckOption(null);
        setScoreInput("");
        setScoreSign(1);
        // A checkout photo not yet confirmed is an orphaned upload — reclaim it
        // (best-effort, mirrors the same cleanup pattern used for form-file
        // "file" answers abandoned mid-form).
        if (checkoutFileKey) {
          fetch(`/api/forms/upload?key=${encodeURIComponent(checkoutFileKey)}`, { method: "DELETE" }).catch(() => {});
        }
        setCheckoutFileKey(null);
        setCheckoutFileName(null);
        setCheckoutFileError(null);
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
      const confirmedStatus: ScanStatus = data.status ?? (res.ok ? "success" : "error");
      if (SCANNER_SETTLED_STATUSES.includes(confirmedStatus)) {
        recentRef.current.set(token, Date.now());
      }
      if (isMountedRef.current) {
        setScanResult({ status: confirmedStatus, ...data, rawToken: token });
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

  const uploadCheckoutEvidence = async (file: File) => {
    setCheckoutFileError(null);
    setUploadingCheckoutFile(true);
    try {
      const upload = await compressImageFile(file, { maxDim: 1600 });
      if (upload.size === 0) throw new Error("empty file");
      const form = new FormData();
      // uploadFormViaXHR (src/lib/xhr-upload.ts) re-materializes every
      // File/Blob before sending, which is where the WebKit-safety work
      // actually happens — this call site just appends the file as-is.
      form.append("file", upload);
      const up = await uploadFormViaXHR("/api/forms/upload", form);
      const data = up.body as { key?: string; error?: string };
      if (!up.ok) {
        const tooBig = up.status === 413;
        setCheckoutFileError((tooBig ? null : data?.error) ||
          (lang === "th" ? (tooBig ? "ไฟล์ใหญ่เกินไป" : "อัปโหลดไฟล์ไม่สำเร็จ")
            : lang === "cn" ? (tooBig ? "文件太大" : "文件上传失败")
            : lang === "mm" ? (tooBig ? "ဖိုင်အရွယ်အစား ကြီးလွန်းသည်" : "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ")
            : (tooBig ? "File is too large." : "File upload failed.")));
        return;
      }
      setCheckoutFileKey(data.key as string);
      setCheckoutFileName(file.name);
    } catch {
      setCheckoutFileError(lang === "th" ? "อัปโหลดไฟล์ไม่สำเร็จ" : lang === "cn" ? "文件上传失败" : lang === "mm" ? "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ" : "File upload failed.");
    } finally {
      setUploadingCheckoutFile(false);
    }
  };

  const removeCheckoutEvidence = () => {
    if (checkoutFileKey) {
      fetch(`/api/forms/upload?key=${encodeURIComponent(checkoutFileKey)}`, { method: "DELETE" }).catch(() => {});
    }
    setCheckoutFileKey(null);
    setCheckoutFileName(null);
  };

  const confirmCheckout = async (token: string) => {
    // events.checkOutEvidenceRequired (default true) — an event can opt out
    // of the mandatory proof photo, trusting staff's in-person confirmation
    // alone. See ScannerService.confirmCheckout for the server-side mirror
    // of this same check.
    const evidenceRequired = selectedEvent?.checkOutEvidenceRequired ?? true;
    if (evidenceRequired && !checkoutFileKey) return;
    setIsConfirmingCheckout(true);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrToken: token,
          eventId,
          sessionId: sessionId || undefined,
          action: "confirm_checkout",
          ...(checkoutFileKey ? { evidenceFileKey: checkoutFileKey } : {}),
        }),
      });
      const data = await res.json();
      const confirmedStatus: ScanStatus = data.status ?? (res.ok ? "success" : "error");
      // Same as confirmAttendance: without this the student's still-in-frame
      // QR re-decodes right after "Continue Scanning" and reopens a ghost
      // "already checked out" result.
      if (SCANNER_SETTLED_STATUSES.includes(confirmedStatus)) {
        markScannerCooldown(recentRef.current, token);
      }
      if (isMountedRef.current) {
        setScanResult({ status: confirmedStatus, ...data, rawToken: token });
      }
      if (res.ok) refreshCheckedInCount();
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
      // Consumed by a successful confirm — nothing left to clean up on close.
      if (res.ok) {
        setCheckoutFileKey(null);
        setCheckoutFileName(null);
      }
    } catch {
      if (isMountedRef.current) {
        setScanResult({ status: "error", error: "Connection error" });
      }
    } finally {
      if (isMountedRef.current) {
        setIsConfirmingCheckout(false);
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
      color: "var(--emerald-500)", 
      icon: UserCheck, 
      title: t.scanSuccess, 
      desc: t.scanSuccess,
      bg: "rgb(var(--emerald-500-rgb) / 0.1)"
    },
    success_walk_in: {
      color: "var(--emerald-500)",
      icon: UserCheck,
      title: t.scanSuccess + " (Walk-in)",
      desc: t.scanSuccess,
      bg: "rgb(var(--emerald-500-rgb) / 0.1)"
    },
    success_checkout: {
      color: "var(--emerald-500)",
      icon: UserCheck,
      title: t.scanCheckoutSuccess,
      desc: t.scanCheckoutSuccess,
      bg: "rgb(var(--emerald-500-rgb) / 0.1)"
    },
    pending_confirmation: {
      color: "var(--indigo-500)",
      icon: AlertCircle,
      title: t.manualCheckinTitle,
      desc: t.manualSearchPlaceholder,
      bg: "rgb(var(--indigo-500-rgb) / 0.1)"
    },
    pending_checkout: {
      color: "var(--amber-500)",
      icon: Camera,
      title: lang === "th" ? "รอเช็คเอาท์" : lang === "cn" ? "待签退" : lang === "mm" ? "checkout စောင့်ဆိုင်းနေသည်" : "Pending check-out",
      desc: lang === "th" ? "แนบรูปหลักฐานเพื่อยืนยันเช็คเอาท์" : lang === "cn" ? "附上证据照片以确认签退" : lang === "mm" ? "checkout အတည်ပြုရန် သက်သေပုံ ပူးတွဲပါ" : "Attach a proof photo to confirm check-out",
      bg: "rgb(var(--amber-500-rgb) / 0.1)"
    },
    already_checked_in: { 
      color: "var(--red-500)", 
      icon: RefreshCcw, 
      title: t.scanAlreadyCheckedIn, 
      desc: t.scanAlreadyCheckedIn,
      bg: "rgb(var(--red-500-rgb) / 0.1)"
    },
    already_checked_out: {
      color: "var(--blue-500)",
      icon: CheckCircle2,
      title: lang === "th" ? "เช็คเอาท์ไปแล้ว" : lang === "cn" ? "已签退" : lang === "mm" ? "checkout ပြီးသားဖြစ်သည်" : "Already Checked Out",
      desc: lang === "th" ? "นักศึกษาเช็คอินและเช็คเอาท์ครบแล้ว" : lang === "cn" ? "该学生已完成签到和签退" : lang === "mm" ? "ဤကျောင်းသားသည် check-in နှင့် checkout ပြီးပါပြီ" : "This student has already checked in and out",
      bg: "rgb(var(--blue-500-rgb) / 0.1)"
    },
    walk_ins_disabled: {
      color: "var(--amber-500)",
      icon: UserMinus,
      title: t.walkInsDisabledLabel || "Walk-ins Not Allowed",
      desc: t.walkInsDisabledError,
      bg: "rgb(var(--amber-500-rgb) / 0.1)"
    },
    not_found: { 
      color: "var(--red-500)", 
      icon: XCircle, 
      title: t.scanNotFound, 
      desc: t.scanNotFound,
      bg: "rgb(var(--red-500-rgb) / 0.1)"
    },
    quota_full: {
      color: "var(--amber-500)",
      icon: UserX,
      title: t.eventFull || "Event Full",
      desc: t.eventFull || "Event Full",
      bg: "rgb(var(--amber-500-rgb) / 0.1)"
    },
    // Score-mode student lookup (no check-in). Always overridden by the score-mode
    // cfg block below; this entry just satisfies the Record<ScanStatus> type.
    found: {
      color: "var(--accent-primary)",
      icon: Award,
      title: t.scanModeScore,
      desc: t.scanModeScore,
      bg: "rgb(var(--indigo-500-rgb) / 0.1)"
    },
    not_registered: {
      color: "var(--red-500)",
      icon: UserX,
      title: lang === "th" ? "ยังไม่ได้ลงทะเบียน" : lang === "cn" ? "未报名此活动" : lang === "mm" ? "ဤပွဲအတွက် စာရင်းမသွင်းရသေးပါ" : "Not Registered",
      desc: lang === "th" ? "นักศึกษายังไม่ได้ลงทะเบียนกิจกรรมนี้" : lang === "cn" ? "该学生未报名此活动" : lang === "mm" ? "ဤကျောင်းသားသည် ဤပွဲတွင် စာရင်းမသွင်းထားပါ" : "This student is not registered for this event",
      bg: "rgb(var(--red-500-rgb) / 0.1)"
    },
    error: { 
      color: "var(--red-500)", 
      icon: AlertCircle, 
      title: t.scanError, 
      desc: t.scanError,
      bg: "rgb(var(--red-500-rgb) / 0.1)"
    },
  };

  const selectedEvent = events.find((e) => e.id === eventId);

  const selectedEventIsLive = selectedEvent ? isEventLive(selectedEvent) : false;

  const otherLiveEvent = selectedEventIsLive ? undefined : events.find((e) => e.id !== eventId && isEventLive(e));

  const selectedEventUpcoming = !!selectedEvent && startsLaterToday(selectedEvent);

  const canGoLiveNow = canGoLive && selectedEventUpcoming;

  const goLiveConfirming = goLiveConfirmFor === eventId;

  const goLiveErrorMsg = goLiveError?.eventId === eventId ? goLiveError.message : null;

  const fmtClock = (iso: string) =>
    new Date(iso).toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

  const goLiveNow = async () => {
    if (!selectedEvent || goLiveBusy) return;
    const targetId = selectedEvent.id;
    setGoLiveBusy(true);
    setGoLiveError(null);
    try {
      const res = await fetch(`/api/admin/events/${targetId}/go-live`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!isMountedRef.current) return;
      setEvents((prev) =>
        prev.map((e) => (e.id === targetId ? { ...e, startTime: data.startTime, sessions: data.sessions } : e))
      );
      // Only re-pick the day if staff are still on this event.
      if (eventIdRef.current === targetId) setSessionId(pickCurrentSessionId(data.sessions));
      setGoLiveConfirmFor(null);
    } catch (err) {
      if (isMountedRef.current) setGoLiveError({ eventId: targetId, message: err instanceof Error ? err.message : "Failed to start event" });
    } finally {
      if (isMountedRef.current) setGoLiveBusy(false);
    }
  };

  const showSongsueNotice =
    scanMode === "checkin"
    && (scanResult?.status === "success" || scanResult?.status === "success_walk_in")
    && Boolean(selectedEvent?.songsueLinked);

  const isCheckoutStatus = scanResult?.status === "pending_checkout"
    || scanResult?.status === "success_checkout"
    || scanResult?.status === "already_checked_out";

  const showMedicalCheck = scanMode === "checkin" && !isCheckoutStatus && !!scanResult?.student?.hasMedicalCondition;

  let cfg = scanResult ? (STATUS_CONFIG[scanResult.status] || STATUS_CONFIG.error) : null;

  if (cfg && scanMode === "score") {
    if (scanResult?.status === "success") {
      cfg = {
        color: "var(--emerald-500)",
        icon: CheckCircle2,
        title: scoreSign === -1
          ? (lang === "th" ? "หักคะแนนสำเร็จ" : lang === "cn" ? "扣分成功" : lang === "mm" ? "အမှတ်နှုတ်ပြီး" : "Points Deducted")
          : (lang === "th" ? "มอบคะแนนสำเร็จ" : "Score Awarded"),
        desc: scoreSign === -1
          ? (lang === "th" ? "หักคะแนนเรียบร้อยแล้ว" : lang === "cn" ? "已成功扣分" : lang === "mm" ? "အမှတ်ကို အောင်မြင်စွာ နှုတ်ပြီးပါပြီ" : "The score has been deducted successfully")
          : (lang === "th" ? "มอบคะแนนเรียบร้อยแล้ว" : "The score has been added successfully"),
        bg: "rgb(var(--emerald-500-rgb) / 0.1)"
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
        bg: "rgb(var(--indigo-500-rgb) / 0.1)"
      };
    }
  } else if (cfg && showMedicalCheck) {
    cfg = {
      ...cfg,
      color: "var(--red-500)",
      icon: AlertCircle,
      bg: "rgb(var(--red-500-rgb) / 0.12)",
      title: lang === "th" ? "คำเตือนด้านสุขภาพ!" : lang === "cn" ? "健康警告！" : lang === "mm" ? "ကျန်းမာရေး သတိပေးချက်!" : "Medical Warning!",
      desc: lang === "th" ? "นักศึกษามีข้อมูลสุขภาพที่ลงทะเบียนไว้ โปรดตรวจสอบข้อมูลยาฉุกเฉินและข้อจำกัดสุขภาพ" : lang === "cn" ? "学生有已记录的健康状况。请核对药品与健康限制。" : lang === "mm" ? "ကျောင်းသားတွင် ကျန်းမာရေးအခြေအနေရှိသည်။ ဆေးဝါးและ ကျန်းမာရေးကန့်สတ်ချက်များကို สစ်ဆေးပါ။" : "Student has a recorded health condition. Please verify medication.",
    };
  }

  return {
    t,
    lang,
    session,
    roles,
    canScore,
    canPrize,
    canShop,
    canProperty,
    canGoLive,
    events,
    setEvents,
    eventId,
    setEventId,
    sessionId,
    setSessionId,
    goLiveConfirmFor,
    setGoLiveConfirmFor,
    goLiveBusy,
    setGoLiveBusy,
    goLiveError,
    setGoLiveError,
    scanResult,
    setScanResult,
    showModal,
    setShowModal,
    isScanning,
    setIsScanning,
    scannerError,
    setScannerError,
    loadingEvents,
    setLoadingEvents,
    eventsError,
    setEventsError,
    manualSearch,
    setManualSearch,
    manualResults,
    setManualResults,
    checkingIn,
    setCheckingIn,
    isConfirming,
    setIsConfirming,
    medsCheckOption,
    setMedsCheckOption,
    checkoutFileKey,
    setCheckoutFileKey,
    checkoutFileName,
    setCheckoutFileName,
    uploadingCheckoutFile,
    setUploadingCheckoutFile,
    checkoutFileError,
    setCheckoutFileError,
    isConfirmingCheckout,
    setIsConfirmingCheckout,
    scanMode,
    setScanMode,
    scoreInput,
    setScoreInput,
    scoreSign,
    setScoreSign,
    scoreReason,
    setScoreReason,
    submittingScore,
    setSubmittingScore,
    dropdownOpen,
    setDropdownOpen,
    dropdownRef,
    dayDropdownOpen,
    setDayDropdownOpen,
    dayDropdownRef,
    checkedInCount,
    setCheckedInCount,
    scannerRef,
    lastTokenRef,
    recentRef,
    eventIdRef,
    sessionIdRef,
    scanModeRef,
    isMountedRef,
    scanSessionIdRef,
    showModalRef,
    manualSearchTimerRef,
    manualSearchSeqRef,
    refreshCheckedInCount,
    startScanner,
    stopScanner,
    selectMode,
    closeModal,
    confirmAttendance,
    uploadCheckoutEvidence,
    removeCheckoutEvidence,
    confirmCheckout,
    confirmScore,
    handleManualSearch,
    manualCheckIn,
    STATUS_CONFIG,
    selectedEvent,
    selectedEventIsLive,
    otherLiveEvent,
    selectedEventUpcoming,
    canGoLiveNow,
    goLiveConfirming,
    goLiveErrorMsg,
    fmtClock,
    goLiveNow,
    showSongsueNotice,
    isCheckoutStatus,
    showMedicalCheck,
    cfg,
    embedded,
  };
}

export type ScannerScreenCtx = ReturnType<typeof useScannerScreen>;
