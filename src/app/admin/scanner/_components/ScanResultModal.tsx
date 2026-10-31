"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, ArrowRight, Award, Camera, House, Loader2, Minus, Paperclip, Plus, UserX, X } from "lucide-react";
import { Field, IconButton, InlineAlert, Modal } from "@/components/admin/ui";
import { QRCodeCanvas, SongsueCheckinNotice } from "./scanner-parts";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

// Result sheet shown after every scan. Built on the kit <Modal>: a bottom sheet
// on phones (Escape, focus trap, focus return, ARIA handled there). Layout, top
// to bottom: the outcome (colour + icon + big text), who the student is, anything
// the staff must act on, then one big action pinned in the thumb zone.
export function ScanResultModal({ ctx }: { ctx: ScannerScreenCtx }) {
  const { cfg, checkoutFileError, checkoutFileKey, checkoutFileName, closeModal, confirmAttendance, confirmCheckout, confirmScore, eventId, events, fmtClock, isConfirming, isConfirmingCheckout, lang, medsCheckOption, removeCheckoutEvidence, scanMode, scanResult, scoreError, scoreInput, scoreReason, scoreSign, selectedEvent, setMedsCheckOption, setScoreError, setScoreInput, setScoreReason, setScoreSign, showMedicalCheck, showModal, showSongsueNotice, submittingScore, t, uploadCheckoutEvidence, uploadingCheckoutFile } = ctx;

  const primaryRef = useRef<HTMLButtonElement>(null);
  const status = scanResult?.status;

  // The primary button changes as the result moves pending -> done, which unmounts
  // the one that had focus. Put focus on whichever primary action is now showing.
  useEffect(() => {
    if (!showModal) return;
    const id = window.setTimeout(() => primaryRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [showModal, status]);

  if (!cfg) return null;

  const student = scanResult?.student;
  const rawToken = scanResult?.rawToken;
  const th = lang === "th";

  const isPendingConfirm = scanMode === "checkin" && status === "pending_confirmation" && !!rawToken;
  const isPendingCheckout = scanMode === "checkin" && status === "pending_checkout" && !!rawToken;
  const isScoreForm = scanMode === "score" && status === "found" && !!rawToken;

  const medicalBlocksConfirm = !!(student?.hasMedicalCondition && !medsCheckOption);
  const evidenceRequired = selectedEvent?.checkOutEvidenceRequired ?? true;
  const checkoutBlocked = evidenceRequired && !checkoutFileKey;
  // A result that needs a medical choice can't be closed with the button until one is made
  // (cancelling a pending confirmation is always allowed).
  const closeDisabled = !!(showMedicalCheck && !medsCheckOption && status !== "pending_confirmation");

  const busy = isConfirming || isConfirmingCheckout || submittingScore || uploadingCheckoutFile;

  const processing = (
    <>
      <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {t.adminScnProcessing}
    </>
  );

  const errorText =
    scanResult?.error === "Walk-in quota is full. Walk-ins cannot be accepted." ? t.walkInQuotaFullError
    : scanResult?.error === "Event is full. Walk-ins cannot be accepted." ? t.eventFullError
    : scanResult?.error === "Walk-ins are not enabled for this event and student is not pre-registered." ? t.walkInsDisabledError
    : scanResult?.error === "Student not found in the system." ? t.studentNotFoundError
    : scanResult?.error || "Unknown Student";

  const checkedInAtTime = scanResult?.checkedInAt && !Number.isNaN(new Date(scanResult.checkedInAt).getTime())
    ? fmtClock(scanResult.checkedInAt)
    : null;

  const houseName = student
    ? student.houseId === "red" ? t.houseMom
      : student.houseId === "green" ? t.houseTo
      : student.houseId === "yellow" ? t.houseLuang
      : student.houseId === "blue" ? t.houseMakara
      : student.house
    : null;

  const meds = [
    {
      value: "brought",
      color: "var(--emerald-500)",
      tint: "rgb(var(--emerald-500-rgb) / 0.08)",
      label: lang === "th" ? "พกยาส่วนตัว/ยาฉุกเฉินมาด้วยแล้ว" : lang === "cn" ? "已携带个人/紧急药品" : lang === "mm" ? "ကိုယ်ပိုင်/အရေးပေါ်ဆေးဝါး ယူဆောင်လာပြီး" : "Brought personal/emergency medication",
    },
    {
      value: "forgot",
      color: "var(--amber-700)",
      tint: "rgb(var(--amber-500-rgb) / 0.1)",
      label: lang === "th" ? "ไม่ได้พกยามาด้วย / รับทราบความเสี่ยง" : lang === "cn" ? "未携带药品 / 已知悉风险" : lang === "mm" ? "ဆေးဝါးယူမလာပါ / အန္တရာယ်ရှိနိုင်မှုကို သိရှိပြီး" : "Didn't bring medication / Acknowledged risk",
    },
    {
      value: "acknowledge",
      color: "var(--indigo-500)",
      tint: "rgb(var(--indigo-500-rgb) / 0.08)",
      label: lang === "th" ? "รับทราบข้อมูล (กรณีข้อจำกัดอาหาร / ข้อมูลทั่วไป)" : lang === "cn" ? "仅确认信息（饮食/过敏限制）" : lang === "mm" ? "အချက်အလက်ကို သိရှိပြီး (အစားအသောက်/ဓာတ်မတည့်မှု ကန့်သတ်ချက်)" : "Acknowledge info only (Dietary/Allergy restrictions)",
    },
  ];

  const scoreMagnitude = parseInt(scoreInput);
  const confirmLabel = selectedEvent?.requireCheckOut
    // requireCheckOut events: this confirm is arrival-only — no points yet, so the
    // label says so instead of implying done.
    ? (lang === "th" ? "ยืนยันเช็คอิน (ยังไม่ได้คะแนน)" : lang === "cn" ? "确认签到（尚未获得积分）" : lang === "mm" ? "checkin အတည်ပြုပါ (မှတ်မရသေးပါ)" : "Confirm Check-in (no points yet)")
    : scanResult?.isWalkIn
    ? (lang === "th" ? "ยืนยันการเช็คอินแบบ Walk-in" : lang === "cn" ? "确认现场签到" : lang === "mm" ? "Walk-in ချက်အင်ဝင်ခြင်းကို အတည်ပြုရန်" : "Confirm Walk-in Presence")
    : (lang === "th" ? "ยืนยันการเข้าร่วมกิจกรรม" : lang === "cn" ? "确认到场签到" : lang === "mm" ? "ကိုယ်တိုင်ရောက်မှုကို အတည်ပြုရန်" : "Confirm Physical Presence");

  const cancelBtn = (
    <button type="button" className="btn btn-ghost btn-lg" style={{ minHeight: 56 }} onClick={closeModal} disabled={busy}>
      {t.adminUiCancel}
    </button>
  );

  let footer: React.ReactNode;
  if (isPendingConfirm) {
    footer = (
      <>
        {cancelBtn}
        <button
          ref={primaryRef}
          type="button"
          className="btn btn-primary btn-lg"
          style={{ minHeight: 56 }}
          onClick={() => confirmAttendance(rawToken!)}
          disabled={isConfirming || medicalBlocksConfirm}
        >
          {isConfirming ? processing : confirmLabel}
        </button>
      </>
    );
  } else if (isPendingCheckout) {
    footer = (
      <>
        {cancelBtn}
        <button
          ref={primaryRef}
          type="button"
          className="btn btn-primary btn-lg"
          style={{ minHeight: 56 }}
          onClick={() => confirmCheckout(rawToken!)}
          disabled={isConfirmingCheckout || checkoutBlocked}
        >
          {isConfirmingCheckout
            ? processing
            : (lang === "th" ? "ยืนยันเช็คเอาท์" : lang === "cn" ? "确认签退" : lang === "mm" ? "checkout ကို အတည်ပြုပါ" : "Confirm Check-out")}
        </button>
      </>
    );
  } else if (isScoreForm) {
    footer = (
      <>
        {cancelBtn}
        <button
          ref={primaryRef}
          type="button"
          className={`btn btn-lg ${scoreSign === -1 ? "adm-btn-danger-solid" : "btn-primary"}`}
          style={{ minHeight: 56 }}
          onClick={() => confirmScore(rawToken!)}
          disabled={submittingScore || !scoreInput}
        >
          {submittingScore
            ? processing
            : scoreSign === -1
              ? (lang === "th" ? "ยืนยันการหักคะแนน" : lang === "cn" ? "确认扣分" : lang === "mm" ? "အမှတ်နှုတ်ခြင်းကို အတည်ပြုရန်" : "Confirm Deduction")
              : t.confirmScoreBtn}
        </button>
      </>
    );
  } else {
    footer = (
      <button
        ref={primaryRef}
        type="button"
        className="btn btn-primary btn-lg"
        style={{ minHeight: 56 }}
        onClick={closeModal}
        disabled={closeDisabled}
      >
        {t.adminScnScanNext} <ArrowRight size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <Modal
      open={showModal}
      onClose={closeModal}
      dismissible={!busy}
      size="sm"
      title={t.adminScnResultTitle}
      description={selectedEvent?.title}
      initialFocusRef={primaryRef}
      footer={footer}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Outcome: colour + icon + text, announced to screen readers when it changes. */}
        <div
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 14,
            borderRadius: 16,
            background: cfg.bg,
            border: `2px solid ${cfg.color}`,
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 56, height: 56, borderRadius: "50%", background: cfg.color, color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <cfg.icon size={30} strokeWidth={3} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.3, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{cfg.title}</p>
            {cfg.desc && cfg.desc !== cfg.title && (
              <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)", marginTop: 2 }}>{cfg.desc}</p>
            )}
            {student && (
              <span className="sr-only">{student.name} {student.studentId}</span>
            )}
          </div>
        </div>

        {student ? (
          <>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.35, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{student.name}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-secondary)", marginTop: 2 }}>{student.studentId}</p>
              {student.nickname && (
                <p style={{ fontSize: 16, color: "var(--text-secondary)", fontWeight: 600, marginTop: 2 }}>
                  {th ? "ชื่อเล่น" : "aka"} &quot;{student.nickname}&quot;
                </p>
              )}
              {status === "already_checked_in" && checkedInAtTime && (
                <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 6 }}>
                  {t.adminScnCheckedInAt.replace("{time}", checkedInAtTime)}
                </p>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ padding: "8px 16px", borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
                <House size={18} aria-hidden="true" color={student.houseColor} />
                <span style={{ fontSize: 16, fontWeight: 700, color: student.houseColor }}>{houseName}</span>
              </div>
              {student.points !== undefined && (
                <div style={{ padding: "8px 16px", borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
                  <Award size={18} aria-hidden="true" color="var(--accent-primary)" />
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    {student.points} {th ? "คะแนน" : "pts"}
                  </span>
                </div>
              )}
            </div>

            {showMedicalCheck && (
              <div style={{ padding: 14, borderRadius: 16, background: "rgb(var(--red-500-rgb) / 0.05)", border: "2px solid rgb(var(--red-500-rgb) / 0.35)", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <AlertCircle size={20} aria-hidden="true" color="var(--red-600)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "var(--red-600)", lineHeight: 1.4 }}>
                      {lang === "th" ? "ข้อมูลสุขภาพสำคัญ" : lang === "cn" ? "重要健康信息" : lang === "mm" ? "ကျန်းမာရေး သတိပေးချက်" : "Important Health Information"}
                    </p>
                    <ul style={{ listStyle: "disc", paddingLeft: 20, fontSize: 14, color: "var(--text-primary)", fontWeight: 600, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {student.medicalFlags?.chronicDiseases && <li>{t.chronicDiseases}</li>}
                      {student.medicalFlags?.medicalHistory && <li>{t.medicalHistory}</li>}
                      {student.medicalFlags?.drugAllergies && <li>{t.drugAllergies}</li>}
                      {student.medicalFlags?.foodAllergies && <li>{t.foodAllergies}</li>}
                      {student.medicalFlags?.dietaryRestrictions && <li>{t.dietaryRestrictions}</li>}
                      {student.medicalFlags?.faintingHistory && <li>{t.faintingHistory}</li>}
                      {student.medicalFlags?.emergencyMed && <li>{t.emergencyMed}</li>}
                    </ul>
                  </div>
                </div>

                {/* Safety action selector */}
                <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <legend style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6, padding: 0 }}>
                    {lang === "th" ? "การดำเนินการโดยผู้ดูแล" : lang === "cn" ? "管理员操作选项" : lang === "mm" ? "အက်ဒမင်လုပ်ဆောင်ချက်" : "Admin Security Action"}
                  </legend>
                  {meds.map((o) => {
                    const selected = medsCheckOption === o.value;
                    return (
                      <label
                        key={o.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          minHeight: 52,
                          padding: "10px 12px",
                          background: selected ? o.tint : "var(--bg-elevated)",
                          borderRadius: 12,
                          border: selected ? `2px solid ${o.color}` : "2px solid var(--border-subtle)",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="radio"
                          name="meds-check-radio"
                          style={{ width: 22, height: 22, accentColor: o.color, cursor: "pointer", flexShrink: 0 }}
                          checked={selected}
                          onChange={() => setMedsCheckOption(o.value)}
                        />
                        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)" }}>{o.label}</span>
                      </label>
                    );
                  })}
                </fieldset>
                {medicalBlocksConfirm || closeDisabled ? (
                  <InlineAlert tone="warning">{t.adminScnMedicalChoose}</InlineAlert>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <p style={{ textAlign: "center", fontSize: 18, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
            {errorText}
          </p>
        )}

        {/* Check-OUT (events.requireCheckOut): staff has already looked at the
            student's evidence in person — attach the kept photo, then confirm
            to award this day's points. See docs/features/evidence-checkin.md. */}
        {isPendingCheckout && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.6 }}>
              {evidenceRequired
                ? (lang === "th" ? "ตรวจสอบหลักฐาน (เช่น Strava) กับนักศึกษาแล้ว ให้แนบรูปเพื่อบันทึกไว้ก่อนยืนยันเช็คเอาท์" : lang === "cn" ? "已当面核实证据（如 Strava）后，请附上照片留存记录，然后确认签退。" : lang === "mm" ? "သက်သေ (ဥပမာ Strava) ကို ကိုယ်တိုင်စစ်ဆေးပြီးနောက် မှတ်တမ်းအတွက် ပုံကို ပူးတွဲပြီး checkout ကို အတည်ပြုပါ။" : "After verifying their evidence (e.g. Strava) in person, attach a photo for the record, then confirm check-out.")
                : (lang === "th" ? "ยืนยันตัวนักศึกษาแล้ว กดยืนยันเช็คเอาท์ได้เลย ไม่ต้องแนบรูป" : lang === "cn" ? "已当面核实身份，可直接确认签退，无需附照片。" : lang === "mm" ? "ကျောင်းသားကို ကိုယ်တိုင်စစ်ဆေးပြီးပါက ပုံ ပူးတွဲစရာမလိုဘဲ checkout ကို အတည်ပြုနိုင်ပါသည်။" : "You've confirmed the student in person — go ahead and check them out, no photo needed.")}
            </p>

            {evidenceRequired && (checkoutFileName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-elevated)", borderRadius: 12, padding: "4px 4px 4px 14px" }}>
                <Paperclip size={16} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                <span style={{ fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{checkoutFileName}</span>
                <IconButton label={t.adminScnRemovePhoto} icon={<X size={18} />} onClick={removeCheckoutEvidence} />
              </div>
            ) : (
              <label className="btn btn-ghost btn-full" style={{ minHeight: 52, cursor: uploadingCheckoutFile ? "wait" : "pointer" }}>
                {uploadingCheckoutFile ? (
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                ) : (
                  <><Camera size={18} aria-hidden="true" /> {lang === "th" ? "แนบรูปหลักฐาน" : lang === "cn" ? "附上证据照片" : lang === "mm" ? "သက်သေပုံ ပူးတွဲပါ" : "Attach proof photo"}</>
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

            {checkoutFileError && <p role="alert" style={{ fontSize: 14, fontWeight: 600, color: "var(--red-600)", textAlign: "center" }}>{checkoutFileError}</p>}
            {checkoutBlocked && !checkoutFileError && !uploadingCheckoutFile && (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center" }}>{t.adminScnPhotoNeeded}</p>
            )}
          </div>
        )}

        {/* Post-check-in "checked in via ActiveCAMT, ask them to open Songsue"
            notice — only for events mirrored into Songsue (songsueLinked), only on a
            fresh confirmed attendance. Informational only for the staff operating
            this scanner; never navigates them away. */}
        {showSongsueNotice && <SongsueCheckinNotice message={t.scanSongsueRedirectMessage} />}

        {/* Pre-test (K_pre) reminder — walk-ins skip the dashboard pre-test gate,
            so on a confirmed check-in we warn and show a QR/link the attendee can
            scan to complete it on their own phone. */}
        {scanMode === "checkin" && scanResult?.preTestWarning && (() => {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const preTestUrl = `${origin}/dashboard/history?form=${scanResult.preTestWarning.formId}&event=${eventId}`;
          return (
            <div style={{ padding: 16, borderRadius: 16, background: "rgb(var(--rose-600-rgb) / 0.06)", border: "2px solid rgb(var(--rose-600-rgb) / 0.4)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={20} aria-hidden="true" color="var(--rose-600)" style={{ flexShrink: 0 }} />
                <p style={{ fontSize: 15, fontWeight: 800, color: "var(--rose-600)", lineHeight: 1.4 }}>
                  {lang === "th" ? "ต้องทำแบบทดสอบ Pre-test" : lang === "cn" ? "需要完成前测" : lang === "mm" ? "Pre-Test ဖြေဆိုရန် လိုအပ်သည်" : "Pre-Test Required"}
                </p>
              </div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
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
                className="btn"
                style={{ minHeight: 44, background: "var(--rose-600)", color: "white" }}
              >
                {lang === "th" ? "เปิดแบบทดสอบ" : lang === "cn" ? "打开前测" : lang === "mm" ? "Pre-Test ဖွင့်ရန်" : "Open pre-test"}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          );
        })()}

        {/* Score mode — blocked: student is not registered for this event */}
        {scanMode === "score" && status === "not_registered" && (
          <div style={{ padding: 14, borderRadius: 16, background: "rgb(var(--red-500-rgb) / 0.08)", border: "2px solid rgb(var(--red-500-rgb) / 0.35)", color: "var(--text-primary)", textAlign: "center", fontWeight: 700, fontSize: 15, lineHeight: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <UserX size={22} aria-hidden="true" color="var(--red-600)" style={{ flexShrink: 0 }} />
            {lang === "th"
              ? "ไม่สามารถมอบ/หักคะแนนได้ เนื่องจากนักศึกษายังไม่ได้ลงทะเบียนกิจกรรมนี้"
              : lang === "cn"
              ? "无法给分/扣分：该学生未报名此活动"
              : lang === "mm"
              ? "ဤကျောင်းသားသည် ဤပွဲတွင် စာရင်းမသွင်းထားသဖြင့် အမှတ်ပေး/နှုတ်၍မရပါ"
              : "Can't award or deduct points — this student is not registered for this event."}
          </div>
        )}

        {/* Score mode inputs — only for students registered for this event (status "found") */}
        {isScoreForm && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <p className="adm-field-label" style={{ marginBottom: 6 }}>{t.activityLabel}</p>
              <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
                {events.find((e) => e.id === eventId)?.title || (th ? "ไม่ได้เลือกกิจกรรม" : "No event selected")}
              </div>
            </div>

            <div>
              <p className="adm-field-label" style={{ marginBottom: 6 }}>{t.scoreToAward}</p>
              {/* Award / Deduct toggle — keeps the magnitude input positive and makes intent explicit */}
              <div role="group" aria-label={t.scoreToAward} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  aria-pressed={scoreSign === 1}
                  onClick={() => setScoreSign(1)}
                  style={{
                    flex: 1, minHeight: 52, padding: "10px 12px", borderRadius: 12, fontSize: 16, fontWeight: 800,
                    border: scoreSign === 1 ? "2px solid var(--emerald-500)" : "2px solid var(--border-subtle)",
                    background: scoreSign === 1 ? "rgb(var(--emerald-500-rgb) / 0.1)" : "var(--bg-elevated)",
                    color: "var(--text-primary)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <Plus size={18} aria-hidden="true" /> {lang === "th" ? "เพิ่มคะแนน" : lang === "cn" ? "加分" : lang === "mm" ? "အမှတ်ပေါင်း" : "Add"}
                </button>
                <button
                  type="button"
                  aria-pressed={scoreSign === -1}
                  onClick={() => setScoreSign(-1)}
                  style={{
                    flex: 1, minHeight: 52, padding: "10px 12px", borderRadius: 12, fontSize: 16, fontWeight: 800,
                    border: scoreSign === -1 ? "2px solid var(--red-500)" : "2px solid var(--border-subtle)",
                    background: scoreSign === -1 ? "rgb(var(--red-500-rgb) / 0.1)" : "var(--bg-elevated)",
                    color: "var(--text-primary)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <Minus size={18} aria-hidden="true" /> {lang === "th" ? "หักคะแนน" : lang === "cn" ? "扣分" : lang === "mm" ? "အမှတ်နှုတ်" : "Deduct"}
                </button>
              </div>

              <Field label={<span className="sr-only">{t.scoreToAward}</span>} error={scoreError}>
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="input"
                    min={1}
                    value={scoreInput}
                    onChange={(e) => { setScoreInput(e.target.value); if (scoreError) setScoreError(null); }}
                    style={{ fontSize: 28, fontWeight: 800, textAlign: "center", minHeight: 56, color: scoreSign === -1 ? "var(--red-600)" : "var(--text-primary)" }}
                  />
                )}
              </Field>
              {scoreInput && scoreMagnitude > 0 && (
                <p style={{ fontSize: 16, fontWeight: 800, textAlign: "center", marginTop: 8, color: scoreSign === -1 ? "var(--red-600)" : "var(--emerald-600)" }}>
                  {scoreSign === -1 ? "−" : "+"}{scoreMagnitude} {th ? "คะแนน" : "pts"}
                </p>
              )}
            </div>

            <Field label={t.scoreReasonLabel}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  className="input"
                  placeholder={t.scoreReasonPlaceholder}
                  value={scoreReason}
                  onChange={(e) => setScoreReason(e.target.value)}
                  style={{ fontSize: 16, minHeight: 48 }}
                />
              )}
            </Field>
          </div>
        )}

      </div>
    </Modal>
  );
}
