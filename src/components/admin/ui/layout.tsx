"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Top of every admin page: one h1, an optional one-line purpose, and the page's
 * actions. The primary action goes LAST in `actions` (it renders right-most on
 * desktop and full-width-first on phones). Keep to 1 primary + ≤2 secondary.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Parent page, for detail screens. */
  back?: { href: string; label?: string };
  /** Badges or status next to the title. */
  meta?: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <header className="adm-page-header">
      <div style={{ minWidth: 0, flex: 1 }}>
        {back && (
          <Link href={back.href} className="adm-back-link">
            <ArrowLeft size={16} aria-hidden="true" />
            {back.label ?? t.adminUiBack}
          </Link>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="adm-page-title">{title}</h1>
          {meta}
        </div>
        {description && <p className="adm-page-desc">{description}</p>}
      </div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </header>
  );
}

/** A titled card that groups related content (Gestalt: common region). */
export function Panel({
  title,
  description,
  actions,
  icon,
  children,
  padded = true,
  className,
  style,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** false for edge-to-edge content such as a table. */
  padded?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`adm-panel${className ? ` ${className}` : ""}`} style={style}>
      {(title || actions) && (
        <div className="adm-panel-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            {title && (
              <h2 className="adm-panel-title">
                {icon && <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--accent-primary)" }}>{icon}</span>}
                {title}
              </h2>
            )}
            {description && <p className="adm-panel-desc">{description}</p>}
          </div>
          {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      <div className={padded ? "adm-panel-body" : undefined}>{children}</div>
    </section>
  );
}

/** Search + filters + secondary actions above a list. Wraps on narrow screens. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="adm-toolbar">{children}</div>;
}

/**
 * Wraps a <table className="data-table">. Scrolls sideways inside itself on
 * narrow screens instead of scrolling the whole page.
 */
export function TableScroll({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="adm-table-scroll" role={label ? "region" : undefined} aria-label={label} tabIndex={label ? 0 : undefined}>
      {children}
    </div>
  );
}
