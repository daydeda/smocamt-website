"use client";

import { ShieldCheck, Check } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function CheckOutFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, lang, set } = ctx;
  return (
    <>{formData.checkInMode === "qr" && (
                  <div className="field" style={{ marginTop: 4 }}>
                    <label
                      className="label"
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    >
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          borderRadius: 5,
                          border: `2px solid ${formData.requireCheckOut ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                          background: formData.requireCheckOut ? "var(--accent-primary)" : "var(--bg-surface)",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        {/* Real checkbox stays for a11y/form semantics but is visually invisible;
                            the styled <span> above renders the custom look. Nesting it inside the
                            <label> (no separate onClick handler) is what makes the whole row
                            clickable via native label-forwarding, not just the tiny box itself. */}
                        <input
                          type="checkbox"
                          checked={formData.requireCheckOut}
                          onChange={(e) => set("requireCheckOut", e.target.checked)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
                        />
                        {formData.requireCheckOut && <Check size={13} strokeWidth={3} style={{ color: "var(--text-on-color)", pointerEvents: "none" }} />}
                      </span>
                      <ShieldCheck size={16} style={{ color: "var(--accent-primary)" }} />
                      {lang === "th" ? "ต้องเช็คเอาท์ (สแกน 2 ครั้ง: เข้า + ออกพร้อมหลักฐาน)" : lang === "cn" ? "需要签退（两次扫码：签到 + 附证据签退）" : lang === "mm" ? "checkout လိုအပ်သည် (scan ၂ ကြိမ် - ဝင်ရောက်ခြင်း + သက်သေဖြင့် ထွက်ခွာခြင်း)" : "Require check-out (2 scans: arrival + evidence-reviewed departure)"}
                    </label>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.45 }}>
                      {lang === "th"
                        ? "การสแกนครั้งแรกจะบันทึกแค่การมาถึง (ไม่ได้คะแนน) สแกนซ้ำครั้งที่สองจะให้เจ้าหน้าที่แนบรูปหลักฐานก่อนยืนยันเช็คเอาท์ ซึ่งตอนนั้นจึงจะได้คะแนน"
                        : lang === "cn" ? "第一次扫码只记录到场（不给积分）；第二次扫码时工作人员需先附上证据照片才能确认签退，此时才发放积分。"
                        : lang === "mm" ? "ပထမဆုံး scan သည် ရောက်ရှိမှုကိုသာ မှတ်တမ်းတင်မည် (မှတ်မရသေးပါ) — ဒုတိယ scan တွင် ဝန်ထမ်းသည် checkout အတည်ပြုမီ သက်သေပုံကို ပူးတွဲရမည်၊ ထိုအချိန်၌သာ မှတ်များ ရရှိမည်။"
                        : "The first scan only records arrival (no points yet). A second scan of the same student lets staff attach a proof photo before confirming check-out — that's when points are actually awarded."}
                    </p>

                    {/* Sub-option of requireCheckOut above — only meaningful once
                        that's on. Lets staff skip the mandatory proof photo for
                        events where the in-person scan alone is trusted (e.g. a
                        small activity staff are watching directly). See
                        events.checkOutEvidenceRequired in schema.ts. */}
                    {formData.requireCheckOut && (
                      <label
                        className="label"
                        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginTop: 12, marginLeft: 30 }}
                      >
                        <span
                          style={{
                            position: "relative",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            flexShrink: 0,
                            borderRadius: 4,
                            border: `2px solid ${formData.checkOutEvidenceRequired ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                            background: formData.checkOutEvidenceRequired ? "var(--accent-primary)" : "var(--bg-surface)",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={formData.checkOutEvidenceRequired}
                            onChange={(e) => set("checkOutEvidenceRequired", e.target.checked)}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
                          />
                          {formData.checkOutEvidenceRequired && <Check size={12} strokeWidth={3} style={{ color: "var(--text-on-color)", pointerEvents: "none" }} />}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                          {lang === "th"
                            ? "ต้องมีรูปหลักฐานตอนเช็คเอาท์"
                            : lang === "cn" ? "签退需要证据照片"
                            : lang === "mm" ? "checkout လုပ်ရန် သက်သေပုံ လိုအပ်သည်"
                            : "Require a proof photo for check-out"}
                        </span>
                      </label>
                    )}
                    {formData.requireCheckOut && !formData.checkOutEvidenceRequired && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0 30px", lineHeight: 1.45 }}>
                        {lang === "th"
                          ? "ปิดไว้: เจ้าหน้าที่ยืนยันเช็คเอาท์ด้วยการสแกนซ้ำเท่านั้น โดยไม่ต้องแนบรูป"
                          : lang === "cn" ? "已关闭：工作人员只需再次扫码即可确认签退，无需附照片。"
                          : lang === "mm" ? "ပိတ်ထားသည်: ဝန်ထမ်းသည် scan ပြန်ခြင်းဖြင့်သာ checkout ကို အတည်ပြုနိုင်ပြီး ပုံ ပူးတွဲရန် မလိုအပ်ပါ။"
                          : "Off: staff confirm check-out with just a second scan — no photo needed."}
                      </p>
                    )}
                  </div>
                )}</>
  );
}
