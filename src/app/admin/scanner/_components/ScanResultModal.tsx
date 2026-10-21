"use client";

import { CheckCircle2, AlertCircle, ArrowRight, House, UserX, Award, Plus, Minus, Camera, Paperclip, X } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { QRCodeCanvas, SongsueCheckinNotice } from "./scanner-parts";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

export function ScanResultModal({ ctx }: { ctx: ScannerScreenCtx }) {
  const { STATUS_CONFIG, cfg, checkoutFileError, checkoutFileKey, checkoutFileName, closeModal, confirmAttendance, confirmCheckout, confirmScore, eventId, events, isConfirming, isConfirmingCheckout, lang, medsCheckOption, removeCheckoutEvidence, scanMode, scanResult, scoreInput, scoreReason, scoreSign, selectedEvent, setMedsCheckOption, setScoreInput, setScoreReason, setScoreSign, showMedicalCheck, showModal, showSongsueNotice, submittingScore, t, uploadCheckoutEvidence, uploadingCheckoutFile } = ctx;
  return (
    <>{showModal && cfg && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgb(var(--scrim-rgb) / 0.6)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={closeModal}
        >
          <div 
            className="animate-fade-in-up"
            style={{
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-xl)",
              width: "100%",
              maxWidth: 440,
              maxHeight: "calc(100vh - 48px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 50px 100px rgb(var(--shadow-rgb) / 0.3)",
              border: `1px solid var(--border-subtle)`
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header/Icon */}
            <div style={{ background: cfg.bg, padding: "32px 32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ 
                width: 72, 
                height: 72, 
                borderRadius: "50%", 
                background: "var(--bg-surface)", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                color: cfg.color,
                boxShadow: `0 10px 30px ${alpha(cfg.color, 0.19)}`,
                border: `4px solid var(--bg-surface)`
              }}>
                <cfg.icon size={36} strokeWidth={3} />
              </div>
              <div style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)" }}>{cfg.title}</h2>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{cfg.desc}</p>
              </div>
            </div>

            {/* Modal Body: Student Info */}
            <div style={{ padding: "24px 32px 32px", overflowY: "auto", flex: 1 }}>
              {scanResult?.student ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.04em", overflowWrap: "break-word", wordBreak: "break-word" }}>
                      {scanResult.student.name}
                    </p>
                    <p style={{ fontSize: 18, color: "var(--text-secondary)", fontWeight: 700, marginTop: 4 }}>
                      {scanResult.student.studentId}
                    </p>
                    {scanResult.student.nickname && (
                      <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>
                        aka &quot;{scanResult.student.nickname}&quot;
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                    <div style={{ 
                      padding: "10px 20px", 
                      borderRadius: 12, 
                      background: "var(--bg-elevated)", 
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}>
                      <House size={16} color={scanResult.student.houseColor} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: scanResult.student.houseColor }}>
                        {scanResult.student.houseId === 'red' ? t.houseMom : scanResult.student.houseId === 'green' ? t.houseTo : scanResult.student.houseId === 'yellow' ? t.houseLuang : scanResult.student.houseId === 'blue' ? t.houseMakara : scanResult.student.house}
                      </span>
                    </div>
                    {scanResult.student.points !== undefined && (
                      <div style={{ 
                        padding: "10px 20px", 
                        borderRadius: 12, 
                        background: "var(--bg-elevated)", 
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                      }}>
                        <Award size={16} color="var(--accent-primary)" />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                          {scanResult.student.points} {lang === "th" ? "คะแนน" : "pts"}
                        </span>
                      </div>
                    )}
                  </div>

                  {showMedicalCheck && (
                    <div style={{ 
                      marginTop: 8,
                      padding: 16, 
                      borderRadius: 16, 
                      background: "rgb(var(--red-500-rgb) / 0.04)", 
                      border: "1.5px dashed rgb(var(--red-500-rgb) / 0.25)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      textAlign: "left"
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <AlertCircle size={18} color="var(--red-500)" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 800, color: "var(--red-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {lang === "th" ? "ข้อมูลสุขภาพสำคัญ" : lang === "cn" ? "重要健康信息" : lang === "mm" ? "ကျန်းမာရေး သတိပေးချက်" : "Important Health Information"}
                          </p>
                          <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                            {scanResult.student.medicalFlags?.chronicDiseases && (
                              <p>• <b>{t.chronicDiseases}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.medicalHistory && (
                              <p>• <b>{t.medicalHistory}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.drugAllergies && (
                              <p>• <b>{t.drugAllergies}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.foodAllergies && (
                              <p>• <b>{t.foodAllergies}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.dietaryRestrictions && (
                              <p>• <b>{t.dietaryRestrictions}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.faintingHistory && (
                              <p>• <b>{t.faintingHistory}</b></p>
                            )}
                            {scanResult.student.medicalFlags?.emergencyMed && (
                              <p>• <b>{t.emergencyMed}</b></p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Safety Action Selector */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                        <p style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                          {lang === "th" ? "การดำเนินการโดยผู้ดูแล" : lang === "cn" ? "管理员操作选项" : lang === "mm" ? "အက်ဒမင်လုပ်ဆောင်ချက်" : "Admin Security Action"}
                        </p>
                        
                        {/* Option 1: Brought Medication */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "brought" ? "rgb(var(--emerald-500-rgb) / 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "brought" ? "1.5px solid var(--emerald-500)" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "var(--emerald-500)", cursor: "pointer" }} 
                            checked={medsCheckOption === "brought"}
                            onChange={() => setMedsCheckOption("brought")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "brought" ? "var(--emerald-500)" : "var(--text-primary)" }}>
                              {lang === "th" ? "พกยาส่วนตัว/ยาฉุกเฉินมาด้วยแล้ว" : lang === "cn" ? "已携带个人/紧急药品" : lang === "mm" ? "ကိုယ်ပိုင်/အရေးပေါ်ဆေးဝါး ယူဆောင်လာပြီး" : "Brought personal/emergency medication"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              Brought Medication (Safe check-in)
                            </p>
                          </div>
                        </label>

                         {/* Option 2: Didn't Bring Medication */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "forgot" ? "rgb(var(--amber-500-rgb) / 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "forgot" ? "1.5px solid var(--amber-500)" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "var(--amber-500)", cursor: "pointer" }} 
                            checked={medsCheckOption === "forgot"}
                            onChange={() => setMedsCheckOption("forgot")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "forgot" ? "var(--amber-500)" : "var(--text-primary)" }}>
                              {lang === "th" ? "ไม่ได้พกยามาด้วย / รับทราบความเสี่ยง" : lang === "cn" ? "未携带药品 / 已知悉风险" : lang === "mm" ? "ဆေးဝါးယူမလာပါ / အန္တရာယ်ရှိနိုင်မှုကို သိရှိပြီး" : "Didn't bring medication / Acknowledged risk"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              {"Didn't bring medication (Accept risk)"}
                            </p>
                          </div>
                        </label>
                        {/* Option 3: Acknowledge Dietary/Allergies Only */}
                        <label style={{ 
                           display: "flex", 
                           alignItems: "center", 
                           gap: 10, 
                           padding: "10px 12px", 
                           background: medsCheckOption === "acknowledge" ? "rgb(var(--indigo-500-rgb) / 0.08)" : "var(--bg-elevated)", 
                           borderRadius: 12, 
                           border: medsCheckOption === "acknowledge" ? "1.5px solid var(--indigo-500)" : "1.5px solid var(--border-subtle)", 
                           cursor: "pointer",
                           userSelect: "none",
                           transition: "all 0.2s"
                        }}>
                          <input 
                            type="radio" 
                            name="meds-check-radio"
                            style={{ width: 16, height: 16, accentColor: "var(--indigo-500)", cursor: "pointer" }} 
                            checked={medsCheckOption === "acknowledge"}
                            onChange={() => setMedsCheckOption("acknowledge")}
                          />
                          <div style={{ textAlign: "left" }}>
                            <p style={{ fontSize: 12, fontWeight: 800, color: medsCheckOption === "acknowledge" ? "var(--indigo-500)" : "var(--text-primary)" }}>
                              {lang === "th" ? "รับทราบข้อมูล (กรณีข้อจำกัดอาหาร / ข้อมูลทั่วไป)" : lang === "cn" ? "仅确认信息（饮食/过敏限制）" : lang === "mm" ? "အချက်အလက်ကို သိရှိပြီး (အစားအသောက်/ဓာတ်မတည့်မှု ကန့်သတ်ချက်)" : "Acknowledge info only (Dietary/Allergy restrictions)"}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              Acknowledge (For Dietary / Allergies / General info)
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: "center", color: cfg.color, fontWeight: 700 }}>
                  {scanResult?.error === "Walk-in quota is full. Walk-ins cannot be accepted."
                    ? t.walkInQuotaFullError
                    : scanResult?.error === "Event is full. Walk-ins cannot be accepted."
                    ? t.eventFullError
                    : scanResult?.error === "Walk-ins are not enabled for this event and student is not pre-registered."
                    ? t.walkInsDisabledError
                    : scanResult?.error === "Student not found in the system."
                    ? t.studentNotFoundError
                    : scanResult?.error || "Unknown Student"}
                </div>
              )}

              {/* Check-in Mode buttons and banners */}
              {scanMode === "checkin" && scanResult?.status === "pending_confirmation" && scanResult.rawToken && (
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => confirmAttendance(scanResult.rawToken!)}
                  disabled={isConfirming || (scanResult?.student?.hasMedicalCondition && !medsCheckOption)}
                  style={{ 
                    marginTop: 24, 
                    background: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "var(--bg-elevated)" : "var(--indigo-500)", 
                    color: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "var(--text-muted)" : "white",
                    minHeight: 56, 
                    borderRadius: 16, 
                    fontSize: 16, 
                    fontWeight: 700,
                    opacity: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? 0.7 : 1,
                    cursor: (scanResult?.student?.hasMedicalCondition && !medsCheckOption) ? "not-allowed" : "pointer"
                  }}
                >
                  {isConfirming
                    ? (lang === "th" ? "กำลังดำเนินการ..." : lang === "cn" ? "处理中..." : lang === "mm" ? "လုပ်ဆောင်နေသည်..." : "Processing...")
                    : selectedEvent?.requireCheckOut
                    // requireCheckOut events: this confirm is arrival-only — no
                    // points yet, so the label says so instead of implying done.
                    ? (lang === "th" ? "ยืนยันเช็คอิน (ยังไม่ได้คะแนน)" : lang === "cn" ? "确认签到（尚未获得积分）" : lang === "mm" ? "checkin အတည်ပြုပါ (မှတ်မရသေးပါ)" : "Confirm Check-in (no points yet)")
                    : (scanResult?.isWalkIn ? (lang === "th" ? "ยืนยันการเช็คอินแบบ Walk-in" : lang === "cn" ? "确认现场签到" : lang === "mm" ? "Walk-in ချက်အင်ဝင်ခြင်းကို อတည်ပြုရน်" : "Confirm Walk-in Presence") : (lang === "th" ? "ยืนยันการเข้าร่วมกิจกรรม" : lang === "cn" ? "确认到场签到" : lang === "mm" ? "ကိုယ်ตိုင်ตက်ရောက်မှုကို อတည်ပြုရန်" : "Confirm Physical Presence"))}
                </button>
              )}

              {/* Check-OUT (events.requireCheckOut): staff has already looked at
                  the student's evidence in person — attach the kept photo, then
                  confirm to award this day's points. See docs/features/evidence-checkin.md. */}
              {scanMode === "checkin" && scanResult?.status === "pending_checkout" && scanResult.rawToken && (() => {
                // events.checkOutEvidenceRequired (default true) — some events
                // trust a staff-witnessed re-scan alone and skip the mandatory
                // proof photo. See confirmCheckout above / ScannerService.confirmCheckout.
                const evidenceRequired = selectedEvent?.checkOutEvidenceRequired ?? true;
                const checkoutBlocked = evidenceRequired && !checkoutFileKey;
                return (
                <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.5 }}>
                    {evidenceRequired
                      ? (lang === "th" ? "ตรวจสอบหลักฐาน (เช่น Strava) กับนักศึกษาแล้ว ให้แนบรูปเพื่อบันทึกไว้ก่อนยืนยันเช็คเอาท์" : lang === "cn" ? "已当面核实证据（如 Strava）后，请附上照片留存记录，然后确认签退。" : lang === "mm" ? "သက်သေ (ဥပမာ Strava) ကို ကိုယ်တိုင်စစ်ဆေးပြီးနောက် မှတ်တမ်းအတွက် ပုံကို ပူးတွဲပြီး checkout ကို အတည်ပြုပါ။" : "After verifying their evidence (e.g. Strava) in person, attach a photo for the record, then confirm check-out.")
                      : (lang === "th" ? "ยืนยันตัวนักศึกษาแล้ว กดยืนยันเช็คเอาท์ได้เลย ไม่ต้องแนบรูป" : lang === "cn" ? "已当面核实身份，可直接确认签退，无需附照片。" : lang === "mm" ? "ကျောင်းသားကို ကိုယ်တိုင်စစ်ဆေးပြီးပါက ပုံ ပူးတွဲစရာမလိုဘဲ checkout ကို အတည်ပြုနိုင်ပါသည်။" : "You've confirmed the student in person — go ahead and check them out, no photo needed.")
                    }
                  </p>

                  {evidenceRequired && (checkoutFileName ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-elevated)", borderRadius: 12, padding: "10px 14px" }}>
                      <Paperclip size={16} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                      <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{checkoutFileName}</span>
                      <button type="button" onClick={removeCheckoutEvidence} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <label className="btn btn-ghost btn-full" style={{ borderRadius: 12, cursor: uploadingCheckoutFile ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      {uploadingCheckoutFile ? (
                        <div className="spinner" style={{ width: 16, height: 16 }} />
                      ) : (
                        <><Camera size={16} /> {lang === "th" ? "แนบรูปหลักฐาน" : lang === "cn" ? "附上证据照片" : lang === "mm" ? "သက်သေပုံ ပူးတွဲပါ" : "Attach proof photo"}</>
                      )}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: "none" }}
                        disabled={uploadingCheckoutFile}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadCheckoutEvidence(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ))}

                  {checkoutFileError && <p style={{ fontSize: 12.5, color: "var(--red-500)", textAlign: "center" }}>{checkoutFileError}</p>}

                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => confirmCheckout(scanResult.rawToken!)}
                    disabled={isConfirmingCheckout || checkoutBlocked}
                    style={{
                      background: checkoutBlocked ? "var(--bg-elevated)" : "var(--amber-500)",
                      color: checkoutBlocked ? "var(--text-muted)" : "white",
                      minHeight: 56,
                      borderRadius: 16,
                      fontSize: 16,
                      fontWeight: 700,
                      opacity: checkoutBlocked ? 0.7 : 1,
                      cursor: checkoutBlocked ? "not-allowed" : "pointer",
                    }}
                  >
                    {isConfirmingCheckout
                      ? (lang === "th" ? "กำลังดำเนินการ..." : lang === "cn" ? "处理中..." : lang === "mm" ? "လုပ်ဆောင်နေသည်..." : "Processing...")
                      : (lang === "th" ? "ยืนยันเช็คเอาท์" : lang === "cn" ? "确认签退" : lang === "mm" ? "checkout ကို အတည်ပြုပါ" : "Confirm Check-out")}
                  </button>
                </div>
                );
              })()}

              {scanMode === "checkin" && (scanResult?.status === "success" || scanResult?.status === "success_walk_in" || scanResult?.status === "success_checkout" || scanResult?.status === "already_checked_in" || scanResult?.status === "already_checked_out") && (
                <div 
                  style={{ 
                    marginTop: 24, 
                    padding: 16, 
                    borderRadius: 16, 
                    background: (scanResult?.status === "already_checked_in" || scanResult?.status === "already_checked_out") ? "var(--blue-500)" : "var(--emerald-500)", 
                    color: "white", 
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    boxShadow: (scanResult?.status === "already_checked_in" || scanResult?.status === "already_checked_out") ? "0 10px 20px rgb(var(--blue-500-rgb) / 0.3)" : "0 10px 20px rgb(var(--emerald-500-rgb) / 0.3)"
                  }}
                >
                  <CheckCircle2 size={24} />
                  {scanResult?.status === "already_checked_in" ? t.scanAlreadyCheckedIn
                    : scanResult?.status === "already_checked_out" ? STATUS_CONFIG.already_checked_out.title
                    : scanResult?.status === "success_checkout" ? t.scanCheckoutSuccess
                    : t.attended}
                </div>
              )}

              {/* Post-check-in "checked in via ActiveCAMT, ask them to open
                  Songsue" notice — only for events mirrored into Songsue
                  (songsueLinked), only on a fresh confirmed attendance (not a
                  re-scan of an already-checked-in student). Informational only
                  for the staff operating this scanner; never navigates them away. */}
              {showSongsueNotice && (
                <SongsueCheckinNotice message={t.scanSongsueRedirectMessage} />
              )}

              {/* Pre-test (K_pre) reminder — walk-ins skip the dashboard pre-test gate,
                  so on a confirmed check-in we warn and show a QR/link the attendee can
                  scan to complete it on their own phone. */}
              {scanMode === "checkin" && scanResult?.preTestWarning && (() => {
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const preTestUrl = `${origin}/dashboard/history?form=${scanResult.preTestWarning.formId}&event=${eventId}`;
                return (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 16,
                      borderRadius: 16,
                      background: "rgb(var(--rose-600-rgb) / 0.06)",
                      border: "1.5px dashed rgb(var(--rose-600-rgb) / 0.4)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertCircle size={18} color="var(--rose-600)" style={{ flexShrink: 0 }} />
                      <p style={{ fontSize: 13, fontWeight: 800, color: "var(--rose-600)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {lang === "th" ? "ต้องทำแบบทดสอบ Pre-test" : lang === "cn" ? "需要完成前测" : lang === "mm" ? "Pre-Test ဖြေဆိုရန် လိုအပ်သည်" : "Pre-Test Required"}
                      </p>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                      {lang === "th"
                        ? `กิจกรรมนี้มีแบบทดสอบ Pre-test “${scanResult.preTestWarning.title}” ที่ผู้เข้าร่วมยังทำไม่เสร็จ ให้สแกนเพื่อทำให้เสร็จ`
                        : lang === "cn"
                        ? `本活动有一个前测「${scanResult.preTestWarning.title}」，该参与者尚未完成。请扫码完成。`
                        : lang === "mm"
                        ? `ဤပွဲတွင် ဤတက်ရောက်သူ မဖြေဆိုရသေးသော Pre-Test「${scanResult.preTestWarning.title}」ရှိသည်။ ဖြေဆိုရန် စကန်ဖတ်ပါ။`
                        : `This event has a pre-test “${scanResult.preTestWarning.title}” the attendee hasn't completed yet. Scan to complete it.`}
                    </p>
                    <div style={{ background: "var(--qr-surface)", padding: 12, borderRadius: 12, lineHeight: 0 }}>
                      <QRCodeCanvas value={preTestUrl} size={160} level="M" bgColor="#ffffff" fgColor="#000000" />
                    </div>
                    <a
                      href={preTestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 18px",
                        borderRadius: 12,
                        background: "var(--rose-600)",
                        color: "white",
                        fontSize: 14,
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      {lang === "th" ? "เปิดแบบทดสอบ" : lang === "cn" ? "打开前测" : lang === "mm" ? "Pre-Test ဖွင့်ရန်" : "Open pre-test"}
                      <ArrowRight size={16} />
                    </a>
                  </div>
                );
              })()}

              {/* Score Mode — blocked: student is not registered for this event */}
              {scanMode === "score" && scanResult?.status === "not_registered" && (
                <div
                  style={{
                    marginTop: 24,
                    padding: 16,
                    borderRadius: 16,
                    background: "rgb(var(--red-500-rgb) / 0.08)",
                    border: "1.5px dashed rgb(var(--red-500-rgb) / 0.35)",
                    color: "var(--red-500)",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10
                  }}
                >
                  <UserX size={20} />
                  {lang === "th"
                    ? "ไม่สามารถมอบ/หักคะแนนได้ เนื่องจากนักศึกษายังไม่ได้ลงทะเบียนกิจกรรมนี้"
                    : lang === "cn"
                    ? "无法给分/扣分：该学生未报名此活动"
                    : lang === "mm"
                    ? "ဤကျောင်းသားသည် ဤပွဲတွင် စာရင်းမသွင်းထားသဖြင့် အမှတ်ပေး/နှုတ်၍မရပါ"
                    : "Can't award or deduct points — this student is not registered for this event."}
                </div>
              )}

              {/* Score Mode inputs — only for students registered for this event (status "found") */}
              {scanMode === "score" && scanResult?.status === "found" && scanResult?.rawToken && (
                <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.activityLabel}
                    </label>
                    <div style={{
                      padding: "12px 16px",
                      borderRadius: 12,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      overflowWrap: "break-word",
                      wordBreak: "break-word"
                    }}>
                      {events.find(e => e.id === eventId)?.title || (lang === "th" ? "ไม่ได้เลือกกิจกรรม" : "No event selected")}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.scoreToAward}
                    </label>

                    {/* Award / Deduct toggle — keeps the magnitude input positive and makes intent explicit */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <button
                        type="button"
                        onClick={() => setScoreSign(1)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          border: scoreSign === 1 ? "1.5px solid var(--emerald-500)" : "1.5px solid var(--border-subtle)",
                          background: scoreSign === 1 ? "rgb(var(--emerald-500-rgb) / 0.08)" : "var(--bg-elevated)",
                          color: scoreSign === 1 ? "var(--emerald-500)" : "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          transition: "all 0.2s"
                        }}
                      >
                        <Plus size={16} /> {lang === "th" ? "เพิ่มคะแนน" : lang === "cn" ? "加分" : lang === "mm" ? "အမှတ်ပေါင်း" : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setScoreSign(-1)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          border: scoreSign === -1 ? "1.5px solid var(--red-500)" : "1.5px solid var(--border-subtle)",
                          background: scoreSign === -1 ? "rgb(var(--red-500-rgb) / 0.08)" : "var(--bg-elevated)",
                          color: scoreSign === -1 ? "var(--red-500)" : "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          transition: "all 0.2s"
                        }}
                      >
                        <Minus size={16} /> {lang === "th" ? "หักคะแนน" : lang === "cn" ? "扣分" : lang === "mm" ? "အမှတ်နှုတ်" : "Deduct"}
                      </button>
                    </div>

                    <input
                      type="number"
                      className="input"
                      placeholder="e.g. 10"
                      min={1}
                      value={scoreInput}
                      onChange={(e) => setScoreInput(e.target.value)}
                      style={{ fontSize: 24, fontWeight: 900, textAlign: "center", padding: "12px 16px", color: scoreSign === -1 ? "var(--red-500)" : "var(--text-primary)" }}
                    />
                    {scoreInput && (parseInt(scoreInput) > 0) && (
                      <p style={{ fontSize: 13, fontWeight: 800, textAlign: "center", marginTop: 8, color: scoreSign === -1 ? "var(--red-500)" : "var(--emerald-500)" }}>
                        {scoreSign === -1 ? "−" : "+"}{parseInt(scoreInput)} {lang === "th" ? "คะแนน" : "pts"}
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                      {t.scoreReasonLabel}
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder={t.scoreReasonPlaceholder}
                      value={scoreReason}
                      onChange={(e) => setScoreReason(e.target.value)}
                      style={{ fontSize: 16, fontWeight: 600, padding: "12px 16px" }}
                    />
                  </div>
                  
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => confirmScore(scanResult.rawToken!)}
                    disabled={submittingScore || !scoreInput}
                    style={{
                      background: !scoreInput ? "var(--bg-elevated)" : scoreSign === -1 ? "var(--red-500)" : "var(--accent-primary)",
                      color: !scoreInput ? "var(--text-muted)" : "white",
                      minHeight: 56,
                      borderRadius: 16,
                      fontSize: 16,
                      fontWeight: 700,
                      opacity: !scoreInput ? 0.7 : 1,
                      cursor: !scoreInput ? "not-allowed" : "pointer"
                    }}
                  >
                    {submittingScore
                      ? t.scoreAwarding
                      : scoreSign === -1
                        ? (lang === "th" ? "ยืนยันการหักคะแนน" : lang === "cn" ? "确认扣分" : lang === "mm" ? "အမှတ်နှုတ်ခြင်းကို အတည်ပြုရန်" : "Confirm Deduction")
                        : t.confirmScoreBtn}
                  </button>
                </div>
              )}

              {scanMode === "score" && scanResult?.status === "success" && (
                <div 
                  style={{ 
                    marginTop: 24, 
                    padding: 16, 
                    borderRadius: 16, 
                    background: "var(--emerald-500)", 
                    color: "white", 
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    boxShadow: "0 10px 20px rgb(var(--emerald-500-rgb) / 0.3)"
                  }}
                >
                  <CheckCircle2 size={24} />
                  {scoreSign === -1
                    ? (lang === "th" ? "หักคะแนนเรียบร้อยแล้ว" : lang === "cn" ? "已成功扣分" : lang === "mm" ? "အမှတ်ကို အောင်မြင်စွာ နှုတ်ပြီးပါပြီ" : "Points Deducted Successfully")
                    : t.scoreAwardedSuccess}
                </div>
              )}

              {(() => {
                const isCloseDisabled = !!(
                  showMedicalCheck &&
                  !medsCheckOption && 
                  scanResult?.status !== "pending_confirmation"
                );
                return (
                  <button 
                    className="btn btn-ghost btn-full" 
                    onClick={closeModal}
                    disabled={isCloseDisabled}
                    style={{ 
                      marginTop: 12, 
                      minHeight: 52, 
                      borderRadius: 16, 
                      fontSize: 16, 
                      fontWeight: 700,
                      opacity: isCloseDisabled ? 0.5 : 1,
                      cursor: isCloseDisabled ? "not-allowed" : "pointer"
                    }}
                  >
                    {lang === "th" ? "สแกนต่อ" : lang === "cn" ? "继续扫描" : lang === "mm" ? "စကင်ဖတ်ခြင်းကို ဆက်လုပ်ရန်" : "Continue Scanning"}
                  </button>
                );
              })()}

            </div>
          </div>
        </div>
      )}</>
  );
}
