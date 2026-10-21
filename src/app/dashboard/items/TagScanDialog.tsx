"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { normalizeTagCode } from "@/lib/property-tag";
import { QR_SCANNER_CONSTRUCTOR_CONFIG, QR_SCANNER_START_CONFIG } from "@/lib/qr-scanner-config";
// Same dialog shell + viewfinder as the staff camera dialogs.
import styles from "@/app/admin/prizes/PrizeAwardPanel.module.css";
import viewfinderStyles from "@/components/admin/QrViewfinder.module.css";

// The student's in-app tag scanner. It only READS the QR and navigates to
// /t/<code>: the owner lookup, sign-in/onboarding checks and rate limit all
// live on that page, so this dialog can't show or leak anything itself.
export default function TagScanDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [opening, setOpening] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const handledRef = useRef(false);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // Already stopped / never started.
    }
  }, []);

  const open = useCallback((raw: string) => {
    const code = normalizeTagCode(raw);
    if (!code) {
      setNotice(t.itemsNotATag);
      return;
    }
    if (handledRef.current) return;
    handledRef.current = true;
    setOpening(true);
    void stopCamera();
    router.push(`/t/${code}`);
  }, [router, stopCamera, t.itemsNotATag]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(typeof window !== "undefined" && window.isSecureContext === false ? t.itemsCameraHttps : t.itemsCameraError);
        return;
      }
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled || !mountedRef.current) return;
      const scanner = new Html5Qrcode("student-tag-reader", QR_SCANNER_CONSTRUCTOR_CONFIG);
      scannerRef.current = scanner;
      try {
        await scanner.start({ facingMode: "environment" }, QR_SCANNER_START_CONFIG, (text) => open(text), () => {});
        if (cancelled) void stopCamera();
      } catch {
        if (mountedRef.current) setCameraError(t.itemsCameraError);
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      void stopCamera();
    };
    // The camera starts once per mount; `open` only closes over stable refs/router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.dialog} animate-fade-in-up`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-tag-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="student-tag-title" style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>{t.itemsScanTitle}</h2>
          <button className={`btn btn-ghost ${styles.closeButton}`} onClick={onClose} aria-label={t.itemsClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={viewfinderStyles.viewfinder}>
            <div id="student-tag-reader" className={viewfinderStyles.reader} />
            <div className={viewfinderStyles.scanGuide} aria-hidden="true" />
          </div>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.5 }}>{t.itemsScanHint}</p>

          {cameraError && (
            <p style={{ borderRadius: 12, padding: "10px 14px", fontSize: 12.5, background: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-700)", lineHeight: 1.5 }}>
              {cameraError}
            </p>
          )}
          {notice && (
            <p role="alert" style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 700, background: "rgb(var(--red-500-rgb) / 0.1)", color: "var(--red-600)" }}>
              <AlertTriangle size={16} /> {notice}
            </p>
          )}

          <div>
            <label htmlFor="student-tag-code" style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
              {t.itemsTypeCode}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="student-tag-code"
                className="input"
                value={typed}
                onChange={(e) => { setTyped(e.target.value); setNotice(null); }}
                onKeyDown={(e) => e.key === "Enter" && typed.trim() && open(typed)}
                placeholder="K7M2QX9TPA"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }}
              />
              <button className="btn btn-ghost" disabled={opening || !typed.trim()} onClick={() => open(typed)}>
                {opening ? <Loader2 size={16} className="animate-spin" /> : t.itemsLookup}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
