"use client";

import { ChevronDown, ChevronUp, CornerDownRight, Plus, Trash2 } from "lucide-react";
import { BRANCH_NEXT, BRANCH_SUBMIT } from "@/lib/forms/form-schema";
import { autoGrowTextarea } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SectionsEditor({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { addOption, addQuestion, addSection, allFormQuestions, formSections, lang, moveSection, removeOption, removeQuestion, removeSection, setBranch, setChoiceCorrect, setPoints, setTextCorrect, setVisibleIf, t, toggleGraded, toggleMultipleCorrect, updateOption, updateQuestion, updateSection } = ctx;
  return (
    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <h4 style={{ fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "var(--accent-primary)", color: "var(--text-on-color)", fontSize: 12 }}>{allFormQuestions.length}</span>
                          {lang === "th" ? "ส่วนและคำถาม" : lang === "cn" ? "章节与问题" : lang === "mm" ? "အပိုင်းများနှင့် မေးခွန်းများ" : "Sections & Questions"}
                        </h4>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-500)", border: "none", cursor: "pointer" }}
                          onClick={addSection}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} style={{ flexShrink: 0 }} /> {lang === "th" ? "เพิ่มส่วน" : lang === "cn" ? "添加章节" : lang === "mm" ? "အပိုင်းထည့်ရန်" : "Add Section"}</span>
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                        {formSections.map((section, sIdx) => (
                          <div key={section.id} style={{ background: "rgb(var(--indigo-500-rgb) / 0.04)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.2)", borderRadius: 24, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                            {/* Section header */}
                            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 900, color: "var(--indigo-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                  {(lang === "th" ? "ส่วนที่ " : lang === "cn" ? "第 " : lang === "mm" ? "အပိုင်း " : "Section ")}{sIdx + 1}{formSections.length > 1 ? ` / ${formSections.length}` : ""}
                                </span>
                                <input
                                  type="text"
                                  className="input"
                                  style={{ height: 40, borderRadius: 10, padding: "0 12px", fontWeight: 800 }}
                                  value={section.title || ""}
                                  onChange={e => updateSection(section.id, "title", e.target.value)}
                                  placeholder={lang === "th" ? "ชื่อส่วน (ไม่บังคับ)" : lang === "cn" ? "章节标题（可选）" : lang === "mm" ? "အပိုင်းခေါင်းစဉ် (ရွေးချယ်ႏိုင်)" : "Section title (optional)"}
                                />
                                <textarea
                                  ref={autoGrowTextarea}
                                  className="input"
                                  rows={1}
                                  style={{ minHeight: 36, borderRadius: 10, padding: "8px 12px", fontSize: 13, resize: "none", overflow: "hidden", fontFamily: "inherit", lineHeight: 1.4 }}
                                  value={section.description || ""}
                                  onChange={e => { updateSection(section.id, "description", e.target.value); autoGrowTextarea(e.target); }}
                                  placeholder={lang === "th" ? "คำอธิบายส่วน (ไม่บังคับ)" : lang === "cn" ? "章节描述（可选）" : lang === "mm" ? "အပိုင်းဖော်ပြချက် (ရွေးချယ်ႏိုင်)" : "Section description (optional)"}
                                />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <button type="button" className="btn btn-ghost" style={{ width: 36, height: 32, padding: 0, borderRadius: 8 }} disabled={sIdx === 0} onClick={() => moveSection(section.id, -1)} title="Move up">
                                  <ChevronUp size={16} />
                                </button>
                                <button type="button" className="btn btn-ghost" style={{ width: 36, height: 32, padding: 0, borderRadius: 8 }} disabled={sIdx === formSections.length - 1} onClick={() => moveSection(section.id, 1)} title="Move down">
                                  <ChevronDown size={16} />
                                </button>
                                <button type="button" className="btn btn-danger" style={{ width: 36, height: 32, padding: 0, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => removeSection(section.id)} title="Delete section">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Questions in this section */}
                            {section.questions.length === 0 ? (
                              <div style={{ textAlign: "center", padding: "24px 16px", background: "var(--bg-elevated)", borderRadius: 16, border: "1px dashed var(--border-subtle)", color: "var(--text-muted)", fontSize: 13 }}>
                                {lang === "th" ? "ยังไม่มีคำถามในส่วนนี้" : lang === "cn" ? "本章节暂无问题" : lang === "mm" ? "ဤအပိုင်းတွင် မေးခွန်းမရှိသေးပါ" : "No questions in this section yet."}
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                {section.questions.map((q, idx) => {
                                  const gradable = q.type === "choice" || q.type === "multiple" || q.type === "text";
                                  // Questions that can drive this one's visibility: other
                                  // choice/multiple questions in the same section that have options.
                                  const controllers = section.questions.filter(
                                    x => x.id !== q.id && (x.type === "choice" || x.type === "multiple") && (x.options?.length ?? 0) > 0
                                  );
                                  const controllerQ = q.visibleIf ? section.questions.find(x => x.id === q.visibleIf!.questionId) : undefined;
                                  return (
                                  <div
                                    key={q.id || idx}
                                    style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-elevated)", padding: "20px", borderRadius: 20, border: q.graded ? "1px solid rgb(var(--emerald-500-rgb) / 0.4)" : "1px solid var(--border-subtle)" }}
                                  >
                                    {/* Question Main Controls Row */}
                                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: "1 1 auto", width: "100%" }}>
                                        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text-muted)", width: 20, paddingTop: 9 }}>{idx + 1}.</span>
                                        <textarea
                                          ref={autoGrowTextarea}
                                          className="input"
                                          rows={1}
                                          style={{ flex: 1, minHeight: 40, borderRadius: 10, padding: "9px 12px", resize: "none", overflow: "hidden", fontFamily: "inherit", lineHeight: 1.4 }}
                                          value={q.label}
                                          onChange={e => { updateQuestion(section.id, q.id, "label", e.target.value); autoGrowTextarea(e.target); }}
                                          placeholder={lang === "th" ? "ข้อความคำถาม..." : lang === "cn" ? "问题内容..." : lang === "mm" ? "မေးခွန်းစာသား..." : "Question Text..."}
                                        />
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", width: "100%", justifyContent: "flex-end" }} className="md:w-auto">
                                        <select
                                          className="input"
                                          style={{ height: 40, borderRadius: 10, padding: "0 12px", background: "var(--bg-surface)", cursor: "pointer", fontWeight: 700, fontSize: 13, flex: "1 1 auto", minWidth: 160 }}
                                          value={q.type}
                                          onChange={e => updateQuestion(section.id, q.id, "type", e.target.value)}
                                        >
                                          <option value="text">{lang === "th" ? "คำตอบแบบยาว" : lang === "cn" ? "长答题" : lang === "mm" ? "စာသားအဖြေရှည်" : "Long Answer"}</option>
                                          <option value="rating">{lang === "th" ? "คะแนนเรตติ้ง (1-5 ดาว)" : lang === "cn" ? "评分 (1-5 星)" : lang === "mm" ? "ကြယ်ပွင့်အဆင့်သတ်မှတ်ချက် (၁-၅)" : "Rating (1-5 Star)"}</option>
                                          <option value="choice">{lang === "th" ? "หลายตัวเลือก (เลือกได้ 1 ข้อ)" : lang === "cn" ? "单选题" : lang === "mm" ? "ရွေးချယ်စရာများစွာ (တစ်ခုရွေးရန်)" : "Multiple Choice"}</option>
                                          <option value="multiple">{lang === "th" ? "เครื่องหมายเลือก (เลือกได้หลายข้อ)" : lang === "cn" ? "多选题" : lang === "mm" ? "ရွေးချယ်စရာများစွာ (အများကြီးရွေးရန်)" : "Checkbox"}</option>
                                          <option value="file">{lang === "th" ? "อัปโหลดไฟล์ (รูปภาพ/PDF)" : lang === "cn" ? "文件上传（图片/PDF）" : lang === "mm" ? "ဖိုင်တင်ခြင်း (ပုံ/PDF)" : "File Upload (Image/PDF)"}</option>
                                        </select>
                                        <button
                                          type="button"
                                          style={{ padding: "6px 12px", height: 40, borderRadius: 10, border: "none", background: q.required ? "rgb(var(--emerald-500-rgb) / 0.1)" : "rgb(var(--ink-rgb) / 0.03)", color: q.required ? "var(--emerald-500)" : "var(--text-muted)", whiteSpace: "nowrap", fontWeight: 800, fontSize: 11, cursor: "pointer" }}
                                          onClick={() => updateQuestion(section.id, q.id, "required", !q.required)}
                                        >
                                          {q.required ? t.eventRequiredLabel : (lang === "th" ? "ไม่บังคับ" : lang === "cn" ? "选填" : lang === "mm" ? "ရွေးချယ်နိုင်သည်" : "Optional")}
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-danger"
                                          style={{ width: 40, height: 40, padding: 0, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                                          onClick={() => removeQuestion(section.id, q.id)}
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Options builder (choice/multiple) with correct-answer marking + branching */}
                                    {(q.type === "choice" || q.type === "multiple") && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 32, borderTop: "1px dashed var(--border-subtle)", paddingTop: 16 }}>
                                        <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                          {lang === "th" ? "ตัวเลือกคำตอบ" : lang === "cn" ? "选项设置" : lang === "mm" ? "ရွေးချယ်စရာများ" : "Answer Options"}
                                          {q.graded && <span style={{ color: "var(--emerald-500)", marginLeft: 8 }}>{lang === "th" ? "• แตะวงกลมเพื่อตั้งคำตอบที่ถูก" : lang === "cn" ? "• 点击圆圈设为正确答案" : lang === "mm" ? "• မှန်ကန်သောအဖြေသတ်မှတ်ရန် နှိပ်ပါ" : "• tap the circle to mark the correct answer"}</span>}
                                        </span>
                                        {q.options?.map((opt: string, optIdx: number) => {
                                          const isCorrect = q.type === "choice" ? q.correct === opt : Array.isArray(q.correct) && q.correct.includes(opt);
                                          return (
                                          <div key={optIdx} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (!q.graded) return;
                                                if (q.type === "choice") setChoiceCorrect(section.id, q.id, opt);
                                                else toggleMultipleCorrect(section.id, q.id, opt);
                                              }}
                                              title={q.graded ? "Mark correct" : undefined}
                                              style={{ width: 22, height: 22, borderRadius: q.type === "choice" ? "50%" : 6, border: `2px solid ${isCorrect ? "var(--emerald-500)" : "var(--border-medium)"}`, background: isCorrect ? "var(--emerald-500)" : "transparent", color: "var(--text-on-color)", cursor: q.graded ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}
                                            >
                                              {isCorrect ? "✓" : ""}
                                            </button>
                                            <input
                                              type="text"
                                              className="input"
                                              style={{ flex: "1 1 160px", height: 36, borderRadius: 8, padding: "0 12px", fontSize: 13 }}
                                              value={opt}
                                              onChange={e => updateOption(section.id, q.id, optIdx, e.target.value)}
                                              placeholder={`Option ${optIdx + 1}`}
                                            />
                                            {/* Per-option branching (single-choice only) */}
                                            {q.type === "choice" && formSections.length > 1 && (
                                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <CornerDownRight size={14} style={{ color: "var(--text-muted)" }} />
                                                <select
                                                  className="input"
                                                  style={{ height: 36, borderRadius: 8, padding: "0 8px", fontSize: 12, background: "var(--bg-surface)", cursor: "pointer", maxWidth: 200 }}
                                                  value={q.branches?.[opt] ?? BRANCH_NEXT}
                                                  onChange={e => setBranch(section.id, q.id, opt, e.target.value)}
                                                >
                                                  <option value={BRANCH_NEXT}>{lang === "th" ? "ไปส่วนถัดไป" : lang === "cn" ? "继续下一节" : lang === "mm" ? "နောက်အပိုင်းသို့" : "Continue to next section"}</option>
                                                  {formSections.map((s, i) => (
                                                    <option key={s.id} value={s.id} disabled={s.id === section.id}>
                                                      {(lang === "th" ? "ไปส่วนที่ " : lang === "cn" ? "前往第 " : lang === "mm" ? "အပိုင်း " : "Go to section ")}{i + 1}{s.title ? `: ${s.title}` : ""}
                                                    </option>
                                                  ))}
                                                  <option value={BRANCH_SUBMIT}>{lang === "th" ? "ส่งแบบฟอร์ม" : lang === "cn" ? "提交表单" : lang === "mm" ? "ဖောင်တင်ရန်" : "Submit form"}</option>
                                                </select>
                                              </div>
                                            )}
                                            <button
                                              type="button"
                                              className="btn btn-ghost"
                                              style={{ width: 36, height: 36, padding: 0, color: "var(--red-500)", borderRadius: 8, fontSize: 14, fontWeight: 800 }}
                                              onClick={() => removeOption(section.id, q.id, optIdx)}
                                              disabled={!q.options || q.options.length <= 1}
                                            >
                                              ✕
                                            </button>
                                          </div>
                                          );
                                        })}
                                        <button
                                          type="button"
                                          className="btn btn-ghost"
                                          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 800, color: "var(--accent-primary)", padding: "4px 12px", height: 32, borderRadius: 8, marginTop: 4 }}
                                          onClick={() => addOption(section.id, q.id)}
                                        >
                                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={12} style={{ flexShrink: 0 }} /> {lang === "th" ? "เพิ่มตัวเลือก" : lang === "cn" ? "添加选项" : lang === "mm" ? "ရွေးချယ်စရာထည့်ရန်" : "Add Option"}</span>
                                        </button>
                                      </div>
                                    )}

                                    {/* Grading controls */}
                                    {gradable && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingLeft: 32, borderTop: "1px dashed var(--border-subtle)", paddingTop: 16 }}>
                                        <button
                                          type="button"
                                          onClick={() => toggleGraded(section.id, q.id)}
                                          style={{ padding: "6px 14px", height: 36, borderRadius: 10, border: "none", background: q.graded ? "rgb(var(--emerald-500-rgb) / 0.12)" : "rgb(var(--ink-rgb) / 0.03)", color: q.graded ? "var(--emerald-500)" : "var(--text-muted)", fontWeight: 800, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                        >
                                          {q.graded ? "✓ " : ""}{lang === "th" ? "ให้คะแนน" : lang === "cn" ? "计分" : lang === "mm" ? "အမှတ်ပေး" : "Graded"}
                                        </button>
                                        {q.graded && (
                                          <>
                                            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                                              {lang === "th" ? "คะแนน" : lang === "cn" ? "分值" : lang === "mm" ? "အမှတ်" : "Points"}
                                              <input
                                                type="number"
                                                min={1}
                                                className="input"
                                                style={{ width: 72, height: 36, borderRadius: 8, padding: "0 10px", fontSize: 13, fontWeight: 800 }}
                                                value={q.points ?? 1}
                                                onChange={e => setPoints(section.id, q.id, parseInt(e.target.value))}
                                              />
                                            </label>
                                            {q.type === "text" && (
                                              <input
                                                type="text"
                                                className="input"
                                                style={{ flex: "1 1 200px", height: 36, borderRadius: 8, padding: "0 12px", fontSize: 13 }}
                                                value={typeof q.correct === "string" ? q.correct : ""}
                                                onChange={e => setTextCorrect(section.id, q.id, e.target.value)}
                                                placeholder={lang === "th" ? "คำตอบที่ถูกต้อง (ไม่สนตัวพิมพ์ใหญ่เล็ก)" : lang === "cn" ? "正确答案（不区分大小写）" : lang === "mm" ? "မှန်ကန်သောအဖြေ" : "Correct answer (case-insensitive)"}
                                              />
                                            )}
                                            {(q.type === "choice" || q.type === "multiple") && (
                                              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                                                {lang === "th" ? "เลือกคำตอบที่ถูกจากวงกลมด้านบน" : lang === "cn" ? "请在上方标记正确答案" : lang === "mm" ? "အပေါ်တွင် မှန်ကန်သောအဖြေကို မှတ်သားပါ" : "Mark the correct option(s) above"}
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}

                                    {/* Conditional visibility — show this question only when a
                                        controlling choice/multiple answer matches a given option. */}
                                    {controllers.length > 0 && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingLeft: 32, borderTop: "1px dashed var(--border-subtle)", paddingTop: 16 }}>
                                        <CornerDownRight size={14} style={{ color: "var(--indigo-500)" }} />
                                        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)" }}>
                                          {lang === "th" ? "แสดงเมื่อ" : lang === "cn" ? "显示条件" : lang === "mm" ? "ပြသမည် အကယ်၍" : "Show only if"}
                                        </span>
                                        <select
                                          className="input"
                                          style={{ height: 36, borderRadius: 8, padding: "0 8px", fontSize: 12, background: "var(--bg-surface)", cursor: "pointer", maxWidth: 220 }}
                                          value={q.visibleIf?.questionId ?? ""}
                                          onChange={e => {
                                            const cid = e.target.value;
                                            if (!cid) { setVisibleIf(section.id, q.id, "", ""); return; }
                                            const ctrl = section.questions.find(x => x.id === cid);
                                            const firstVal = ctrl?.options?.[0] ?? "";
                                            setVisibleIf(section.id, q.id, cid, q.visibleIf?.questionId === cid ? q.visibleIf.value : firstVal);
                                          }}
                                        >
                                          <option value="">{lang === "th" ? "แสดงเสมอ" : lang === "cn" ? "始终显示" : lang === "mm" ? "အမြဲပြသ" : "Always show"}</option>
                                          {controllers.map((c, ci) => (
                                            <option key={c.id} value={c.id}>{c.label || `Q${ci + 1}`}</option>
                                          ))}
                                        </select>
                                        {q.visibleIf && controllerQ && (
                                          <>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                                              {lang === "th" ? "มีคำตอบเป็น" : lang === "cn" ? "等于" : lang === "mm" ? "သည်" : "is"}
                                            </span>
                                            <select
                                              className="input"
                                              style={{ height: 36, borderRadius: 8, padding: "0 8px", fontSize: 12, background: "var(--bg-surface)", cursor: "pointer", maxWidth: 220 }}
                                              value={q.visibleIf.value}
                                              onChange={e => setVisibleIf(section.id, q.id, q.visibleIf!.questionId, e.target.value)}
                                            >
                                              {(controllerQ.options ?? []).map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}

                            <button
                              type="button"
                              className="btn"
                              style={{ alignSelf: "flex-start", borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgb(var(--accent-rgb) / 0.1)", color: "var(--accent-primary)", border: "none", cursor: "pointer" }}
                              onClick={() => addQuestion(section.id)}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} style={{ flexShrink: 0 }} /> {t.eventAddQuestionLabel}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
  );
}
