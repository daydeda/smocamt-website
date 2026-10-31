"use client";

import { AlertCircle, AlertTriangle, HeartPulse, Phone } from "lucide-react";
import { Modal } from "@/components/admin/ui";
import { type EmergencyContact } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";
import { fmt } from "./fmt";

const SECTION: React.CSSProperties = { background: "var(--bg-elevated)", padding: 16, borderRadius: 16 };
const SECTION_TITLE: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 };

export function StudentProfileModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canSeeAttendeeContactAndMedical, canSeeRawMedicalDetail, hasActualMedicalInfo, hasMedicalSignal, selectedStudent, setSelectedStudent, t } = ctx;
  const close = () => setSelectedStudent(null);
  const s = selectedStudent;
  return (
    <Modal
      open={!!s}
      onClose={close}
      size="md"
      title={t.adminEvlProfileTitle}
      footer={
        <button type="button" className="btn btn-primary" onClick={close}>
          {t.adminEvlClose}
        </button>
      }
    >
      {s && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div aria-hidden="true" style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "var(--accent-primary)" }}>
              {s.name?.charAt(0)}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>{s.name}</p>
              <p style={{ fontSize: 14, color: "var(--text-muted)" }}>{s.studentId} • {s.major}</p>
            </div>
          </div>

          {/* Contact: hidden from smo (thin roster carries no phone); visible to
              staff and a president viewing an event they own. */}
          {canSeeAttendeeContactAndMedical && (
            <div style={SECTION}>
              <p style={SECTION_TITLE}>{t.adminEvlContactInfo}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Phone size={16} aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontWeight: 600 }}>{s.phone || t.adminEvlNoPhone}</span>
              </div>
            </div>
          )}

          {/* Medical & health: the raw detail the student filled in is PDPA-sensitive and
              shown only via canSeeRawMedicalDetail (super_admin/admin, or a president
              viewing their own event; the contact NAME is still redacted server-side for
              the president tier). Other admin-area roles (registration/organizer) see the
              "has a condition" signal, never the detail. Hidden from smo. */}
          {canSeeAttendeeContactAndMedical && (
            <div
              style={{
                ...SECTION,
                background: hasMedicalSignal(s) ? "rgb(var(--red-500-rgb) / 0.05)" : "var(--bg-elevated)",
                border: hasMedicalSignal(s) ? "1px solid rgb(var(--red-500-rgb) / 0.15)" : "1px solid transparent",
              }}
            >
              <p style={{ ...SECTION_TITLE, color: hasMedicalSignal(s) ? "var(--red-600)" : "var(--text-secondary)" }}>
                <HeartPulse size={14} aria-hidden="true" />
                {t.medicalHealthInfo}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14, lineHeight: 1.6 }}>
                {canSeeRawMedicalDetail ? (
                  <>
                    {s.chronicDiseases && s.chronicDiseases.trim() !== "-" && <p><b>{t.chronicDiseases}:</b> {s.chronicDiseases}</p>}
                    {s.medicalHistory && s.medicalHistory.trim() !== "-" && <p><b>{t.medicalHistory}:</b> {s.medicalHistory}</p>}
                    {s.drugAllergies && s.drugAllergies.trim() !== "-" && <p><b>{t.drugAllergies}:</b> <span style={{ color: "var(--red-600)", fontWeight: 700 }}>{s.drugAllergies}</span></p>}
                    {s.foodAllergies && s.foodAllergies.trim() !== "-" && <p><b>{t.foodAllergies}:</b> <span style={{ color: "var(--red-600)", fontWeight: 700 }}>{s.foodAllergies}</span></p>}
                    {s.dietaryRestrictions && s.dietaryRestrictions.trim() !== "-" && <p><b>{t.dietaryRestrictions}:</b> {s.dietaryRestrictions}</p>}
                    {s.emergencyMedication && s.emergencyMedication.trim() !== "-" && <p><b>{t.emergencyMed}:</b> <span style={{ color: "var(--red-600)", fontWeight: 700 }}>{s.emergencyMedication}</span></p>}
                    {s.hospitalNumber && <p><b>HN:</b> {s.hospitalNumber}{s.hospitalName ? ` (${s.hospitalName})` : ""}</p>}
                    {s.faintingHistory && <p style={{ color: "var(--red-600)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0 }} /> {t.faintingHistory}</p>}
                    {!hasActualMedicalInfo(s) && <p style={{ color: "var(--text-muted)" }}>{t.noMedicalConditions}</p>}
                  </>
                ) : hasMedicalSignal(s) ? (
                  // Signal only: registration sees WHICH categories exist, never the detail.
                  <>
                    <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                      {(s.medicalCategories ?? []).map((cat) => (
                        <li key={cat} style={{ color: "var(--red-600)", fontWeight: 700 }}>
                          {t[cat as keyof typeof t] ?? cat}
                        </li>
                      ))}
                    </ul>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                      <AlertCircle size={14} aria-hidden="true" />
                      {t.medicalDetailsRestricted}
                    </p>
                  </>
                ) : (
                  <p style={{ color: "var(--text-muted)" }}>{t.noMedicalConditions}</p>
                )}
              </div>
            </div>
          )}

          {/* Emergency contact: the contact's own NAME is present only when the server
              sent it; a president viewing their own event gets relationship + phone only. */}
          {s.emergencyContacts && s.emergencyContacts.length > 0 && (
            <div style={SECTION}>
              <p style={SECTION_TITLE}>{t.adminEvlEmergencyContact}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {s.emergencyContacts.map((c: EmergencyContact, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>
                        {c.name ? `${c.name} ` : ""}{c.nickname ? `“${c.nickname}” ` : ""}({c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship})
                      </p>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{c.phone}</p>
                    </div>
                    <a
                      href={`tel:${c.phone}`}
                      className="btn btn-ghost"
                      aria-label={fmt(t.adminEvlCallPhone, { phone: c.phone })}
                      title={fmt(t.adminEvlCallPhone, { phone: c.phone })}
                      style={{ width: 44, height: 44, padding: 0, borderRadius: 12 }}
                    >
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
