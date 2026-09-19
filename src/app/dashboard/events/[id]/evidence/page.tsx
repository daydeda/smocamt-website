"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { uploadFormViaXHR } from "@/lib/xhr-upload";
import {
  ArrowLeft, Camera, CheckCircle2, Clock, Lock, Paperclip, ShieldAlert, Upload, X,
} from "lucide-react";

// Evidence-mode check-in (events.checkInMode === 'evidence'): a student
// self-submits proof (photo + that day's code word) for each session instead
// of being QR/manual/walk-in scanned. Mirrors the "file" question upload flow
// in dashboard/history/page.tsx (same /api/forms/upload endpoint, same
// client-side compress-before-upload), but submits straight to
// EvidenceCheckinService via /api/events/[id]/evidence-checkin rather than a
// form answer. See docs/features/evidence-checkin.md.

type WindowStatus = "upcoming" | "open" | "closed";

interface EvidenceSession {
  sessionId: string;
  title: string | null;
  startTime: string;
  endTime: string;
  evidencePrompt: string | null;
  windowStatus: WindowStatus;
  submitted: boolean;
  submittedAt: string | null;
  attendanceId: string | null;
}

interface EvidenceEventData {
  eventId: string;
  eventTitle: string;
  individualPointsAwarded: number;
  sessions: EvidenceSession[];
}

const fmtDateTime = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

