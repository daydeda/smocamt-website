"use client";

import { forwardRef } from "react";

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required: becomes the accessible name and the hover tooltip. */
  label: string;
  icon: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
  /** md = 44px (default, touch-safe). sm = 36px, for dense desktop-only rows. */
  size?: "md" | "sm";
};

/** A button with only an icon. `label` is mandatory so it is never unnamed for screen readers. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = "neutral", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`adm-icon-btn adm-icon-btn-${tone} adm-icon-btn-${size}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
