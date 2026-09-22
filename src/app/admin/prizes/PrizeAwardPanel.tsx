"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Html5Qrcode } from "html5-qrcode";
import { compressImageFile } from "@/lib/compress-image";
import { uploadFormViaXHR } from "@/lib/xhr-upload";
import { useLanguage } from "@/lib/LanguageContext";
import { Camera, Check, X, AlertTriangle, Loader2, Search, ImagePlus } from "lucide-react";

// The booth screen: scan → see who it is and whether they may have it → confirm
// → photo. See docs/features/prize-claim.md.
//
// Two rules this component exists to honour:
//  1. Staff never TYPE an identity. Scanning resolves the student server-side;
//     the manual fallback is a search that resolves to a real users row. A
//     hand-typed รหัสนักศึกษา at a busy booth produces rows pointing at nobody.
//  2. The claim is committed BEFORE the photo. If the venue wifi dies during
//     the upload we still have the handover on record — otherwise the duplicate
//     check silently switches off for everyone behind them in the queue.
//
// UI note: no `dark:` Tailwind classes here — this app is light-only by design
// (see the note at the top of PrizesClient.tsx). Styling mirrors
// admin/scanner/page.tsx (the same booth-camera screen for check-in) so staff
// get one consistent visual language: black camera box, big legible result
// state, large touch targets for a phone held at arm's length.

interface ClaimStudent {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
}

interface ClaimResult {
  status: "success" | "already_claimed" | "not_eligible" | "prize_closed" | "not_found" | "error";
  student: ClaimStudent | null;
  claimId?: string;
  existingClaim?: { claimedAt: string; claimedByName: string | null };
  requiredEventTitle?: string | null;
  error?: string;
  // Client-side only marker (never sent by the server): true when this
  // already_claimed result is for a student THIS panel session just awarded —
  // see justAwardedIdsRef below. Lets PreviewCard show a calm confirmation
  // instead of a refusal card for what is really just the camera catching the
  // same student a second time.
  justAwarded?: boolean;
}

// A student's QR token is stable for a 5-minute window (WINDOW_MS, see
// src/lib/qr-token.ts). Without a cooldown, clearing the "last decoded" guard
// on "Next person" lets the SAME still-in-frame student re-decode within
// milliseconds — the server then truthfully answers already_claimed (or
// success, for a rarer race) and a ghost refusal appears with nobody having
// scanned anything. This map remembers recently-SETTLED identifiers (the raw
// token AND, once known, the student's id) for a short grace period so a stray
// re-decode of the same person is silently dropped before it ever reaches the
// server. Only "success"/"already_claimed" are cooled down — those are the
// only two outcomes that are actually stable per-student; not_eligible/
// prize_closed/not_found/error may be transient or a genuine mis-scan staff
// wants to retry immediately, so they deliberately do NOT start a cooldown.
const PRIZE_SCAN_COOLDOWN_MS = 20_000;

function pruneAndCheckCooldown(map: Map<string, number>, key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of map) {
    if (now - ts > PRIZE_SCAN_COOLDOWN_MS) map.delete(k);
  }
  const ts = map.get(key);
  return ts !== undefined && now - ts < PRIZE_SCAN_COOLDOWN_MS;
}

function markCooldown(map: Map<string, number>, keys: (string | null | undefined)[]) {
  const now = Date.now();
  for (const k of keys) {
    if (k) map.set(k, now);
  }
}

