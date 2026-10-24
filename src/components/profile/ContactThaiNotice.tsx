"use client";

import { AlertTriangle, Info } from "lucide-react";

/**
 * Thai-script notice for the emergency-contact step. Like the name callout it is
 * always Thai, whatever the UI language is: when the student's own name is Thai we
 * already know their contacts (usually parents) are Thai citizens, and a switched
 * UI language was why they were typed in English.
 */
export function ContactThaiCallout() {
  return (
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
      <span lang="th">ผู้ติดต่อฉุกเฉินที่เป็นคนไทย กรุณากรอกชื่อ-นามสกุลและความสัมพันธ์เป็นภาษาไทย</span>
    </div>
  );
}

/** Inline warning under a contact that has Latin letters, with a one-click exit. */
export function ContactLatinWarning({ onKeep }: { onKeep: () => void }) {
  return (
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
          <span lang="th">ผู้ติดต่อที่เป็นคนไทยกรุณาพิมพ์เป็นภาษาไทย</span>
          {" / "}
          Thai contacts: please type in Thai
        </span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onKeep}>
        This contact is not Thai, keep English
      </button>
    </div>
  );
}
