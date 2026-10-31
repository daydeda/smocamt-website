"use client";

import { Download, EyeOff, FileDown, MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

const HOUSE_COLORS: Record<string, string> = {
  red: "var(--red-house)",
  green: "var(--green-house)",
  yellow: "var(--yellow-house)",
  blue: "var(--blue-house)",
};

export function SubmissionsList({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { SUBMISSIONS_PER_PAGE, allFormQuestions, exportSubmissionsXlsx, formSubmissions, goToSubmissionsPage, submissionsListRef, submissionsPage, t } = ctx;
  const totalPages = Math.max(1, Math.ceil(formSubmissions.length / SUBMISSIONS_PER_PAGE));
  const currentPage = Math.min(submissionsPage, totalPages);
  const start = (currentPage - 1) * SUBMISSIONS_PER_PAGE;
  const pageSubs = formSubmissions.slice(start, start + SUBMISSIONS_PER_PAGE);
  return (
    <div ref={submissionsListRef} role="region" aria-labelledby="evf-submissions" style={{ scrollMarginTop: 80 }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="evf-submissions" className="inline-flex items-center gap-2" style={{ fontSize: 16, fontWeight: 700 }}>
          <MessageSquare size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {t.fbStudentSubmissions} ({formSubmissions.length})
        </h3>
        <button type="button" className="btn btn-ghost" disabled={formSubmissions.length === 0} onClick={exportSubmissionsXlsx}>
          <FileDown size={16} aria-hidden="true" /> {t.adminEvfExport}
        </button>
      </div>
      {formSubmissions.length === 0 ? (
        <EmptyState title={t.fbNoSubmissionsYet} description={t.fbNoSubmissionsDesc} compact />
      ) : (
        <div className="flex flex-col gap-4">
          {pageSubs.map((sub, sIdx) => (
            <article
              key={sub.id || (start + sIdx)}
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 20 }}
            >
              {/* Header info */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 pb-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: HOUSE_COLORS[sub.houseId] ?? "var(--blue-house)" }} />
                  {sub.identityHidden ? (
                    <span className="inline-flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 15, fontStyle: "italic", color: "var(--text-muted)" }}>
                      <EyeOff size={14} aria-hidden="true" /> {t.fbAnonymousRespondent}
                    </span>
                  ) : (
                    <>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{sub.studentName}</span>
                      <span className="adm-field-hint">• {sub.studentId}</span>
                    </>
                  )}
                  {sub.hasGraded && (
                    <span className="adm-badge adm-tone-success">
                      {t.adminEvfScore} {sub.score}/{sub.maxScore}
                    </span>
                  )}
                </div>
                <span className="adm-field-hint">
                  {new Date(sub.submittedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              {/* Answers */}
              <dl className="m-0 flex flex-col gap-3">
                {allFormQuestions.map((q) => {
                  const ans = sub.answers?.[q.id];
                  const rating = typeof ans === "number" ? ans : typeof ans === "string" ? parseInt(ans) || 0 : 0;
                  return (
                    <div key={q.id} className="flex flex-col gap-1">
                      <dt style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{q.label}</dt>
                      <dd className="m-0">
                        {q.type === "file" ? (
                          typeof ans === "string" && ans ? (
                            <a
                              href={`/api/forms/file/${sub.id}?q=${q.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5"
                              style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.08)", border: "1px solid rgb(var(--accent-rgb) / 0.15)", textDecoration: "none" }}
                            >
                              <Download size={14} aria-hidden="true" /> {(ans.split(".").pop() || "file").toUpperCase()} · {t.adminEvfOpenFile}
                            </a>
                          ) : (
                            <span className="adm-field-hint" style={{ fontStyle: "italic" }}>{t.adminEvfNoFile}</span>
                          )
                        ) : q.type === "rating" ? (
                          <span className="inline-flex items-center gap-2" style={{ color: "var(--rating-star)" }}>
                            <span aria-hidden="true" style={{ fontSize: 16 }}>
                              {Array.from({ length: 5 }, (_, i) => (i < rating ? "★" : "☆")).join("")}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{rating}/5</span>
                          </span>
                        ) : Array.isArray(ans) ? (
                          ans.length > 0 ? (
                            <span className="flex flex-wrap gap-1.5">
                              {ans.map((item: string, itemIdx: number) => (
                                <span key={itemIdx} className="adm-badge adm-tone-accent" style={{ whiteSpace: "normal" }}>{item}</span>
                              ))}
                            </span>
                          ) : (
                            <span className="adm-field-hint" style={{ fontStyle: "italic" }}>{t.adminEvfNoSelection}</span>
                          )
                        ) : (
                          <span style={{ fontSize: 14, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                            {ans || <span className="adm-field-hint" style={{ fontStyle: "italic" }}>{t.adminEvfNoAnswer}</span>}
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))}
          {totalPages > 1 && (
            <nav aria-label={t.adminEvfPagination} className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <button type="button" className="btn btn-ghost" disabled={currentPage <= 1} onClick={() => goToSubmissionsPage((p) => Math.max(1, p - 1))}>
                {t.adminEvfPrev}
              </button>
              <span aria-live="polite" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t.adminEvfPageOf.replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}
              </span>
              <button type="button" className="btn btn-ghost" disabled={currentPage >= totalPages} onClick={() => goToSubmissionsPage((p) => Math.min(totalPages, p + 1))}>
                {t.adminEvfNext}
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
