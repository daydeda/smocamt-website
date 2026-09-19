"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { uploadFormViaXHR } from "@/lib/xhr-upload";
import { Calendar, History, Trophy, Sparkles, ArrowRight, ArrowLeft, X, Star, CheckCircle2, ClipboardList, Lock, Save, AlertTriangle, Paperclip } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import Link from "next/link";
import {
  normalizeForm,
  allQuestions,
  resolveNextSection,
  isQuestionVisible,
  type NormalizedForm,
  type FormQuestion as Question,
  type AnswerMap,
} from "@/lib/form-schema";

const FORM_TYPE_LABELS: Record<string, string> = {
  K_pre: "K Pre-Test",
  K_post: "K Post-Test",
  A: "A - Attitude",
  S: "S - Skill",
};

// Auto-save draft key. Drafts live only in this browser's localStorage —
// never sent to the server, so they cost nothing against Supabase/Vercel
// quotas. Keyed per event+form so each form keeps its own in-progress answers.
const draftKey = (eventId: string, formId: string) => `activecamt:form-draft:${eventId}:${formId}`;

interface EventFormStatus {
  id: string;
  formType: string;
  title: string;
  sortOrder: number;
  formStatus: "available" | "submitted" | "closed" | "upcoming";
  formPoints: number;
  formIndividualPoints: number;
  opensAt: string | null;
  closesAt: string | null;
}

interface SessionStatus {
  sessionId: string;
  title: string | null; // null → derive "Day N" in the UI
  startTime: string | null;
  checkInTime: string | null;
  method?: string | null;
  rank: number | null; // check-in order within this session; null if not checked in
}

interface HistoryItem {
  id: string;
  eventId: string;
  eventImageUrl: string | null;
  eventTitle: string;
  checkInTime: string | null;
  eventStartTime: string;
  eventEndTime?: string;
  eventQuota: number | null;
  rank: number | null; // check-in order; null when registered but not yet checked in
  sessions: SessionStatus[]; // one per session the student joined; >1 for multi-day events
  forms: EventFormStatus[];
  method?: string | null;
  assignedOnly?: boolean; // entry surfaced only because the viewer is assigned to evaluate
}

interface ActiveForm {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  questions: unknown;
  formType: string;
}

