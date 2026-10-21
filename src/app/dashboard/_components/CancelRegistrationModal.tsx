"use client";

import { AlertCircle } from "lucide-react";
import type { DashboardCtx } from "../_lib/useDashboard";

export function CancelRegistrationModal({ ctx }: { ctx: DashboardCtx }) {
  const { confirmUnregister, handleRegister, lang, setConfirmUnregister } = ctx;
  return (
    <>{confirmUnregister.show && (
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
        }} onClick={() => setConfirmUnregister(prev => ({ ...prev, show: false }))}>
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
              background: "rgb(var(--amber-500-rgb) / 0.1)",
              color: "var(--amber-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertCircle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {lang === "th" ? "ยกเลิกการลงทะเบียน?" : lang === "cn" ? "取消注册？" : lang === "mm" ? "မှတ်ပုံတင်ခြင်း ပယ်ဖျက်မလား?" : "Cancel Registration?"}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: confirmUnregister.losesPreTest ? 16 : 28 }}>
              {lang === "th"
                ? `คุณต้องการยกเลิกการลงทะเบียนสำหรับกิจกรรม "${confirmUnregister.eventTitle}" ใช่หรือไม่? ที่นั่งของคุณอาจถูกผู้อื่นจองแทน`
                : lang === "cn"
                ? `您确定要取消活动 "${confirmUnregister.eventTitle}" 的注册吗？您的名额可能会被其他人占用。`
                : lang === "mm"
                ? `"${confirmUnregister.eventTitle}" လှုပ်ရှားမှုအတွက် မှတ်ပုံတင်ခြင်းကို ပယ်ဖျက်လိုသည်မှာ သေချာပါသလား? သင့်နေရာကို အခြားသူ ယူသွားနိုင်ပါသည်။`
                : `Are you sure you want to cancel your registration for "${confirmUnregister.eventTitle}"? Your seat may be taken by someone else.`}
            </p>
            {confirmUnregister.losesPreTest && (
              <div style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                textAlign: "left",
                background: "rgb(var(--red-500-rgb) / 0.08)",
                border: "1px solid rgb(var(--red-500-rgb) / 0.25)",
                borderRadius: 14,
                padding: "12px 14px",
                marginBottom: 28
              }}>
                <AlertCircle size={18} style={{ color: "var(--red-500)", flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, fontWeight: 600 }}>
                  {lang === "th"
                    ? "คุณทำแบบทดสอบ Pre-Test ของกิจกรรมนี้ไปแล้ว การยกเลิกจะลบคำตอบของคุณ และต้องทำใหม่ทั้งหมดหากลงทะเบียนอีกครั้ง"
                    : lang === "cn"
                    ? "您已完成此活动的 Pre-Test。取消将删除您的作答，重新注册后需要再次完成。"
                    : lang === "mm"
                    ? "ဤပွဲ၏ Pre-Test ကို ဖြေပြီးပါပြီ။ ပယ်ဖျက်ပါက သင့်အဖြေများ ပျောက်ဆုံးပြီး ပြန်လည်မှတ်ပုံတင်ပါက အသစ်ပြန်ဖြေရပါမည်။"
                    : "You've already completed this event's Pre-Test. Cancelling will delete your answers, and you'll have to retake it if you register again."}
                </span>
              </div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, border: "1px solid var(--border-medium)" }}
                onClick={() => setConfirmUnregister(prev => ({ ...prev, show: false }))}
              >
                {lang === "th" ? "ไม่ใช่ คงไว้" : lang === "cn" ? "保留注册" : lang === "mm" ? "မဖျက်တော့ပါ" : "Keep It"}
              </button>
              <button
                className="btn"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  background: "var(--red-500)",
                  color: "var(--text-on-color)",
                  border: "none",
                  boxShadow: "0 10px 25px rgb(var(--red-500-rgb) / 0.3)"
                }}
                onClick={() => {
                  const { eventId } = confirmUnregister;
                  setConfirmUnregister(prev => ({ ...prev, show: false }));
                  handleRegister(eventId, true);
                }}
              >
                {lang === "th" ? "ยืนยันยกเลิก" : lang === "cn" ? "确认取消" : lang === "mm" ? "ပယ်ဖျက်မည်" : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}</>
  );
}
