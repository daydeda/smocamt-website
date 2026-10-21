"use client";

import { X, AlertCircle, Phone, HeartPulse, AlertTriangle } from "lucide-react";
import { type EmergencyContact } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

export function StudentProfileModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canSeeAttendeeContactAndMedical, canSeeRawMedicalDetail, hasActualMedicalInfo, hasMedicalSignal, selectedStudent, setSelectedStudent, t } = ctx;
  return (
    <>{selectedStudent && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgb(var(--scrim-rgb) / 0.4)",
          backdropFilter: "blur(8px)",
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setSelectedStudent(null)}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "100%",
            maxWidth: 500,
            borderRadius: 32,
            overflow: "hidden",
            boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.2)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 32, borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 20, fontWeight: 900 }}>Student Profile</h3>
              <button className="btn btn-ghost" onClick={() => setSelectedStudent(null)} style={{ borderRadius: "50%", width: 40, height: 40, padding: 0 }}><X size={18} /></button>
            </div>
            <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Header Info */}
              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "var(--accent-primary)" }}>
                  {selectedStudent.name?.charAt(0)}
                </div>
                <div>
                  <p style={{ fontSize: 22, fontWeight: 900 }}>{selectedStudent.name}</p>
                  <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600 }}>{selectedStudent.studentId} • {selectedStudent.major}</p>
                </div>
              </div>

              {/* Contact — hidden from smo (thin roster carries no phone); visible
                  to staff and a president viewing an event they own. */}
              {canSeeAttendeeContactAndMedical && (
              <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Contact Information</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Phone size={16} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 700 }}>{selectedStudent.phone || "No phone provided"}</span>
                </div>
              </div>
              )}

              {/* Medical & Health Info: the raw detail the student filled in is
                  PDPA-sensitive and shown only via canSeeRawMedicalDetail
                  (super_admin/admin, or a president viewing their own event —
                  contact NAME still redacted server-side for the president
                  tier, see the Emergency Contact section below). Other
                  admin-area roles (registration/organizer) still see the "has
                  a condition" signal, not the detail. */}
              {/* Medical — hidden from smo (thin roster carries no medical
                  signal, so it can't be derived here). */}
              {canSeeAttendeeContactAndMedical && (
              <div style={{
                background: hasMedicalSignal(selectedStudent)
                  ? "rgb(var(--red-500-rgb) / 0.05)"
                  : "var(--bg-elevated)",
                padding: 20,
                borderRadius: 20,
                border: hasMedicalSignal(selectedStudent)
                  ? "1px solid rgb(var(--red-500-rgb) / 0.1)"
                  : "1px solid transparent"
              }}>
                <p style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: hasMedicalSignal(selectedStudent) ? "var(--red-500)" : "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 12,
                  letterSpacing: "0.05em",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}>
                  <HeartPulse size={14} />
                  {t.medicalHealthInfo}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {canSeeRawMedicalDetail ? (
                    <>
                      {selectedStudent.chronicDiseases && selectedStudent.chronicDiseases.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.chronicDiseases}:</b> {selectedStudent.chronicDiseases}</p>}
                      {selectedStudent.medicalHistory && selectedStudent.medicalHistory.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.medicalHistory}:</b> {selectedStudent.medicalHistory}</p>}
                      {selectedStudent.drugAllergies && selectedStudent.drugAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.drugAllergies}:</b> <span style={{ color: "var(--red-500)", fontWeight: 700 }}>{selectedStudent.drugAllergies}</span></p>}
                      {selectedStudent.foodAllergies && selectedStudent.foodAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.foodAllergies}:</b> <span style={{ color: "var(--red-500)", fontWeight: 700 }}>{selectedStudent.foodAllergies}</span></p>}
                      {selectedStudent.dietaryRestrictions && selectedStudent.dietaryRestrictions.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.dietaryRestrictions}:</b> {selectedStudent.dietaryRestrictions}</p>}
                      {selectedStudent.emergencyMedication && selectedStudent.emergencyMedication.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.emergencyMed}:</b> <span style={{ color: "var(--red-500)", fontWeight: 700 }}>{selectedStudent.emergencyMedication}</span></p>}
                      {selectedStudent.faintingHistory && <p style={{ fontSize: 14, color: "var(--red-500)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} style={{ flexShrink: 0 }} /> {t.faintingHistory}</p>}

                      {!hasActualMedicalInfo(selectedStudent) && (
                        <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                      )}
                    </>
                  ) : hasMedicalSignal(selectedStudent) ? (
                    // Signal only — registration sees WHICH categories exist (as
                    // bullet points), never the detail the student filled in.
                    <>
                      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                        {(selectedStudent.medicalCategories ?? []).map((cat) => (
                          <li key={cat} style={{ fontSize: 14, color: "var(--red-500)", fontWeight: 700 }}>
                            {t[cat as keyof typeof t] ?? cat}
                          </li>
                        ))}
                      </ul>
                      <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertCircle size={14} />
                        {t.medicalDetailsRestricted}
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                  )}
                </div>
              </div>
              )}

              {/* Emergency Contact — visible to all admin-area roles that reach
                  this modal at all (smo is excluded above, thin roster). The
                  contact's own NAME is only present when the server actually
                  sent it (super_admin/admin/registration/organizer); a
                  president viewing their own event gets relationship + phone
                  only (redacted server-side, see EmergencyContact.name above). */}
              {selectedStudent.emergencyContacts && selectedStudent.emergencyContacts.length > 0 && (
                <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Emergency Contact</p>
                  {selectedStudent.emergencyContacts.map((c: EmergencyContact, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>
                          {c.name ? `${c.name} ` : ""}({c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship})
                        </p>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{c.phone}</p>
                      </div>
                      <a href={`tel:${c.phone}`} className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }}><Phone size={14} /></a>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "20px 32px", background: "var(--bg-elevated)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setSelectedStudent(null)}>Close Profile</button>
            </div>
          </div>
        </div>
      )}</>
  );
}
