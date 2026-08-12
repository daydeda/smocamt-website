"use client";

import { useSession, signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { useState, useEffect } from "react";
import { Camera, Check, Loader2, LogOut, User, Menu, X, AlertTriangle, Lock } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { FACULTIES, majorsForFaculty, facultyFromStudentId } from "@/lib/faculties";

// Rich CAMT major labels; other faculties show their bare code (or no Major
// dropdown at all until their major lists are provided).
const MAJOR_LABELS: Record<string, string> = {
  ANI: "ANI – Animation and Visual Effect",
  DG: "DG – Digital Game",
  DII: "DII – Digital Industry Integration",
  MMIT: "MMIT – Modern Management and Information Technology",
  SE: "SE – Software Engineering",
};

type EmergencyContact = { name: string; relationship: string; phone: string };

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Step-icon used in the desktop sidebar                                      */
/* ─────────────────────────────────────────────────────────────────────────── */
function StepIcon({ index, current }: { index: number; current: number }) {
  const done = index < current;
  const active = index === current;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: done
          ? "var(--accent-primary)"
          : active
          ? "rgba(255,107,0,0.12)"
          : "var(--bg-elevated)",
        border: active
          ? "2px solid var(--accent-primary)"
          : done
          ? "none"
          : "1.5px solid var(--border-medium)",
        transition: "all 0.25s ease",
        boxShadow: active ? "0 0 12px var(--accent-glow)" : "none",
      }}
    >
      {done ? (
        <Check size={15} color="#fff" strokeWidth={3} />
      ) : (
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: active ? "var(--accent-primary)" : "var(--text-muted)",
          }}
        >
          {index + 1}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Main page                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
