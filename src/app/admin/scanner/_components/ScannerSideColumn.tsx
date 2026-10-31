"use client";

import { useState } from "react";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { Field, Panel } from "@/components/admin/ui";
import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

// Manual lookup: the fallback when a QR won't scan or the camera is unusable.
// Student ID is the default (numeric keypad on phones); Name switches to the
// normal keyboard. Both feed the same search.
export function ScannerSideColumn({ ctx }: { ctx: ScannerScreenCtx }) {
  const { checkingIn, handleManualSearch, manualCheckIn, manualResults, manualSearch, manualStatus, scanMode, t } = ctx;
  const [by, setBy] = useState<"id" | "name">("id");

  const options = [
    { id: "id" as const, label: t.adminScnByStudentId },
    { id: "name" as const, label: t.adminScnByName },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel
        title={scanMode === "score" ? t.adminScnManualScoreTitle : t.adminScnManualTitle}
        icon={<Search size={18} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div role="group" aria-label={t.adminScnSearchBy} style={{ display: "flex", gap: 8 }}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={by === o.id}
                onClick={() => setBy(o.id)}
                className={`btn ${by === o.id ? "btn-primary" : "btn-ghost"}`}
                style={{ flex: 1, minHeight: 44 }}
              >
                {o.label}
              </button>
            ))}
          </div>

          <Field label={by === "id" ? t.adminScnManualIdLabel : t.adminScnManualNameLabel} hint={t.adminScnManualHint}>
            {(p) => (
              <input
                {...p}
                data-scanner-manual=""
                className="input"
                type="search"
                inputMode={by === "id" ? "numeric" : "text"}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                style={{ minHeight: 48, fontSize: 18 }}
                value={manualSearch}
                onChange={(e) => handleManualSearch(e.target.value)}
              />
            )}
          </Field>

          <div aria-live="polite">
            {manualStatus === "loading" && (
              <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{t.adminScnSearching}</p>
            )}
            {manualStatus === "error" && (
              <p role="alert" style={{ fontSize: 14, fontWeight: 700, color: "var(--red-600)" }}>{t.adminScnSearchFailed}</p>
            )}
            {manualStatus === "done" && manualResults.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{t.adminScnNoMatch.replace("{q}", manualSearch)}</p>
            )}
          </div>

          {manualResults.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {manualResults.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => manualCheckIn(s.id)}
                    disabled={checkingIn === s.id}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      minHeight: 64,
                      padding: "12px 16px",
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      cursor: checkingIn === s.id ? "wait" : "pointer",
                      opacity: checkingIn === s.id ? 0.6 : 1,
                      font: "inherit",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 16, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>{s.name}</span>
                      <span style={{ display: "block", fontSize: 14, color: "var(--text-secondary)", marginTop: 2 }}>{s.studentId}</span>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Reassurance for staff and students: every scan is logged. */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "0 4px" }}>
        <ShieldCheck size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <b>{t.immutableLogsBadge.replace("🔒 ", "")}</b> {t.auditAlertText}
        </p>
      </div>
    </div>
  );
}
