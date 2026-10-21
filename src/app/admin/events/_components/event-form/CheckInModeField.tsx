"use client";

import { QrCode } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function CheckInModeField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, lang, set } = ctx;
  return (
    <div className="field" style={{ marginTop: 4 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <QrCode size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "วิธีเช็คอิน" : lang === "cn" ? "签到方式" : lang === "mm" ? "checkin နည်းလမ်း" : "Check-in method"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    {lang === "th"
                      ? "เลือก \"หลักฐานด้วยตนเอง\" สำหรับกิจกรรมที่ไม่มีจุดสแกน QR (เช่น ภารกิจนับก้าวหลายวัน) — ผู้เข้าร่วมจะส่งรูปหลักฐาน + รหัสประจำวันแทนการสแกน"
                      : lang === "cn" ? "对于没有二维码扫描点的活动（如多日步数挑战），选择\"自行提交证据\"——参与者将上传证据照片和当日代码词，而不是被扫码签到。"
                      : lang === "mm" ? "QR scan point မရှိသော activity (ဥပမာ - ရက်များစွာကြာ လမ်းလျှောက်စိန်ခေါ်မှု) အတွက် \"မိမိကိုယ်တိုင် သက်သေတင်ခြင်း\" ကို ရွေးပါ — scan မလုပ်ဘဲ ဓာတ်ပုံနှင့် နေ့စဉ်ကုဒ်ကို တင်သွင်းမည်။"
                      : "Pick \"Self-submitted evidence\" for activities with nowhere to scan a QR (e.g. a multi-day step challenge) — participants upload a proof photo + that day's code word instead of being scanned."}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      {
                        value: "qr" as const,
                        label: lang === "th" ? "สแกน QR / เจ้าหน้าที่เช็คอิน" : lang === "cn" ? "扫码 / 工作人员签到" : lang === "mm" ? "QR scan / ဝန်ထမ်း checkin" : "QR / staff scanner",
                        desc: lang === "th" ? "วิธีเดิม — เช็คอินด้วยการสแกนหรือเจ้าหน้าที่กดยืนยัน" : lang === "cn" ? "默认方式——通过扫码或工作人员确认签到" : lang === "mm" ? "မူလနည်းလမ်း — scan (သို့) ဝန်ထမ်းအတည်ပြုချက်ဖြင့် checkin" : "The existing flow — scanned or manually confirmed by staff.",
                      },
                      {
                        value: "evidence" as const,
                        label: lang === "th" ? "หลักฐานด้วยตนเอง (ไม่ต้องสแกน)" : lang === "cn" ? "自行提交证据（无需扫码）" : lang === "mm" ? "မိမိကိုယ်တိုင် သက်သေတင်ခြင်း (scan မလို)" : "Self-submitted evidence (no scan)",
                        desc: lang === "th" ? "ผู้เข้าร่วมส่งรูป + รหัสประจำวันด้วยตนเองในแดชบอร์ด" : lang === "cn" ? "参与者在仪表盘中自行上传照片和当日代码词" : lang === "mm" ? "dashboard တွင် ဓာတ်ပုံ + နေ့စဉ်ကုဒ်ကို မိမိကိုယ်တိုင် တင်သွင်းမည်" : "Participants submit a photo + code word themselves from the dashboard.",
                      },
                    ]).map((opt) => {
                      const active = formData.checkInMode === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => set("checkInMode", opt.value)}
                          style={{
                            minHeight: 48,
                            background: "var(--bg-elevated)",
                            borderRadius: 16,
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 16px",
                            cursor: "pointer",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{
                            width: 22, height: 22, flexShrink: 0, marginTop: 1, borderRadius: "50%",
                            border: active ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                            display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s",
                          }}>
                            {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.35 }}>
                              {opt.label}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {opt.desc}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
  );
}
