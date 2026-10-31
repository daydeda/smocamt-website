"use client";

import { Heart, Phone, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ErrorState, InlineAlert, LoadingState, Modal, Panel } from "@/components/admin/ui";
import type { Student } from "../_lib/students";

/**
 * Super-admin medical record. Opened only AFTER the audited-access confirmation
 * (see viewSensitive in page.tsx); this component just renders what that
 * confirmed fetch returned. Renders exactly the same fields as before.
 */
export function MedicalRecordModal({
  student,
  data,
  loading,
  error,
  onRetry,
  onClose,
}: {
  /** The list row: identity only (name and ID), never medical detail. */
  student: Student | undefined;
  data: Student | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const who = data ?? student;
  const rows: [string, string | null | undefined][] = data
    ? [
        [t.adminStuChronic, data.chronicDiseases],
        [t.adminStuMedHistory, data.medicalHistory],
        [t.adminStuDrugAllergy, data.drugAllergies],
        [t.adminStuFoodAllergy, data.foodAllergies],
        [t.adminStuDietary, data.dietaryRestrictions],
        [t.adminStuFainting, data.faintingHistory ? t.adminStuFaintingYes : t.adminStuFaintingNo],
        [t.adminStuHospitalNumber, data.hospitalNumber ? `${data.hospitalNumber}${data.hospitalName ? ` (${data.hospitalName})` : ""}` : null],
      ]
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={<ShieldAlert size={20} />}
      title={t.adminStuMedicalTitle}
      description={who ? `${who.prefix || ""}${who.name} · ${who.studentId ?? t.adminStuNoId}` : undefined}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t.adminStuMedicalClose}
        </button>
      }
    >
      {loading ? (
        <LoadingState label={t.adminStuMedicalLoading} compact />
      ) : error ? (
        <ErrorState
          title={t.adminStuMedicalLoadError}
          message={
            <>
              {error}
              <br />
              {t.adminStuMedicalErrorNote}
            </>
          }
          onRetry={onRetry}
          compact
        />
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title={t.adminStuPanelMedical} icon={<Heart size={16} />}>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, margin: 0 }}>
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="adm-field-label">{label}</dt>
                  <dd style={{ margin: "2px 0 0", fontSize: 15, lineHeight: 1.6, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {value || t.adminStuNoRecords}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title={t.adminStuPanelEmergency} icon={<Phone size={16} />}>
            {Array.isArray(data.emergencyContacts) && data.emergencyContacts.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {data.emergencyContacts.map((c, i) => (
                  <div key={i} style={{ padding: 16, background: "var(--bg-elevated)", borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
                    <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", lineHeight: 1.5 }}>
                      {c.name}{c.nickname ? ` (${c.nickname})` : ""}
                    </p>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                      {c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship}
                    </p>
                    <a href={`tel:${c.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8, color: "var(--accent-primary)", fontWeight: 700, textDecoration: "none", fontSize: 16, minHeight: 44 }}>
                      <Phone size={16} aria-hidden="true" />
                      {c.phone}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{t.adminStuNoContacts}</p>
            )}
          </Panel>

          <InlineAlert tone="warning">{t.adminStuAuditNotice}</InlineAlert>
        </div>
      ) : null}
    </Modal>
  );
}
