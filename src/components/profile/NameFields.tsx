"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { partsHaveLatin, sanitizeNameInput } from "@/lib/profile/name";

export type NameValue = {
  firstName: string;
  middleName: string;
  lastName: string;
  latinNameConfirmed: boolean;
};

/**
 * First / middle / last name inputs shared by onboarding and the profile editor.
 * The Thai-script notice is a visible callout in Thai whatever the UI language is
 * (students who switched to English skipped the old grey hint). Typing Latin
 * letters shows an inline warning with a one-click "keep English" exit for
 * international students; that choice is stored as latinNameConfirmed only.
 * `prefix` is rendered inline before the first-name input.
 */
export function NameFields({
  value,
  onChange,
  validationTriggered,
  prefix,
  disabled = false,
}: {
  value: NameValue;
  onChange: (patch: Partial<NameValue>) => void;
  validationTriggered: boolean;
  prefix?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const needsLatinConfirm = !value.latinNameConfirmed && partsHaveLatin(value);
  const bad = (v: string) => validationTriggered && !v.trim();
  const errStyle = (isBad: boolean) =>
    isBad ? { borderColor: "var(--red-500)", boxShadow: "0 0 0 1px var(--red-500)" } : undefined;
  const required = <span style={{ color: "var(--red-500)" }}>*</span>;

  return (
    <div className="flex flex-col gap-3">
      {!value.latinNameConfirmed && (
        <div
          role="note"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 12,
            background: "var(--accent-primary)14",
            border: "1px solid var(--accent-primary)40",
            color: "var(--text-primary)",
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          <Info size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--accent-primary)" }} />
          <span lang="th">คนไทยกรุณากรอกชื่อและนามสกุลเป็นภาษาไทย</span>
        </div>
      )}

      <div className="flex gap-3">
        {prefix}
        <div className="field flex-grow" style={{ minWidth: 0 }}>
          <label className="label">{t.firstName} {required}</label>
          <input
            className="input"
            name="firstName"
            autoComplete="given-name"
            disabled={disabled}
            value={value.firstName}
            onChange={(e) => onChange({ firstName: sanitizeNameInput(e.target.value) })}
            style={errStyle(bad(value.firstName))}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.middleName}</label>
          <input
            className="input"
            name="middleName"
            autoComplete="additional-name"
            disabled={disabled}
            value={value.middleName}
            onChange={(e) => onChange({ middleName: sanitizeNameInput(e.target.value) })}
          />
        </div>
        <div className="field flex-1" style={{ minWidth: 0 }}>
          <label className="label">{t.lastName} {required}</label>
          <input
            className="input"
            name="lastName"
            autoComplete="family-name"
            disabled={disabled}
            value={value.lastName}
            onChange={(e) => onChange({ lastName: sanitizeNameInput(e.target.value) })}
            style={errStyle(bad(value.lastName))}
          />
        </div>
      </div>

      {(bad(value.firstName) || bad(value.lastName)) && (
        <span style={{ color: "var(--red-500)", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {t.nameRequired}
        </span>
      )}

      {needsLatinConfirm && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            background: "var(--red-500)14",
            border: "1px solid var(--red-500)55",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--red-500)", display: "flex", gap: 6, alignItems: "center" }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>
              <span lang="th">คนไทยกรุณาพิมพ์ชื่อเป็นภาษาไทย</span>
              {" / "}
              Thai students: please type your name in Thai
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => onChange({ latinNameConfirmed: true })}
          >
            I&apos;m an international student, keep English
          </button>
        </div>
      )}
    </div>
  );
}