export default function HistoryPage() {
  const { lang, t } = useLanguage();
  // Locale for date formatting so the month/format follow the chosen language.
  const dateLocale = lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : lang === "mm" ? "my-MM" : "en-GB";
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the history fetch fails, so we show an error instead of the
  // misleading "No history yet" empty state.
  const [historyError, setHistoryError] = useState(false);

  const [showStudentForm, setShowStudentForm] = useState(false);
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [normForm, setNormForm] = useState<NormalizedForm | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [navStack, setNavStack] = useState<number[]>([]);
  const [scoreResult, setScoreResult] = useState<{ score: number; maxScore: number } | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | number | string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [generalSuccess, setGeneralSuccess] = useState<string | null>(null);

  const [showWarningModal, setShowWarningModal] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");

  // True when the open form was repopulated from a locally-saved draft, so we
  // can show a small "restored" hint to the student.
  const [draftRestored, setDraftRestored] = useState(false);
  // Per-question state for "file" answers: in-flight upload + last upload error.
  const [fileUploading, setFileUploading] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  // Keys uploaded this session that aren't yet committed to a submission. If the
  // student removes/replaces a file or abandons the form, these are deleted from
  // the private bucket so they don't orphan (cleared on a successful submit, since
  // the submission then owns them).
  const pendingFileKeysRef = useRef<Set<string>>(new Set());

  // Scroll container for the form modal. When the user moves between sections,
  // the new (shorter) section can leave the view scrolled partway down, landing
  // them in the middle instead of at the first question — reset to the top.
  const modalScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    modalScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [sectionIndex]);

  // Auto-save the in-progress answers to localStorage on every change so an
  // accidental close (or page reload) doesn't lose the student's work. Guarded
  // on !formLoading so the empty reset during openStudentForm's fetch doesn't
  // clobber the saved draft before we've had a chance to restore it, and on
  // !generalSuccess so we don't re-save right after a successful submit clears it.
  useEffect(() => {
    if (!showStudentForm || !activeForm || formLoading || generalSuccess) return;
    try {
      localStorage.setItem(draftKey(activeForm.eventId, activeForm.id), JSON.stringify(answers));
    } catch { /* storage full or blocked (private mode) — fail silently */ }
  }, [answers, showStudentForm, activeForm, formLoading, generalSuccess]);

  const fetchHistory = () => {
    setLoading(true);
    setHistoryError(false);
    fetch("/api/profile/history")
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then((d) => {
        if (Array.isArray(d)) {
          const sorted = [...d].sort((a, b) => {
            const dateA = new Date(a.checkInTime || a.eventStartTime || 0).getTime();
            const dateB = new Date(b.checkInTime || b.eventStartTime || 0).getTime();
            return dateB - dateA;
          });
          setHistory(sorted);
        }
      })
      .catch(() => setHistoryError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(() => { fetchHistory(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  const openStudentForm = async (eventId: string, formId: string, formType: string) => {
    setShowStudentForm(true);
    setFormLoading(true);
    setAnswers({});
    setFormErrors({});
    setGeneralError(null);
    setGeneralSuccess(null);
    setSectionIndex(0);
    setNavStack([]);
    setScoreResult(null);
    setDraftRestored(false);

    try {
      const res = await fetch(`/api/events/${eventId}/form`);
      const data = await res.json();

      const formObj = data.forms?.find((f: { id: string }) => f.id === formId);

      if (!formObj) {
        setGeneralError(t.evaluationNotFound);
        setFormLoading(false);
        return;
      }

      // Already-submitted gate (server truth). The GET returns hasSubmitted for
      // this (form, student) pair; the modal can't re-fill a submitted form
      // (the POST hard-rejects with a 23505), so don't present a blank one.
      // This guards both a stale-cached "available" button and a deep-link that
      // arrives after the form was completed.
      if (formObj.hasSubmitted) {
        setShowStudentForm(false);
        setWarningMessage(
          lang === "th"
            ? "คุณได้ส่งแบบฟอร์มนี้ไปแล้ว ไม่สามารถส่งซ้ำได้"
            : lang === "cn"
            ? "您已提交此表单，无法重复提交。"
            : lang === "mm"
            ? "ဤဖောင်ကို သင်တင်သွင်းပြီးဖြစ်သည်။ ထပ်မံတင်သွင်း၍ မရပါ။"
            : "You've already submitted this form — it can't be submitted again."
        );
        setShowWarningModal(true);
        return;
      }

      // Attendance gate: K_pre (pre-test) and S (skill — filled by assigned
      // evaluators, not attendees) don't require check-in; all others do.
      if (formType !== "K_pre" && formType !== "S" && !data.hasAttended) {
        setShowStudentForm(false);
        setWarningMessage(
          lang === "th"
            ? "คุณยังไม่ได้สแกนเช็คอินเข้าร่วมกิจกรรมนี้ กรุณาสแกนเช็คอินเพื่อเข้าร่วมกิจกรรมจริงก่อนจึงจะสามารถส่งแบบประเมินและสะสมคะแนนบ้านได้!"
            : lang === "cn"
            ? "您尚未扫码签到参加此活动。请先在现场签到参加活动，然后才能提交评估表并为您的“学院/House”赚取积分！"
            : lang === "mm"
            ? "သင်သည် ဤပွဲသို့ ပါဝင်ရန် QR check-in မလုပ်ရသေးပါ။ ကျေးဇူးပြု၍ ပွဲသို့ တကယ့်ကိုယ်တိုင်တက်ရောက်ပြီးမှသာ အကဲဖြတ်လွှာကို တင်သွင်းပြီး အိမ်မှတ်များ စုဆောင်းနိုင်မည်ဖြစ်သည်!"
            : "You haven't scanned and checked into this event yet. Please check in and physically attend the event first to submit your evaluation and feed house points!"
        );
        setShowWarningModal(true);
        return;
      }

      setActiveForm({ ...formObj, eventId });
      const nf = normalizeForm(formObj.questions);
      setNormForm(nf);
      const initialAnswers: Record<string, string | number | string[]> = {};
      allQuestions(nf).forEach((q) => {
        initialAnswers[q.id] = q.type === "rating" ? 5 : q.type === "multiple" ? [] : "";
      });

      // Restore a locally-saved draft if one exists for this form. Merge over
      // the defaults so we only restore answers for questions that still exist
      // in the current form (a stale draft for a removed question is dropped).
      let restored = false;
      try {
        const raw = localStorage.getItem(draftKey(eventId, formObj.id));
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, string | number | string[]>;
          for (const q of allQuestions(nf)) {
            // Never restore a "file" answer: its uploaded object may have been
            // deleted when the form was last closed, so the saved key could be
            // dead. The student re-uploads instead of submitting a broken link.
            if (q.type === "file") continue;
            if (saved[q.id] !== undefined) {
              initialAnswers[q.id] = saved[q.id];
              restored = true;
            }
          }
        }
      } catch { /* corrupt or blocked storage — ignore and start fresh */ }

      setAnswers(initialAnswers);
      setDraftRestored(restored);
    } catch (e) {
      console.error(e);
      setGeneralError(t.failedToLoadEvaluation);
    } finally {
      setFormLoading(false);
    }
  };

  // Auto-open a form when deep-linked from the dashboard's pre-test gate
  // (?form=<formId>&event=<eventId>). Runs once after history loads so we can
  // resolve the form's type (needed for the attendance gate) from the entry.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || loading) return;
    const params = new URLSearchParams(window.location.search);
    const formId = params.get("form");
    const eventId = params.get("event");
    if (!formId || !eventId) return;
    const form = history.find((h) => h.eventId === eventId)?.forms.find((f) => f.id === formId);
    if (!form) return;
    // Only auto-open a form that's actually fillable. A deep-link can outlive the
    // submission (e.g. a stale FormsDueBanner/pre-test link), and we must not
    // present an already-submitted/closed form as a fresh, blank one.
    if (form.formStatus !== "available") {
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    autoOpenedRef.current = true;
    // Defer out of the effect body (mirrors fetchHistory) so opening the form —
    // which sets state — doesn't run synchronously inside the effect.
    const timer = setTimeout(() => openStudentForm(eventId, formId, form.formType), 0);
    // Strip the params so a refresh / back doesn't re-trigger the form.
    window.history.replaceState(null, "", window.location.pathname);
    return () => clearTimeout(timer);
    // openStudentForm is a stable closure; deps intentionally limited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, history]);

  // Upload a "file" answer to the private bucket and store the returned key as
  // this question's answer. Images are re-encoded server-side; PDFs are kept.
  const uploadFileAnswer = async (qId: string, file: File) => {
    setFileErrors((e) => { const u = { ...e }; delete u[qId]; return u; });
    setFileUploading((s) => ({ ...s, [qId]: true }));
    try {
      // Downscale images in the browser so a raw multi-MB phone photo doesn't hit
      // the reverse proxy's body cap (a 413 before the app). PDFs pass through
      // untouched — they can't be canvas-compressed, so a large PDF may still 413.
      const upload = await compressImageFile(file, { maxDim: 1600 });
      if (upload.size === 0) throw new Error("empty file");
      const form = new FormData();
      // Append a plain Blob (via slice()), not the File object compressImageFile
      // returns — see src/lib/xhr-upload.ts for why (WebKit FormData/Blob bug).
      const blob = upload.slice(0, upload.size, upload.type);
      form.append("file", blob, upload.name);
      const up = await uploadFormViaXHR("/api/forms/upload", form);
      const data = up.body as { key?: string; error?: string };
      if (!up.ok) {
        const tooBig = up.status === 413;
        setFileErrors((e) => ({
          ...e,
          [qId]: (tooBig ? null : data?.error) || (lang === "th" ? (tooBig ? "ไฟล์ใหญ่เกินไป" : "อัปโหลดไฟล์ไม่สำเร็จ") : lang === "cn" ? (tooBig ? "文件太大" : "文件上传失败") : lang === "mm" ? (tooBig ? "ဖိုင်အရွယ်အစား ကြီးလွန်းသည်" : "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ") : (tooBig ? "File is too large." : "File upload failed.")),
        }));
        return;
      }
      setAnswers((prev) => ({ ...prev, [qId]: data.key as string }));
      // Track as un-committed so it's cleaned up if the student abandons the form.
      pendingFileKeysRef.current.add(data.key as string);
      if (formErrors[qId]) { const u = { ...formErrors }; delete u[qId]; setFormErrors(u); }
    } catch {
      setFileErrors((e) => ({
        ...e,
        [qId]: lang === "th" ? "อัปโหลดไฟล์ไม่สำเร็จ" : lang === "cn" ? "文件上传失败" : lang === "mm" ? "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ" : "File upload failed.",
      }));
    } finally {
      setFileUploading((s) => { const u = { ...s }; delete u[qId]; return u; });
    }
  };

  // Remove an un-submitted "file" answer: clear it immediately, then best-effort
  // delete the uploaded object so it isn't orphaned in the private bucket. The
  // delete is fire-and-forget — if it fails the answer is still cleared.
  const removeFileAnswer = (qId: string) => {
    const key = answers[qId];
    setAnswers((prev) => ({ ...prev, [qId]: "" }));
    setFileErrors((e) => { const u = { ...e }; delete u[qId]; return u; });
    if (typeof key === "string" && key) {
      pendingFileKeysRef.current.delete(key);
      fetch(`/api/forms/upload?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => { /* best-effort */ });
    }
  };

  // Close the form modal, deleting any file uploaded this session that wasn't
  // committed to a submission so abandoning the form doesn't orphan it. No-op for
  // the post-submit close (a successful submit clears the set first). Best-effort:
  // a failed delete just leaves an orphan, same as before.
  const closeStudentForm = () => {
    const keys = [...pendingFileKeysRef.current];
    pendingFileKeysRef.current.clear();
    for (const key of keys) {
      fetch(`/api/forms/upload?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => { /* best-effort */ });
    }
    setShowStudentForm(false);
  };

  const validateSection = (idx: number): boolean => {
    const section = normForm?.sections[idx];
    if (!section) return true;
    const newErrors: Record<string, string> = {};
    for (const q of section.questions) {
      if (!isQuestionVisible(q, answers as AnswerMap)) continue;
      const a = answers[q.id];
      const empty =
        a === undefined || a === null ||
        (Array.isArray(a) ? a.length === 0 : a.toString().trim() === "");
      if (q.required && empty) newErrors[q.id] = t.fieldRequired;
    }
    if (Object.keys(newErrors).length > 0) {
      setFormErrors(newErrors);
      setGeneralError(t.completeRequiredFields);
      return false;
    }
    return true;
  };

  const nextDestination = (): number | "submit" =>
    normForm ? resolveNextSection(normForm, sectionIndex, answers as AnswerMap) : "submit";

  const goBack = () => {
    setFormErrors({});
    setGeneralError(null);
    setNavStack((stack) => {
      if (stack.length === 0) return stack;
      const copy = [...stack];
      const prev = copy.pop()!;
      setSectionIndex(prev);
      return copy;
    });
  };

  // True while any "file" answer is still uploading. Submitting/advancing now
  // would race the upload: the key lands after the POST, silently dropping the
  // answer and orphaning the file. Block until uploads settle.
  const uploadsInFlight = () => Object.values(fileUploading).some(Boolean);
  const uploadWaitMessage = () =>
    lang === "th" ? "กรุณารอให้อัปโหลดไฟล์เสร็จก่อน" : lang === "cn" ? "请等待文件上传完成" : lang === "mm" ? "ဖိုင်တင်ပြီးသည်အထိ စောင့်ပါ" : "Please wait for the file upload to finish.";

  const goNext = () => {
    setFormErrors({});
    setGeneralError(null);
    if (uploadsInFlight()) { setGeneralError(uploadWaitMessage()); return; }
    if (!validateSection(sectionIndex)) return;
    const dest = nextDestination();
    if (dest === "submit") {
      submitAnswers();
      return;
    }
    setNavStack((stack) => [...stack, sectionIndex]);
    setSectionIndex(dest);
  };

  const submitAnswers = async () => {
    if (!activeForm) return;
    setFormErrors({});
    setGeneralError(null);
    if (uploadsInFlight()) { setGeneralError(uploadWaitMessage()); return; }
    if (!validateSection(sectionIndex)) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${activeForm.eventId}/form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: activeForm.id, answers }),
      });
      const data = await res.json();

      if (res.ok) {
        if (data.result?.hasGraded) {
          setScoreResult({ score: data.result.score, maxScore: data.result.maxScore });
        }
        // The submission now owns its file answers, so don't clean them up on close.
        pendingFileKeysRef.current.clear();
        // Submitted successfully — discard the local draft so it isn't restored next time.
        try { localStorage.removeItem(draftKey(activeForm.eventId, activeForm.id)); } catch { /* ignore */ }
        setGeneralSuccess("Submitted");
        fetchHistory();
      } else {
        if (res.status === 403) {
          // Submission rejected — its file answers were never stored, so clean them up.
          closeStudentForm();
          setWarningMessage(
            lang === "th"
              ? "คุณยังไม่ได้สแกนเช็คอินเข้าร่วมกิจกรรมนี้ กรุณาสแกนเช็คอินเพื่อเข้าร่วมกิจกรรมจริงก่อนจึงจะสามารถส่งแบบประเมินและสะสมคะแนนบ้านได้!"
              : lang === "cn"
              ? "您尚未扫码签到参加此活动。请先在现场签到参加活动，然后才能提交评估表并为您的“学院/House”赚取积分！"
              : lang === "mm"
              ? "သင်သည် ဤပွဲသို့ ပါဝင်ရန် QR check-in မလုပ်ရသေးပါ။ ကျေးဇူးပြု၍ ပွဲသို့ တကယ့်ကိုယ်တိုင်တက်ရောက်ပြီးမှသာ အကဲဖြတ်လွှာကို တင်သွင်းပြီး အိမ်မှတ်များ စုဆောင်းနိုင်မည်ဖြစ်သည်!"
              : "You haven't scanned and checked into this event yet. Please check in and physically attend the event first to submit your evaluation and feed house points!"
          );
          setShowWarningModal(true);
        } else {
          setGeneralError(t.failedToSubmitFeedback + ": " + (data.error || "Unknown error"));
        }
      }
    } catch (e) {
      console.error(e);
      setGeneralError(t.failedToSubmitFeedback);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <StudentNav />

      <main className="page-container" style={{ marginTop: 48, paddingBottom: 100 }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em", marginBottom: 12 }}>
            {t.eventHistory}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 18, fontWeight: 500 }}>
            {history.length} events completed in your journey.
          </p>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : historyError ? (
          <div style={{ padding: "100px 40px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 40, border: "2px dashed var(--border-subtle)" }}>
            <AlertTriangle size={48} style={{ color: "#ef4444", display: "block", margin: "0 auto 20px auto", opacity: 0.5 }} />
            <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
              {lang === "th" ? "โหลดประวัติไม่สำเร็จ" : lang === "cn" ? "无法加载历史记录" : lang === "mm" ? "မှတ်တမ်း ဖွင့်၍မရပါ" : "Couldn't load your history"}
            </h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
              {lang === "th" ? "กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง" : lang === "cn" ? "请检查您的网络连接并重试。" : lang === "mm" ? "အင်တာနက်ချိတ်ဆက်မှုကို စစ်ဆေးပြီး ထပ်စမ်းကြည့်ပါ။" : "Please check your connection and try again."}
            </p>
            <button onClick={() => fetchHistory()} className="btn btn-primary">
              {lang === "th" ? "ลองอีกครั้ง" : lang === "cn" ? "重试" : lang === "mm" ? "ထပ်စမ်းကြည့်ပါ" : "Try again"}
            </button>
          </div>
        ) : history.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {history.map((h) => (
              <div key={h.id} className="glass animate-fade-in-up" style={{
                padding: "28px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
                borderRadius: 32,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-surface)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.03)",
                // Grid items default to min-width:auto, so a long form/event title
                // would stretch the whole column instead of wrapping. minWidth:0
                // lets the column hold its track width so the inner text wraps.
                minWidth: 0
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ width: 70, height: 70, borderRadius: 18, overflow: "hidden", background: "var(--bg-elevated)", flexShrink: 0 }}>
                    {h.eventImageUrl ? (
                      <img src={h.eventImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Calendar size={28} color="var(--text-muted)" />
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 900, fontSize: 17, color: "var(--text-primary)", letterSpacing: "-0.01em", lineHeight: 1.35, overflowWrap: "break-word", wordBreak: "break-word" }}>{h.eventTitle}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {h.sessions && h.sessions.length > 1 ? (
                        // Multi-day event: the per-session dates are listed below,
                        // so the subtitle just states how many sessions there are.
                        <>{h.sessions.length}{" "}{lang === "th" ? "ช่วงกิจกรรม" : lang === "cn" ? "个场次" : lang === "mm" ? "ကြိမ်" : "sessions"}</>
                      ) : h.checkInTime ? (
                        <>Completed on {new Date(h.checkInTime).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })}</>
                      ) : (
                        <>Event Date: {new Date(h.eventStartTime).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })}</>
                      )}
                    </p>
                  </div>
                </div>

                {h.sessions && h.sessions.length > 1 ? (
                  // Multi-day event: one row per session with its date + the
                  // student's check-in order for that specific session.
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {h.sessions.map((s, i) => {
                      const label = s.title || (lang === "th" ? `วันที่ ${i + 1}` : lang === "cn" ? `第 ${i + 1} 天` : lang === "mm" ? `နေ့ ${i + 1}` : `Day ${i + 1}`);
                      const dateSrc = s.startTime || s.checkInTime;
                      const dateStr = dateSrc
                        ? new Date(dateSrc).toLocaleDateString(dateLocale, { day: "numeric", month: "short", timeZone: "Asia/Bangkok" })
                        : "";
                      return (
                        <div key={s.sessionId} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                          padding: "8px 14px", borderRadius: 14,
                          background: s.checkInTime ? "rgba(255,107,0,0.08)" : "rgba(0,0,0,0.04)"
                        }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <ClipboardList size={14} style={{ flexShrink: 0, color: s.checkInTime ? "var(--accent-primary)" : "var(--text-muted)" }} />
                            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text-primary)", overflowWrap: "break-word", wordBreak: "break-word" }}>{label}</span>
                              {dateStr && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{dateStr}</span>}
                            </span>
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 800, flexShrink: 0, textAlign: "right", color: s.checkInTime ? "var(--accent-primary)" : "var(--text-muted)" }}>
                            {s.rank != null
                              ? (h.eventQuota
                                  ? t.joinedAsRank.replace("{rank}", s.rank.toString()).replace("{total}", h.eventQuota.toString())
                                  : t.joinedAsRankNoLimit.replace("{rank}", s.rank.toString()))
                              : t.registeredNotCheckedIn}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {h.assignedOnly ? (
                    // Surfaced only because the viewer is assigned to evaluate this
                    // event's skill form — they aren't a participant here.
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      background: "rgba(239,68,68,0.08)",
                      borderRadius: 14,
                      color: "#ef4444",
                      fontSize: 12,
                      fontWeight: 800
                    }}>
                      <ClipboardList size={14} />
                      {lang === "th" ? "ได้รับมอบหมายให้ประเมิน" : lang === "cn" ? "已分配评估任务" : lang === "mm" ? "အကဲဖြတ်ရန် တာဝန်ပေးထားသည်" : "Assigned to evaluate"}
                    </div>
                  ) : h.rank != null ? (
                    // Checked in: show the physical check-in / walk-in scan order.
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      background: "rgba(255,107,0,0.08)",
                      borderRadius: 14,
                      color: "var(--accent-primary)",
                      fontSize: 12,
                      fontWeight: 800
                    }}>
                      <ClipboardList size={14} />
                      {h.eventQuota
                        ? t.joinedAsRank.replace("{rank}", h.rank.toString()).replace("{total}", h.eventQuota.toString())
                        : t.joinedAsRankNoLimit.replace("{rank}", h.rank.toString())}
                    </div>
                  ) : (
                    // Registered but not yet checked in — no rank is assigned until the
                    // student physically scans in, so we avoid showing a misleading number.
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      background: "rgba(0,0,0,0.04)",
                      borderRadius: 14,
                      color: "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 800
                    }}>
                      <ClipboardList size={14} />
                      {t.registeredNotCheckedIn}
                    </div>
                  )}
                </div>
                )}

                {/* KAS Form Actions */}
                {h.forms.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16, marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                    {h.forms.map((form) => (
                      <div key={form.id}>
                        {form.formStatus === "available" && (
                          <button
                            className="btn"
                            style={{
                              width: "100%",
                              minHeight: 42,
                              borderRadius: 12,
                              padding: "8px 14px",
                              fontSize: 13,
                              fontWeight: 900,
                              background: "linear-gradient(135deg, var(--accent-primary) 0%, #ff3d00 100%)",
                              color: "#fff",
                              border: "none",
                              cursor: "pointer",
                              boxShadow: "0 4px 12px rgba(255,107,0,0.15)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexWrap: "wrap",
                              gap: 6
                            }}
                            onClick={() => openStudentForm(h.eventId, form.id, form.formType)}
                          >
                            <ClipboardList size={14} style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, background: "rgba(255,255,255,0.2)", padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>
                              {FORM_TYPE_LABELS[form.formType] || form.formType}
                            </span>
                            <span style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word" }}>{form.title}</span>
                            {/* Two separate rewards: house contest points (to the
                                winning house) vs individual points (to you on submit). */}
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                              {form.formPoints > 0 && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, opacity: 0.9, background: "rgba(255,255,255,0.18)", padding: "1px 7px", borderRadius: 6 }}>
                                  <Trophy size={11} style={{ flexShrink: 0 }} /> +{form.formPoints} {t.histHousePts}
                                </span>
                              )}
                              {form.formIndividualPoints > 0 && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, opacity: 0.9, background: "rgba(255,255,255,0.18)", padding: "1px 7px", borderRadius: 6 }}>
                                  <Sparkles size={11} style={{ flexShrink: 0 }} /> +{form.formIndividualPoints} {t.histYouPts}
                                </span>
                              )}
                            </span>
                          </button>
                        )}
                        {form.formStatus === "submitted" && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            width: "100%",
                            minHeight: 42,
                            borderRadius: 12,
                            padding: "8px 14px",
                            background: "rgba(16,185,129,0.08)",
                            color: "#10b981",
                            fontSize: 13,
                            fontWeight: 800
                          }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <CheckCircle2 size={14} style={{ flexShrink: 0 }} /> <span style={{ minWidth: 0, overflowWrap: "break-word", wordBreak: "break-word" }}>{form.title}</span>
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 900, opacity: 0.75, background: "rgba(16,185,129,0.15)", padding: "2px 8px", borderRadius: 6, flexShrink: 0 }}>
                              {FORM_TYPE_LABELS[form.formType] || form.formType}
                            </span>
                          </div>
                        )}
                        {form.formStatus === "closed" && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            width: "100%",
                            minHeight: 42,
                            borderRadius: 12,
                            padding: "8px 14px",
                            background: "rgba(0,0,0,0.03)",
                            color: "var(--text-muted)",
                            fontSize: 13,
                            fontWeight: 700
                          }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <Lock size={14} style={{ flexShrink: 0 }} /> <span style={{ minWidth: 0, overflowWrap: "break-word", wordBreak: "break-word" }}>{form.title}</span>
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 900, opacity: 0.6, background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 6, flexShrink: 0 }}>
                              {FORM_TYPE_LABELS[form.formType] || form.formType}
                            </span>
                          </div>
                        )}
                        {form.formStatus === "upcoming" && (
                          <div style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            width: "100%",
                            minHeight: 42,
                            borderRadius: 12,
                            padding: "8px 14px",
                            background: "rgba(99,102,241,0.06)",
                            color: "#6366f1",
                            fontSize: 13,
                            fontWeight: 700
                          }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                <Calendar size={14} style={{ flexShrink: 0 }} />
                                <span style={{ minWidth: 0, overflowWrap: "break-word", wordBreak: "break-word" }}>{form.title}</span>
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 900, opacity: 0.7, background: "rgba(99,102,241,0.12)", padding: "2px 8px", borderRadius: 6, flexShrink: 0 }}>
                                {FORM_TYPE_LABELS[form.formType] || form.formType}
                              </span>
                            </div>
                            {form.opensAt && (
                              <span style={{ opacity: 0.85, fontWeight: 600, fontSize: 12, paddingLeft: 20 }}>
                                {lang === "th" ? "เปิด" : lang === "cn" ? "开放" : lang === "mm" ? "ဖွင့်" : "Opens"}{" "}
                                {new Date(form.opensAt).toLocaleString(dateLocale, { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "100px 40px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 40, border: "2px dashed var(--border-subtle)" }}>
            <History size={48} style={{ color: "var(--text-muted)", display: "block", margin: "0 auto 20px auto", opacity: 0.3 }} />
            <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>No history yet</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>Join your first event to start your activity journey!</p>
            <Link href="/dashboard" className="btn btn-primary">Browse Events</Link>
          </div>
        )}

        {/* Warning Modal */}
        {showWarningModal && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
            zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24
          }} onClick={() => setShowWarningModal(false)}>
            <div className="animate-fade-in-up" style={{
              background: "var(--bg-surface)", width: "100%", maxWidth: 480, borderRadius: 32,
              overflow: "hidden", boxShadow: "0 30px 60px rgba(0,0,0,0.25)", border: "1px solid var(--border-medium)",
              padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center"
            }} onClick={e => e.stopPropagation()}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%", background: "rgba(255,107,0,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24,
                border: "1px solid rgba(255,107,0,0.2)", boxShadow: "0 0 20px rgba(255,107,0,0.15)"
              }}>
                <Trophy size={36} style={{ color: "var(--accent-primary)" }} />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", marginBottom: 14 }}>
                {lang === "th" ? "จำเป็นต้องเข้าร่วมกิจกรรม" : lang === "cn" ? "需要签到参加活动" : lang === "mm" ? "ပွဲတက်ရောက်ရန် လိုအပ်သည်" : "Event Attendance Required"}
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 500, lineHeight: 1.6, marginBottom: 32 }}>
                {warningMessage}
              </p>
              <button className="btn btn-primary" type="button" style={{
                width: "100%", height: 48, borderRadius: 14, fontWeight: 900, fontSize: 15,
                background: "linear-gradient(135deg, var(--accent-primary) 0%, #ff3d00 100%)",
                color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(255,107,0,0.3)", cursor: "pointer"
              }} onClick={() => setShowWarningModal(false)}>
                {lang === "th" ? "ตกลง" : lang === "cn" ? "好的" : lang === "mm" ? "ကောင်းပါပြီ" : "Understood"}
              </button>
            </div>
          </div>
        )}

        {/* Student Form Modal */}
        {showStudentForm && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
            zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24
          }} onClick={() => closeStudentForm()}>
            <div ref={modalScrollRef} className="animate-fade-in-up custom-scrollbar" style={{
              background: "var(--bg-surface)", width: "100%", maxWidth: 600, maxHeight: "85vh",
              borderRadius: 32, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch",
              boxShadow: "0 30px 60px rgba(0,0,0,0.2)", border: "1px solid var(--border-medium)"
            }} onClick={e => e.stopPropagation()}>

              {/* Modal Header */}
              <div style={{ padding: "clamp(14px, 4vw, 28px) clamp(18px, 5vw, 40px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10, gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.housePointFeeding}</span>
                    {activeForm?.formType && (
                      <span style={{ fontSize: 10, fontWeight: 900, background: "rgba(255,107,0,0.12)", color: "var(--accent-primary)", padding: "2px 8px", borderRadius: 6 }}>
                        {FORM_TYPE_LABELS[activeForm.formType] || activeForm.formType}
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: "clamp(16px, 4.5vw, 20px)", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.3, overflowWrap: "break-word", wordBreak: "break-word" }}>{activeForm?.title || t.evaluation}</h3>
                </div>
                <button className="btn btn-ghost" onClick={() => closeStudentForm()} style={{ borderRadius: "50%", width: 40, height: 40, padding: 0, flexShrink: 0 }}>
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              {formLoading ? (
                <div style={{ padding: "80px 0", textAlign: "center" }}>
                  <div className="spinner w-8 h-8 border-4 border-t-transparent" style={{ margin: "0 auto 16px" }} />
                  <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.loadingFormsEngine}</p>
                </div>
              ) : generalSuccess ? (
                <div style={{ padding: 40, textAlign: "center" }}>
                  <div className="animate-scale-in" style={{
                    width: 72, height: 72, borderRadius: "50%", background: "rgba(16,185,129,0.1)", color: "#10b981",
                    display: "flex", alignItems: "center", justifyContent: "center", margin: "20px auto 24px",
                    boxShadow: "0 10px 30px rgba(16,185,129,0.15)"
                  }}>
                    <CheckCircle2 size={36} />
                  </div>
                  <h4 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>{t.feedbackSubmitted}</h4>

                  {scoreResult && (
                    <div className="animate-scale-in" style={{
                      maxWidth: 320, margin: "0 auto 24px", padding: "20px 24px", borderRadius: 20,
                      background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
                    }}>
                      <p style={{ fontSize: 12, fontWeight: 900, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                        {lang === "th" ? "คะแนนของคุณ" : lang === "cn" ? "您的得分" : lang === "mm" ? "သင့်ရမှတ်" : "Your Score"}
                      </p>
                      <p style={{ fontSize: 40, fontWeight: 900, color: "var(--accent-primary)", lineHeight: 1 }}>
                        {scoreResult.score}<span style={{ fontSize: 22, color: "var(--text-muted)" }}> / {scoreResult.maxScore}</span>
                      </p>
                    </div>
                  )}

                  <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 420, margin: "0 auto 32px", lineHeight: 1.6 }}>
                    {t.feedbackSuccessDetail}
                  </p>
                  <button className="btn btn-primary" style={{
                    height: 46, borderRadius: 12, padding: "0 32px",
                    background: "linear-gradient(135deg, var(--accent-primary) 0%, #ff3d00 100%)",
                    color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(255,107,0,0.3)"
                  }} onClick={() => { closeStudentForm(); setGeneralSuccess(null); }}>
                    {t.closeWindow}
                  </button>
                </div>
              ) : (
                <div style={{ padding: "clamp(20px, 5vw, 40px)" }}>
                  {draftRestored && sectionIndex === 0 && navStack.length === 0 && (
                    <div className="animate-fade-in" style={{
                      background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 16,
                      padding: "12px 16px", marginBottom: 20, color: "#6366f1", fontSize: 13, fontWeight: 700,
                      display: "flex", alignItems: "center", gap: 10
                    }}>
                      <Save size={16} style={{ flexShrink: 0 }} />
                      {lang === "th"
                        ? "กู้คืนคำตอบที่บันทึกไว้ในเครื่องนี้แล้ว"
                        : lang === "cn"
                        ? "已恢复此设备上保存的草稿"
                        : lang === "mm"
                        ? "ဤစက်တွင် သိမ်းဆည်းထားသော အဖြေများကို ပြန်လည်ရယူပြီးပါပြီ"
                        : "Restored your saved answers from this device"}
                    </div>
                  )}
                  {generalError && (
                    <div className="animate-fade-in" style={{
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 16,
                      padding: "16px 20px", marginBottom: 28, color: "#ef4444", fontSize: 13, fontWeight: 700,
                      display: "flex", alignItems: "center", gap: 10
                    }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {generalError}
                    </div>
                  )}

                  {activeForm?.description && sectionIndex === 0 && navStack.length === 0 && (
                    <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 500, lineHeight: 1.5, marginBottom: 28, background: "var(--bg-elevated)", padding: 16, borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
                      {activeForm.description}
                    </p>
                  )}

                  {normForm && normForm.sections.length > 1 && (
                    <div style={{ marginBottom: 24 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {(lang === "th" ? "ส่วนที่ " : lang === "cn" ? "章节 " : lang === "mm" ? "အပိုင်း " : "Section ")}{sectionIndex + 1}
                        {(lang === "th" ? " จาก " : lang === "cn" ? " / " : lang === "mm" ? " / " : " of ")}{normForm.sections.length}
                      </span>
                      {normForm.sections[sectionIndex]?.title && (
                        <h4 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)", marginTop: 2 }}>
                          {normForm.sections[sectionIndex].title}
                        </h4>
                      )}
                      {normForm.sections[sectionIndex]?.description && (
                        <p style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, lineHeight: 1.5, marginTop: 6, whiteSpace: "pre-wrap" }}>
                          {normForm.sections[sectionIndex].description}
                        </p>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {normForm?.sections[sectionIndex]?.questions
                      .filter((q: Question) => isQuestionVisible(q, answers as AnswerMap))
                      .map((q: Question) => (
                        <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <label style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                            {q.label === "Overall Satisfaction" ? t.overallSatisfaction : q.label} {q.required && <span style={{ color: "#ef4444" }}>*</span>}
                          </label>

                          {q.type === "rating" ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "8px 0", maxWidth: "100%" }}>
                              {Array.from({ length: 5 }).map((_, starIdx) => {
                                const ratingValue = starIdx + 1;
                                const ansVal = answers[q.id];
                                const isSelected = ratingValue <= (typeof ansVal === "number" ? ansVal : typeof ansVal === "string" ? parseInt(ansVal) || 0 : 0);
                                return (
                                  <button key={starIdx} type="button" style={{
                                    border: "none", background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0,
                                    color: isSelected ? "#ffb000" : "var(--border-medium)", transition: "all 0.1s"
                                  }} onClick={() => {
                                    setAnswers({ ...answers, [q.id]: ratingValue });
                                    if (formErrors[q.id]) { const u = { ...formErrors }; delete u[q.id]; setFormErrors(u); }
                                  }}>
                                    <Star size={28} fill={isSelected ? "#ffb000" : "none"} />
                                  </button>
                                );
                              })}
                              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-muted)", marginLeft: 8, flexShrink: 0 }}>
                                {answers[q.id] || 0} / 5
                              </span>
                            </div>
                          ) : q.type === "choice" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "8px 0" }}>
                              {q.options?.map((opt: string, optIdx: number) => {
                                const isSelected = answers[q.id] === opt;
                                return (
                                  <label key={optIdx} style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14,
                                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                                    background: isSelected ? "var(--bg-elevated)" : "var(--bg-surface)", cursor: "pointer",
                                    transition: "all 0.2s ease", boxShadow: isSelected ? "0 0 12px rgba(255,107,0,0.1)" : "none"
                                  }}>
                                    <input type="radio" name={`choice-${q.id}`} value={opt} checked={isSelected}
                                      onChange={() => {
                                        setAnswers({ ...answers, [q.id]: opt });
                                        if (formErrors[q.id]) { const u = { ...formErrors }; delete u[q.id]; setFormErrors(u); }
                                      }}
                                      style={{ accentColor: "var(--accent-primary)", width: 18, height: 18, cursor: "pointer" }} />
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : q.type === "multiple" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "8px 0" }}>
                              {q.options?.map((opt: string, optIdx: number) => {
                                const currentSelections = (Array.isArray(answers[q.id]) ? answers[q.id] : []) as string[];
                                const isSelected = currentSelections.includes(opt);
                                return (
                                  <label key={optIdx} style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14,
                                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                                    background: isSelected ? "var(--bg-elevated)" : "var(--bg-surface)", cursor: "pointer",
                                    transition: "all 0.2s ease", boxShadow: isSelected ? "0 0 12px rgba(255,107,0,0.1)" : "none"
                                  }}>
                                    <input type="checkbox" value={opt} checked={isSelected}
                                      onChange={(e) => {
                                        let updated = [...currentSelections];
                                        if (e.target.checked) updated.push(opt); else updated = updated.filter((v) => v !== opt);
                                        setAnswers({ ...answers, [q.id]: updated });
                                        if (formErrors[q.id]) { const u = { ...formErrors }; delete u[q.id]; setFormErrors(u); }
                                      }}
                                      style={{ accentColor: "var(--accent-primary)", width: 18, height: 18, cursor: "pointer" }} />
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : q.type === "file" ? (
                            <div style={{ margin: "8px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                              {answers[q.id] ? (
                                <div style={{
                                  display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 14,
                                  border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)"
                                }}>
                                  <CheckCircle2 size={18} style={{ color: "#10b981", flexShrink: 0 }} />
                                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {(String(answers[q.id]).split(".").pop() || "file").toUpperCase()}{" "}
                                    {lang === "th" ? "ไฟล์อัปโหลดแล้ว" : lang === "cn" ? "文件已上传" : lang === "mm" ? "ဖိုင်တင်ပြီးပါပြီ" : "file uploaded"}
                                  </span>
                                  <button type="button" onClick={() => removeFileAnswer(q.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ef4444", fontWeight: 800, fontSize: 12 }}>
                                    {lang === "th" ? "ลบ" : lang === "cn" ? "移除" : lang === "mm" ? "ဖယ်ရှားရန်" : "Remove"}
                                  </button>
                                </div>
                              ) : (
                                <label style={{
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "16px",
                                  borderRadius: 14, border: `2px dashed ${formErrors[q.id] ? "#ef4444" : "var(--border-medium)"}`,
                                  background: "var(--bg-surface)", cursor: fileUploading[q.id] ? "wait" : "pointer", fontSize: 13, fontWeight: 800,
                                  color: "var(--text-secondary)"
                                }}>
                                  {fileUploading[q.id]
                                    ? (lang === "th" ? "กำลังอัปโหลด..." : lang === "cn" ? "上传中..." : lang === "mm" ? "တင်နေသည်..." : "Uploading...")
                                    : (<><Paperclip size={14} style={{ flexShrink: 0 }} />{lang === "th" ? "เลือกไฟล์ (รูปภาพ หรือ PDF)" : lang === "cn" ? "选择文件（图片或 PDF）" : lang === "mm" ? "ဖိုင်ရွေးပါ (ပုံ သို့မဟုတ် PDF)" : "Choose a file (image or PDF)"}</>)}
                                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={!!fileUploading[q.id]}
                                    style={{ display: "none" }}
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFileAnswer(q.id, f); e.target.value = ""; }} />
                                </label>
                              )}
                              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                                {lang === "th" ? "รองรับ JPG, PNG, WEBP, PDF • สูงสุด 4MB" : lang === "cn" ? "支持 JPG、PNG、WEBP、PDF • 最大 4MB" : lang === "mm" ? "JPG, PNG, WEBP, PDF • အများဆုံး 4MB" : "JPG, PNG, WEBP, PDF • max 4MB"}
                              </span>
                              {fileErrors[q.id] && (
                                <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {fileErrors[q.id]}</span>
                              )}
                            </div>
                          ) : (
                            <textarea className="input custom-scrollbar" style={{
                              width: "100%", minHeight: 100, borderRadius: 14, padding: "12px 16px", resize: "vertical",
                              borderColor: formErrors[q.id] ? "#ef4444" : "var(--border-medium)"
                            }} value={String(answers[q.id] || "")}
                              onChange={e => {
                                setAnswers({ ...answers, [q.id]: e.target.value });
                                if (formErrors[q.id]) { const u = { ...formErrors }; delete u[q.id]; setFormErrors(u); }
                              }}
                              placeholder={t.yourAnswerHere} />
                          )}

                          {formErrors[q.id] && (
                            <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                              <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {formErrors[q.id]}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* Footer */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, borderTop: "1px solid var(--border-subtle)", paddingTop: 28, marginTop: 32 }}>
                    <button className="btn btn-ghost" type="button" style={{ height: 46, borderRadius: 12, padding: "0 24px", display: "flex", alignItems: "center", gap: 8 }}
                      onClick={navStack.length > 0 ? goBack : () => closeStudentForm()} disabled={submitting}>
                      {navStack.length > 0 ? (
                        <><ArrowLeft size={16} /> {lang === "th" ? "ย้อนกลับ" : lang === "cn" ? "上一步" : lang === "mm" ? "နောက်သို့" : "Back"}</>
                      ) : t.cancel}
                    </button>
                    <button className="btn btn-primary" type="button" style={{
                      height: 46, borderRadius: 12, padding: "0 24px",
                      background: "linear-gradient(135deg, var(--accent-primary) 0%, #ff3d00 100%)",
                      color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(255,107,0,0.3)",
                      display: "flex", alignItems: "center", gap: 8
                    }} disabled={submitting} onClick={goNext}>
                      {submitting ? (
                        <div className="spinner w-4 h-4 border-2" />
                      ) : nextDestination() === "submit" ? (
                        t.submitFeedback
                      ) : (
                        <>{lang === "th" ? "ถัดไป" : lang === "cn" ? "下一步" : lang === "mm" ? "ရှေ့သို့" : "Next"} <ArrowRight size={16} /></>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <style jsx global>{`
          .glass:hover {
            transform: translateY(-4px);
            border-color: var(--accent-primary) !important;
            box-shadow: 0 20px 40px rgba(0,0,0,0.06) !important;
          }
        `}</style>
      </main>
    </div>
  );
}
