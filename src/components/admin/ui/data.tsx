"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, Clock, Info, Minus, XCircle } from "lucide-react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/**
 * One number with its meaning. `hint` answers "so what?" (vs. last month,
 * pending, target). Pass `href` only when the card leads somewhere: only then
 * does it look and act clickable.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  trend,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  trend?: { direction: "up" | "down" | "flat"; text: string; title?: string };
  href?: string;
}) {
  const body = (
    <>
      <div className="adm-stat-top">
        <p className="adm-stat-label">{label}</p>
        {icon && <span className={`adm-stat-icon adm-tone-${tone}`} aria-hidden="true">{icon}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <p className="adm-stat-value">{value}</p>
        {trend && (
          <span className={`adm-stat-trend adm-stat-trend-${trend.direction}`} title={trend.title}>
            {trend.direction === "up" ? <ArrowUpRight size={14} aria-hidden="true" /> : trend.direction === "down" ? <ArrowDownRight size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
            {trend.text}
          </span>
        )}
      </div>
      {hint && <p className="adm-stat-hint">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="adm-stat adm-stat-link">{body}</Link>
  ) : (
    <div className="adm-stat">{body}</div>
  );
}

const BADGE_ICON: Record<Tone, React.ReactNode> = {
  neutral: <Circle size={12} />,
  accent: <Circle size={12} />,
  success: <CheckCircle2 size={12} />,
  warning: <Clock size={12} />,
  danger: <XCircle size={12} />,
  info: <Info size={12} />,
};

/**
 * Status pill. Colour is never the only signal: each tone carries an icon and
 * the text itself. Pass `icon={false}` only when the text alone is unambiguous.
 */
export function StatusBadge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: React.ReactNode | false; children: React.ReactNode }) {
  return (
    <span className={`adm-badge adm-tone-${tone}`}>
      {icon !== false && <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon ?? BADGE_ICON[tone]}</span>}
      {children}
    </span>
  );
}

export type TabItem<T extends string> = { id: T; label: string; icon?: React.ReactNode; count?: number };

/**
 * Accessible tab bar (arrow keys, Home/End). Render the active panel yourself
 * inside <TabPanel>. Scrolls sideways on phones instead of wrapping.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idBase,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Shared with the matching <TabPanel idBase>. */
  idBase: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className="adm-tabs">
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`adm-tab${selected ? " adm-tab-active" : ""}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.icon && <span aria-hidden="true" style={{ display: "inline-flex" }}>{tab.icon}</span>}
            {tab.label}
            {typeof tab.count === "number" && <span className="adm-tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, id, children }: { idBase: string; id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className="adm-tabpanel">
      {children}
    </div>
  );
}

/**
 * Label + control + hint + error, wired for screen readers. The child control
 * receives the id via render prop so the <label> is programmatically linked.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label htmlFor={id} className="adm-field-label">
        {label}
        {required && <span className="adm-required" aria-hidden="true"> *</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })}
      {hint && !error && <p id={hintId} className="adm-field-hint">{hint}</p>}
      {error && <p id={errId} className="adm-field-error" role="alert">{error}</p>}
    </div>
  );
}
