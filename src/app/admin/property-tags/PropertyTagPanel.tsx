"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, Check, Loader2, ScanLine, Tag, UserMinus, UserPlus, X } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { normalizeTagCode } from "@/lib/property-tag";
import { QR_SCANNER_CONSTRUCTOR_CONFIG, QR_SCANNER_START_CONFIG } from "@/lib/qr-scanner-config";
// Same dialog shell as the prize booth, so staff get one visual language for
// "a camera dialog that resolves something and asks to confirm".
import styles from "../prizes/PrizeAwardPanel.module.css";
import viewfinderStyles from "@/components/admin/QrViewfinder.module.css";

// Scan a property tag → see whether it's empty or whose it is → assign,
// change or remove the owner. See docs/features/property-tags.md.
//
// The student is identified by scanning their Digital ID (either order: the
// camera reads both QR kinds, and a scanned student is held until the tag
// arrives) or by search. Like PrizeAwardPanel, staff never TYPE an identity:
// the owner always resolves to a real users row.

interface Owner {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
  major: string | null;
}

interface StaffTag {
  code: string;
  label: string;
  groupName: string;
  groupStatus: "open" | "archived";
  owner: Owner | null;
}

interface SearchHit extends Owner {
  phoneMasked: string | null;
}

interface Warnings {
  alreadyOwnsInGroup: string[];
  seriesRoleMismatch: string | null;
}

// "student" = a tag is open and the camera waits for the owner's Digital ID.
type View = "scan" | "student" | "tag" | "preview" | "done";

