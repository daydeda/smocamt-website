"use client";

import { HeartPulse } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LoadingState } from "@/components/admin/ui";

// Medical/emergency-contact detail for ONE member. Presentation only: the
// fetch (GET .../members/[memberId]/medical, audit-logged per member) stays in
// the owning page and runs on the first expand of that member. Emergency
// contacts arrive pre-redacted server-side to relationship + phone only.
export type MemberMedical = {
  chronicDiseases: string | null;
  medicalHistory: string | null;
  drugAllergies: string | null;
  foodAllergies: string | null;
  dietaryRestrictions: string | null;
  faintingHistory: boolean | null;
  emergencyMedication: string | null;
  hospitalNumber: string | null;
  hospitalName: string | null;
  emergencyContacts: { relationship: string; phone: string }[];
};

export function hasMedicalDetail(m: MemberMedical | undefined): boolean {
  return !!(
    m &&
    (m.chronicDiseases || m.medicalHistory || m.drugAllergies || m.foodAllergies ||
      m.dietaryRestrictions || m.faintingHistory || m.emergencyMedication || m.hospitalNumber ||
      m.emergencyContacts.length > 0)
  );
}

export function MedicalDetailPanel({
  medical,
  loading,
  error,
}: {
  medical: MemberMedical | undefined;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useLanguage();

  if (loading) return <LoadingState compact label={t.adminCmMedicalLoading} />;
  if (!medical) {
    return (
      <p role="alert" style={{ fontSize: 13, color: "var(--red-600)", fontWeight: 600 }}>
        {error || t.adminCmMedicalLoadFailed}
      </p>
    );
  }
  if (!hasMedicalDetail(medical)) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.adminCmMedicalNone}</p>;
  }

  const rows: { label: string; value: string; alert?: boolean }[] = [];
  if (medical.chronicDiseases) rows.push({ label: t.adminCmMedChronic, value: medical.chronicDiseases });
  if (medical.medicalHistory) rows.push({ label: t.adminCmMedHistory, value: medical.medicalHistory });
  if (medical.drugAllergies) rows.push({ label: t.adminCmMedDrugAllergies, value: medical.drugAllergies, alert: true });
  if (medical.foodAllergies) rows.push({ label: t.adminCmMedFoodAllergies, value: medical.foodAllergies, alert: true });
  if (medical.dietaryRestrictions) rows.push({ label: t.adminCmMedDietary, value: medical.dietaryRestrictions });
  if (medical.faintingHistory) rows.push({ label: t.adminCmMedFainting, value: t.adminCmMedYes, alert: true });
  if (medical.emergencyMedication) rows.push({ label: t.adminCmMedEmergencyMedication, value: medical.emergencyMedication, alert: true });
  if (medical.hospitalNumber) {
    rows.push({
      label: t.adminCmMedHospitalNumber,
      value: `${medical.hospitalNumber}${medical.hospitalName ? ` (${medical.hospitalName})` : ""}`,
    });
  }
  if (medical.emergencyContacts.length > 0) {
    rows.push({
      label: t.adminCmMedEmergencyContact,
      value: medical.emergencyContacts.map((c) => `${c.relationship}: ${c.phone}`).join("; "),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--red-600)" }}>
        <HeartPulse size={14} aria-hidden="true" /> {t.adminCmMedicalTitle}
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "minmax(110px, max-content) 1fr", gap: "4px 14px", fontSize: 13, lineHeight: 1.5 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "contents" }}>
            <dt style={{ fontWeight: 700, color: r.alert ? "var(--red-600)" : "var(--text-secondary)" }}>{r.label}</dt>
            <dd style={{ color: r.alert ? "var(--red-600)" : "var(--text-primary)", overflowWrap: "anywhere" }}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.adminCmMedicalLogged}</p>
    </div>
  );
}
