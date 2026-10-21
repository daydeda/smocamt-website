"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Calendar, ListChecks } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type PendingForm = {
  id: string;
  eventId: string;
  eventTitle: string | null;
  title: string;
  formType: string;
  updatedAt: string;
};

type PendingEvent = {
  id: string;
  title: string;
  startTime: string;
  ownerClubIds: string[] | null;
  ownerMajors: string[] | null;
  updatedAt: string;
};

// Aggregate dashboard so staff don't have to open each event individually and
// notice a review banner — see GET /api/admin/reviews. Each row deep-links
// straight to the thing that needs reviewing: a form row opens the Feedback
// Form modal directly (?openForm=<eventId>, same shortcut club/major
// presidents use, see admin/events/page.tsx), an event row opens the plain
// event editor (?edit=<eventId>).
export function PendingReviewsClient() {
  const { lang } = useLanguage();
  const [pendingForms, setPendingForms] = useState<PendingForm[]>([]);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/reviews")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setPendingForms(Array.isArray(d.forms) ? d.forms : []);
        setPendingEvents(Array.isArray(d.events) ? d.events : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="pb-20">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12 }}>
          <ListChecks size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
          {lang === "th" ? "รอตรวจสอบ" : lang === "cn" ? "待审核" : lang === "mm" ? "စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်" : "Pending Reviews"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>
          {lang === "th"
            ? "แบบประเมินและรายละเอียดกิจกรรมที่ประธานชมรม/สาขาแก้ไข รอการตรวจสอบจากทีมงาน"
            : lang === "cn"
            ? "社团/专业会长编辑的反馈表单和活动详情，等待工作人员审核。"
            : lang === "mm"
            ? "ကလပ်/အထူးပြုဌာန ပ္ဂူပ္ပါယ်များ ပြင်ဆင်ခဲ့သည့် အကဲဖြတ်ပုံစံနှင့် ပွဲအသေးစိတ်များ ဝန်ထမ်း စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်။"
            : "Feedback forms and event detail edits from club/major presidents, awaiting staff review."}
        </p>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : (
        <>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <ClipboardList size={18} style={{ color: "var(--indigo-500)" }} />
              {lang === "th" ? "แบบประเมินที่รอตรวจสอบ" : lang === "cn" ? "待审核反馈表单" : lang === "mm" ? "စောင့်ဆိုင်းနေသော အကဲဖြတ်ပုံစံများ" : "Pending Feedback Forms"}
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>({pendingForms.length})</span>
            </h2>
            {pendingForms.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 600 }}>
                {lang === "th" ? "ไม่มีแบบประเมินที่รอตรวจสอบ" : lang === "cn" ? "没有待审核的表单。" : lang === "mm" ? "စစ်ဆေးရန် စောင့်ဆိုင်းနေသော ဖောင် မရှိပါ။" : "Nothing pending."}
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingForms.map((f) => (
                  <Link
                    key={f.id}
                    href={`/admin/events?openForm=${f.eventId}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)",
                      padding: 16, textDecoration: "none", color: "inherit",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 14 }}>{f.title}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{f.eventTitle}</p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-500)", flexShrink: 0 }}>
                      {lang === "th" ? "รอตรวจสอบ" : lang === "cn" ? "待审核" : lang === "mm" ? "စောင့်ဆိုင်းနေသည်" : "Pending"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Calendar size={18} style={{ color: "var(--accent-primary)" }} />
              {lang === "th" ? "รายละเอียดกิจกรรมที่รอตรวจสอบ" : lang === "cn" ? "待审核活动详情" : lang === "mm" ? "စောင့်ဆိုင်းနေသော ပွဲအသေးစိတ်များ" : "Pending Event Detail Changes"}
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>({pendingEvents.length})</span>
            </h2>
            {pendingEvents.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 600 }}>
                {lang === "th" ? "ไม่มีรายละเอียดกิจกรรมที่รอตรวจสอบ" : lang === "cn" ? "没有待审核的活动详情。" : lang === "mm" ? "စစ်ဆေးရန် စောင့်ဆိုင်းနေသော ပွဲအသေးစိတ် မရှိပါ။" : "Nothing pending."}
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingEvents.map((e) => (
                  <Link
                    key={e.id}
                    href={`/admin/events?edit=${e.id}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)",
                      padding: 16, textDecoration: "none", color: "inherit",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{new Date(e.startTime).toLocaleDateString()}</p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-500)", flexShrink: 0 }}>
                      {lang === "th" ? "รอตรวจสอบ" : lang === "cn" ? "待审核" : lang === "mm" ? "စောင့်ဆိုင်းနေသည်" : "Pending"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