export default function PropertyTagPanel({
  initialCode,
  onChanged,
  onClose,
}: {
  /** Open straight on this tag (from the group table) instead of the camera. */
  initialCode?: string;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<View>(initialCode ? "tag" : "scan");
  const [tag, setTag] = useState<StaffTag | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<{ student: Owner; warnings: Warnings } | null>(null);
  const [confirmUnassign, setConfirmUnassign] = useState(false);
  // A student whose Digital ID was scanned before the tag; consumed by the next tag.
  const [heldStudent, setHeldStudent] = useState<Owner | null>(null);

  const mountedRef = useRef(true);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stopPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const lookingUpRef = useRef(false);
  const heldStudentRef = useRef<Owner | null>(null);
  const tagRef = useRef<StaffTag | null>(null);
  const lastScanRef = useRef<string | null>(null);
  const searchSeqRef = useRef(0);
  const pickStudentRef = useRef<(id: string, code?: string) => Promise<void>>(async () => {});
  const onScanRef = useRef<(text: string) => void>(() => {});

  const roleName = (role: string) => (role === "smo" ? "SMO" : role === "anusmo" ? "ANUSMO" : role);

  const stopCamera = useCallback(() => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return stopPromiseRef.current;
    stopPromiseRef.current = stopPromiseRef.current.then(async () => {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // Already stopped / never started.
      }
    });
    return stopPromiseRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopCamera();
    };
  }, [stopCamera]);

  const lookup = useCallback(async (raw: string) => {
    if (lookingUpRef.current) return;
    lookingUpRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/property-tags/lookup?code=${encodeURIComponent(raw)}`);
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.status === "found") {
        const held = heldStudentRef.current;
        setTag(data.tag);
        setPicking(!data.tag.owner);
        setResults(null);
        setQuery("");
        setPreview(null);
        setConfirmUnassign(false);
        setView("tag");
        if ("vibrate" in navigator) navigator.vibrate(80);
        if (held) {
          // Student was scanned first: skip the search and go straight to confirm.
          heldStudentRef.current = null;
          setHeldStudent(null);
          void pickStudentRef.current(held.id, data.tag.code);
        }
      } else {
        if (data.status !== "invalid" && data.status !== "not_found") lastScanRef.current = null;
        setNotice({ tone: "error", text: data.status === "invalid" ? t.adminPtInvalid : data.status === "not_found" ? t.adminPtNotFound : t.adminPtError });
        setView("scan");
      }
    } catch {
      lastScanRef.current = null;
      if (mountedRef.current) {
        setNotice({ tone: "error", text: t.adminPtError });
        setView("scan");
      }
    } finally {
      lookingUpRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [t.adminPtInvalid, t.adminPtNotFound, t.adminPtError]);

  useEffect(() => {
    if (!initialCode) return;
    const timer = setTimeout(() => void lookup(initialCode), 0);
    return () => clearTimeout(timer);
  }, [initialCode, lookup]);

  // Camera runs only while the scan view (and so #property-qr-reader) is mounted.
  useEffect(() => {
    if (view !== "scan" && view !== "student") {
      void stopCamera();
      return;
    }
    let cancelled = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(typeof window !== "undefined" && window.isSecureContext === false ? t.adminPtCameraHttps : t.adminPtCameraError);
        return;
      }
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopPromiseRef.current;
      if (cancelled || !mountedRef.current) return;
      const scanner = new Html5Qrcode("property-qr-reader", QR_SCANNER_CONSTRUCTOR_CONFIG);
      scannerRef.current = scanner;
      setCameraError(null);
      try {
        await scanner.start(
          { facingMode: "environment" },
          // No reticle crop: a Digital ID QR is far denser than a tag's, and
          // the 75% box cut it off unless the phone was held well back. The
          // white guide is only an aiming hint here.
          { ...QR_SCANNER_START_CONFIG, qrbox: undefined },
          (decodedText) => {
            // The camera re-reads the same code every frame; handle each once.
            if (lookingUpRef.current || decodedText === lastScanRef.current) return;
            lastScanRef.current = decodedText;
            onScanRef.current(decodedText);
          },
          () => {},
        );
        if (cancelled) void stopCamera();
      } catch {
        if (mountedRef.current) setCameraError(t.adminPtCameraError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, stopCamera, t.adminPtCameraError, t.adminPtCameraHttps]);

  // A Digital ID QR: hold the student until a tag is scanned, or — when a tag is
  // already open — go straight to the confirm step.
  async function resolveStudent(raw: string) {
    if (lookingUpRef.current) return;
    lookingUpRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/property-tags/resolve-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: raw }),
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.status === "found") {
        if ("vibrate" in navigator) navigator.vibrate(80);
        const openTag = tagRef.current;
        if (view === "student" && openTag) {
          lookingUpRef.current = false;
          await pickStudentRef.current(data.student.id, openTag.code);
        } else {
          heldStudentRef.current = data.student;
          setHeldStudent(data.student);
        }
      } else {
        // A bad/expired code stays "seen" so the camera doesn't hammer the
        // server with it; a refreshed Digital ID is a different token.
        if (data.status !== "invalid") lastScanRef.current = null;
        setNotice({ tone: "error", text: data.status === "invalid" ? t.adminPtBadDigitalId : t.adminPtError });
      }
    } catch {
      lastScanRef.current = null;
      if (mountedRef.current) setNotice({ tone: "error", text: t.adminPtError });
    } finally {
      lookingUpRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleScan(text: string) {
    // Tag stickers are a /t/<code> URL (or a bare code); anything else is
    // treated as a Digital ID token and verified server-side.
    if (view === "scan" && normalizeTagCode(text)) void lookup(text);
    else void resolveStudent(text);
  }

  function clearHeldStudent() {
    lastScanRef.current = null;
    heldStudentRef.current = null;
    setHeldStudent(null);
  }

  useEffect(() => {
    onScanRef.current = handleScan;
  });
  useEffect(() => {
    tagRef.current = tag;
  }, [tag]);

  // Live search: results follow the typing (debounced), no Enter needed. The
  // sequence counter drops answers that arrive after a newer keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/property-tags/students?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (mountedRef.current && seq === searchSeqRef.current) setResults(Array.isArray(data.students) ? data.students : []);
      } catch {
        if (mountedRef.current && seq === searchSeqRef.current) setResults([]);
      } finally {
        if (mountedRef.current && seq === searchSeqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const searchActive = query.trim().length >= 2;
  const shownResults = searchActive ? results : null;
  const tagLike = normalizeTagCode(query);

  // A search hit: hold the student for the next tag (scan view) or go straight
  // to confirm (a tag is already open).
  function chooseStudent(hit: SearchHit) {
    if (tag) {
      void pickStudent(hit.id);
      return;
    }
    heldStudentRef.current = hit;
    setHeldStudent(hit);
    setQuery("");
    setResults(null);
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/property-tags/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function pickStudent(studentUserId: string, code = tag?.code) {
    if (!code) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await post({ action: "preview", code, studentUserId });
      if (!mountedRef.current) return;
      if (data.status === "preview") {
        setTag(data.tag);
        setPreview({ student: data.student, warnings: data.warnings });
        setView("preview");
      } else {
        setNotice({ tone: "error", text: t.adminPtError });
        setView("tag");
      }
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: t.adminPtError });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    pickStudentRef.current = pickStudent;
  });

  async function confirmAssign() {
    if (!tag || !preview) return;
    setBusy(true);
    try {
      const data = await post({
        action: "confirm",
        code: tag.code,
        studentUserId: preview.student.id,
        expectedOwnerId: tag.owner?.id ?? null,
      });
      if (!mountedRef.current) return;
      if (data.status === "success") {
        setTag(data.tag);
        setNotice({ tone: "ok", text: t.adminPtAssignedOk.replace("{name}", preview.student.name) });
        setView("done");
        onChanged?.();
      } else {
        setNotice({ tone: "error", text: data.status === "changed" ? t.adminPtChanged : t.adminPtError });
        setView("tag");
      }
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: t.adminPtError });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function doUnassign() {
    if (!tag?.owner) return;
    setBusy(true);
    try {
      const data = await post({ action: "unassign", code: tag.code, expectedOwnerId: tag.owner.id });
      if (!mountedRef.current) return;
      if (data.status === "success") {
        setTag(data.tag);
        setNotice({ tone: "ok", text: t.adminPtUnassignedOk });
        setView("done");
        onChanged?.();
      } else {
        setNotice({ tone: "error", text: data.status === "changed" ? t.adminPtChanged : t.adminPtError });
      }
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: t.adminPtError });
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setConfirmUnassign(false);
      }
    }
  }

  function scanNext() {
    clearHeldStudent();
    lastScanRef.current = null;
    setTag(null);
    setPreview(null);
    setResults(null);
    setQuery("");
    setNotice(null);
    setConfirmUnassign(false);
    setView("scan");
  }

  const noticeBox = notice && (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      style={{
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 13.5,
        fontWeight: 700,
        lineHeight: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: notice.tone === "error" ? "rgb(var(--red-500-rgb) / 0.1)" : "rgb(var(--green-500-rgb) / 0.12)",
        color: notice.tone === "error" ? "var(--red-600)" : "var(--teal-600)",
      }}
    >
      {notice.tone === "error" ? <AlertTriangle size={16} /> : <Check size={16} />} {notice.text}
    </p>
  );

  const tagHeader = tag && (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Tag size={22} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{tag.label}</p>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
          {tag.groupName} · {tag.code}
        </p>
      </div>
    </div>
  );

  const resultsList = shownResults && (
    shownResults.length === 0 ? (
      <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{searching ? t.adminPtChecking : t.adminPtNoResults}</p>
    ) : (
      <ul style={{ display: "flex", flexDirection: "column", gap: 4, listStyle: "none" }}>
        {shownResults.map((hit) => (
          <li key={hit.id}>
            <button
              onClick={() => chooseStudent(hit)}
              disabled={busy}
              style={{ width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", cursor: "pointer" }}
            >
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{hit.name}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)" }}>
                {[hit.studentId, hit.nickname, hit.major, hit.phoneMasked].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  );

  const ownerLine = (o: Owner) => (
    <>
      <p style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{o.name}</p>
      <p style={{ marginTop: 2, fontSize: 13.5, fontWeight: 600, color: "var(--text-secondary)" }}>
        {[o.studentId, o.nickname, o.major].filter(Boolean).join(" · ") || "—"}
      </p>
    </>
  );

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.dialog} animate-fade-in-up`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="property-tag-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="property-tag-title" style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>{t.adminPtAssignTitle}</h2>
          <button className={`btn btn-ghost ${styles.closeButton}`} onClick={onClose} aria-label={t.adminPtClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          {view === "scan" && (
            <>
              <div className={viewfinderStyles.viewfinder}>
                <div id="property-qr-reader" className={viewfinderStyles.reader} />
                <div className={viewfinderStyles.scanGuide} aria-hidden="true" />
              </div>
              {heldStudent ? (
                <div style={{ borderRadius: 16, padding: "12px 14px", background: "rgb(var(--green-500-rgb) / 0.08)", border: "1px solid rgb(var(--green-500-rgb) / 0.3)", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{heldStudent.name}</p>
                    <p style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                      {[heldStudent.studentId, heldStudent.nickname, heldStudent.major].filter(Boolean).join(" · ")}
                    </p>
                    <p style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: "var(--teal-600)" }}>{t.adminPtScanTagNext}</p>
                  </div>
                  <button className="btn btn-ghost" onClick={clearHeldStudent} aria-label={t.adminPtClearStudent}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center" }}>{t.adminPtScanHint}</p>
              )}
              {busy && (
                <p role="status" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: "var(--text-secondary)" }}>
                  <Loader2 size={16} className="animate-spin" /> {t.adminPtChecking}
                </p>
              )}
              {cameraError && (
                <p style={{ borderRadius: 12, padding: "10px 14px", fontSize: 12.5, background: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-700)", lineHeight: 1.5 }}>
                  {cameraError}
                </p>
              )}
              {noticeBox}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label htmlFor="property-search" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
                  {t.adminPtSearchOrCode}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="property-search"
                    className="input"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setNotice(null); }}
                    onKeyDown={(e) => e.key === "Enter" && tagLike && void lookup(query)}
                    placeholder={t.adminPtSearchPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ width: "100%", paddingRight: 40 }}
                  />
                  {searching && <Loader2 size={16} className="animate-spin" style={{ position: "absolute", right: 14, top: 14, color: "var(--text-muted)" }} />}
                </div>
                {tagLike && (
                  <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} disabled={busy} onClick={() => void lookup(query)}>
                    <Tag size={16} /> {t.adminPtOpenTag.replace("{code}", tagLike)}
                  </button>
                )}
                {resultsList}
              </div>
            </>
          )}

          {view === "student" && (
            <>
              {tagHeader}
              <div className={viewfinderStyles.viewfinder}>
                <div id="property-qr-reader" className={viewfinderStyles.reader} />
                <div className={viewfinderStyles.scanGuide} aria-hidden="true" />
              </div>
              <p style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center" }}>{t.adminPtScanStudentHint}</p>
              {cameraError && (
                <p style={{ borderRadius: 12, padding: "10px 14px", fontSize: 12.5, background: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-700)", lineHeight: 1.5 }}>
                  {cameraError}
                </p>
              )}
              {noticeBox}
              <button className="btn btn-ghost btn-full" onClick={() => { setNotice(null); setView("tag"); }}>{t.adminPtBack}</button>
            </>
          )}

          {view === "tag" && !tag && (
            <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "32px 0", color: "var(--text-muted)" }}>
              <Loader2 size={16} className="animate-spin" /> {t.adminPtChecking}
            </p>
          )}

          {view === "tag" && tag && (
            <>
              {tagHeader}
              {tag.groupStatus === "archived" && (
                <p style={{ fontSize: 12.5, color: "var(--amber-700)" }}>{t.adminPtGroupArchivedNote}</p>
              )}
              {noticeBox}
              {tag.owner ? (
                <div style={{ borderRadius: 16, padding: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{t.adminPtOwner}</p>
                  {ownerLine(tag.owner)}
                </div>
              ) : (
                <div style={{ borderRadius: 16, padding: 16, border: "2px dashed var(--border-medium)", color: "var(--text-secondary)", fontWeight: 700, fontSize: 14.5 }}>
                  {t.adminPtTagEmpty}
                </div>
              )}

              {tag.owner && !picking && !confirmUnassign && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button className="btn btn-primary btn-lg" style={{ flex: "1 1 160px" }} onClick={() => setPicking(true)}>
                    <UserPlus size={18} /> {t.adminPtReassign}
                  </button>
                  <button className="btn btn-ghost btn-lg" style={{ flex: "1 1 160px", color: "var(--red-600)" }} onClick={() => setConfirmUnassign(true)}>
                    <UserMinus size={18} /> {t.adminPtUnassign}
                  </button>
                </div>
              )}

              {tag.owner && confirmUnassign && (
                <div style={{ borderRadius: 16, padding: 16, background: "rgb(var(--red-500-rgb) / 0.08)", border: "1px solid rgb(var(--red-500-rgb) / 0.3)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5 }}>
                    {t.adminPtUnassignConfirm.replace("{name}", tag.owner.name)}
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmUnassign(false)} disabled={busy}>{t.adminPtCancel}</button>
                    <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => void doUnassign()} disabled={busy}>
                      {busy ? <Loader2 size={16} className="animate-spin" /> : t.adminPtUnassign}
                    </button>
                  </div>
                </div>
              )}

              {picking && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button className="btn btn-primary btn-lg btn-full" onClick={() => { setNotice(null); setView("student"); }}>
                    <ScanLine size={18} /> {t.adminPtScanDigitalId}
                  </button>
                  <p style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>{t.adminPtOrSearch}</p>
                  <div style={{ position: "relative" }}>
                    <input
                      className="input"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t.adminPtPickStudent}
                      aria-label={t.adminPtPickStudent}
                      autoFocus
                      autoComplete="off"
                      style={{ width: "100%", paddingRight: 40 }}
                    />
                    {searching && <Loader2 size={16} className="animate-spin" style={{ position: "absolute", right: 14, top: 14, color: "var(--text-muted)" }} />}
                  </div>
                  {resultsList}
                  {tag.owner && (
                    <button className="btn btn-ghost" onClick={() => { setPicking(false); setResults(null); setQuery(""); }}>{t.adminPtCancel}</button>
                  )}
                </div>
              )}

              <button className="btn btn-ghost btn-full" onClick={scanNext}>{t.adminPtNextTag}</button>
            </>
          )}

          {view === "preview" && tag && preview && (
            <>
              {tagHeader}
              <div style={{ borderRadius: 16, padding: 16, background: "rgb(var(--green-500-rgb) / 0.08)", border: "1px solid rgb(var(--green-500-rgb) / 0.3)" }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
                  {tag.owner ? t.adminPtReassignFrom.replace("{name}", tag.owner.name) : t.adminPtAssignTo}
                </p>
                {ownerLine(preview.student)}
              </div>
              {(preview.warnings.alreadyOwnsInGroup.length > 0 || preview.warnings.seriesRoleMismatch) && (
                <div style={{ borderRadius: 14, padding: "12px 14px", background: "rgb(var(--amber-500-rgb) / 0.12)", color: "var(--amber-700)", fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 6 }}>
                  {preview.warnings.alreadyOwnsInGroup.length > 0 && (
                    <p style={{ display: "flex", gap: 8 }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      {t.adminPtWarnAlreadyOwns.replace("{labels}", preview.warnings.alreadyOwnsInGroup.join(", "))}
                    </p>
                  )}
                  {preview.warnings.seriesRoleMismatch && (
                    <p style={{ display: "flex", gap: 8 }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      {t.adminPtWarnSeries
                        .replace("{series}", tag.label.split("-")[0])
                        .replace("{role}", roleName(preview.warnings.seriesRoleMismatch))}
                    </p>
                  )}
                </div>
              )}
              {noticeBox}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={() => { setPreview(null); setView("tag"); }} disabled={busy}>
                  {t.adminPtBack}
                </button>
                <button className="btn btn-success-solid btn-lg" style={{ flex: 1 }} onClick={() => void confirmAssign()} disabled={busy}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : t.adminPtConfirm}
                </button>
              </div>
            </>
          )}

          {view === "done" && tag && (
            <>
              {tagHeader}
              {noticeBox}
              {tag.owner && (
                <div style={{ borderRadius: 16, padding: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  {ownerLine(tag.owner)}
                </div>
              )}
              <button className="btn btn-primary btn-lg btn-full" onClick={scanNext}>{t.adminPtNextTag}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
