"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { compressImageFile } from "@/lib/compress-image";
import { Camera, Check, X, AlertTriangle, Loader2, Search } from "lucide-react";

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
  const [scanning, setScanning] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<(ClaimResult & { rawToken?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<{ claimId: string; student: ClaimStudent } | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<ClaimStudent[]>([]);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const lastTokenRef = useRef<string | null>(null);
  const previewOpenRef = useRef(false);

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
      setPreview({ ...data, rawToken: qrToken });
      if ("vibrate" in navigator) navigator.vibrate(data.status === "success" ? [90, 40, 90] : 200);
    } catch {
      if (mountedRef.current) setPreview({ status: "error", student: null, error: "Connection error" });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [prizeId]);

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
            ? "Camera blocked: open this site over its https:// address (or localhost)."
            : "This browser/device does not expose a camera API.",
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
          { fps: 10, qrbox: { width: 260, height: 260 } },
          async (decodedText) => {
            // Ignore repeats of the token already on screen: the camera fires
            // many times a second and the student keeps holding their phone up.
            if (lastTokenRef.current === decodedText || previewOpenRef.current) return;
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
        if (mountedRef.current) setCameraError("Could not start the camera. Check the permission and try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scanning, stopCamera, runPreview]);

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
        setCommitted({ claimId: data.claimId, student: data.student });
        setPreview(null);
        onClaimed();
      } else {
        // Includes the 409 duplicate that only surfaced at insert time (two
        // staffers scanning the same student at once) — show it like any other
        // refusal rather than as an error.
        setPreview({ ...data, rawToken: body.qrToken });
      }
    } catch {
      if (mountedRef.current) setPreview({ status: "error", student: null, error: "Connection error" });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!committed) return;
    setPhotoState("uploading");
    try {
      const compressed = await compressImageFile(file);
      const form = new FormData();
      form.append("file", compressed);
      const up = await fetch("/api/forms/upload", { method: "POST", body: form });
      if (!up.ok) throw new Error("upload failed");
      const { key } = await up.json();

      const attach = await fetch(`/api/admin/prizes/claims/${committed.claimId}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoKey: key }),
      });
      if (!attach.ok) throw new Error("attach failed");
      if (mountedRef.current) setPhotoState("done");
      onClaimed();
    } catch {
      // The CLAIM is already saved — only the photo failed. Say so explicitly,
      // because "failed" on this screen otherwise reads as "nothing was recorded"
      // and staff will try to hand the prize over a second time.
      if (mountedRef.current) setPhotoState("failed");
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
    lastTokenRef.current = null;
    setPreview(null);
    setCommitted(null);
    setPhotoState("idle");
    setManualResults([]);
    setManualQuery("");
    setScanning(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl dark:bg-neutral-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">แจกรางวัล</p>
            <h2 className="text-lg font-semibold">{prizeName}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ---- Committed: the handover is recorded; now the photo ---- */}
        {committed ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-center gap-2 font-semibold text-green-800 dark:text-green-300">
                <Check className="h-5 w-5" /> บันทึกการรับรางวัลแล้ว
              </div>
              <p className="mt-1 text-sm">
                {committed.student.name}
                {committed.student.studentId ? ` · ${committed.student.studentId}` : ""}
              </p>
            </div>

            <div className="rounded-xl border p-4 dark:border-neutral-700">
              <p className="text-sm font-medium">ถ่ายรูปนักศึกษาถือของรางวัล</p>
              <p className="mt-1 text-xs text-neutral-500">
                รูปนี้จะถูกเก็บเป็นหลักฐานและใช้ในรายงานที่ส่งคณบดี เก็บแบบไม่เปิดเผยต่อสาธารณะ
                และการเปิดดูทุกครั้งจะถูกบันทึกไว้
              </p>

              {photoState === "done" ? (
                <p className="mt-3 flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                  <Check className="h-4 w-4" /> แนบรูปแล้ว
                </p>
              ) : (
                <>
                  <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
                    {photoState === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {photoState === "uploading" ? "กำลังอัปโหลด…" : "ถ่ายรูป / เลือกรูป"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={photoState === "uploading"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadPhoto(f);
                      }}
                    />
                  </label>
                  {photoState === "failed" && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      อัปโหลดรูปไม่สำเร็จ — <strong>การรับรางวัลถูกบันทึกไว้แล้ว</strong> ไม่ต้องแจกซ้ำ
                      ลองแนบรูปใหม่ภายหลังจากรายการ &quot;รอรูป&quot;
                    </p>
                  )}
                </>
              )}
            </div>

            <button
              onClick={resetForNext}
              className="w-full rounded-lg border px-4 py-3 text-sm font-medium dark:border-neutral-700"
            >
              คนถัดไป
            </button>
          </div>
        ) : preview ? (
          /* ---- Preview: who it is, and whether they may have it ---- */
          <div className="space-y-4">
            <PreviewCard result={preview} />
            <div className="flex gap-2">
              <button
                onClick={resetForNext}
                className="flex-1 rounded-lg border px-4 py-3 text-sm font-medium dark:border-neutral-700"
              >
                สแกนใหม่
              </button>
              {preview.status === "success" && preview.student && (
                <button
                  disabled={busy}
                  onClick={() =>
                    confirmClaim(
                      preview.rawToken ? { qrToken: preview.rawToken } : { studentUserId: preview.student!.id },
                    )
                  }
                  className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "กำลังบันทึก…" : "ยืนยันการรับ"}
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ---- Scanning ---- */
          <div className="space-y-4">
            <div id="prize-qr-reader" className="overflow-hidden rounded-xl bg-black" />
            {cameraError && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {cameraError}
              </p>
            )}
            {busy && (
              <p className="flex items-center justify-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบ…
              </p>
            )}

            <details className="rounded-xl border p-3 dark:border-neutral-700">
              <summary className="cursor-pointer text-sm font-medium">สแกนไม่ได้? ค้นหาด้วยชื่อ/รหัส</summary>
              <div className="mt-3 flex gap-2">
                <input
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runManualSearch()}
                  placeholder="ชื่อ หรือ รหัสนักศึกษา"
                  className="flex-1 rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                />
                <button onClick={runManualSearch} className="rounded-lg border px-3 dark:border-neutral-700">
                  <Search className="h-4 w-4" />
                </button>
              </div>
              {/* No free-text entry: every option here is a real users row. */}
              <ul className="mt-2 divide-y dark:divide-neutral-700">
                {manualResults.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        setPreview({ status: "success", student: s });
                      }}
                      className="w-full py-2 text-left text-sm hover:opacity-70"
                    >
                      {s.name}
                      {s.studentId ? <span className="text-neutral-500"> · {s.studentId}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCard({ result }: { result: ClaimResult }) {
  const student = result.student;

  if (result.status === "success" && student) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
        <p className="text-lg font-semibold">{student.name}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {student.studentId ?? "ไม่มีรหัสนักศึกษาในระบบ"}
          {student.nickname ? ` · ${student.nickname}` : ""}
        </p>
        <p className="mt-2 text-sm text-green-800 dark:text-green-300">มีสิทธิ์รับรางวัลนี้</p>
      </div>
    );
  }

  const tone =
    result.status === "already_claimed"
      ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
      : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950";

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-5 w-5" />
        {result.status === "already_claimed" && "รับรางวัลนี้ไปแล้ว"}
        {result.status === "not_eligible" && "ยังไม่มีสิทธิ์รับ"}
        {result.status === "prize_closed" && "รางวัลนี้ปิดรับแล้ว"}
        {result.status === "not_found" && "ไม่พบนักศึกษาในระบบ"}
        {result.status === "error" && "เกิดข้อผิดพลาด"}
      </div>
      {student && (
        <p className="mt-1 text-sm">
          {student.name}
          {student.studentId ? ` · ${student.studentId}` : ""}
        </p>
      )}
      {/* The "why" matters more than the refusal: staff has a queue and needs to
          tell the student what to do next. */}
      {result.existingClaim && (
        <p className="mt-2 text-sm">
          รับไปแล้วเมื่อ {new Date(result.existingClaim.claimedAt).toLocaleString("th-TH")}
          {result.existingClaim.claimedByName ? ` โดย ${result.existingClaim.claimedByName}` : ""}
        </p>
      )}
      {result.status === "not_eligible" && result.requiredEventTitle && (
        <p className="mt-2 text-sm">ต้องเช็คอินกิจกรรม &quot;{result.requiredEventTitle}&quot; ก่อน</p>
      )}
      {result.error && !result.existingClaim && result.status !== "not_eligible" && (
        <p className="mt-2 text-sm">{result.error}</p>
      )}
    </div>
  );
}
