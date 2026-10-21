"use client";

import { useEffect, useState } from "react";
import { ClipboardList, ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type PendingForm = {
  formId: string;
  eventId: string;
  eventTitle: string | null;
  formType: string;
  title: string;
};

// Rose / urgent palette — these are required, outstanding actions.
const ROSE = "var(--rose-600)";

/**
 * Persistent reminder of every form a student still owes (pre-test, post-test,
 * feedback) across all the events they've joined — shown on the Digital ID page
 * and the dashboard. Derived from the student's actual outstanding forms (via
 * /api/forms/pending), so it stays until each form is done and lists exactly which
 * event + which form is left, with a running count. Renders nothing when clear.
 */
export function FormsDueBanner({ userId }: { userId: string | undefined }) {
  const { t } = useLanguage();
  const [forms, setForms] = useState<PendingForm[]>([]);

  useEffect(() => {
    if (!userId) return;
    const ac = new AbortController();
    fetch("/api/forms/pending", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.forms)) setForms(d.forms);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [userId]);

  if (forms.length === 0) return null;

  const labelFor = (ft: string) =>
    ft === "K_pre"
      ? t.formTypePreTest
      : ft === "K_post"
        ? t.formTypePostTest
        : ft === "S"
          ? t.formTypeSkill
          : t.formTypeFeedback; // "A" and any other student-facing form

  return (
    <div
      className="animate-fade-in-up"
      style={{
        padding: 16,
        borderRadius: 18,
        background: "rgb(var(--rose-600-rgb) / 0.08)",
        border: `1.5px solid rgb(var(--rose-600-rgb) / 0.3)`,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header: icon + title/hint + count */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            flexShrink: 0,
            width: 42,
            height: 42,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgb(var(--rose-600-rgb) / 0.15)",
            color: ROSE,
          }}
        >
          <ClipboardList size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: ROSE, lineHeight: 1.25 }}>{t.formsDueTitle}</p>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginTop: 1 }}>
            {t.formsDueHint}
          </p>
        </div>
        <span
          aria-label={`${forms.length}`}
          style={{
            flexShrink: 0,
            minWidth: 28,
            height: 28,
            padding: "0 9px",
            borderRadius: 999,
            background: ROSE,
            color: "white",
            fontSize: 14,
            fontWeight: 900,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {forms.length}
        </span>
      </div>

      {/* One tappable row per outstanding form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {forms.map((f) => (
          <a
            key={f.formId}
            href={`/dashboard/history?form=${f.formId}&event=${f.eventId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              textDecoration: "none",
              color: "var(--text-primary)",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                padding: "3px 9px",
                borderRadius: 8,
                background: "rgb(var(--rose-600-rgb) / 0.12)",
                color: ROSE,
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
              }}
            >
              {labelFor(f.formType)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.title}
              </p>
              {f.eventTitle && (
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.eventTitle}
                </p>
              )}
            </div>
            <ArrowRight size={16} color={ROSE} style={{ flexShrink: 0 }} />
          </a>
        ))}
      </div>
    </div>
  );
}
