"use client";
 
import { useSession } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft, Save, User, Smartphone, BookOpen,
  HeartPulse, ShieldAlert, Phone, Camera, Loader2,
  Maximize, Move, AlertTriangle, Check
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { compressImageFile } from "@/lib/compress-image";
import { useRouter } from "next/navigation";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { FACULTIES, majorsForFaculty, facultyFromStudentId } from "@/lib/faculties";

// Rich CAMT major labels; other faculties show their bare code.
const MAJOR_LABELS: Record<string, string> = {
  ANI: "ANI - Animation and Visual Effect",
  DG: "DG - Digital Game",
  DII: "DII - Digital Industry Integration",
  MMIT: "MMIT - Modern Management and Information Technology",
  SE: "SE - Software Engineering",
};

type EmergencyContact = { name: string; relationship: string; phone: string };
 
export default function ProfilePage() {
  const { data: session, update } = useSession();
  const { t } = useLanguage();
  const router = useRouter();
 
  const [loading, setLoading] = useState(true);
  // Set when the initial profile fetch fails — we then show an error instead of a
  // blank form, since saving a blank form would overwrite the real profile.
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationTriggered, setValidationTriggered] = useState(false);
  const [isProfileCompleted, setIsProfileCompleted] = useState(false);

  const [hasFields, setHasFields] = useState<Record<string, boolean>>({
    chronicDiseases: false,
    medicalHistory: false,
    drugAllergies: false,
    foodAllergies: false,
    emergencyMedication: false,
  });

  const [formData, setFormData] = useState({
    studentId: "",
    prefix: "นาย",
    name: "",
    nickname: "",
    phone: "",
    faculty: "CAMT",
    major: "",
    religion: "",
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
    emergencyContacts: [
      { name: "", relationship: "", phone: "" },
      { name: "", relationship: "", phone: "" },
    ] as EmergencyContact[],
  });
 
  useEffect(() => {
    fetch("/api/profile")
      .then(r => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then(user => {
        if (user) {
          setFormData({
            studentId: user.studentId || "",
            prefix: user.prefix || "นาย",
            name: user.name || "",
            nickname: user.nickname || "",
            phone: user.phone || "",
            faculty: user.faculty || "CAMT",
            major: user.major || "",
            religion: user.religion || "",
            contactChannels: user.contactChannels || "",
            image: user.image || "",
            imageTransform: user.imageTransform || { scale: 1, x: 0, y: 0 },
            chronicDiseases: user.chronicDiseases || "",
            medicalHistory: user.medicalHistory || "",
            drugAllergies: user.drugAllergies || "",
            foodAllergies: user.foodAllergies || "",
            dietaryRestrictions: user.dietaryRestrictions || "",
            faintingHistory: !!user.faintingHistory,
            emergencyMedication: user.emergencyMedication || "",
            emergencyContacts: user.emergencyContacts || [
              { name: "", relationship: "", phone: "" },
              { name: "", relationship: "", phone: "" },
            ],
          });
          setHasFields({
            chronicDiseases: !!(user.chronicDiseases && user.chronicDiseases.trim() !== "" && user.chronicDiseases.trim() !== "-" && user.chronicDiseases.trim() !== "None"),
            medicalHistory: !!(user.medicalHistory && user.medicalHistory.trim() !== "" && user.medicalHistory.trim() !== "-" && user.medicalHistory.trim() !== "None"),
            drugAllergies: !!(user.drugAllergies && user.drugAllergies.trim() !== "" && user.drugAllergies.trim() !== "-" && user.drugAllergies.trim() !== "None"),
            foodAllergies: !!(user.foodAllergies && user.foodAllergies.trim() !== "" && user.foodAllergies.trim() !== "-" && user.foodAllergies.trim() !== "None"),
            emergencyMedication: !!(user.emergencyMedication && user.emergencyMedication.trim() !== "" && user.emergencyMedication.trim() !== "-" && user.emergencyMedication.trim() !== "None"),
          });
          if (user.image) setPreviewUrl(user.image);
          setIsProfileCompleted(!!user.profileCompleted);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoadError(true);
        setLoading(false);
      });
  }, []);
  const set = <K extends keyof typeof formData>(key: K, value: typeof formData[K]) => setFormData((p) => ({ ...p, [key]: value }));

  const degreeDigit = formData.studentId.trim()[4];
  const majorOptions: string[] =
    degreeDigit === "3" ? ["SE", "KIM", "DTM"]
    : degreeDigit === "5" ? ["KIM", "DTM"]
    : ["ANI", "DG", "DII", "MMIT", "SE"];

  // Faculty is derived from the (locked) student id rather than assumed —
  // typo protection: it flags an id whose faculty digits don't say CAMT.
  const derivedFaculty = facultyFromStudentId(formData.studentId);

  // Faculty-scoped major list. CAMT keeps the existing degree-digit-aware list
  // (undergrad SE/KIM/DTM by intake year vs the base ANI/DG/DII/MMIT/SE);
  // other faculties use their (currently empty, pending real data) list from
  // src/lib/faculties.ts.
  const currentMajorOptions = derivedFaculty === "CAMT" ? majorOptions : majorsForFaculty(derivedFaculty);

  // Reset major when degree level or faculty changes (only relevant while the field is editable)
  useEffect(() => {
    if (!isProfileCompleted && derivedFaculty && !currentMajorOptions.includes(formData.major)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      set("major", currentMajorOptions[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degreeDigit, derivedFaculty]);

  const setEC = (idx: number, key: string, value: string) => {
    const contacts = [...formData.emergencyContacts] as EmergencyContact[];
    contacts[idx] = { ...contacts[idx], [key]: value };
    set("emergencyContacts", contacts);
  };
  const renderMedicalField = (
    fieldKey: "chronicDiseases" | "medicalHistory" | "drugAllergies" | "foodAllergies" | "emergencyMedication",
    label: string,
    isFullWidth: boolean = false
  ) => {
    const isHas = hasFields[fieldKey];
    return (
      <div className={`field col-span-${isFullWidth ? 12 : 6}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="label">{label}</label>
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
            {fieldKey === "medicalHistory" ? (
              <textarea
                className="input"
                rows={2}
                placeholder={t.back === "กลับ" ? "ระบุรายละเอียด..." : "Please specify details..."}
                value={formData[fieldKey]}
                onChange={(e) => set(fieldKey, e.target.value)}
                style={{
                  resize: "vertical",
                  marginTop: 4,
                  borderColor: validationTriggered && !formData[fieldKey].trim() ? "#ef4444" : undefined,
                  boxShadow: validationTriggered && !formData[fieldKey].trim() ? "0 0 0 1px #ef4444" : undefined,
                }}
              />
            ) : (
              <input
                className="input"
                placeholder={t.back === "กลับ" ? "ระบุรายละเอียด..." : "Please specify details..."}
                value={formData[fieldKey]}
                onChange={(e) => set(fieldKey, e.target.value)}
                style={{
                  marginTop: 4,
                  borderColor: validationTriggered && !formData[fieldKey].trim() ? "#ef4444" : undefined,
                  boxShadow: validationTriggered && !formData[fieldKey].trim() ? "0 0 0 1px #ef4444" : undefined,
                }}
              />
            )}
            {validationTriggered && !formData[fieldKey].trim() && (
              <span className="error-text" style={{ color: "#ef4444", fontSize: 11, fontWeight: 600, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                {t.back === "กลับ" ? "กรุณาระบุรายละเอียด" : "Required"}
              </span>
            )}
          </>
        )}
      </div>
    );
  };
 
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
 
    // Validate size (max 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError(t.fileTooLarge);
      return;
    }
 
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    setError(null);

    const isTh = t.back === "กลับ";
    try {
      // Avatars display small, so downscale hard in the browser (512px → ~10–20KB).
      // This also keeps the upload under the reverse proxy's body cap, which would
      // otherwise reject a raw multi-MB phone photo with a 413 before it reaches the app.
      const upload = await compressImageFile(file, { maxDim: 512 });
      const fd = new FormData();
      fd.append("file", upload);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: fd
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        set("image", data.url);
      } else if (res.status === 413) {
        setError(isTh ? "ไฟล์รูปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง" : "Image is too large. Please choose a smaller photo.");
      } else {
        setError(data?.error || (isTh ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again."));
      }
    } catch (err) {
      setError(isTh ? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };
 
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
 
    const isTh = t.back === "กลับ";
    if (!formData.name.trim() || !formData.nickname.trim() || !formData.phone.trim() || !formData.contactChannels.trim()) {
      setError(isTh ? "กรุณากรอกข้อมูลส่วนตัวที่จำเป็นให้ครบถ้วน" : "Please fill out all required personal information fields.");
      setSaving(false);
      setValidationTriggered(true);
      return;
    }
 
    if (!/^[0-9]{10}$/.test(formData.phone.trim())) {
      setError(isTh ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Phone number must be exactly 10 digits and contain only numbers.");
      setSaving(false);
      setValidationTriggered(true);
      return;
    }
 
    const ec1 = formData.emergencyContacts[0];
    const isEc1RelEmpty = !ec1 || !ec1.relationship.trim() || ec1.relationship.trim() === "Other:";
    if (!ec1 || !ec1.name.trim() || isEc1RelEmpty || !ec1.phone.trim()) {
      setError(isTh ? "กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินคนที่ 1 ให้ครบถ้วน" : "Please fill out all fields for Emergency Contact #1.");
      setSaving(false);
      setValidationTriggered(true);
      return;
    }
    if (!/^[0-9]{10}$/.test(ec1.phone.trim())) {
      setError(isTh ? "เบอร์โทรศัพท์ผู้ติดต่อฉุกเฉินคนที่ 1 ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Emergency Contact #1 phone number must be exactly 10 digits and contain only numbers.");
      setSaving(false);
      setValidationTriggered(true);
      return;
    }
 
    const ec2 = formData.emergencyContacts[1];
    if (ec2 && (ec2.name.trim() || ec2.relationship.trim() || ec2.phone.trim())) {
      const isEc2RelEmpty = !ec2.relationship.trim() || ec2.relationship.trim() === "Other:";
      if (!ec2.name.trim() || isEc2RelEmpty || !ec2.phone.trim()) {
        setError(isTh ? "กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินคนที่ 2 ให้ครบถ้วน หรือปล่อยว่างไว้ทั้งหมด" : "Please complete all fields for Emergency Contact #2 or leave it empty.");
        setSaving(false);
        setValidationTriggered(true);
        return;
      }
      if (!/^[0-9]{10}$/.test(ec2.phone.trim())) {
        setError(isTh ? "เบอร์โทรศัพท์ผู้ติดต่อฉุกเฉินคนที่ 2 ต้องเป็นตัวเลข 10 หลักเท่านั้น" : "Emergency Contact #2 phone number must be exactly 10 digits and contain only numbers.");
        setSaving(false);
        setValidationTriggered(true);
        return;
      }
    }
    const emptyHasFields = Object.keys(hasFields).filter(
      (key) => hasFields[key] && !formData[key as keyof typeof formData]?.toString().trim()
    );
    if (emptyHasFields.length > 0) {
      setError(isTh ? "กรุณากรอกข้อมูลสุขภาพที่คุณเลือก 'มี'" : "Please specify details for fields checked as 'Has'.");
      setSaving(false);
      setValidationTriggered(true);
      return;
    }
    setValidationTriggered(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
 
      if (res.ok) {
        setSuccess(true);
        await update(); // Refresh session
        router.refresh();
      } else {
        const data = await res.json();
        setError(t[data.error as keyof typeof t] || data.error || "Failed to update profile");
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  };
 
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  // Load failed — never render the (blank) form, because saving it would
  // overwrite the student's real profile with empty values.
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <AlertTriangle size={40} style={{ color: "#ef4444", margin: "0 auto 16px", display: "block" }} />
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
            {t.back === "กลับ" ? "โหลดโปรไฟล์ไม่สำเร็จ" : "Couldn't load your profile"}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 20 }}>
            {t.back === "กลับ" ? "กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง" : "Please check your connection and try again."}
          </p>
          <button onClick={() => window.location.reload()} className="btn btn-primary">
            {t.back === "กลับ" ? "ลองอีกครั้ง" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-wrapper">
        {/* Header */}
        <div className="profile-header">
          <div className="header-title-section">
            <Link href="/dashboard" className="btn btn-ghost back-btn">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="title-text">{t.profileSummary}</h1>
              <p className="subtitle-text">Update your profile information and safety settings.</p>
            </div>
          </div>
          <LanguageSwitcher variant="segmented" />
        </div>

        <form onSubmit={handleSubmit} className="animate-fade-in-up">
          <div className="form-container">

            {/* Section: Profile Photo & Adjustments */}
            <div className="form-card photo-card">
              <div className="photo-avatar-container">
                <div className="avatar-preview-box">
                  {uploading && (
                    <div className="avatar-loading-overlay">
                      <Loader2 className="animate-spin text-white" size={24} />
                    </div>
                  )}
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Profile"
                      style={{
                        position: "absolute",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: `scale(${formData.imageTransform.scale}) translate(${formData.imageTransform.x}%, ${formData.imageTransform.y}%)`,
                        transition: "transform 0.1s ease-out"
                      }}
                    />
                  ) : (
                    <User size={70} className="text-muted opacity-30" />
                  )}
                </div>
                <label className="camera-upload-btn" title={t.profilePhotoDisabledNote}>
                  <Camera size={20} />
                  <input type="file" hidden accept="image/*" onChange={handleImageUpload} disabled={true} />
                </label>
              </div>

              <div className="photo-info-container">
                {/* Note: Profile photo upload temporarily disabled */}
                <div className="photo-disabled-note">
                  {t.profilePhotoDisabledNote}
                </div>

                {previewUrl && (
                  <div className="photo-controls">
                    <div className="control-group">
                      <div className="control-header">
                        <span className="control-label">
                          <Maximize size={12} /> Zoom
                        </span>
                        <span className="control-value">{Math.round(formData.imageTransform.scale * 100)}%</span>
                      </div>
                      <input
                        type="range" min="1" max="3" step="0.05"
                        value={formData.imageTransform.scale}
                        onChange={(e) => set("imageTransform", { ...formData.imageTransform, scale: parseFloat(e.target.value) })}
                        className="range-input"
                      />
                    </div>

                    <div className="control-group">
                      <div className="control-header">
                        <span className="control-label">
                          <Move size={12} /> Horizontal
                        </span>
                        <span className="control-value">{formData.imageTransform.x}px</span>
                      </div>
                      <input
                        type="range"
                        min={-(formData.imageTransform.scale - 1) * 50}
                        max={(formData.imageTransform.scale - 1) * 50}
                        step="1"
                        value={formData.imageTransform.x}
                        onChange={(e) => set("imageTransform", { ...formData.imageTransform, x: parseInt(e.target.value) })}
                        className="range-input"
                      />
                    </div>

                    <div className="control-group">
                      <div className="control-header">
                        <span className="control-label">
                          <Move size={12} style={{ transform: "rotate(90deg)" }} /> Vertical
                        </span>
                        <span className="control-value">{formData.imageTransform.y}px</span>
                      </div>
                      <input
                        type="range"
                        min={-(formData.imageTransform.scale - 1) * 50}
                        max={(formData.imageTransform.scale - 1) * 50}
                        step="1"
                        value={formData.imageTransform.y}
                        onChange={(e) => set("imageTransform", { ...formData.imageTransform, y: parseInt(e.target.value) })}
                        className="range-input"
                      />
                    </div>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm reset-btn"
                      onClick={() => set("imageTransform", { scale: 1, x: 0, y: 0 })}
                    >
                      Reset Framing
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Section: Basic Info */}
            <div className="form-card">
              <h2 className="section-title">
                <User size={20} style={{ color: "var(--accent-primary)" }} />
                {t.personalInfo}
              </h2>
              <div className="form-grid">
                <div className="field col-span-12">
                  <label className="label">{t.studentId} (Locked)</label>
                  <input className="input" disabled value={formData.studentId} style={{ background: "var(--bg-elevated)", cursor: "not-allowed", opacity: 0.7 }} />
                </div>
                <div className="col-span-12 flex gap-3 sm:gap-4">
                  <div className="field flex-shrink-0" style={{ width: 100 }}>
                    <label className="label">
                      {t.prefix} {isProfileCompleted && "(Locked)"}
                    </label>
                    <select
                      className="input"
                      disabled={isProfileCompleted}
                      value={formData.prefix}
                      onChange={(e) => set("prefix", e.target.value)}
                      style={{
                        background: isProfileCompleted ? "var(--bg-elevated)" : undefined,
                        cursor: isProfileCompleted ? "not-allowed" : undefined,
                        opacity: isProfileCompleted ? 0.7 : undefined,
                        width: "100%"
                      }}
                    >
                      <option value="นาย">{t.back === "กลับ" ? "นาย" : "Mr."}</option>
                      <option value="นางสาว">{t.back === "กลับ" ? "น.ส." : "Ms."}</option>
                      <option value="นาง">{t.back === "กลับ" ? "นาง" : "Mrs."}</option>
                    </select>
                  </div>
                  <div className="field flex-grow">
                    <label className="label">
                      {t.fullName} <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      className="input"
                      name="name"
                      required
                      value={formData.name}
                      onChange={(e) => set("name", e.target.value)}
                      style={{
                        borderColor: validationTriggered && !formData.name.trim() ? "#ef4444" : undefined,
                        boxShadow: validationTriggered && !formData.name.trim() ? "0 0 0 1px #ef4444" : undefined
                      }}
                    />
                    {validationTriggered && !formData.name.trim() && (
                      <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                        {t.back === "กลับ" ? "กรุณากรอกชื่อ-นามสกุล" : "This field is required"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="field col-span-4">
                  <label className="label">{t.nickname} <span style={{ color: "#ef4444" }}>*</span></label>
                  <input
                    className="input"
                    name="nickname"
                    value={formData.nickname}
                    onChange={(e) => set("nickname", e.target.value)}
                    style={{
                      borderColor: validationTriggered && !formData.nickname.trim() ? "#ef4444" : undefined,
                      boxShadow: validationTriggered && !formData.nickname.trim() ? "0 0 0 1px #ef4444" : undefined
                    }}
                  />
                  {validationTriggered && !formData.nickname.trim() && (
                    <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      {t.back === "กลับ" ? "กรุณากรอกชื่อเล่น" : "This field is required"}
                    </span>
                  )}
                </div>
                {/* Faculty — auto-detected from the (locked) student id, so you can
                    re-check it matches CAMT. Hidden until a 9-digit id exists. */}
                {formData.studentId.trim().length === 9 && (
                  derivedFaculty ? (
                    <div className="field col-span-8">
                      <label className="label">{t.faculty} (Locked)</label>
                      <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--bg-elevated)", cursor: "not-allowed", opacity: 0.7 }}>
                        {FACULTIES.find((f) => f.id === derivedFaculty)?.name ?? derivedFaculty}
                      </div>
                    </div>
                  ) : (
                    <div className="field col-span-8">
                      <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                        {t.back === "กลับ"
                          ? "รหัสนักศึกษานี้ไม่ตรงกับวิทยาลัยศิลปะ สื่อ และเทคโนโลยี กรุณาติดต่อที่ IG: smocamt.official"
                          : "This student ID's digits don't match to College of Arts, Media and Technology. Please contact IG: smocamt.official."}
                      </span>
                    </div>
                  )
                )}
                {derivedFaculty && currentMajorOptions.length > 0 && (
                  <div className="field col-span-8">
                    <label className="label">
                      {t.major} {isProfileCompleted && "(Locked)"}
                    </label>
                    <select
                      className="input"
                      disabled={isProfileCompleted}
                      value={formData.major}
                      onChange={(e) => set("major", e.target.value)}
                      style={{
                        background: isProfileCompleted ? "var(--bg-elevated)" : undefined,
                        cursor: isProfileCompleted ? "not-allowed" : undefined,
                        opacity: isProfileCompleted ? 0.7 : undefined,
                      }}
                    >
                      {currentMajorOptions.map((m) => (
                        <option key={m} value={m}>{MAJOR_LABELS[m] ?? m}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field col-span-6">
                  <label className="label">
                    {t.phone} {isProfileCompleted ? "(Locked)" : <span style={{ color: "#ef4444" }}>*</span>}
                  </label>
                  <input
                    className="input"
                    name="phone"
                    required
                    disabled={isProfileCompleted}
                    value={formData.phone}
                    onChange={(e) => set("phone", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                    style={{
                      background: isProfileCompleted ? "var(--bg-elevated)" : undefined,
                      cursor: isProfileCompleted ? "not-allowed" : undefined,
                      opacity: isProfileCompleted ? 0.7 : undefined,
                      borderColor: validationTriggered && (!formData.phone.trim() || !/^[0-9]{10}$/.test(formData.phone.trim())) ? "#ef4444" : undefined,
                      boxShadow: validationTriggered && (!formData.phone.trim() || !/^[0-9]{10}$/.test(formData.phone.trim())) ? "0 0 0 1px #ef4444" : undefined
                    }}
                  />
                  {validationTriggered && (!formData.phone.trim() || !/^[0-9]{10}$/.test(formData.phone.trim())) && (
                    <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      {!formData.phone.trim() 
                        ? (t.back === "กลับ" ? "กรุณากรอกเบอร์โทรศัพท์" : "This field is required")
                        : (t.back === "กลับ" ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก" : "Phone number must be exactly 10 digits and numbers only")}
                    </span>
                  )}
                </div>
                <div className="field col-span-6">
                  <label className="label">{t.contactChannels} <span style={{ color: "#ef4444" }}>*</span></label>
                  <input
                    className="input"
                    name="contactChannels"
                    required
                    value={formData.contactChannels}
                    onChange={(e) => set("contactChannels", e.target.value)}
                    placeholder="IG: smocamt.official / LINE: smocamt.official"
                    style={{
                      borderColor: validationTriggered && !formData.contactChannels.trim() ? "#ef4444" : undefined,
                      boxShadow: validationTriggered && !formData.contactChannels.trim() ? "0 0 0 1px #ef4444" : undefined
                    }}
                  />
                  {validationTriggered && !formData.contactChannels.trim() && (
                    <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      {t.back === "กลับ" ? "กรุณากรอกช่องทางติดต่อ" : "This field is required"}
                    </span>
                  )}
                </div>
                <div className="field col-span-12">
                  <label className="label">{t.religion}</label>
                  <select
                    className="input"
                    name="religion"
                    value={
                      ["", "Buddhism", "Christianity", "Islam", "Hinduism", "Sikhism", "None"].includes(formData.religion)
                        ? formData.religion
                        : "Other"
                    }
                    onChange={(e) => {
                      if (e.target.value === "Other") {
                        set("religion", "Other:");
                      } else {
                        set("religion", e.target.value);
                      }
                    }}
                  >
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
                    <input
                      type="text"
                      className="input"
                      style={{ marginTop: 8 }}
                      placeholder={t.back === "กลับ" ? "กรุณาระบุศาสนา..." : "Please specify religion..."}
                      value={
                        formData.religion.startsWith("Other:")
                          ? formData.religion.substring(6)
                          : formData.religion
                      }
                      onChange={(e) => set("religion", "Other:" + e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Section: Parent / Emergency Info */}
            <div className="form-card">
              <h2 className="section-title">
                <ShieldAlert size={20} style={{ color: "var(--accent-secondary)" }} />
                {t.emergencyContacts}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {formData.emergencyContacts.map((contact, i) => {
                  const isFirst = i === 0;
                  const isSecondPartiallyFilled = i === 1 && !!(contact.name.trim() || contact.relationship.trim() || contact.phone.trim());
                  const isFieldRequired = isFirst || isSecondPartiallyFilled;

                  return (
                    <div key={i} className="emergency-contact-box">
                      <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16 }}>Contact #{i + 1}</p>
                      <div className="form-grid">
                        <div className="field col-span-12">
                          <label className="label">{t.fullName} {isFieldRequired && <span style={{ color: "#ef4444" }}>*</span>}</label>
                          <input
                            className="input"
                            required={isFieldRequired}
                            value={contact.name}
                            onChange={(e) => setEC(i, "name", e.target.value)}
                            style={{
                              borderColor: validationTriggered && isFieldRequired && !contact.name.trim() ? "#ef4444" : undefined,
                              boxShadow: validationTriggered && isFieldRequired && !contact.name.trim() ? "0 0 0 1px #ef4444" : undefined
                            }}
                          />
                          {validationTriggered && isFieldRequired && !contact.name.trim() && (
                            <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                              {t.back === "กลับ" ? "กรุณากรอกชื่อ-นามสกุล" : "This field is required"}
                            </span>
                          )}
                        </div>
                        <div className="field col-span-6">
                          <label className="label">{t.relationship} {isFieldRequired && <span style={{ color: "#ef4444" }}>*</span>}</label>
                          <select
                            className="input"
                            required={isFieldRequired}
                            value={["", "Father", "Mother", "Guardian", "Sibling", "Relative", "Friend"].includes(contact.relationship) ? contact.relationship : (contact.relationship ? "Other" : "")}
                            onChange={(e) => setEC(i, "relationship", e.target.value === "Other" ? "Other:" : e.target.value)}
                            style={{
                              minHeight: 48,
                              borderColor: validationTriggered && isFieldRequired && (!contact.relationship.trim() || contact.relationship === "Other:") ? "#ef4444" : undefined,
                              boxShadow: validationTriggered && isFieldRequired && (!contact.relationship.trim() || contact.relationship === "Other:") ? "0 0 0 1px #ef4444" : undefined
                            }}
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
                              className="input"
                              style={{
                                marginTop: 8,
                                minHeight: 48,
                                borderColor: validationTriggered && isFieldRequired && (!contact.relationship.trim() || contact.relationship === "Other:") ? "#ef4444" : undefined,
                                boxShadow: validationTriggered && isFieldRequired && (!contact.relationship.trim() || contact.relationship === "Other:") ? "0 0 0 1px #ef4444" : undefined
                              }}
                              placeholder={t.back === "กลับ" ? "กรุณาระบุความสัมพันธ์..." : "Please specify relationship..."}
                              value={contact.relationship.startsWith("Other:") ? contact.relationship.substring(6) : contact.relationship}
                              onChange={(e) => setEC(i, "relationship", "Other:" + e.target.value)}
                            />
                          )}
                          {validationTriggered && isFieldRequired && (!contact.relationship.trim() || contact.relationship === "Other:") && (
                            <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                              {t.back === "กลับ" ? "กรุณากรอกความสัมพันธ์" : "This field is required"}
                            </span>
                          )}
                        </div>
                        <div className="field col-span-6">
                          <label className="label">{t.phone} {isFieldRequired && <span style={{ color: "#ef4444" }}>*</span>}</label>
                          <input
                            className="input"
                            required={isFieldRequired}
                            value={contact.phone}
                            onChange={(e) => setEC(i, "phone", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                            style={{
                              borderColor: validationTriggered && isFieldRequired && (!contact.phone.trim() || !/^[0-9]{10}$/.test(contact.phone.trim())) ? "#ef4444" : undefined,
                              boxShadow: validationTriggered && isFieldRequired && (!contact.phone.trim() || !/^[0-9]{10}$/.test(contact.phone.trim())) ? "0 0 0 1px #ef4444" : undefined
                            }}
                          />
                          {validationTriggered && isFieldRequired && (!contact.phone.trim() || !/^[0-9]{10}$/.test(contact.phone.trim())) && (
                            <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 500, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} />
                              {!contact.phone.trim()
                                ? (t.back === "กลับ" ? "กรุณากรอกเบอร์โทรศัพท์" : "This field is required")
                                : (t.back === "กลับ" ? "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก" : "Phone number must be exactly 10 digits and numbers only")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section: Health & Safety */}
            <div className="form-card">
              <h2 className="section-title">
                <HeartPulse size={20} style={{ color: "#ef4444" }} />
                {t.medicalInfo}
              </h2>
              <div className="form-grid">
                {renderMedicalField("chronicDiseases", t.chronicDiseases)}
                {renderMedicalField("medicalHistory", t.medicalHistory)}
                {renderMedicalField("drugAllergies", t.drugAllergies)}
                {renderMedicalField("foodAllergies", t.foodAllergies)}
                <div className="field col-span-6">
                  <label className="label">{t.dietaryRestrictions}</label>
                  <select
                    className="input"
                    value={
                      ["", "Vegetarian", "Vegan", "Halal", "Kosher"].includes(formData.dietaryRestrictions)
                        ? formData.dietaryRestrictions
                        : "Other"
                    }
                    onChange={(e) => {
                      if (e.target.value === "Other") {
                        set("dietaryRestrictions", "Other:");
                      } else {
                        set("dietaryRestrictions", e.target.value);
                      }
                    }}
                  >
                    <option value="">{t.none}</option>
                    <option value="Vegetarian">{t.veg}</option>
                    <option value="Vegan">{t.vegan}</option>
                    <option value="Halal">{t.halal}</option>
                    <option value="Kosher">{t.kosher}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                  {(!["", "Vegetarian", "Vegan", "Halal", "Kosher"].includes(formData.dietaryRestrictions) || formData.dietaryRestrictions.startsWith("Other:")) && (
                    <input
                      type="text"
                      className="input"
                      style={{ marginTop: 8 }}
                      placeholder={t.back === "กลับ" ? "กรุณาระบุข้อจำกัดอาหาร..." : "Please specify dietary restrictions..."}
                      value={
                        formData.dietaryRestrictions.startsWith("Other:")
                          ? formData.dietaryRestrictions.substring(6)
                          : formData.dietaryRestrictions
                      }
                      onChange={(e) => set("dietaryRestrictions", "Other:" + e.target.value)}
                    />
                  )}
                </div>
                {renderMedicalField("emergencyMedication", t.emergencyMed)}
                <div className="field col-span-12" style={{ marginTop: 8 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                    <input type="checkbox" style={{ marginTop: 3, flexShrink: 0, width: 18, height: 18, accentColor: "var(--accent-primary)", cursor: "pointer" }} checked={formData.faintingHistory} onChange={(e) => set("faintingHistory", e.target.checked)} />
                    <span style={{ fontSize: 14, lineHeight: 1.4 }}>{t.faintingHistory}</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="form-footer">
              <div className="status-msg-box">
                {error && <p style={{ color: "var(--accent-primary)", fontWeight: 600, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}</p>}
                {success && <p style={{ color: "#10b981", fontWeight: 600, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}><Check size={14} style={{ flexShrink: 0 }} /> {t.complete}</p>}
              </div>

              <button type="submit" disabled={saving || uploading} className="btn btn-primary btn-lg submit-btn">
                {saving ? <Loader2 className="animate-spin" size={20} /> : <><Save size={20} /> {t.save}</>}
              </button>
            </div>

          </div>
        </form>
      </div>

      <style jsx>{`
        .profile-page {
          background: var(--bg-base);
          min-height: 100vh;
          padding: 40px 24px;
        }
        .profile-wrapper {
          max-width: 800px;
          margin: 0 auto;
        }
        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 40px;
          gap: 24px;
        }
        .header-title-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .back-btn {
          width: 48px;
          height: 48px;
          padding: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .title-text {
          font-size: clamp(24px, 4vw, 32px);
          font-weight: 900;
          letter-spacing: -0.04em;
          margin: 0;
          line-height: 1.35;
        }
        .subtitle-text {
          color: var(--text-muted);
          font-weight: 500;
          margin: 4px 0 0;
          font-size: 14px;
        }
        .form-container {
          display: grid;
          gap: 32px;
        }
        .form-card {
          background: var(--bg-surface);
          padding: 32px;
          border-radius: 32px;
          border: 1px solid var(--border-medium);
          box-shadow: 0 10px 30px rgba(0,0,0,0.04);
        }
        .photo-card {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 32px;
          padding: 32px;
        }
        .photo-avatar-container {
          position: relative;
          flex-shrink: 0;
        }
        .avatar-preview-box {
          width: 160px;
          height: 160px;
          border-radius: 50%;
          background-color: var(--bg-elevated);
          border: 4px solid white;
          box-shadow: 0 10px 30px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }
        .avatar-loading-overlay {
          position: absolute;
          inset: 0;
          z-index: 20;
          background: rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .camera-upload-btn {
          position: absolute;
          bottom: 4px;
          right: 4px;
          width: 44px;
          height: 44px;
          background: var(--border-medium);
          color: var(--text-muted);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: not-allowed;
          border: 3px solid white;
        }
        .photo-info-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex-grow: 1;
          width: 100%;
        }
        .photo-disabled-note {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
        }
        .photo-controls {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          padding: 20px;
          background: var(--bg-elevated);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle);
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .control-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .control-label {
          font-size: 11px;
          font-weight: 800;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .control-value {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-primary);
        }
        .range-input {
          width: 100%;
          accent-color: var(--accent-primary);
          cursor: pointer;
        }
        .reset-btn {
          grid-column: span 2;
          justify-self: center;
          margin-top: 8px;
        }
        .section-title {
          font-size: 18px;
          font-weight: 800;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .form-grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 20px;
        }
        .col-span-12 { grid-column: span 12; }
        .col-span-9  { grid-column: span 9; }
        .col-span-8  { grid-column: span 8; }
        .col-span-6  { grid-column: span 6; }
        .col-span-4  { grid-column: span 4; }
        .col-span-3  { grid-column: span 3; }
        
        .emergency-contact-box {
          padding: 24px;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--border-medium);
          border-radius: 24px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.03);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .form-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 20px;
          padding-bottom: 60px;
          gap: 24px;
        }
        .status-msg-box {
          flex: 1;
        }
        .submit-btn {
          min-width: 200px;
          border-radius: 99px;
          box-shadow: 0 10px 20px var(--accent-glow);
        }

        /* iPad and Tablets (max-width: 1024px) */
        @media (max-width: 1024px) {
          .profile-page {
            padding: 32px 6vw;
          }
          .form-card {
            padding: 24px;
            border-radius: 24px;
          }
        }

        /* Portrait iPad and smaller (max-width: 820px) */
        @media (max-width: 820px) {
          .profile-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 20px;
          }
        }

        /* Phones (max-width: 640px) */
        @media (max-width: 640px) {
          .profile-page {
            padding: 24px 8vw;
          }
          .form-card {
            padding: 20px 16px;
            border-radius: 20px;
          }
          .form-container {
            gap: 20px;
          }
          .header-title-section {
            align-items: flex-start;
          }
          .photo-card {
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 24px;
            padding: 24px 16px;
          }
          .photo-info-container {
            align-items: center;
          }
          .photo-disabled-note {
            text-align: center;
          }
          .photo-controls {
            grid-template-columns: 1fr;
            padding: 16px;
          }
          .reset-btn {
            grid-column: span 1;
            width: 100%;
          }
          .form-grid > * {
            grid-column: span 12 !important;
          }
          .emergency-contact-box {
            padding: 16px;
            border-radius: 20px;
          }
          .form-footer {
            flex-direction: column;
            align-items: stretch;
            text-align: center;
            gap: 16px;
          }
          .submit-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
