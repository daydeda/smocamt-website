"use client";

import { ChevronDown, ChevronUp, CornerDownRight, Plus, Trash2, X } from "lucide-react";
import { Field, IconButton, Panel, useConfirm } from "@/components/admin/ui";
import { BRANCH_NEXT, BRANCH_SUBMIT, type FormQuestion, type FormSection } from "@/lib/forms/form-schema";
import { autoGrowTextarea } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

const subtleCard = { background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" } as const;

export function SectionsEditor({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { addOption, addQuestion, addSection, allFormQuestions, formSections, moveSection, removeOption, removeQuestion, removeSection, setBranch, setChoiceCorrect, setPoints, setTextCorrect, setVisibleIf, t, toggleGraded, toggleMultipleCorrect, updateOption, updateQuestion, updateSection } = ctx;
  const confirm = useConfirm();

  const fill = (s: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

  const onRemoveSection = async (section: FormSection, sIdx: number) => {
    const name = section.title?.trim() || fill(t.adminEvfSectionN, { n: sIdx + 1 });
    const ok = await confirm({
      title: fill(t.adminEvfDeleteSectionTitle, { name }),
      message: fill(t.adminEvfDeleteSectionMsg, { count: section.questions.length, name }),
      confirmLabel: t.adminEvfDeleteSectionBtn,
      tone: "danger",
    });
    if (ok) removeSection(section.id);
  };

  const onRemoveQuestion = async (section: FormSection, q: FormQuestion, idx: number) => {
    const text = q.label.trim();
    const ok = await confirm({
      title: fill(t.adminEvfDeleteQuestionTitle, { n: idx + 1 }),
      message: fill(t.adminEvfDeleteQuestionMsg, { text: text || t.adminEvfUntitled }),
      confirmLabel: t.adminEvfDeleteQuestionBtn,
      tone: "danger",
    });
    if (ok) removeQuestion(section.id, q.id);
  };

  return (
    <Panel
      title={t.adminEvfSectionsHeading}
      description={fill(t.adminEvfSectionsSummary, { questions: allFormQuestions.length, sections: formSections.length })}
      actions={
        <button type="button" className="btn btn-ghost btn-sm" onClick={addSection}>
          <Plus size={14} aria-hidden="true" /> {t.adminEvfAddSection}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {formSections.map((section, sIdx) => (
          <section
            key={section.id}
            aria-label={fill(t.adminEvfSectionN, { n: sIdx + 1 })}
            className="flex flex-col gap-4 rounded-2xl p-4"
            style={{ background: "rgb(var(--indigo-500-rgb) / 0.04)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.2)" }}
          >
            {/* Section header: where it is in the order, and reorder controls */}
            <div className="flex items-center justify-between gap-3">
              <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {fill(t.adminEvfSectionN, { n: sIdx + 1 })}
                {formSections.length > 1 && <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> / {formSections.length}</span>}
              </h4>
              <div className="flex gap-1">
                <IconButton size="sm" label={fill(t.adminEvfMoveSectionUp, { n: sIdx + 1 })} icon={<ChevronUp size={16} />} disabled={sIdx === 0} onClick={() => moveSection(section.id, -1)} />
                <IconButton size="sm" label={fill(t.adminEvfMoveSectionDown, { n: sIdx + 1 })} icon={<ChevronDown size={16} />} disabled={sIdx === formSections.length - 1} onClick={() => moveSection(section.id, 1)} />
              </div>
            </div>

            <Field label={t.adminEvfSectionTitle}>
              {(p) => (
                <input {...p} type="text" className="input" style={{ fontWeight: 700 }} value={section.title || ""} onChange={(e) => updateSection(section.id, "title", e.target.value)} />
              )}
            </Field>
            <Field label={t.adminEvfSectionDesc}>
              {(p) => (
                <textarea
                  {...p}
                  ref={autoGrowTextarea}
                  className="input"
                  rows={1}
                  style={{ minHeight: 44, resize: "none", overflow: "hidden", fontFamily: "inherit", lineHeight: 1.5 }}
                  value={section.description || ""}
                  onChange={(e) => { updateSection(section.id, "description", e.target.value); autoGrowTextarea(e.target); }}
                />
              )}
            </Field>

            {/* Questions in this section */}
            {section.questions.length === 0 ? (
              <p className="rounded-2xl px-4 py-6 text-center" style={{ border: "1px dashed var(--border-medium)", background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: 14 }}>
                {t.adminEvfNoQuestions}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {section.questions.map((q, idx) => {
                  const gradable = q.type === "choice" || q.type === "multiple" || q.type === "text";
                  // Questions that can drive this one's visibility: other
                  // choice/multiple questions in the same section that have options.
                  const controllers = section.questions.filter(
                    (x) => x.id !== q.id && (x.type === "choice" || x.type === "multiple") && (x.options?.length ?? 0) > 0
                  );
                  const controllerQ = q.visibleIf ? section.questions.find((x) => x.id === q.visibleIf!.questionId) : undefined;
                  const hasOptions = q.type === "choice" || q.type === "multiple";
                  return (
                    <article
                      key={q.id || idx}
                      className="flex flex-col gap-4 rounded-2xl p-4"
                      style={{ ...subtleCard, border: q.graded ? "1px solid rgb(var(--emerald-500-rgb) / 0.5)" : subtleCard.border }}
                    >
                      {/* Header: which question, and the (separated) delete */}
                      <div className="flex items-center justify-between gap-3">
                        <h5 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                          {fill(t.adminEvfQuestionN, { n: idx + 1 })}
                          {q.graded && <span className="adm-badge adm-tone-success" style={{ marginLeft: 8 }}>{t.adminEvfGraded}</span>}
                        </h5>
                        <IconButton
                          size="sm"
                          tone="danger"
                          label={fill(t.adminEvfDeleteQuestionN, { n: idx + 1 })}
                          icon={<Trash2 size={16} />}
                          onClick={() => onRemoveQuestion(section, q, idx)}
                        />
                      </div>

                      <Field label={<span className="sr-only">{fill(t.adminEvfQuestionText, { n: idx + 1 })}</span>}>
                        {(p) => (
                          <textarea
                            {...p}
                            ref={autoGrowTextarea}
                            className="input"
                            rows={1}
                            style={{ minHeight: 44, resize: "none", overflow: "hidden", fontFamily: "inherit", lineHeight: 1.5 }}
                            value={q.label}
                            onChange={(e) => { updateQuestion(section.id, q.id, "label", e.target.value); autoGrowTextarea(e.target); }}
                            placeholder={t.adminEvfQuestionPh}
                          />
                        )}
                      </Field>

                      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                        <Field className="min-w-52 flex-1" label={t.eventQuestionTypeLabel}>
                          {(p) => (
                            <select {...p} className="input" value={q.type} onChange={(e) => updateQuestion(section.id, q.id, "type", e.target.value)}>
                              <option value="text">{t.adminEvfQTypeText}</option>
                              <option value="rating">{t.adminEvfQTypeRating}</option>
                              <option value="choice">{t.adminEvfQTypeChoice}</option>
                              <option value="multiple">{t.adminEvfQTypeMultiple}</option>
                              <option value="file">{t.adminEvfQTypeFile}</option>
                            </select>
                          )}
                        </Field>
                        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                          <input
                            type="checkbox"
                            checked={!!q.required}
                            onChange={() => updateQuestion(section.id, q.id, "required", !q.required)}
                            style={{ width: 20, height: 20, accentColor: "var(--accent-primary)" }}
                          />
                          {t.eventRequiredLabel}
                        </label>
                      </div>

                      {/* Options builder (choice/multiple) with correct-answer marking + branching */}
                      {hasOptions && (
                        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 pt-3" style={{ borderTop: "1px dashed var(--border-medium)" }}>
                          <legend className="adm-field-label p-0">{t.adminEvfAnswerOptions}</legend>
                          {q.graded && <p className="adm-field-hint" style={{ color: "var(--emerald-600)" }}>{t.adminEvfTapCorrect}</p>}
                          {q.options?.map((opt: string, optIdx: number) => {
                            const isCorrect = q.type === "choice" ? q.correct === opt : Array.isArray(q.correct) && q.correct.includes(opt);
                            return (
                              <div key={optIdx} className="flex flex-wrap items-center gap-2">
                                {q.graded && (
                                  <input
                                    type={q.type === "choice" ? "radio" : "checkbox"}
                                    name={`correct-${q.id}`}
                                    checked={isCorrect}
                                    aria-label={fill(t.adminEvfMarkCorrect, { n: optIdx + 1 })}
                                    onChange={() => {
                                      if (q.type === "choice") setChoiceCorrect(section.id, q.id, opt);
                                      else toggleMultipleCorrect(section.id, q.id, opt);
                                    }}
                                    style={{ width: 20, height: 20, flexShrink: 0, accentColor: "var(--emerald-600)" }}
                                  />
                                )}
                                <Field className="min-w-40 flex-1" label={<span className="sr-only">{fill(t.adminEvfOptionN, { n: optIdx + 1 })}</span>}>
                                  {(p) => (
                                    <input {...p} type="text" className="input" value={opt} onChange={(e) => updateOption(section.id, q.id, optIdx, e.target.value)} placeholder={fill(t.adminEvfOptionN, { n: optIdx + 1 })} />
                                  )}
                                </Field>
                                {/* Per-option branching (single-choice only) */}
                                {q.type === "choice" && formSections.length > 1 && (
                                  <div className="flex items-center gap-1">
                                    <CornerDownRight size={14} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                                    <select
                                      className="input"
                                      aria-label={fill(t.adminEvfBranchFor, { opt: opt || fill(t.adminEvfOptionN, { n: optIdx + 1 }) })}
                                      style={{ maxWidth: 220 }}
                                      value={q.branches?.[opt] ?? BRANCH_NEXT}
                                      onChange={(e) => setBranch(section.id, q.id, opt, e.target.value)}
                                    >
                                      <option value={BRANCH_NEXT}>{t.adminEvfBranchNext}</option>
                                      {formSections.map((s, i) => (
                                        <option key={s.id} value={s.id} disabled={s.id === section.id}>
                                          {fill(t.adminEvfBranchGoTo, { n: i + 1 })}{s.title ? `: ${s.title}` : ""}
                                        </option>
                                      ))}
                                      <option value={BRANCH_SUBMIT}>{t.adminEvfBranchSubmit}</option>
                                    </select>
                                  </div>
                                )}
                                <IconButton
                                  size="sm"
                                  tone="danger"
                                  label={fill(t.adminEvfRemoveOptionN, { n: optIdx + 1 })}
                                  icon={<X size={16} />}
                                  onClick={() => removeOption(section.id, q.id, optIdx)}
                                  disabled={!q.options || q.options.length <= 1}
                                />
                              </div>
                            );
                          })}
                          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => addOption(section.id, q.id)}>
                            <Plus size={14} aria-hidden="true" /> {t.adminEvfAddOption}
                          </button>
                        </fieldset>
                      )}

                      {/* Grading controls */}
                      {gradable && (
                        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 pt-3" style={{ borderTop: "1px dashed var(--border-medium)" }}>
                          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                            <input
                              type="checkbox"
                              checked={!!q.graded}
                              onChange={() => toggleGraded(section.id, q.id)}
                              style={{ width: 20, height: 20, accentColor: "var(--emerald-600)" }}
                            />
                            {t.adminEvfGradedToggle}
                          </label>
                          {q.graded && (
                            <>
                              <Field label={t.adminEvfPoints} className="w-24">
                                {(p) => (
                                  <input {...p} type="number" inputMode="numeric" min={1} className="input" value={q.points ?? 1} onChange={(e) => setPoints(section.id, q.id, parseInt(e.target.value))} />
                                )}
                              </Field>
                              {q.type === "text" && (
                                <Field className="min-w-52 flex-1" label={t.adminEvfCorrectAnswer} hint={t.adminEvfCorrectAnswerHint}>
                                  {(p) => (
                                    <input {...p} type="text" className="input" value={typeof q.correct === "string" ? q.correct : ""} onChange={(e) => setTextCorrect(section.id, q.id, e.target.value)} />
                                  )}
                                </Field>
                              )}
                              {hasOptions && <p className="adm-field-hint pb-3">{t.adminEvfMarkCorrectAbove}</p>}
                            </>
                          )}
                        </div>
                      )}

                      {/* Conditional visibility — show this question only when a
                          controlling choice/multiple answer matches a given option. */}
                      {controllers.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3" style={{ borderTop: "1px dashed var(--border-medium)" }}>
                          <label className="flex flex-wrap items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                            <span className="inline-flex items-center gap-1.5">
                              <CornerDownRight size={14} aria-hidden="true" style={{ color: "var(--indigo-500)" }} />
                              {t.adminEvfShowOnlyIf}
                            </span>
                            <select
                              className="input"
                              style={{ maxWidth: 240 }}
                              value={q.visibleIf?.questionId ?? ""}
                              onChange={(e) => {
                                const cid = e.target.value;
                                if (!cid) { setVisibleIf(section.id, q.id, "", ""); return; }
                                const ctrl = section.questions.find((x) => x.id === cid);
                                const firstVal = ctrl?.options?.[0] ?? "";
                                setVisibleIf(section.id, q.id, cid, q.visibleIf?.questionId === cid ? q.visibleIf.value : firstVal);
                              }}
                            >
                              <option value="">{t.adminEvfAlwaysShow}</option>
                              {controllers.map((c, ci) => (
                                <option key={c.id} value={c.id}>{c.label || `Q${ci + 1}`}</option>
                              ))}
                            </select>
                          </label>
                          {q.visibleIf && controllerQ && (
                            <label className="flex flex-wrap items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                              {t.adminEvfIs}
                              <select
                                className="input"
                                style={{ maxWidth: 240 }}
                                value={q.visibleIf.value}
                                onChange={(e) => setVisibleIf(section.id, q.id, q.visibleIf!.questionId, e.target.value)}
                              >
                                {(controllerQ.options ?? []).map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* Add question on the left, the destructive section delete set apart on the right. */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addQuestion(section.id)}>
                <Plus size={14} aria-hidden="true" /> {t.eventAddQuestionLabel}
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onRemoveSection(section, sIdx)}>
                <Trash2 size={14} aria-hidden="true" /> {t.adminEvfDeleteSectionBtn}
              </button>
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}