export default function PrizeAwardPanel({
  prizeId,
  prizeName,
  onClaimed,
  onClose,
}: {
  prizeId: string;
  prizeName: string;
  onClaimed: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [scanning, setScanning] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<(ClaimResult & { rawToken?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<{ claimId: string; student: ClaimStudent } | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [photoErrorMessage, setPhotoErrorMessage] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<ClaimStudent[]>([]);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const lastTokenRef = useRef<string | null>(null);
  const previewOpenRef = useRef(false);
  // See PRIZE_SCAN_COOLDOWN_MS above. recentRef holds recently-settled
  // token/student-id → timestamp; justAwardedIdsRef is the whole-session set of
  // students this panel instance has successfully awarded, used to soften an
  // already_claimed result for one of them into a calm confirmation instead of
  // a refusal card (see PreviewCard's justAwarded handling below). Both are
  // fresh for every panel mount (the award dialog is remounted per open), so
  // neither needs explicit clearing.
  const recentRef = useRef<Map<string, number>>(new Map());
  const justAwardedIdsRef = useRef<Set<string>>(new Set());

  // Mirrored into a ref for the camera callback, which is created once when the
  // scanner starts and would otherwise close over the first render's state.
  useEffect(() => {
    previewOpenRef.current = !!preview || !!committed;
  }, [preview, committed]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // Already stopped / never started — nothing to unwind.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopCamera();
    };
  }, [stopCamera]);

  const runPreview = useCallback(async (qrToken: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/prizes/${prizeId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", qrToken }),
      });
      const data: ClaimResult = await res.json();
      if (!mountedRef.current) return;
      // "success" and "already_claimed" are both SETTLED, stable answers for
      // this student — start the cooldown so a still-in-frame QR doesn't
      // re-open the same preview a moment later (see PRIZE_SCAN_COOLDOWN_MS).
      if (data.status === "success" || data.status === "already_claimed") {
        markCooldown(recentRef.current, [qrToken, data.student?.id]);
      }
      // A student THIS panel session already awarded, now showing
      // already_claimed (e.g. the camera caught them again before the
      // cooldown above even applied) — show it as a calm confirmation, not a
      // refusal; nobody did anything wrong.
      const justAwarded = data.status === "already_claimed" && !!data.student
        && justAwardedIdsRef.current.has(data.student.id);
      setPreview({ ...data, rawToken: qrToken, justAwarded });
      if ("vibrate" in navigator) navigator.vibrate(data.status === "success" ? [90, 40, 90] : 200);
    } catch {
      if (mountedRef.current) setPreview({ status: "error", student: null, error: t.adminPrizesConnectionError });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [prizeId, t.adminPrizesConnectionError]);

  useEffect(() => {
    if (!scanning) {
      void stopCamera();
      return;
    }

    let cancelled = false;
    (async () => {
      // A plain-HTTP origin (e.g. http://192.168.x.x) has the camera blocked
      // outright with no permission prompt, which otherwise looks like a broken
      // page. Same check the scanner page makes.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          typeof window !== "undefined" && window.isSecureContext === false
            ? t.adminPrizesCameraBlockedHttps
            : t.adminPrizesCameraNoApi,
        );
        return;
      }

      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled || !mountedRef.current) return;

      const scanner = new Html5Qrcode("prize-qr-reader");
      scannerRef.current = scanner;
      setCameraError(null);

      try {
        await scanner.start(
          { facingMode: "environment" },
          // aspectRatio: 1 requests a roughly square camera stream. Without
          // it, a webcam's native (often tall-portrait, e.g. a laptop selfie
          // cam) resolution is used unmodified, so the video — and the
          // reticle centered within it — end up much taller than the qrbox,
          // reading as "off-center" even though it's centered in that tall
          // frame. Square keeps the visible frame close to the qrbox itself.
          { fps: 10, qrbox: { width: 280, height: 280 }, aspectRatio: 1 },
          async (decodedText) => {
            // Ignore repeats of the token already on screen: the camera fires
            // many times a second and the student keeps holding their phone up.
            // Also drop anything still on cooldown (PRIZE_SCAN_COOLDOWN_MS) —
            // the same still-in-frame student re-decoding right after "Next
            // person" is not a new scan, so it's dropped before it ever
            // reaches the server.
            if (lastTokenRef.current === decodedText || previewOpenRef.current) return;
            if (pruneAndCheckCooldown(recentRef.current, decodedText)) return;
            lastTokenRef.current = decodedText;
            await runPreview(decodedText);
          },
          () => {},
        );

        // A device with no rear camera (a laptop at the desk) falls back to the
        // front one, which is face-to-face and needs mirroring to feel right.
        try {
          const settings = scanner.getRunningTrackSettings();
          const video = document.querySelector<HTMLVideoElement>("#prize-qr-reader video");
          if (video) {
            video.style.transform = settings.facingMode === "environment" ? "none" : "scaleX(-1)";
          }
        } catch {
          // getRunningTrackSettings isn't available everywhere; the un-mirrored
          // view is still usable.
        }
      } catch {
        if (mountedRef.current) setCameraError(t.adminPrizesCameraStartError);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scanning, stopCamera, runPreview, t.adminPrizesCameraBlockedHttps, t.adminPrizesCameraNoApi, t.adminPrizesCameraStartError]);

  async function confirmClaim(body: { qrToken?: string; studentUserId?: string }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/prizes/${prizeId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", ...body }),
      });
      const data: ClaimResult = await res.json();
      if (!mountedRef.current) return;

      if (data.status === "success" && data.claimId && data.student) {
        // This student is now SETTLED for this prize — cool their token/id down
        // (PRIZE_SCAN_COOLDOWN_MS) so the camera catching them again right after
        // "Next person" doesn't reopen a ghost already_claimed preview, and
        // remember them for the rest of this panel session so it can be shown
        // as a calm confirmation if it ever does (see justAwardedIdsRef).
        markCooldown(recentRef.current, [body.qrToken, data.student.id]);
        justAwardedIdsRef.current.add(data.student.id);
        setCommitted({ claimId: data.claimId, student: data.student });
        setPreview(null);
        onClaimed();
      } else {
        // Includes the 409 duplicate that only surfaced at insert time (two
        // staffers scanning the same student at once) — show it like any other
        // refusal rather than as an error. Same settled-outcome cooldown as
        // runPreview.
        if (data.status === "already_claimed") {
          markCooldown(recentRef.current, [body.qrToken, data.student?.id]);
        }
        const justAwarded = data.status === "already_claimed" && !!data.student
          && justAwardedIdsRef.current.has(data.student.id);
        setPreview({ ...data, rawToken: body.qrToken, justAwarded });
      }
    } catch {
      if (mountedRef.current) setPreview({ status: "error", student: null, error: t.adminPrizesConnectionError });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!committed) return;
    setPhotoState("uploading");
    setPhotoErrorMessage(null);
    try {
      const compressed = await compressImageFile(file);
      // Confirmed on iOS: the server sometimes receives a well-formed
      // multipart Content-Type but Content-Length: 0 — the body never
      // arrives. This check tells us, from what's on the STAFF'S OWN SCREEN,
      // whether the blob was already empty before we even touch the network
      // — no server-log spelunking needed to isolate which half is broken.
      if (compressed.size === 0) {
        throw new Error(
          "Photo data was empty before upload (0 bytes) — this looks like a camera/browser issue. Try picking an existing photo from your library instead of taking a new one.",
        );
      }
      const form = new FormData();
      // uploadFormViaXHR (src/lib/xhr-upload.ts) re-materializes every
      // File/Blob before sending — that's where the actual WebKit-safety
      // work happens, so this call site just appends the file as-is.
      form.append("file", compressed);
      const up = await uploadFormViaXHR("/api/forms/upload", form);
      if (!up.ok) throw new Error((up.body.error as string) || "upload failed");
      const { key } = up.body as { key: string };

      const attach = await fetch(`/api/admin/prizes/claims/${committed.claimId}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoKey: key }),
      });
      if (!attach.ok) throw new Error("attach failed");
      if (mountedRef.current) setPhotoState("done");
      onClaimed();
    } catch (e) {
      // The CLAIM is already saved — only the photo failed. Say so explicitly,
      // because "failed" on this screen otherwise reads as "nothing was recorded"
      // and staff will try to hand the prize over a second time. Surface the
      // server's actual reason (wrong format, too large, ...) rather than a
      // blanket "failed" — staff at the booth need to know WHAT to fix.
      if (mountedRef.current) {
        setPhotoErrorMessage(e instanceof Error ? e.message : null);
        setPhotoState("failed");
      }
    }
  }

  async function runManualSearch() {
    const q = manualQuery.trim();
    if (q.length < 2) return;
    setBusy(true);
    try {
      // Reuses the scanner's own student search (ScannerService.searchStudents),
      // which returns an array and deliberately omits qrToken. Not a new search
      // surface — one fewer place that can leak the student directory.
      const res = await fetch(`/api/admin/scan?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (mountedRef.current) setManualResults(Array.isArray(data) ? data : []);
    } catch {
      if (mountedRef.current) setManualResults([]);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function resetForNext() {
    // Safe to clear unconditionally: the "last decoded" pointer only dedupes
    // rapid-fire re-decodes of the SAME in-flight scan (the camera fires many
    // times a second), never the ghost-refusal case — that's now the
    // recentRef cooldown above, which is deliberately time-based and NOT
    // cleared here, so it keeps suppressing a still-in-frame student's QR for
    // the rest of its window regardless of this reset. Clearing lastTokenRef
    // here is what lets a genuine retry of the same code (e.g. after a
    // transient network error) work immediately via "Rescan".
    lastTokenRef.current = null;
    setPreview(null);
    setCommitted(null);
    setPhotoState("idle");
    setPhotoErrorMessage(null);
    setManualResults([]);
    setManualQuery("");
    setScanning(true);
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "clamp(12px, 4vw, 24px)",
      }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)",
          width: "100%",
          maxWidth: 480,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "clamp(20px, 5vw, 24px)",
          overflow: "hidden",
          boxShadow: "0 30px 60px rgba(0,0,0,0.25)",
          border: "1px solid var(--border-medium)",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.adminPrizesAwardBtn}</p>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "break-word" }}>{prizeName}</h2>
          </div>
          <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0, flexShrink: 0 }} onClick={onClose} aria-label={t.adminPrizesCloseLabel}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {committed ? (
            /* ---- Committed: the handover is recorded; now the photo ---- */
            <>
              <div style={{ borderRadius: 16, padding: 16, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0d9488", fontSize: 15 }}>
                  <Check size={20} /> {t.adminPrizesCommittedTitle}
                </div>
                <p style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                  {committed.student.name}
                  {committed.student.studentId ? ` · ${committed.student.studentId}` : ""}
                </p>
              </div>

              <div style={{ borderRadius: 16, padding: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t.adminPrizesPhotoCardTitle}</p>
                <p style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {t.adminPrizesPhotoCardHint}
                </p>

                {photoState === "done" ? (
                  <p style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "#0d9488" }}>
                    <Check size={16} /> {t.adminPrizesPhotoAttached}
                  </p>
                ) : (
                  <>
                    {/* Two separate inputs, not one bare accept="image/*": Android's
                        OEM file picker (Samsung/Xiaomi/the Android 13+ Photo Picker)
                        frequently shows gallery-only when there's no `capture`
                        attribute to force the camera — the camera option simply
                        isn't there, not merely un-obvious. `capture="environment"`
                        on the first input guarantees the camera opens; the second
                        input (no `capture`) keeps the existing HEIC-escape-hatch —
                        staff can pick an already-converted photo when the phone's
                        native camera format fails to upload. Both share the same
                        uploadPhoto() handler. */}
                    {/* flexWrap so the two buttons stack instead of clipping
                        their label text on a narrow phone (checked at 360px);
                        smaller padding than btn-lg's default gives each one more
                        breathing room before that wrap point is needed at all. */}
                    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label
                        className="btn btn-primary btn-lg"
                        style={{ flex: "1 1 150px", padding: "12px 16px", cursor: photoState === "uploading" ? "not-allowed" : "pointer" }}
                      >
                        {photoState === "uploading" ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                        {photoState === "uploading" ? t.adminPrizesPhotoUploading : t.adminPrizesPhotoCtaCamera}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          style={{ display: "none" }}
                          disabled={photoState === "uploading"}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadPhoto(f);
                          }}
                        />
                      </label>
                      <label
                        className="btn btn-ghost btn-lg"
                        style={{ flex: "1 1 150px", padding: "12px 16px", cursor: photoState === "uploading" ? "not-allowed" : "pointer" }}
                      >
                        <ImagePlus size={18} />
                        {t.adminPrizesPhotoCtaGallery}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          disabled={photoState === "uploading"}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadPhoto(f);
                          }}
                        />
                      </label>
                    </div>
                    {typeof window !== "undefined" && window.isSecureContext === false && (
                      <p style={{ marginTop: 10, fontSize: 12.5, color: "#b45309", lineHeight: 1.5 }}>
                        {t.adminPrizesCameraBlockedHttps}
                      </p>
                    )}
                    {photoState === "failed" && (
                      <p style={{ marginTop: 10, fontSize: 12.5, color: "#b45309", lineHeight: 1.5 }}>
                        {t.adminPrizesPhotoFailedNotice} <strong>{t.adminPrizesPhotoFailedEmphasis}</strong>{" "}
                        {t.adminPrizesPhotoFailedRetry}
                        {photoErrorMessage && (
                          <>
                            <br />
                            {photoErrorMessage}
                          </>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>

              <button className="btn btn-ghost btn-lg btn-full" onClick={resetForNext}>
                {t.adminPrizesNextPerson}
              </button>
            </>
          ) : preview ? (
            /* ---- Preview: who it is, and whether they may have it ---- */
            <>
              <PreviewCard result={preview} />
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={resetForNext}>
                  {t.adminPrizesRescan}
                </button>
                {preview.status === "success" && preview.student && (
                  <button
                    className="btn btn-success-solid btn-lg"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() =>
                      confirmClaim(
                        preview.rawToken ? { qrToken: preview.rawToken } : { studentUserId: preview.student!.id },
                      )
                    }
                  >
                    {busy ? t.saving : t.adminPrizesConfirmClaim}
                  </button>
                )}
              </div>
            </>
          ) : (
            /* ---- Scanning ---- */
            <>
              <div
                style={{
                  background: "#000",
                  borderRadius: "var(--radius-xl)",
                  overflow: "hidden",
                  border: "8px solid var(--bg-surface)",
                  boxShadow: "0 40px 80px rgba(0,0,0,0.15)",
                  // Square, matching the aspectRatio:1 requested from the
                  // camera above — bounds the box instead of letting it grow
                  // to a webcam's native (often tall-portrait) resolution.
                  aspectRatio: "1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <div
                  id="prize-qr-reader"
                  style={{
                    width: "100%",
                    height: "100%",
                    // html5-qrcode sizes the <video> it inserts here to the
                    // container's width and leaves height auto, so if the
                    // camera doesn't actually deliver a square stream (many
                    // webcams ignore the requested aspectRatio and fall back
                    // to their native ratio) the video renders shorter or
                    // taller than this square box. Centering it here keeps
                    // the reticle looking centered in the visible black
                    // frame instead of pinned to the top.
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                />
              </div>
              {cameraError && (
                <p style={{ borderRadius: 12, padding: "10px 14px", fontSize: 12.5, background: "rgba(245,158,11,0.1)", color: "#b45309", lineHeight: 1.5 }}>
                  {cameraError}
                </p>
              )}
              {busy && (
                <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 14, color: "var(--text-muted)" }}>
                  <Loader2 size={16} className="animate-spin" /> {t.adminPrizesChecking}
                </p>
              )}

              <details style={{ borderRadius: 16, border: "1px solid var(--border-subtle)", padding: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "var(--text-secondary)" }}>
                  {t.adminPrizesManualSearchToggle}
                </summary>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <input
                    className="input"
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runManualSearch()}
                    placeholder={t.adminPrizesManualSearchPlaceholder}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost" onClick={runManualSearch} aria-label={t.adminPrizesSearchLabel}>
                    <Search size={16} />
                  </button>
                </div>
                {/* No free-text entry: every option here is a real users row. */}
                {manualResults.length > 0 && (
                  <ul style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                    {manualResults.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => setPreview({ status: "success", student: s })}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 10px",
                            borderRadius: 10,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 14,
                            color: "var(--text-primary)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          {s.name}
                          {s.studentId ? <span style={{ color: "var(--text-muted)" }}> · {s.studentId}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Color tokens match the app's .badge-* families (green/yellow/red in
// globals.css) so a "duplicate" or "not eligible" refusal reads with the same
// visual weight staff already recognize from badges elsewhere in admin.
function PreviewCard({ result }: { result: ClaimResult }) {
  const { t } = useLanguage();
  const student = result.student;

  if (result.status === "success" && student) {
    return (
      <div style={{ borderRadius: 16, padding: 18, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
        <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>{student.name}</p>
        <p style={{ marginTop: 2, fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
          {student.studentId ?? t.adminPrizesNoStudentId}
          {student.nickname ? ` · ${student.nickname}` : ""}
        </p>
        <p style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "#0d9488" }}>{t.adminPrizesEligibleNotice}</p>
      </div>
    );
  }

  // A student THIS session already awarded, decoded again (the cooldown above
  // should already stop this at the source, but a second staff device or a
  // manual re-pick isn't covered by it) — a calm confirmation, not a refusal.
  // Nobody did anything wrong; there's nothing to act on.
  if (result.status === "already_claimed" && result.justAwarded && student) {
    return (
      <div style={{ borderRadius: 16, padding: 18, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, color: "#0d9488" }}>
          <Check size={20} />
          {t.adminPrizesAlreadyRecordedJustNow}
        </div>
        <p style={{ marginTop: 6, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
          {student.name}
          {student.studentId ? ` · ${student.studentId}` : ""}
        </p>
      </div>
    );
  }

  const tone =
    result.status === "already_claimed"
      ? { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", color: "#b45309" }
      : { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", color: "#dc2626" };

  return (
    <div style={{ borderRadius: 16, padding: 18, background: tone.bg, border: `1px solid ${tone.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, color: tone.color }}>
        <AlertTriangle size={20} />
        {result.status === "already_claimed" && t.adminPrizesStatusAlreadyClaimed}
        {result.status === "not_eligible" && t.adminPrizesStatusNotEligible}
        {result.status === "prize_closed" && t.adminPrizesStatusClosed}
        {result.status === "not_found" && t.adminPrizesStatusNotFound}
        {result.status === "error" && t.adminPrizesStatusError}
      </div>
      {student && (
        <p style={{ marginTop: 6, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
          {student.name}
          {student.studentId ? ` · ${student.studentId}` : ""}
        </p>
      )}
      {/* The "why" matters more than the refusal: staff has a queue and needs to
          tell the student what to do next. */}
      {result.existingClaim && (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          {t.adminPrizesClaimedAt.replace("{date}", new Date(result.existingClaim.claimedAt).toLocaleString("th-TH"))}
          {result.existingClaim.claimedByName ? t.adminPrizesClaimedBy.replace("{name}", result.existingClaim.claimedByName) : ""}
        </p>
      )}
      {result.status === "not_eligible" && result.requiredEventTitle && (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          {t.adminPrizesRequiredEventNotice.replace("{event}", result.requiredEventTitle)}
        </p>
      )}
      {result.error && !result.existingClaim && result.status !== "not_eligible" && (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>{result.error}</p>
      )}
    </div>
  );
}
