"use client";

import { ClipboardCheck } from "lucide-react";
import type { DashboardCtx } from "../_lib/useDashboard";

export function PreTestGateModal({ ctx }: { ctx: DashboardCtx }) {
  const { lang, preTestModal, router, setPreTestModal } = ctx;
  return (
    <>{preTestModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2050,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgb(var(--accent-rgb) / 0.1)",
              color: "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <ClipboardCheck size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {lang === "th" ? "กรุณาทำแบบทดสอบ Pre-Test" : lang === "cn" ? "请先完成前测" : lang === "mm" ? "ကြိုတင်စာမေးပွဲ ဖြေဆိုပါ" : "Pre-Test Required"}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {lang === "th"
                ? `คุณได้ลงทะเบียนกิจกรรม "${preTestModal.eventTitle}" แล้ว กิจกรรมนี้มีแบบทดสอบ Pre-Test ที่ต้องทำให้เสร็จ`
                : lang === "cn"
                ? `您已注册活动 "${preTestModal.eventTitle}"。此活动要求先完成前测（Pre-Test）。`
                : lang === "mm"
                ? `"${preTestModal.eventTitle}" အတွက် မှတ်ပုံတင်ပြီးပါပြီ။ ဤပွဲတွင် ဖြည့်ရန်လိုသော ကြိုတင်စာမေးပွဲ (Pre-Test) ရှိသည်။`
                : `You're registered for "${preTestModal.eventTitle}". This event has a pre-test you need to complete.`}
            </p>
            <button
              className="btn"
              style={{
                width: "100%",
                height: 46,
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 800,
                background: "var(--accent-primary)",
                color: "var(--text-on-color)",
                border: "none",
                boxShadow: "0 10px 25px var(--accent-glow)",
                marginBottom: 12
              }}
              onClick={() => {
                const { eventId, formId } = preTestModal;
                setPreTestModal({ show: false, eventId: "", formId: "", eventTitle: "" });
                router.push(`/dashboard/history?form=${formId}&event=${eventId}`);
              }}
            >
              {lang === "th" ? "ทำแบบทดสอบเลย" : lang === "cn" ? "立即开始前测" : lang === "mm" ? "ယခု စာမေးပွဲ ဖြေဆိုမည်" : "Take the Pre-Test"}
            </button>
            <button
              className="btn btn-ghost"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, border: "1px solid var(--border-medium)" }}
              onClick={() => setPreTestModal({ show: false, eventId: "", formId: "", eventTitle: "" })}
            >
              {lang === "th" ? "ไว้ทีหลัง" : lang === "cn" ? "稍后" : lang === "mm" ? "နောက်မှ" : "Later"}
            </button>
          </div>
        </div>
      )}</>
  );
}