export default function OnboardingClient({ initialSession }: { initialSession: Session }) {
  const { data: sessionData, update } = useSession();
  const session = sessionData || initialSession;
  const isStudent =
    session?.user &&
    !["super_admin", "admin", "registration", "organizer"].includes(
      session.user.role || ""
    );
  const { t, lang } = useLanguage();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationTriggered, setValidationTriggered] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const STEPS = [t.personalInfo, t.medicalInfo, t.emergencyContacts, t.reviewSubmit];
  const isTh = t.back === "กลับ";

  const [formData, setFormData] = useState({
    studentId: "",
    prefix: "นาย",
    name: "",
    nickname: "",
    faculty: "CAMT",
    major: "SE",
    religion: "",
    phone: "",
    contactChannels: "",
    image: "",
    imageTransform: { scale: 1, x: 0, y: 0 },
    chronicDiseases: "",
    medicalHistory: "",
    drugAllergies: "",
    foodAllergies: "",
    dietaryRestrictions: "",
    faintingHistory: false,
    emergencyMedication: "",
    pdpaConsent: false,
    emergencyContacts: [
      { name: "", relationship: "", phone: "" },
      { name: "", relationship: "", phone: "" },
    ] as EmergencyContact[],
  });

  const [hasFields, setHasFields] = useState<Record<string, boolean>>(() => ({
    chronicDiseases: !!formData.chronicDiseases,
    medicalHistory: !!formData.medicalHistory,
    drugAllergies: !!formData.drugAllergies,
    foodAllergies: !!formData.foodAllergies,
    emergencyMedication: !!formData.emergencyMedication,
  }));

  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) =>
    setFormData((p) => ({ ...p, [key]: value }));

  const setEC = (idx: number, key: string, value: string) => {
    const contacts = [...formData.emergencyContacts] as EmergencyContact[];
    contacts[idx] = { ...contacts[idx], [key]: value };
    set("emergencyContacts", contacts);
  };

  const degreeDigit = formData.studentId.trim()[4];
  const majorOptions: string[] =
    degreeDigit === "3" ? ["SE", "KIM", "DTM"]
    : degreeDigit === "5" ? ["KIM", "DTM"]
    : ["ANI", "DG", "DII", "MMIT", "SE"];

  // Faculty is derived from the student id (digits 3-4) rather than assumed —
  // ActiveCAMT is CAMT-only, so this is typo protection: it flags a student id
  // whose faculty digits don't say CAMT instead of silently accepting it.
  const derivedFaculty = facultyFromStudentId(formData.studentId);

  // Faculty-scoped major list. CAMT keeps the existing degree-digit-aware list
  // (undergrad SE/KIM/DTM by intake year vs the base ANI/DG/DII/MMIT/SE);
  // other faculties use their (currently empty, pending real data) list from
  // src/lib/faculties.ts.
  const currentMajorOptions = derivedFaculty === "CAMT" ? majorOptions : majorsForFaculty(derivedFaculty);

  // Reset major to a valid option when the degree level or faculty changes
  useEffect(() => {
    if (derivedFaculty && !currentMajorOptions.includes(formData.major)) set("major", currentMajorOptions[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degreeDigit, derivedFaculty]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError(t.fileTooLarge); return; }
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    setError(null);
    const th = lang === "th";
    try {
      // Avatars display small, so downscale hard (512px → ~10–20KB). This also
      // keeps the upload under the reverse proxy's body cap (a raw multi-MB photo
      // would otherwise 413 before reaching the app).
      const upload = await compressImageFile(file, { maxDim: 512 });
      const fd = new FormData();
      fd.append("file", upload);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) set("image", data.url);
      else if (res.status === 413) setError(th ? "ไฟล์รูปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง" : "Image is too large. Please choose a smaller photo.");
      else setError(data?.error || (th ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again."));
    } catch { setError(lang === "th" ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again."); }
    finally { setUploading(false); }
  };

  const handleSubmit = async () => {
    if (!formData.pdpaConsent) { setError(t.pdpaConsent); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) { await update(); window.location.href = "/dashboard"; }
      else {
        const d = await res.json();
        const errVal = Array.isArray(d.error) ? d.error[0]?.message : d.error;
        setError(t[errVal as keyof typeof t] || errVal);
      }
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  const handleContinue = () => {
    setError(null);
    if (step === 0) {
      if (!formData.name.trim() || !formData.nickname.trim() || !formData.phone.trim() || !formData.contactChannels.trim() || (isStudent && !formData.studentId.trim())) {
        setError(isTh ? "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน" : "Please fill out all required fields.");
        setValidationTriggered(true); return;
      }
      if (isStudent && !/^[0-9]{9}$/.test(formData.studentId.trim())) {
        setError(isTh ? "รหัสนักศึกษาต้องเป็นตัวเลข 9 หลักเท่านั้น" : "Student ID must be exactly 9 digits.");
        setValidationTriggered(true); return;
      }
      if (isStudent && /^[0-9]{9}$/.test(formData.studentId.trim()) && !derivedFaculty) {
        setError(isTh
          ? "รหัสนักศึกษานี้ไม่ตรงกับวิทยาลัยศิลปะ สื่อ และเทคโนโลยี กรุณาตรวจสอบรหัสนักศึกษาอีกครั้ง หรือติดต่อที่ IG: smocamt.official"
          : "This student ID's digits don't match to College of Arts, Media and Technology. Please double-check your student ID or contact IG: smocamt.official.");
        setValidationTriggered(true); return;
      }
      if (!/^[0-9]{10}$/.test(formData.phone.trim())) {
        setError(isTh ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Phone number must be exactly 10 digits.");
        setValidationTriggered(true); return;
      }
    }
    if (step === 1) {
      const emptyHasFields = Object.keys(hasFields).filter(
        (key) => hasFields[key] && !formData[key as keyof typeof formData]?.toString().trim()
      );
      if (emptyHasFields.length > 0) {
        setError(isTh ? "กรุณากรอกข้อมูลสุขภาพที่คุณเลือก 'มี'" : "Please specify details for fields checked as 'Has'.");
        setValidationTriggered(true);
        return;
      }
    }
    if (step === 2) {
      const ec1 = formData.emergencyContacts[0];
      const isEc1RelEmpty = !ec1.relationship.trim() || ec1.relationship.trim() === "Other:";
      if (!ec1.name.trim() || isEc1RelEmpty || !ec1.phone.trim()) {
        setError(isTh ? "กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินคนที่ 1 ให้ครบถ้วน" : "Please fill out all fields for Emergency Contact #1.");
        setValidationTriggered(true); return;
      }
      if (!/^[0-9]{10}$/.test(ec1.phone.trim())) {
        setError(isTh ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Emergency Contact #1 phone must be exactly 10 digits.");
        setValidationTriggered(true); return;
      }
      const ec2 = formData.emergencyContacts[1];
      const hasAnyEc2 = ec2.name.trim() || ec2.relationship.trim() || ec2.phone.trim();
      if (hasAnyEc2) {
        const isEc2RelEmpty = !ec2.relationship.trim() || ec2.relationship.trim() === "Other:";
        if (!ec2.name.trim() || isEc2RelEmpty || !ec2.phone.trim()) {
          setError(isTh ? "กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินคนที่ 2 ให้ครบถ้วน หรือปล่อยว่างไว้ทั้งหมด" : "Complete or clear all fields for Emergency Contact #2.");
          setValidationTriggered(true); return;
        }
        if (!/^[0-9]{10}$/.test(ec2.phone.trim())) {
          setError(isTh ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Emergency Contact #2 phone must be exactly 10 digits.");
          setValidationTriggered(true); return;
        }
      }
    }
    setValidationTriggered(false);
    setStep((s) => s + 1);
  };

  const goBack = () => { setStep((s) => s - 1); setValidationTriggered(false); setError(null); };

  const inp = "input";
  const lbl = "label";

  const medicalPlaceholders: Record<string, string> = {
    chronicDiseases: isTh ? "เช่น เบาหวาน, ความดันโลหิตสูง, โรคหืด" : "e.g. Diabetes, Hypertension, Asthma",
    medicalHistory: isTh ? "เช่น เคยผ่าตัด, เคยรับการรักษาในโรงพยาบาล" : "e.g. Previous surgeries, hospital stays",
    drugAllergies: isTh ? "เช่น แอสไพริน, เพนิซิลลิน" : "e.g. Aspirin, Penicillin",
    foodAllergies: isTh ? "เช่น อาหารทะเล, ถั่วลิสง" : "e.g. Seafood, Peanuts",
    emergencyMedication: isTh ? "เช่น ยาพ่นหอบ, ยาลดความดัน" : "e.g. Inhaler, Blood pressure medication",
  };

  const renderMedicalField = (
    fieldKey: "chronicDiseases" | "medicalHistory" | "drugAllergies" | "foodAllergies" | "emergencyMedication",
    label: string
  ) => {
    const isHas = hasFields[fieldKey];
    return (
      <div className="field flex-1" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className={lbl}>{label}</label>
        <div style={{ display: "flex", gap: 24, alignItems: "center", minHeight: 32 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={!isHas}
              onChange={() => {
                setHasFields((p) => ({ ...p, [fieldKey]: false }));
                set(fieldKey, "");
              }}
              style={{ width: 18, height: 18, accentColor: "var(--accent-primary)", cursor: "pointer" }}
            />
            <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{t.none}</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={isHas}
              onChange={() => {
                setHasFields((p) => ({ ...p, [fieldKey]: true }));
              }}
              style={{ width: 18, height: 18, accentColor: "var(--accent-primary)", cursor: "pointer" }}
            />
            <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{t.has}</span>
          </label>
        </div>
        {isHas && (
          <>
            <input
              className={inp}
              placeholder={medicalPlaceholders[fieldKey] ?? (isTh ? "ระบุรายละเอียด..." : "Please specify details...")}
              value={formData[fieldKey]}
              onChange={(e) => set(fieldKey, e.target.value)}
              style={{
                marginTop: 4,
                ...errStyle(validationTriggered && !formData[fieldKey].trim()),
              }}
            />
            <ErrMsg
              show={validationTriggered && !formData[fieldKey].trim()}
              msg={isTh ? "กรุณาระบุรายละเอียด" : "Required"}
            />
          </>
        )}
      </div>
    );
  };

  /* ── Shared: field validation helpers ─────────────────────────────────── */
  const errStyle = (bad: boolean) => ({
    minHeight: 48 as const,
    borderColor: bad ? "#ef4444" : undefined,
    boxShadow: bad ? "0 0 0 2px rgba(239,68,68,0.2)" : undefined,
  });
  const ErrMsg = ({ show, msg }: { show: boolean; msg: string }) =>
    show ? (
      <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 600, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {msg}
      </span>
    ) : null;

  /* ── Shared: navigation buttons (used in both mobile bar + desktop form) */
  const NavButtons = ({ inline }: { inline?: boolean }) => (
    <div
      style={{
        display: "flex",
        gap: 12,
        ...(inline
          ? { marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }
          : {}),
      }}
    >
      {step > 0 && (
        <button
          className="btn btn-ghost"
          style={{ flex: "0 0 auto", minHeight: 52, minWidth: 96, fontSize: 15 }}
          onClick={goBack}
          disabled={submitting}
        >
          ← {t.back}
        </button>
      )}
      {step < STEPS.length - 1 ? (
        <button
          className="btn btn-primary"
          style={{ flex: 1, minHeight: 52, fontSize: 16, fontWeight: 700 }}
          onClick={handleContinue}
        >
          {t.continue} →
        </button>
      ) : (
        <button
          className="btn btn-primary"
          style={{ flex: 1, minHeight: 52, fontSize: 16, fontWeight: 700 }}
          onClick={handleSubmit}
          disabled={submitting || !formData.pdpaConsent}
        >
          {submitting ? (
            <><Loader2 className="animate-spin inline mr-2" size={18} />Submitting...</>
          ) : t.complete}
        </button>
      )}
    </div>
  );

  /* ── Shared: form step content ──────────────────────────────────────────── */
  const FormContent = () => (
    <div className="flex flex-col gap-5">
      {/* ── Step 0: Personal Info ── */}
      {step === 0 && (
        <>
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div
              key={previewUrl ? "has-preview" : "no-preview"}
              style={{
                width: 88, height: 88, borderRadius: "50%",
                backgroundColor: "var(--bg-elevated)",
                border: previewUrl ? "2.5px solid var(--accent-primary)" : "2px dashed var(--border-medium)",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative", overflow: "hidden",
              }}
            >
              {uploading && (
                <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Loader2 className="animate-spin text-white" size={22} />
                </div>
              )}
              {previewUrl
                ? <img src={previewUrl} alt="Preview" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: `scale(${formData.imageTransform.scale}) translate(${formData.imageTransform.x}%, ${formData.imageTransform.y}%)`, zIndex: 10 }} onError={() => console.error("Preview failed")} />
                : !uploading && <User size={30} className="opacity-30" style={{ color: "var(--text-muted)" }} />}
            </div>
            <label className="btn btn-ghost btn-sm" style={{ gap: 6, cursor: "not-allowed", borderRadius: 99, opacity: 0.5, minHeight: 40 }} title={t.profilePhotoDisabledNote}>
              <Camera size={14} />
              {previewUrl ? t.changePhoto : t.uploadPhoto}
              <input type="file" hidden accept="image/*" onChange={handleImageUpload} disabled />
            </label>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", maxWidth: 260 }}>{t.profilePhotoDisabledNote}</span>
          </div>

          {/* Prefix + Name */}
          <div className="flex gap-3">
            <div className="field" style={{ width: 88, flexShrink: 0 }}>
              <label className={lbl}>{t.prefix}</label>
              <select className={inp} value={formData.prefix} onChange={(e) => set("prefix", e.target.value)} style={{ minHeight: 48 }}>
                <option value="นาย">{lang === "th" ? "นาย" : "Mr."}</option>
                <option value="นางสาว">{lang === "th" ? "น.ส." : "Ms."}</option>
                <option value="นาง">{lang === "th" ? "นาง" : "Mrs."}</option>
              </select>
            </div>
            <div className="field flex-grow" style={{ minWidth: 0 }}>
              <label className={lbl}>{t.fullName} <span style={{ color: "#ef4444" }}>*</span></label>
              <input className={inp} placeholder={lang === "th" ? "ชื่อ-นามสกุล" : "Full Name"} value={formData.name} onChange={(e) => set("name", e.target.value)} style={errStyle(validationTriggered && !formData.name.trim())} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>
                {isTh
                  ? "หากคุณเป็นคนไทย กรุณาเขียนชื่อเป็นภาษาไทย"
                  : "If you are a Thai citizen, please write your name in Thai (ให้เขียนชื่อเป็นภาษาไทย)"}
              </span>
              <ErrMsg show={validationTriggered && !formData.name.trim()} msg={isTh ? "กรุณากรอกชื่อ-นามสกุล" : "This field is required"} />
            </div>
          </div>

          {/* Student ID + Nickname */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="field flex-1">
              <label className={lbl}>{t.studentId} <span style={{ color: "#ef4444" }}>*</span></label>
              <input className={inp} maxLength={9} placeholder="640510000" inputMode="numeric" value={formData.studentId} onChange={(e) => set("studentId", e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} style={errStyle(validationTriggered && !!(isStudent && formData.studentId.trim().length !== 9))} />
              <ErrMsg show={validationTriggered && !!(isStudent && formData.studentId.trim().length !== 9)} msg={isTh ? "รหัสนักศึกษาต้องมี 9 หลัก" : "Must be exactly 9 digits"} />
            </div>
            <div className="field flex-1">
              <label className={lbl}>{t.nickname} <span style={{ color: "#ef4444" }}>*</span></label>
              <input className={inp} placeholder={t.nickname} value={formData.nickname} onChange={(e) => set("nickname", e.target.value)} style={errStyle(validationTriggered && !formData.nickname.trim())} />
              <ErrMsg show={validationTriggered && !formData.nickname.trim()} msg={isTh ? "กรุณากรอกชื่อเล่น" : "This field is required"} />
            </div>
          </div>

          {/* Faculty — auto-detected from the student id (digits 3-4) so you can
              re-check it matches CAMT before submitting. Hidden until 9 digits. */}
          {formData.studentId.trim().length === 9 && (
            derivedFaculty ? (
              <div className="field">
                <label className={lbl}>{t.faculty}</label>
                <input
                  className={inp}
                  disabled
                  value={FACULTIES.find((f) => f.id === derivedFaculty)?.name ?? derivedFaculty}
                  style={{ minHeight: 48, opacity: 0.85, cursor: "not-allowed" }}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {isTh ? "ตรวจจับอัตโนมัติจากรหัสนักศึกษา" : "Auto-detected from your student ID"}
                </span>
              </div>
            ) : (
              <div className="alert alert-error" style={{ fontSize: 13 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>
                  {isTh
                    ? "รหัสนักศึกษานี้ไม่ตรงกับวิทยาลัยศิลปะ สื่อ และเทคโนโลยี กรุณาตรวจสอบรหัสนักศึกษาอีกครั้ง หรือติดต่อที่ IG: smocamt.official"
                    : "This student ID's digits don't match to College of Arts, Media and Technology. Please double-check your student ID or contact IG: smocamt.official."}
                </span>
              </div>
            )
          )}

          {/* Major — depends on the degree-level digit read from the student id
              (see degreeDigit above), so hide it until a full 9-digit id exists;
              otherwise it briefly shows the wrong (undergrad-default) option list. */}
          {derivedFaculty && currentMajorOptions.length > 0 && (
            <div className="field">
              <label className={lbl}>{t.major}</label>
              <select className={inp} value={formData.major} onChange={(e) => set("major", e.target.value)} style={{ minHeight: 48 }}>
                {currentMajorOptions.map((m) => (
                  <option key={m} value={m}>{MAJOR_LABELS[m] ?? m}</option>
                ))}
              </select>
            </div>
          )}

          {/* Religion */}
          <div className="field">
            <label className={lbl}>{t.religion}</label>
            <select className={inp} value={["", "Buddhism", "Christianity", "Islam", "Hinduism", "Sikhism", "None"].includes(formData.religion) ? formData.religion : "Other"} onChange={(e) => set("religion", e.target.value === "Other" ? "Other:" : e.target.value)} style={{ minHeight: 48 }}>
              <option value="">{t.selectReligion}</option>
              <option value="Buddhism">{t.buddhism}</option>
              <option value="Christianity">{t.christianity}</option>
              <option value="Islam">{t.islam}</option>
              <option value="Hinduism">{t.hinduism}</option>
              <option value="Sikhism">{t.sikhism}</option>
              <option value="None">{t.noReligion}</option>
              <option value="Other">{t.other}</option>
            </select>
            {(!["", "Buddhism", "Christianity", "Islam", "Hinduism", "Sikhism", "None"].includes(formData.religion) || formData.religion.startsWith("Other:")) && (
              <input type="text" className={inp} style={{ marginTop: 8, minHeight: 48 }} placeholder={isTh ? "กรุณาระบุศาสนา..." : "Please specify..."} value={formData.religion.startsWith("Other:") ? formData.religion.substring(6) : formData.religion} onChange={(e) => set("religion", "Other:" + e.target.value)} />
            )}
          </div>

          {/* Phone + Contact */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="field flex-1">
              <label className={lbl}>{t.phone} <span style={{ color: "#ef4444" }}>*</span></label>
              <input className={inp} placeholder="0812345678" inputMode="tel" value={formData.phone} onChange={(e) => set("phone", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} style={errStyle(validationTriggered && (!formData.phone.trim() || !/^[0-9]{10}$/.test(formData.phone.trim())))} />
              <ErrMsg show={validationTriggered && (!formData.phone.trim() || !/^[0-9]{10}$/.test(formData.phone.trim()))} msg={!formData.phone.trim() ? (isTh ? "กรุณากรอกเบอร์โทรศัพท์" : "Required") : (isTh ? "ต้องเป็นตัวเลข 10 หลัก" : "Must be exactly 10 digits")} />
            </div>
            <div className="field flex-1">
              <label className={lbl}>{t.contactChannels} <span style={{ color: "#ef4444" }}>*</span></label>
              <input className={inp} placeholder="IG: smocamt / LINE: smocamt" value={formData.contactChannels} onChange={(e) => set("contactChannels", e.target.value)} style={errStyle(validationTriggered && !formData.contactChannels.trim())} />
              <ErrMsg show={validationTriggered && !formData.contactChannels.trim()} msg={isTh ? "กรุณากรอกช่องทางติดต่อ" : "Required"} />
            </div>
          </div>
        </>
      )}

      {/* ── Step 1: Medical Info ── */}
      {step === 1 && (
        <>
          <div className="alert alert-info" style={{ fontSize: 13 }}>
            <Lock size={14} style={{ flexShrink: 0 }} /><span>{t.medicalInfoDetail}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            {renderMedicalField("chronicDiseases", t.chronicDiseases)}
            {renderMedicalField("medicalHistory", t.medicalHistory)}
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            {renderMedicalField("drugAllergies", t.drugAllergies)}
            {renderMedicalField("foodAllergies", t.foodAllergies)}
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="field flex-1">
              <label className={lbl}>{t.dietaryRestrictions}</label>
              <select className={inp} value={["", "Vegetarian", "Vegan", "Halal", "Kosher"].includes(formData.dietaryRestrictions) ? formData.dietaryRestrictions : "Other"} onChange={(e) => set("dietaryRestrictions", e.target.value === "Other" ? "Other:" : e.target.value)} style={{ minHeight: 48 }}>
                <option value="">{t.none}</option>
                <option value="Vegetarian">{t.veg}</option>
                <option value="Vegan">{t.vegan}</option>
                <option value="Halal">{t.halal}</option>
                <option value="Kosher">{t.kosher}</option>
                <option value="Other">{t.other}</option>
              </select>
              {(!["", "Vegetarian", "Vegan", "Halal", "Kosher"].includes(formData.dietaryRestrictions) || formData.dietaryRestrictions.startsWith("Other:")) && (
                <input type="text" className={inp} style={{ marginTop: 8, minHeight: 48 }} placeholder={isTh ? "กรุณาระบุ..." : "Please specify..."} value={formData.dietaryRestrictions.startsWith("Other:") ? formData.dietaryRestrictions.substring(6) : formData.dietaryRestrictions} onChange={(e) => set("dietaryRestrictions", "Other:" + e.target.value)} />
              )}
            </div>
            {renderMedicalField("emergencyMedication", t.emergencyMed)}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: formData.faintingHistory ? "rgba(255,107,0,0.06)" : "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: `1px solid ${formData.faintingHistory ? "rgba(255,107,0,0.3)" : "var(--border-subtle)"}`, cursor: "pointer", transition: "all 0.15s", minHeight: 56 }}>
            <input type="checkbox" style={{ width: 20, height: 20, accentColor: "var(--accent-primary)", flexShrink: 0 }} checked={formData.faintingHistory} onChange={(e) => set("faintingHistory", e.target.checked)} />
            <span style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.4 }}>{t.faintingHistory}</span>
          </label>
        </>
      )}

      {/* ── Step 2: Emergency Contacts ── */}
      {step === 2 && (
        <>
          {[0, 1].map((i) => {
            const contact = formData.emergencyContacts[i];
            const partial = i === 1 && !!(contact.name.trim() || contact.relationship.trim() || contact.phone.trim());
            const required = i === 0 || partial;
            return (
              <div key={i} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-medium)", borderRadius: "var(--radius-xl)", padding: "20px 18px", boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-primary)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
                  {t.emergencyContacts} #{i + 1}
                  {i === 1 && <span style={{ marginLeft: 8, fontWeight: 500, color: "var(--text-muted)", textTransform: "none", fontSize: 11, letterSpacing: 0 }}>({lang === "th" ? "ไม่บังคับ" : "Optional"})</span>}
                </p>
                <div className="flex flex-col gap-4">
                  <div className="field">
                    <label className={lbl}>{t.fullName} {required && <span style={{ color: "#ef4444" }}>*</span>}</label>
                    <input className={inp} placeholder={t.fullName} value={contact.name} onChange={(e) => setEC(i, "name", e.target.value)} style={errStyle(validationTriggered && required && !contact.name.trim())} />
                    <ErrMsg show={validationTriggered && required && !contact.name.trim()} msg={isTh ? "กรุณากรอกชื่อ-นามสกุล" : "Required"} />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="field flex-1">
                      <label className={lbl}>{t.relationship} {required && <span style={{ color: "#ef4444" }}>*</span>}</label>
                      <select
                        className={inp}
                        value={["", "Father", "Mother", "Guardian", "Sibling", "Relative", "Friend"].includes(contact.relationship) ? contact.relationship : (contact.relationship ? "Other" : "")}
                        onChange={(e) => setEC(i, "relationship", e.target.value === "Other" ? "Other:" : e.target.value)}
                        style={errStyle(validationTriggered && required && (!contact.relationship.trim() || contact.relationship === "Other:"))}
                      >
                        <option value="">{t.selectRelationship}</option>
                        <option value="Father">{t.father}</option>
                        <option value="Mother">{t.mother}</option>
                        <option value="Guardian">{t.guardian}</option>
                        <option value="Sibling">{t.sibling}</option>
                        <option value="Relative">{t.relative}</option>
                        <option value="Friend">{t.friend}</option>
                        <option value="Other">{t.other}</option>
                      </select>
                      {(!["", "Father", "Mother", "Guardian", "Sibling", "Relative", "Friend"].includes(contact.relationship) || contact.relationship.startsWith("Other:")) && contact.relationship !== "" && (
                        <input
                          type="text"
                          className={inp}
                          style={{
                            marginTop: 8,
                            ...errStyle(validationTriggered && required && (!contact.relationship.trim() || contact.relationship === "Other:"))
                          }}
                          placeholder={isTh ? "กรุณาระบุความสัมพันธ์..." : "Please specify relationship..."}
                          value={contact.relationship.startsWith("Other:") ? contact.relationship.substring(6) : contact.relationship}
                          onChange={(e) => setEC(i, "relationship", "Other:" + e.target.value)}
                        />
                      )}
                      <ErrMsg show={validationTriggered && required && (!contact.relationship.trim() || contact.relationship === "Other:")} msg={isTh ? "กรุณากรอกความสัมพันธ์" : "Required"} />
                    </div>
                    <div className="field flex-1">
                      <label className={lbl}>{t.phone} {required && <span style={{ color: "#ef4444" }}>*</span>}</label>
                      <input className={inp} placeholder="0812345678" inputMode="tel" value={contact.phone} onChange={(e) => setEC(i, "phone", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} style={errStyle(validationTriggered && required && (!contact.phone.trim() || !/^[0-9]{10}$/.test(contact.phone.trim())))} />
                      <ErrMsg show={validationTriggered && required && (!contact.phone.trim() || !/^[0-9]{10}$/.test(contact.phone.trim()))} msg={!contact.phone.trim() ? (isTh ? "กรุณากรอกเบอร์" : "Required") : (isTh ? "ต้องเป็นตัวเลข 10 หลัก" : "Must be 10 digits")} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── Step 3: Review + PDPA ── */}
      {step === 3 && (
        <>
          {/* Summary */}
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "18px 16px" }}>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 14 }}>{t.profileSummary}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              {[
                [t.fullName, `${formData.prefix}${formData.name}`],
                [t.nickname, formData.nickname],
                [t.studentId, formData.studentId || "—"],
                [t.faculty, derivedFaculty ? (FACULTIES.find((f) => f.id === derivedFaculty)?.name ?? derivedFaculty) : "—"],
                [t.major, formData.major],
                [t.phone, formData.phone],
                [t.religion, (() => {
                  if (!formData.religion) return "—";
                  const map: Record<string, string> = { Buddhism: t.buddhism, Christianity: t.christianity, Islam: t.islam, Hinduism: t.hinduism, Sikhism: t.sikhism, None: t.noReligion };
                  if (map[formData.religion]) return map[formData.religion];
                  if (formData.religion.startsWith("Other:")) return formData.religion.substring(6);
                  return formData.religion;
                })()],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</dt>
                  <dd style={{ fontSize: 14, color: "var(--text-primary)", marginTop: 3, fontWeight: 600 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* PDPA */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "18px 16px", background: formData.pdpaConsent ? "rgba(255,107,0,0.05)" : "var(--bg-surface)", borderRadius: "var(--radius-md)", border: `1.5px solid ${formData.pdpaConsent ? "rgba(255,107,0,0.35)" : "var(--border-medium)"}`, cursor: "pointer", transition: "all 0.15s" }}>
            <input type="checkbox" style={{ width: 20, height: 20, accentColor: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} checked={formData.pdpaConsent} onChange={(e) => set("pdpaConsent", e.target.checked)} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{t.pdpaConsent}</p>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{t.pdpaDetail}</p>
              <div className="alert alert-warning" style={{ fontSize: 12, padding: "10px 14px", borderRadius: 10, marginTop: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <AlertTriangle size={14} style={{ marginTop: -2, flexShrink: 0 }} />
                <span style={{ lineHeight: 1.5, color: "var(--text-primary)" }}>{t.pdpaWarning}</span>
              </div>
            </div>
          </label>

          {error && <div className="alert alert-error"><AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}</div>}
        </>
      )}

      {/* Error banner for steps 0–2 */}
      {error && step < 3 && (
        <div className="alert alert-error" style={{ marginTop: 4 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}
    </div>
  );

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <>
      {/* Mobile Drawer (Side Menu) */}
      {/* Backdrop Overlay */}
      <div
        onClick={() => setDrawerOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          zIndex: 100,
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Drawer Content */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          height: "100%",
          width: "280px",
          maxWidth: "85vw",
          backgroundColor: "#ffffff",
          boxShadow: "4px 0 24px rgba(0, 0, 0, 0.15)",
          zIndex: 101,
          transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          display: "flex",
          flexDirection: "column",
          padding: "24px 20px",
        }}
      >
        {/* Brand & Close */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-primary)", marginBottom: 2 }}>SMO CAMT</div>
            <div className="gradient-text" style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.35, paddingBottom: "2px" }}>
              {lang === "th" ? "ลงทะเบียน" : "Registration"}
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: "none", border: "none", padding: 8, cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* User Pill */}
        {session?.user && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", marginBottom: 24 }}>
            {session.user.image
              ? <img src={session.user.image} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={16} color="var(--accent-primary)" /></div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.name || "User"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.email}</div>
            </div>
          </div>
        )}

        {/* Navigation Step List */}
        <nav className="flex flex-col gap-1" style={{ flex: 1, overflowY: "auto" }}>
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  background: active ? "var(--accent-glow)" : "transparent",
                  border: active ? "1px solid rgba(255,107,0,0.2)" : "1px solid transparent",
                  transition: "all 0.2s",
                  cursor: "default",
                }}
              >
                <StepIcon index={i} current={step} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: done ? "var(--text-muted)" : active ? "var(--accent-primary)" : "var(--text-muted)" }}>
                    {t.step} {i + 1}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: done ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {label}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer Actions */}
        <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => {
              setDrawerOpen(false);
              signOut({ callbackUrl: "/" });
            }}
            className="btn btn-ghost btn-sm"
            style={{ gap: 8, justifyContent: "flex-start", color: "var(--text-muted)", fontSize: 13 }}
          >
            <LogOut size={14} />
            {lang === "th" ? "ออกจากระบบ" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════════════
          DESKTOP layout  (lg and above):
          Fixed left sidebar | Scrollable right panel
      ══════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex min-h-screen w-full max-w-full" style={{ width: "100%", background: "var(--bg-base)" }}>

        {/* Left sidebar wrapper to reserve space in flex layout */}
        <div style={{ width: "clamp(260px, 22vw, 300px)", flexShrink: 0 }}>
          <aside
            className="flex flex-col"
            style={{
              width: "clamp(260px, 22vw, 300px)",
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              background: "#ffffff",
              borderRight: "1px solid var(--border-subtle)",
              padding: "36px clamp(16px, 2vw, 28px)",
              zIndex: 40,
            }}
          >
            {/* Brand */}
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-primary)", marginBottom: 4 }}>SMO CAMT</div>
              <div className="gradient-text" style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.35, paddingBottom: "2px" }}>
                {lang === "th" ? "ลงทะเบียน" : "Registration"}
              </div>
            </div>

            {/* User info pill */}
            {session?.user && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", marginBottom: 32 }}>
                {session.user.image
                  ? <img src={session.user.image} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={16} color="var(--accent-primary)" /></div>
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.name || "User"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.email}</div>
                </div>
              </div>
            )}

            {/* Vertical step list */}
            <nav className="flex flex-col gap-1" style={{ flex: 1 }}>
              {STEPS.map((label, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: "var(--radius-md)",
                      background: active ? "var(--accent-glow)" : "transparent",
                      border: active ? "1px solid rgba(255,107,0,0.2)" : "1px solid transparent",
                      transition: "all 0.2s",
                      cursor: "default",
                    }}
                  >
                    <StepIcon index={i} current={step} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: done ? "var(--text-muted)" : active ? "var(--accent-primary)" : "var(--text-muted)" }}>
                        {t.step} {i + 1}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: done ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Language + Sign out */}
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12, paddingTop: 24 }}>
              <LanguageSwitcher variant="segmented" fullWidth />
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="btn btn-ghost btn-sm"
                style={{ gap: 8, justifyContent: "flex-start", color: "var(--text-muted)", fontSize: 13 }}
              >
                <LogOut size={14} />
                {lang === "th" ? "ออกจากระบบ" : "Sign out"}
              </button>
            </div>
          </aside>
        </div>

        {/* Right panel — scrollable */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            padding: "56px clamp(16px, 4vw, 48px) 80px",
          }}
        >
          <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
            {/* Step heading */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-primary)", marginBottom: 6 }}>
                {t.step} {step + 1} / {STEPS.length}
              </div>
              <h1 className="gradient-text" style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, paddingTop: "4px", paddingBottom: "4px" }}>
                {STEPS[step]}
              </h1>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: "var(--bg-elevated)", borderRadius: 99, marginBottom: 36, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((step + 1) / STEPS.length) * 100}%`, background: "var(--accent-primary)", borderRadius: 99, transition: "width 0.4s ease", boxShadow: "0 0 8px var(--accent-glow)" }} />
            </div>

            {/* Form card */}
            <div
              className="animate-fade-in-up"
              style={{
                background: "#ffffff",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-xl)",
                padding: "clamp(20px, 3.5vw, 32px)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.06)",
                width: "100%",
              }}
            >
              {FormContent()}
              {/* Inline nav buttons on desktop */}
              {NavButtons({ inline: true })}
            </div>
          </div>
        </main>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TABLET + PHONE layout  (below lg):
          Sticky top bar | Scrollable content | Fixed bottom nav
      ══════════════════════════════════════════════════════════════════ */}
      <div className="flex lg:hidden flex-col min-h-screen w-full max-w-full" style={{ width: "100%", background: "var(--bg-base)" }}>

        {/* Sticky top bar — back + language only */}
        <header
          className="sticky top-0 z-50 w-full border-b border-[var(--border-subtle)]"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            paddingTop: "max(env(safe-area-inset-top), 0px)",
          }}
        >
          <div className="flex items-center justify-between px-4 sm:px-8 pt-3 pb-3 max-w-5xl mx-auto w-full">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDrawerOpen(true)}
                style={{
                  background: "none",
                  border: "none",
                  outline: "none",
                  padding: "8px",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  borderRadius: "8px",
                  minHeight: 44,
                  minWidth: 44
                }}
                aria-label="Open menu"
              >
                <Menu size={20} />
              </button>
              {step > 0 && (
                <button
                  onClick={goBack}
                  style={{
                    background: "none",
                    border: "none",
                    outline: "none",
                    padding: "8px 4px",
                    color: "var(--text-muted)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    minHeight: 44
                  }}
                >
                  ← {t.back}
                </button>
              )}
            </div>
            <LanguageSwitcher variant="segmented" />
          </div>
        </header>

        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto w-full"
          style={{ width: "100%", paddingBottom: "max(32px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="max-w-5xl mx-auto w-full px-4 sm:px-8 pt-8 pb-8">

            {/* Step heading — centered */}
            <div style={{ marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-primary)", marginBottom: 4 }}>
                {t.step} {step + 1} / {STEPS.length}
              </div>
              <h1 className="gradient-text" style={{ fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, paddingTop: "4px", paddingBottom: "4px" }}>
                {STEPS[step]}
              </h1>
            </div>

            {/* Horizontal Stepper Wrapper (guarantees perfect centering on all mobile screens) */}
            <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: "40px" }}>
              {/* Horizontal Stepper (visible on mobile/tablet, hidden on desktop) */}
              <div 
                className="relative flex items-center justify-between w-full max-w-[240px] sm:max-w-[320px]"
                style={{
                  padding: "8px 0",
                }}
              >
                {/* Connecting Line Background */}
                <div 
                  className="absolute top-1/2 h-[2px] bg-[var(--border-medium)] -translate-y-1/2 z-0" 
                  style={{ left: "15px", right: "15px" }}
                />
                {/* Active Connecting Line */}
                <div 
                  className="absolute top-1/2 h-[2px] bg-[var(--accent-primary)] -translate-y-1/2 z-0 transition-all duration-300"
                  style={{ 
                    left: "15px",
                    width: `calc((100% - 30px) * ${step / (STEPS.length - 1)})`,
                    boxShadow: "0 0 8px var(--accent-glow)"
                  }}
                />
                
                {STEPS.map((label, i) => {
                  const done = i < step;
                  const active = i === step;
                  return (
                    <div key={i} className="flex flex-col items-center z-10 relative">
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: done
                            ? "var(--accent-primary)"
                            : active
                            ? "#ffffff"
                            : "var(--bg-elevated)",
                          border: active
                            ? "2px solid var(--accent-primary)"
                            : done
                            ? "none"
                            : "1.5px solid var(--border-medium)",
                          transition: "all 0.25s ease",
                          boxShadow: active ? "0 0 10px var(--accent-glow)" : "none",
                        }}
                      >
                        {done ? (
                          <Check size={14} color="#fff" strokeWidth={3} />
                        ) : (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              color: active ? "var(--accent-primary)" : "var(--text-muted)",
                            }}
                          >
                            {i + 1}
                          </span>
                        )}
                      </div>
                      {/* Label */}
                      <span 
                        className="hidden sm:block mt-2 text-[10px] font-bold text-center absolute top-10 left-1/2 -translate-x-1/2 whitespace-nowrap"
                        style={{
                          color: active ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card — no border, shadow only, no grey line */}
            <div
              className="animate-fade-in-up"
              style={{
                background: "#ffffff",
                borderRadius: "var(--radius-xl)",
                padding: "clamp(18px, 5vw, 28px)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                width: "100%",
                maxWidth: "100%",
              }}
            >
              {FormContent()}
              {NavButtons({ inline: true })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}