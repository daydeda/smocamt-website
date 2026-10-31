"use client";

// Small shared controls for the event form. Every selectable thing here is a
// real native checkbox/radio inside a <label>, so it is keyboard- and
// screen-reader-correct, the whole row is the click target (>= 44px), and the
// state is always readable as words or a ticked box, never colour alone.

import { CheckCircle2, ChevronDown, Filter, Lock } from "lucide-react";
import { useId } from "react";
import { alpha } from "@/lib/ui/color";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const DEFAULT_ACCENT = "var(--accent-primary)";

/** A full-width checkbox/radio row with a title and an optional hint. */
export function OptionRow({
  type = "checkbox",
  name,
  checked,
  onChange,
  disabled,
  title,
  hint,
  icon,
  showState,
  accent = DEFAULT_ACCENT,
}: {
  type?: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Spell the state out ("On" / "Off") at the right edge, for toggles. */
  showState?: boolean;
  accent?: string;
}) {
  const { t } = useLanguage();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 items-start gap-3 rounded-[12px] px-4 py-3"
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${checked ? accent : "var(--border-subtle)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        transition: "border-color 0.15s",
      }}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0, accentColor: accent }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)" }}>
          {icon && <span aria-hidden="true" style={{ display: "inline-flex", color: checked ? accent : "var(--text-muted)" }}>{icon}</span>}
          {title}
        </span>
        {hint && <span id={hintId} className="adm-field-hint">{hint}</span>}
      </span>
      {showState && (
        <span
          className="shrink-0 rounded-full px-2.5"
          style={{
            fontSize: 12,
            fontWeight: 700,
            lineHeight: "22px",
            marginTop: 1,
            color: checked ? accent : "var(--text-muted)",
            background: checked ? alpha(accent, 0.12) : "var(--bg-surface)",
            border: `1px solid ${checked ? alpha(accent, 0.35) : "var(--border-subtle)"}`,
          }}
        >
          {checked ? t.adminEvfOn : t.adminEvfOff}
        </span>
      )}
    </label>
  );
}

/** A compact tick-chip for choosing several items from a list (roles, majors, clubs). */
export function ChipCheck({
  checked,
  onChange,
  disabled,
  accent = DEFAULT_ACCENT,
  title,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  accent?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      title={title}
      className="inline-flex min-h-11 items-center gap-2 rounded-[12px] px-3"
      style={{
        background: checked ? alpha(accent, 0.12) : "var(--bg-elevated)",
        border: `1px solid ${checked ? alpha(accent, 0.55) : "var(--border-subtle)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, flexShrink: 0, accentColor: accent }}
      />
      <span style={{ fontSize: 13, fontWeight: checked ? 700 : 600, lineHeight: 1.5, color: "var(--text-primary)" }}>{children}</span>
    </label>
  );
}

/**
 * A titled group of related controls (a real <fieldset>/<legend>). `locked`
 * disables everything inside and says why, so a role that cannot edit the
 * group sees a clear reason rather than a faded-out block.
 */
export function ChoiceFieldset({
  legend,
  hint,
  icon,
  locked,
  badge,
  children,
}: {
  legend: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  locked?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="adm-field-label mb-1 flex items-center gap-2 p-0">
        {icon && <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--accent-primary)" }}>{icon}</span>}
        {legend}
        {badge}
      </legend>
      {hint && <p className="adm-field-hint">{hint}</p>}
      {locked && (
        <p className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: "var(--warn-text)" }}>
          <Lock size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
          {t.eventStaffOnlyFieldHint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

/**
 * One-line, plain-words summary of the current choice ("Open to all roles",
 * "Restricted to: SE, DG"). Icon + text, wraps for long lists.
 */
export function SelectionSummary({ restricted, children }: { restricted: boolean; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 self-start rounded-[12px] px-3 py-2 adm-tone-${restricted ? "info" : "success"}`}
      style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", marginTop: 3, flexShrink: 0 }}>
        {restricted ? <Filter size={15} /> : <CheckCircle2 size={15} />}
      </span>
      <span className="min-w-0" style={{ overflowWrap: "anywhere" }}>{children}</span>
    </p>
  );
}

/** Required marker for labels whose control must not get a native `required` attribute. */
export function ReqMark() {
  return <span className="adm-required" aria-hidden="true"> *</span>;
}

/** Rare or advanced options behind a native disclosure. `summary` stays visible when closed. */
export function Disclosure({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: React.ReactNode;
  /** What is currently set, shown while collapsed so nothing is hidden. */
  summary?: React.ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="group overflow-hidden rounded-[12px]"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
    >
      <summary
        className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"
        style={{ listStyle: "none", background: "var(--bg-elevated)" }}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)" }}>{title}</span>
          {summary && <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>{summary}</span>}
        </span>
        <ChevronDown size={18} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" style={{ color: "var(--text-muted)" }} />
      </summary>
      <div className="flex flex-col gap-5 p-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>{children}</div>
    </details>
  );
}

/** Wrap the stacked contents of a Panel with a consistent rhythm. */
export function Stack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}
