"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { sanitizeNameInput } from "@/lib/profile/name";
import { POSITION_IDS, POSITION_I18N_KEY } from "@/lib/access/positions";
import { Field, Modal, Panel, useToast } from "@/components/admin/ui";
import { fill, rolesOf, type Club, type House, type Student } from "../_lib/students";
import { ContactsEditor } from "./ContactsEditor";

function CheckTile({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        minHeight: 44,
        borderRadius: 10,
        cursor: "pointer",
        background: checked ? "var(--bg-surface)" : "transparent",
        border: checked ? "1px solid var(--accent-primary)" : "1px solid transparent",
      }}
    >
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: "var(--accent-primary)", cursor: "pointer", width: 18, height: 18 }} />
      <span style={{ fontSize: 14, fontWeight: checked ? 700 : 500, color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}>{label}</span>
    </label>
  );
}

const tileGrid = (min: number): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
  gap: 8,
  padding: 8,
  background: "var(--bg-elevated)",
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
});

/**
 * "Manage user" dialog: groups the profile into Identity, Academic and house,
 * Roles and positions, Contact (super_admin) and Emergency contacts (super_admin).
 * The PATCH payload is the whole student object, exactly as before.
 */
export function EditStudentModal({
  student,
  setStudent,
  houses,
  clubs,
  userRole,
  getHouseName,
  onClose,
  onSaved,
}: {
  student: Student;
  setStudent: (s: Student) => void;
  houses: House[];
  clubs: Club[];
  userRole: string;
  getHouseName: (id: string, defaultName: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const isSuperAdmin = userRole === "super_admin";

  const currentRoles = rolesOf(student);
  const roleOptions = [
    { value: "student", label: t.roleStudent },
    { value: "staff", label: t.roleStaff },
    { value: "smo", label: t.roleSMO },
    { value: "anusmo", label: t.roleANUSMO },
    { value: "admin", label: t.roleAdmin },
    { value: "super_admin", label: t.roleSuperAdmin },
    { value: "club_president", label: t.roleClubPresident },
    { value: "major_president", label: t.roleMajorPresident },
  ].filter((opt) => !(opt.value === "super_admin" && userRole !== "super_admin"));

  const positionOptions = [
    { value: "", label: "—" },
    ...POSITION_IDS.map((id) => ({ value: id, label: t[POSITION_I18N_KEY[id] as keyof typeof t] as string })),
  ];
  const activeClubs = clubs.filter((c) => !c.isArchived);
  const hasRole = (r: string) => (student.roles || (student.role ? [student.role] : [])).includes(r);
  const hnNeedsHospital = !!(student.hospitalNumber || "").trim() && !(student.hospitalName || "").trim();

  const save = async () => {
    setUpdating(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/users/${student.id}`, {
        method: "PATCH",
        body: JSON.stringify(student),
      });
      if (res.ok) {
        onClose();
        onSaved();
        toast.success(fill(t.adminStuSaved, { name: student.name }));
      } else {
        const d = await res.json().catch(() => null);
        const code = d?.error as string | undefined;
        setEditError(
          code === "nameInvalidChars" ? t.nameInvalidChars
          : code === "nameRequired" ? t.nameRequired
          : code === "contactInvalid" ? t.adminStuErrContact
          : code === "hospitalNameRequired" ? t.hospitalNameRequired
          : t.adminStuErrSave,
        );
      }
    } catch (err) {
      console.error(err);
      setEditError(t.adminStuErrSave);
      toast.error(t.adminStuSaveFailedTitle);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!updating}
      title={t.manageUser}
      description={`${student.prefix || ""}${student.name} · ${student.studentId ?? t.adminStuNoId}`}
      footer={
        <>
          {editError && (
            <span role="alert" style={{ marginRight: "auto", alignSelf: "center", color: "var(--red-600)", fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
              {editError}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={updating}>{t.cancel}</button>
          <button type="button" className="btn btn-primary" disabled={updating || hnNeedsHospital} onClick={save}>
            {updating ? t.saving : t.adminStuSaveChanges}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title={t.adminStuPanelIdentity}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 140px) 1fr", gap: 16 }}>
              <Field label={t.prefix}>
                {(p) => (
                  <select {...p} className="input" value={student.prefix || "นาย"} onChange={(e) => setStudent({ ...student, prefix: e.target.value })}>
                    <option value="นาย">{t.adminStuPrefixMr}</option>
                    <option value="นางสาว">{t.adminStuPrefixMs}</option>
                    <option value="นาง">{t.adminStuPrefixMrs}</option>
                  </select>
                )}
              </Field>
              <Field label={t.firstName} required>
                {(p) => (
                  <input {...p} className="input" value={student.firstName || ""} onChange={(e) => setStudent({ ...student, firstName: sanitizeNameInput(e.target.value) })} />
                )}
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <Field label={t.middleName}>
                {(p) => (
                  <input {...p} className="input" value={student.middleName || ""} onChange={(e) => setStudent({ ...student, middleName: sanitizeNameInput(e.target.value) })} />
                )}
              </Field>
              <Field label={t.lastName} required>
                {(p) => (
                  <input {...p} className="input" value={student.lastName || ""} onChange={(e) => setStudent({ ...student, lastName: sanitizeNameInput(e.target.value) })} />
                )}
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <Field label={t.studentId}>
                {(p) => (
                  <input {...p} className="input" inputMode="numeric" value={student.studentId || ""} onChange={(e) => setStudent({ ...student, studentId: e.target.value })} />
                )}
              </Field>
              <Field label={t.nickname}>
                {(p) => (
                  <input {...p} className="input" value={student.nickname || ""} onChange={(e) => setStudent({ ...student, nickname: sanitizeNameInput(e.target.value) })} />
                )}
              </Field>
            </div>
          </div>
        </Panel>

        <Panel title={t.adminStuPanelAcademic}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label={t.major}>
              {(p) => (
                <input {...p} className="input" placeholder="e.g. SE, ANI, MMIT" value={student.major || ""} onChange={(e) => setStudent({ ...student, major: e.target.value })} />
              )}
            </Field>
            <Field label={t.adminStuHouse}>
              {(p) => (
                <select {...p} className="input" value={student.houseId || ""} onChange={(e) => setStudent({ ...student, houseId: e.target.value })}>
                  <option value="">{t.unassignedLabel}</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>{getHouseName(h.id, h.name)}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </Panel>

        <Panel title={t.adminStuPanelRoles}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="adm-field-label" style={{ marginBottom: 4 }}>{t.adminStuRolesLegend}</legend>
              <p className="adm-field-hint" style={{ marginBottom: 8 }}>{t.adminStuRolesHint}</p>
              <div style={tileGrid(170)}>
                {roleOptions.map((opt) => {
                  const isChecked = currentRoles.includes(opt.value);
                  const toggle = () => {
                    const updated = isChecked ? currentRoles.filter((r) => r !== opt.value) : [...currentRoles, opt.value];
                    const finalRoles = updated.length > 0 ? updated : ["student"];
                    setStudent({
                      ...student,
                      roles: finalRoles,
                      role: finalRoles[0] || "student",
                      // Unchecking club_president clears their club picks too —
                      // otherwise a stale clubIds value would still get PATCHed
                      // and re-grant presidencies to a non-president.
                      ...(opt.value === "club_president" && isChecked ? { clubIds: [] } : {}),
                    });
                  };
                  return <CheckTile key={opt.value} checked={isChecked} onChange={toggle} label={opt.label} />;
                })}
              </div>
            </fieldset>

            {hasRole("club_president") && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend className="adm-field-label" style={{ marginBottom: 8 }}>{t.adminStuClubsLegend}</legend>
                <div style={tileGrid(190)}>
                  {activeClubs.length === 0 && (
                    <span style={{ fontSize: 14, color: "var(--text-muted)", padding: 8 }}>{t.adminStuNoClubs}</span>
                  )}
                  {activeClubs.map((club) => {
                    const currentClubIds = student.clubIds || [];
                    const isChecked = currentClubIds.includes(club.id);
                    const toggle = () =>
                      setStudent({
                        ...student,
                        clubIds: isChecked ? currentClubIds.filter((id) => id !== club.id) : [...currentClubIds, club.id],
                      });
                    return <CheckTile key={club.id} checked={isChecked} onChange={toggle} label={club.name} />;
                  })}
                </div>
              </fieldset>
            )}

            {/* SMO/ANUSMO titles are scoped independently (src/lib/positions.ts) —
                a student holding both roles at once gets one select per role, each
                with its own title. Club titles are edited per-club in admin/clubs's
                Members modal; major titles in admin/majors's Team panel. */}
            {hasRole("smo") && (
              <Field label={t.positionSMO}>
                {(p) => (
                  <select {...p} className="input" value={student.smoPosition || ""} onChange={(e) => setStudent({ ...student, smoPosition: e.target.value || null })}>
                    {positionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </Field>
            )}
            {hasRole("anusmo") && (
              <Field label={t.positionANUSMO}>
                {(p) => (
                  <select {...p} className="input" value={student.anusmoPosition || ""} onChange={(e) => setStudent({ ...student, anusmoPosition: e.target.value || null })}>
                    {positionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </Field>
            )}
          </div>
        </Panel>

        {/* Contact info — email/phone/contactChannels are only ever present on
            the student for a super_admin requester (the API strips them for
            everyone else), so this section is naturally invisible to the rest. */}
        {isSuperAdmin && (
          <Panel title={t.adminStuPanelContact} description={t.adminStuSuperAdminOnly}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label={t.email}>
                {(p) => <input {...p} className="input" value={student.email || ""} disabled readOnly style={{ opacity: 0.7, cursor: "not-allowed" }} />}
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <Field label={t.phone}>
                  {(p) => <input {...p} className="input" inputMode="tel" value={student.phone || ""} onChange={(e) => setStudent({ ...student, phone: e.target.value })} />}
                </Field>
                <Field label={t.contactChannels}>
                  {(p) => <input {...p} className="input" value={student.contactChannels || ""} onChange={(e) => setStudent({ ...student, contactChannels: e.target.value })} />}
                </Field>
              </div>
            </div>
          </Panel>
        )}

        {/* HN: shown only once the audited fetch in page.tsx has loaded it. */}
        {isSuperAdmin && student.hospitalNumber !== undefined && (
          <Panel title={t.adminStuPanelHospital} description={t.adminStuSuperAdminOnly}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <Field label={t.adminStuHospitalNumber}>
                {(p) => <input {...p} className="input" maxLength={30} value={student.hospitalNumber || ""} onChange={(e) => setStudent({ ...student, hospitalNumber: e.target.value })} />}
              </Field>
              {!!(student.hospitalNumber || "").trim() && (
                <Field label={t.adminStuHospitalName} required>
                  {(p) => <input {...p} className="input" maxLength={100} value={student.hospitalName || ""} onChange={(e) => setStudent({ ...student, hospitalName: e.target.value })} />}
                </Field>
              )}
            </div>
          </Panel>
        )}

        {/* Emergency contacts: super_admin only, shown once the audited fetch has loaded them
            (so a failed load never shows empty cards that would blank the real data on save). */}
        {isSuperAdmin && student.emergencyContacts != null && (
          <ContactsEditor
            contacts={student.emergencyContacts}
            onChange={(next) => setStudent({ ...student, emergencyContacts: next })}
          />
        )}
      </div>
    </Modal>
  );
}
