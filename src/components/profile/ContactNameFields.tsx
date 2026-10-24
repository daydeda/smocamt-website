"use client";

import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { contactHasName, sanitizeNameInput, withComposedName } from "@/lib/profile/name";

export type ContactNameValue = {
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickname?: string;
};

/**
 * Emergency-contact name inputs shared by onboarding and the profile editor: first
 * and last name required, middle name and nickname optional. Every change also
 * rebuilds the display `name`, so everything that reads `name` keeps working.
 */
export function ContactNameFields({
  value,
  onChange,
  required,
  validationTriggered,
}: {
  value: ContactNameValue;
  onChange: (next: ContactNameValue) => void;
  required: boolean;
  validationTriggered: boolean;
}) {
  const { t } = useLanguage();
  const set = (patch: Partial<ContactNameValue>) => onChange(withComposedName({ ...value, ...patch }));
  const missing = (v: string | undefined) => validationTriggered && required && !(v ?? "").trim();
  const errStyle = (bad: boolean) =>
    bad ? { borderColor: "var(--red-500)", boxShadow: "0 0 0 1px var(--red-500)" } : undefined;
  const star = required ? <span style={{ color: "var(--red-500)" }}>*</span> : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.firstName} {star}</label>
          <input
            className="input"
            autoComplete="off"
            value={value.firstName ?? ""}
            onChange={(e) => set({ firstName: sanitizeNameInput(e.target.value) })}
            style={errStyle(missing(value.firstName))}
          />
        </div>
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.lastName} {star}</label>
          <input
            className="input"
            autoComplete="off"
            value={value.lastName ?? ""}
            onChange={(e) => set({ lastName: sanitizeNameInput(e.target.value) })}
            style={errStyle(missing(value.lastName))}
          />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.middleName}</label>
          <input
            className="input"
            autoComplete="off"
            value={value.middleName ?? ""}
            onChange={(e) => set({ middleName: sanitizeNameInput(e.target.value) })}
          />
        </div>
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.nicknameOptional}</label>
          <input
            className="input"
            autoComplete="off"
            value={value.nickname ?? ""}
            onChange={(e) => set({ nickname: sanitizeNameInput(e.target.value) })}
          />
        </div>
      </div>
      {validationTriggered && required && !contactHasName(value) && (
        <span style={{ color: "var(--red-500)", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {t.nameRequired}
        </span>
      )}
    </div>
  );
}
