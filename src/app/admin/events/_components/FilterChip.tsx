"use client";

import { Check } from "lucide-react";

/**
 * A toggle filter. State is shown by a check icon and aria-pressed as well as
 * colour, so it never relies on colour alone.
 */
export function FilterChip({
  active,
  onClick,
  icon,
  children,
  tone = "accent",
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "accent" | "danger";
}) {
  const color = tone === "danger" ? "var(--red-600)" : "var(--accent-primary)";
  const bg = tone === "danger" ? "rgb(var(--red-500-rgb) / 0.1)" : "var(--accent-glow)";
  return (
    <button
      type="button"
      aria-pressed={active}
      className="btn btn-ghost"
      style={{
        borderRadius: 99,
        padding: "6px 14px",
        fontSize: 13,
        ...(active ? { borderColor: color, background: bg, color } : null),
      }}
      onClick={onClick}
    >
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{active ? <Check size={14} /> : icon}</span>
      {children}
    </button>
  );
}
