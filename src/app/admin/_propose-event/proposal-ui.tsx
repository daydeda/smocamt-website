"use client";

// Small presentational pieces used only by ProposeEventSection. They keep the
// form's JSX short; none of them hold state or talk to the server.

import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

/** A whole-row checkbox: big target, optional hint, optional leading icon. */
export function ToggleRow({
  checked,
  onChange,
  label,
  hint,
  icon,
}: {
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: "100%",
        minHeight: 48,
        textAlign: "left",
        background: "var(--bg-elevated)",
        borderRadius: 14,
        display: "flex",
        alignItems: hint ? "flex-start" : "center",
        gap: 12,
        padding: hint ? "12px 16px" : "10px 16px",
        cursor: "pointer",
        border: checked ? "1px solid var(--accent-primary)" : "1px solid transparent",
        color: "inherit",
        font: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: 6,
          marginTop: hint ? 1 : 0,
          border: `2px solid ${checked ? "var(--accent-primary)" : "var(--border-medium)"}`,
          background: checked ? "var(--accent-primary)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <CheckCircle2 size={16} color="white" />}
      </span>
      {icon}
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: checked ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.5 }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{hint}</span>}
      </span>
    </button>
  );
}

const CHIP_TONES = {
  indigo: { bg: "rgb(var(--indigo-500-rgb) / 0.12)", fg: "var(--indigo-600)", border: "rgb(var(--indigo-500-rgb) / 0.5)" },
  accent: { bg: "rgb(var(--accent-rgb) / 0.12)", fg: "var(--accent-primary)", border: "rgb(var(--accent-rgb) / 0.5)" },
  violet: { bg: "rgb(var(--violet-500-rgb) / 0.12)", fg: "var(--violet-500)", border: "rgb(var(--violet-500-rgb) / 0.5)" },
} as const;

/** A pill that toggles on/off. The check mark means it never relies on colour alone. */
export function ChipToggle({
  selected,
  onClick,
  tone = "indigo",
  children,
}: {
  selected: boolean;
  onClick: () => void;
  tone?: keyof typeof CHIP_TONES;
  children: ReactNode;
}) {
  const c = CHIP_TONES[tone];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        padding: "6px 14px",
        borderRadius: 99,
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        background: selected ? c.bg : "var(--bg-elevated)",
        color: selected ? c.fg : "var(--text-secondary)",
        border: `1px solid ${selected ? c.border : "transparent"}`,
      }}
    >
      {selected && <CheckCircle2 size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Wraps an <input className="input"> with a leading icon. The input needs paddingLeft: 44. */
export function IconInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden="true"
        style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", display: "inline-flex", pointerEvents: "none" }}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}

/** A group label for a set of related toggles/chips that share one visible heading. */
export function GroupLabel({ id, children, hint }: { id: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p id={id} className="adm-field-label">{children}</p>
      {hint && <p className="adm-field-hint" style={{ marginTop: 2 }}>{hint}</p>}
    </div>
  );
}
