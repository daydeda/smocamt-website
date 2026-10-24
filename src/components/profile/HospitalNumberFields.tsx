"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";

export type HospitalValue = { hospitalNumber: string; hospitalName: string };

/**
 * Optional HN (hospital number) + the hospital that issued it, shared by onboarding
 * and the profile editor. An HN is per hospital with no common format, so the only
 * rule is: if an HN is entered, the hospital name is needed too.
 */
export function HospitalNumberFields({
  value,
  onChange,
  validationTriggered,
}: {
  value: HospitalValue;
  onChange: (patch: Partial<HospitalValue>) => void;
  validationTriggered: boolean;
}) {
  const { t } = useLanguage();
  const missingHospital = validationTriggered && !!value.hospitalNumber.trim() && !value.hospitalName.trim();

  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <label className="label">{t.hospitalNumber}</label>
        <input
          className="input"
          name="hospitalNumber"
          maxLength={30}
          autoComplete="off"
          value={value.hospitalNumber}
          onChange={(e) => onChange({ hospitalNumber: e.target.value })}
        />
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>
          {t.hospitalNumberHint}
        </span>
      </div>
      {value.hospitalNumber.trim() && (
        <div className="field">
          <label className="label">
            {t.hospitalName} <span style={{ color: "var(--red-500)" }}>*</span>
          </label>
          <input
            className="input"
            name="hospitalName"
            maxLength={100}
            autoComplete="off"
            placeholder={t.hospitalNamePlaceholder}
            value={value.hospitalName}
            onChange={(e) => onChange({ hospitalName: e.target.value })}
            style={missingHospital ? { borderColor: "var(--red-500)", boxShadow: "0 0 0 1px var(--red-500)" } : undefined}
          />
          {missingHospital && (
            <span style={{ color: "var(--red-500)", fontSize: 12, fontWeight: 500, marginTop: 4 }}>{t.hospitalNameRequired}</span>
          )}
        </div>
      )}
    </div>
  );
}
