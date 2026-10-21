"use client";

import { BarChart3, Download, EyeOff, MessageSquare } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SubmissionsList({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { SUBMISSIONS_PER_PAGE, allFormQuestions, exportSubmissionsXlsx, formSubmissions, goToSubmissionsPage, lang, submissionsListRef, submissionsPage, t } = ctx;
  return (
    <div ref={submissionsListRef} style={{ scrollMarginTop: 80 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                        <h4 style={{ fontSize: 16, fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 6 }}><MessageSquare size={16} style={{ flexShrink: 0 }} /> {t.fbStudentSubmissions || "Student Submissions"} ({formSubmissions.length})</h4>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgb(var(--emerald-500-rgb) / 0.12)", color: "var(--emerald-500)", border: "none", cursor: formSubmissions.length === 0 ? "not-allowed" : "pointer", opacity: formSubmissions.length === 0 ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}
                          disabled={formSubmissions.length === 0}
                          onClick={exportSubmissionsXlsx}
                        >
                          <BarChart3 size={15} /> {lang === "th" ? "ส่งออก Excel (.xlsx)" : lang === "cn" ? "导出 Excel (.xlsx)" : lang === "mm" ? "Excel (.xlsx) ထုတ်ယူရန်" : "Export Excel (.xlsx)"}
                        </button>
                      </div>
                      {formSubmissions.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "60px 20px", border: "1px dashed var(--border-subtle)", borderRadius: 20 }}>
                          <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.fbNoSubmissionsYet || "No feedback submissions yet."}</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t.fbNoSubmissionsDesc || "Once students complete the form, their answers will appear here live!"}</p>
                        </div>
                      ) : (() => {
                        const totalPages = Math.max(1, Math.ceil(formSubmissions.length / SUBMISSIONS_PER_PAGE));
                        const currentPage = Math.min(submissionsPage, totalPages);
                        const start = (currentPage - 1) * SUBMISSIONS_PER_PAGE;
                        const pageSubs = formSubmissions.slice(start, start + SUBMISSIONS_PER_PAGE);
                        return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          {pageSubs.map((sub, sIdx) => (
                            <div
                              key={sub.id || (start + sIdx)}
                              style={{ 
                                background: "var(--bg-elevated)", 
                                border: "1px solid var(--border-subtle)", 
                                borderRadius: 20, 
                                padding: 24 
                              }}
                            >
                              {/* Header info */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "50%",
                                    background: sub.houseId === "red" ? "var(--red-house)" : sub.houseId === "green" ? "var(--green-house)" : sub.houseId === "yellow" ? "var(--yellow-house)" : "var(--blue-house)"
                                  }} />
                                  {sub.identityHidden ? (
                                    <span style={{ fontWeight: 800, fontSize: 15, fontStyle: "italic", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                                      <EyeOff size={13} /> {t.fbAnonymousRespondent || "Anonymous respondent"}
                                    </span>
                                  ) : (
                                    <>
                                      <span style={{ fontWeight: 800, fontSize: 15 }}>{sub.studentName}</span>
                                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>• {sub.studentId}</span>
                                    </>
                                  )}
                                  {sub.hasGraded && (
                                    <span style={{ fontSize: 12, fontWeight: 900, color: "var(--emerald-500)", background: "rgb(var(--emerald-500-rgb) / 0.1)", padding: "2px 10px", borderRadius: 999 }}>
                                      {lang === "th" ? "คะแนน" : lang === "cn" ? "得分" : lang === "mm" ? "ရမှတ်" : "Score"} {sub.score}/{sub.maxScore}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                                  {new Date(sub.submittedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>

                              {/* Answers */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                {allFormQuestions.map((q) => {
                                  const ans = sub.answers?.[q.id];
                                  return (
                                    <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{q.label}</span>
                                      {q.type === "file" ? (
                                        typeof ans === "string" && ans ? (
                                          <a
                                            href={`/api/forms/file/${sub.id}?q=${q.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", fontSize: 13, fontWeight: 800, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.08)", border: "1px solid rgb(var(--accent-rgb) / 0.15)", borderRadius: 10, padding: "8px 14px", textDecoration: "none" }}
                                          >
                                            <Download size={14} /> {(ans.split(".").pop() || "file").toUpperCase()} · {lang === "th" ? "เปิดไฟล์" : lang === "cn" ? "查看文件" : lang === "mm" ? "ဖိုင်ဖွင့်ရန်" : "Open file"}
                                          </a>
                                        ) : (
                                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}>
                                            {lang === "th" ? "ไม่มีไฟล์" : lang === "cn" ? "无文件" : lang === "mm" ? "ဖိုင်မရှိ" : "No file"}
                                          </span>
                                        )
                                      ) : q.type === "rating" ? (
                                        <div style={{ display: "flex", gap: 2, color: "var(--rating-star)" }}>
                                          {Array.from({ length: 5 }).map((_, starIdx) => (
                                            <span key={starIdx} style={{ fontSize: 16 }}>
                                               {starIdx < (typeof ans === "number" ? ans : typeof ans === "string" ? parseInt(ans) || 0 : 0) ? "★" : "☆"}
                                            </span>
                                          ))}
                                        </div>
                                      ) : Array.isArray(ans) ? (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                                          {ans.length > 0 ? (
                                            ans.map((item: string, itemIdx: number) => (
                                              <span
                                                key={itemIdx}
                                                style={{
                                                  fontSize: 12,
                                                  fontWeight: 800,
                                                  background: "rgb(var(--accent-rgb) / 0.08)",
                                                  color: "var(--accent-primary)",
                                                  padding: "4px 8px",
                                                  borderRadius: 8,
                                                  border: "1px solid rgb(var(--accent-rgb) / 0.15)"
                                                }}
                                              >
                                                {item}
                                              </span>
                                            ))
                                          ) : (
                                            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}>No selection</span>
                                          )}
                                        </div>
                                      ) : (
                                        <p style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500, whiteSpace: "pre-wrap" }}>
                                          {ans || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No answer</span>}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          {totalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="btn"
                                disabled={currentPage <= 1}
                                onClick={() => goToSubmissionsPage((p) => Math.max(1, p - 1))}
                                style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", cursor: currentPage <= 1 ? "not-allowed" : "pointer", opacity: currentPage <= 1 ? 0.5 : 1 }}
                              >
                                {lang === "th" ? "ก่อนหน้า" : lang === "cn" ? "上一页" : lang === "mm" ? "ယခင်" : "Previous"}
                              </button>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>
                                {(lang === "th" ? "หน้า" : lang === "cn" ? "第" : lang === "mm" ? "စာမျက်နှာ" : "Page")} {currentPage} / {totalPages}
                              </span>
                              <button
                                type="button"
                                className="btn"
                                disabled={currentPage >= totalPages}
                                onClick={() => goToSubmissionsPage((p) => Math.min(totalPages, p + 1))}
                                style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", cursor: currentPage >= totalPages ? "not-allowed" : "pointer", opacity: currentPage >= totalPages ? 0.5 : 1 }}
                              >
                                {lang === "th" ? "ถัดไป" : lang === "cn" ? "下一页" : lang === "mm" ? "နောက်တစ်ခု" : "Next"}
                              </button>
                            </div>
                          )}
                        </div>
                        );
                      })()}
                    </div>
  );
}
