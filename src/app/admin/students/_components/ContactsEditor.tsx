"use client";

import { ShieldAlert } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { ContactNameFields } from "@/components/profile/ContactNameFields";
import { formatPhone, phoneDigits } from "@/lib/profile/phone";

export type EditableContact = {
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickname?: string;
  relationship: string;
  phone: string;
  latinNameConfirmed?: boolean;
};

export const EMPTY_CONTACT: EditableContact = {
  name: "", firstName: "", middleName: "", lastName: "", nickname: "", relationship: "", phone: "",
};

const KNOWN = ["", "Father", "Mother", "Guardian", "Sibling", "Relative", "Friend"];

/**
 * Emergency-contact editor for the super_admin student edit modal. Two slots (the second is
 * optional); an empty card is dropped by the server. No Thai-script nagging here: the admin is
 * correcting data, and the server marks a Latin-script contact as confirmed.
 */
export function ContactsEditor({
  contacts,
  onChange,
}: {
  contacts: EditableContact[];
  onChange: (next: EditableContact[]) => void;
}) {
  const { t } = useLanguage();
  const slots = [0, 1].map((i) => contacts[i] ?? EMPTY_CONTACT);
  const update = (i: number, next: EditableContact) => {
    const copy = [0, 1].map((k) => contacts[k] ?? EMPTY_CONTACT);
    copy[i] = next;
    onChange(copy);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, background: "var(--bg-elevated)", borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldAlert size={14} style={{ color: "var(--red-500)" }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {t.emergencyContacts} (Super Admin only)
        </span>
      </div>
      {slots.map((c, i) => {
        const isCustom = c.relationship.startsWith("Other:") || !KNOWN.includes(c.relationship);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: i === 1 ? 12 : 0, borderTop: i === 1 ? "1px dashed var(--border-subtle)" : undefined }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}>#{i + 1}{i === 1 ? " (optional)" : ""}</span>
            <ContactNameFields
              value={c}
              onChange={(next) => update(i, { ...c, ...next })}
              required={i === 0}
              validationTriggered={false}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="field flex-1" style={{ minWidth: 0 }}>
                <label className="label">{t.relationship}</label>
                <select
                  className="input"
                  value={isCustom && c.relationship ? "Other" : c.relationship}
                  onChange={(e) => update(i, { ...c, relationship: e.target.value === "Other" ? "Other:" : e.target.value })}
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
                {isCustom && c.relationship !== "" && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    value={c.relationship.startsWith("Other:") ? c.relationship.slice(6) : c.relationship}
                    onChange={(e) => update(i, { ...c, relationship: "Other:" + e.target.value })}
                  />
                )}
              </div>
              <div className="field flex-1" style={{ minWidth: 0 }}>
                <label className="label">{t.phone}</label>
                <input
                  className="input"
                  inputMode="tel"
                  placeholder="081-xxx-xxxx"
                  value={formatPhone(c.phone)}
                  onChange={(e) => update(i, { ...c, phone: phoneDigits(e.target.value) })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