export default function EvidenceCheckinPage() {
  const { lang } = useLanguage();
  const params = useParams();
  const eventId = String(params.id);

  const [data, setData] = useState<EvidenceEventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"wrong_mode" | "other" | null>(null);

  // Per-session draft state, keyed by sessionId.
  const [nonces, setNonces] = useState<Record<string, string>>({});
  const [fileKeys, setFileKeys] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetch(`/api/events/${eventId}/evidence-checkin`)
      .then(async (r) => {
        if (r.status === 400) { setLoadError("wrong_mode"); return null; }
        if (!r.ok) { setLoadError("other"); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => setLoadError("other"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Deferred via setTimeout so load()'s setState calls fire after this
    // render commits rather than synchronously within the effect body
    // (react-hooks/set-state-in-effect) — mirrors the pattern used elsewhere
    // in this codebase (e.g. admin/events/page.tsx's own load effects).
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const uploadFile = async (sessionId: string, file: File) => {
    setErrors((e) => { const u = { ...e }; delete u[sessionId]; return u; });
    setUploading((s) => ({ ...s, [sessionId]: true }));
    try {
      const upload = await compressImageFile(file, { maxDim: 1600 });
      if (upload.size === 0) throw new Error("empty file");
      const form = new FormData();
      // uploadFormViaXHR (src/lib/xhr-upload.ts) re-materializes every
      // File/Blob before sending, which is where the WebKit-safety work
      // actually happens — this call site just appends the file as-is.
      form.append("file", upload);
      const up = await uploadFormViaXHR("/api/forms/upload", form);
      const result = up.body as { key?: string; error?: string };
      if (!up.ok) {
        const tooBig = up.status === 413;
        setErrors((e) => ({
          ...e,
          [sessionId]: (tooBig ? null : result?.error) ||
            (lang === "th" ? (tooBig ? "ไฟล์ใหญ่เกินไป" : "อัปโหลดไฟล์ไม่สำเร็จ")
              : lang === "cn" ? (tooBig ? "文件太大" : "文件上传失败")
              : lang === "mm" ? (tooBig ? "ဖိုင်အရွယ်အစား ကြီးလွန်းသည်" : "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ")
              : (tooBig ? "File is too large." : "File upload failed.")),
        }));
        return;
      }
      setFileKeys((prev) => ({ ...prev, [sessionId]: result.key as string }));
      setFileNames((prev) => ({ ...prev, [sessionId]: file.name }));
    } catch {
      setErrors((e) => ({
        ...e,
        [sessionId]: lang === "th" ? "อัปโหลดไฟล์ไม่สำเร็จ" : lang === "cn" ? "文件上传失败" : lang === "mm" ? "ဖိုင်တင်ခြင်း မအောင်မြင်ပါ" : "File upload failed.",
      }));
    } finally {
      setUploading((s) => { const u = { ...s }; delete u[sessionId]; return u; });
    }
  };

  const removeFile = (sessionId: string) => {
    const key = fileKeys[sessionId];
    setFileKeys((prev) => { const u = { ...prev }; delete u[sessionId]; return u; });
    setFileNames((prev) => { const u = { ...prev }; delete u[sessionId]; return u; });
    if (key) fetch(`/api/forms/upload?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
  };

  const submit = async (sessionId: string) => {
    const nonce = (nonces[sessionId] || "").trim();
    const fileKey = fileKeys[sessionId];
    if (!nonce) {
      setErrors((e) => ({ ...e, [sessionId]: lang === "th" ? "กรุณาใส่รหัสประจำวัน" : lang === "cn" ? "请输入当日代码词" : lang === "mm" ? "ကျေးဇူးပြု၍ နေ့စဉ်ကုဒ်ထည့်ပါ" : "Please enter today's code word." }));
      return;
    }
    if (!fileKey) {
      setErrors((e) => ({ ...e, [sessionId]: lang === "th" ? "กรุณาแนบรูปหลักฐาน" : lang === "cn" ? "请附上证据照片" : lang === "mm" ? "ကျေးဇူးပြု၍ ဓာတ်ပုံ ပူးတွဲပါ" : "Please attach your evidence photo." }));
      return;
    }
    setSubmitting((s) => ({ ...s, [sessionId]: true }));
    setErrors((e) => { const u = { ...e }; delete u[sessionId]; return u; });
    try {
      const res = await fetch(`/api/events/${eventId}/evidence-checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, nonce, fileKey }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [sessionId]: result?.error || "Submission failed." }));
        return;
      }
      // Clear this session's draft and re-fetch so its card flips to "submitted".
      setNonces((prev) => { const u = { ...prev }; delete u[sessionId]; return u; });
      setFileKeys((prev) => { const u = { ...prev }; delete u[sessionId]; return u; });
      setFileNames((prev) => { const u = { ...prev }; delete u[sessionId]; return u; });
      load();
    } catch {
      setErrors((e) => ({ ...e, [sessionId]: lang === "th" ? "เกิดข้อผิดพลาด" : lang === "cn" ? "出错了" : lang === "mm" ? "အမှားတစ်ခု ဖြစ်ပွားသည်" : "Something went wrong." }));
    } finally {
      setSubmitting((s) => { const u = { ...s }; delete u[sessionId]; return u; });
    }
  };

  if (loading) {
    return (
      <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
        <StudentNav />
        <div className="min-h-screen flex items-center justify-center">
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
        <StudentNav />
        <main className="page-container" style={{ marginTop: 40 }}>
          <div className="notice-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", padding: 40 }}>
            <ShieldAlert size={40} style={{ color: "var(--text-muted)" }} />
            <p>{loadError === "wrong_mode"
              ? (lang === "th" ? "กิจกรรมนี้ไม่ได้ใช้การเช็คอินแบบหลักฐาน" : lang === "cn" ? "该活动未使用证据签到方式" : lang === "mm" ? "ဤ activity သည် evidence checkin ကို အသုံးမပြုပါ" : "This event doesn't use evidence check-in.")
              : (lang === "th" ? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" : lang === "cn" ? "出错了，请重试" : lang === "mm" ? "အမှားတစ်ခု ဖြစ်ပွားသည်၊ ထပ်စမ်းကြည့်ပါ" : "Something went wrong. Please try again.")}</p>
          </div>
        </main>
      </div>
    );
  }

  const statusBadge = (status: WindowStatus) => {
    const map: Record<WindowStatus, { color: string; bg: string; label: string }> = {
      upcoming: {
        color: "#f59e0b", bg: "rgba(245,158,11,0.12)",
        label: lang === "th" ? "ยังไม่เปิด" : lang === "cn" ? "尚未开放" : lang === "mm" ? "မစတင်သေးပါ" : "Not open yet",
      },
      open: {
        color: "#10b981", bg: "rgba(16,185,129,0.12)",
        label: lang === "th" ? "เปิดรับ" : lang === "cn" ? "开放中" : lang === "mm" ? "ဖွင့်ထားသည်" : "Open now",
      },
      closed: {
        color: "var(--text-muted)", bg: "var(--bg-elevated)",
        label: lang === "th" ? "ปิดแล้ว" : lang === "cn" ? "已关闭" : lang === "mm" ? "ပိတ်ပြီး" : "Closed",
      },
    };
    const s = map[status];
    return (
      <span style={{ fontSize: 11, fontWeight: 800, color: s.color, background: s.bg, borderRadius: 999, padding: "3px 10px" }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", paddingBottom: 80 }}>
      <StudentNav />
      <main className="page-container" style={{ marginTop: 32, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Link href={`/dashboard?event=${eventId}`} className="btn btn-ghost btn-sm" style={{ padding: 8, borderRadius: 12 }}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="section-title">{lang === "th" ? "กิจกรรม" : lang === "cn" ? "活动" : lang === "mm" ? "activity" : "Event"}</p>
            <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em" }}>{data.eventTitle}</h1>
          </div>
        </div>

        {data.individualPointsAwarded > 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            {lang === "th" ? `ได้ ${data.individualPointsAwarded} คะแนนต่อวันที่ส่งหลักฐานสำเร็จ` : lang === "cn" ? `每成功提交一天可获得 ${data.individualPointsAwarded} 积分` : lang === "mm" ? `တစ်ရက်လျှင် အောင်မြင်စွာ တင်သွင်းပါက ${data.individualPointsAwarded} မှတ် ရရှိမည်` : `+${data.individualPointsAwarded} points for each day you submit successfully.`}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.sessions.map((s, idx) => {
            const label = s.title?.trim() || (lang === "th" ? `วันที่ ${idx + 1}` : lang === "cn" ? `第 ${idx + 1} 天` : lang === "mm" ? `နေ့ ${idx + 1}` : `Day ${idx + 1}`);
            const fileName = fileNames[s.sessionId];
            const err = errors[s.sessionId];

            return (
              <div key={s.sessionId} className="stat-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>{label}</h3>
                    <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                      {fmtDateTime(s.startTime, lang)} – {fmtDateTime(s.endTime, lang)}
                    </p>
                  </div>
                  {statusBadge(s.windowStatus)}
                </div>

                {s.evidencePrompt && (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{s.evidencePrompt}</p>
                )}

                {s.submitted ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 12, padding: "10px 14px" }}>
                    <CheckCircle2 size={18} style={{ color: "#10b981", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981", flex: 1 }}>
                      {lang === "th" ? "ส่งหลักฐานแล้ว" : lang === "cn" ? "已提交证据" : lang === "mm" ? "သက်သေတင်ပြီးပါပြီ" : "Submitted"}
                      {s.submittedAt ? ` · ${fmtDateTime(s.submittedAt, lang)}` : ""}
                    </span>
                    {s.attendanceId && (
                      <a href={`/api/attendance/evidence/${s.attendanceId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: "#10b981" }}>
                        {lang === "th" ? "ดูไฟล์" : lang === "cn" ? "查看文件" : lang === "mm" ? "ဖိုင်ကြည့်ရန်" : "View file"}
                      </a>
                    )}
                  </div>
                ) : s.windowStatus !== "open" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", fontSize: 13 }}>
                    {s.windowStatus === "upcoming" ? <Clock size={16} /> : <Lock size={16} />}
                    {s.windowStatus === "upcoming"
                      ? (lang === "th" ? "ยังไม่ถึงเวลาส่งหลักฐาน" : lang === "cn" ? "还未到提交时间" : lang === "mm" ? "တင်သွင်းရန် အချိန်မတန်သေးပါ" : "Submission isn't open yet.")
                      : (lang === "th" ? "หมดเวลาส่งหลักฐานสำหรับวันนี้แล้ว" : lang === "cn" ? "该日提交时间已截止" : lang === "mm" ? "ယနေ့အတွက် တင်သွင်းချိန် ကုန်ဆုံးပြီ" : "The submission window for this day has closed.")}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      className="input"
                      type="text"
                      value={nonces[s.sessionId] || ""}
                      onChange={(e) => setNonces((prev) => ({ ...prev, [s.sessionId]: e.target.value }))}
                      placeholder={lang === "th" ? "รหัสประจำวันนี้ (ดูจากประกาศ)" : lang === "cn" ? "当日代码词（见公告）" : lang === "mm" ? "ယနေ့ကုဒ် (ကြေညာချက်တွင်ကြည့်ပါ)" : "Today's code word (see the announcement)"}
                    />

                    {fileName ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-elevated)", borderRadius: 10, padding: "8px 12px" }}>
                        <Paperclip size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                        <span style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
                        <button type="button" onClick={() => removeFile(s.sessionId)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <label className="btn btn-ghost" style={{ borderRadius: 10, fontSize: 13, cursor: uploading[s.sessionId] ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                        {uploading[s.sessionId] ? (
                          <div className="spinner" style={{ width: 14, height: 14 }} />
                        ) : (
                          <><Upload size={14} /> {lang === "th" ? "เลือกรูปหลักฐาน (รูปภาพ หรือ PDF)" : lang === "cn" ? "选择证据照片（图片或 PDF）" : lang === "mm" ? "သက်သေပုံ ရွေးပါ (ပုံ သို့မဟုတ် PDF)" : "Choose evidence photo (image or PDF)"}</>
                        )}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: "none" }}
                          disabled={!!uploading[s.sessionId]}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadFile(s.sessionId, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}

                    {err && <p style={{ fontSize: 12.5, color: "#ef4444" }}>{err}</p>}

                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!!submitting[s.sessionId]}
                      onClick={() => submit(s.sessionId)}
                      style={{ borderRadius: 12, fontWeight: 800, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}
                    >
                      {submitting[s.sessionId] ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Camera size={16} />}
                      {lang === "th" ? "ส่งหลักฐาน" : lang === "cn" ? "提交证据" : lang === "mm" ? "သက်သေတင်ရန်" : "Submit evidence"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
