// Shared form model + pure helpers for the event evaluation/quiz forms.
//
// The same logic must run in three places — the admin builder, the student
// renderer, and the submit API (which is the authoritative scorer) — so it lives
// here with no React/DB dependencies.
//
// Storage: `forms.questions` (jsonb) holds EITHER
//   - a legacy flat array of questions  (older forms, pre-sections), or
//   - a v2 object { version: 2, sections: [...] }.
// normalizeForm() collapses both into the same in-memory shape so callers never
// branch on storage format.

// "file" is an upload answer (image or PDF). Its answer value is an opaque
// storage key string for a file in the PRIVATE "form-uploads" bucket (see
// src/lib/form-file-storage.ts); it is never graded and never drives branching.
export type QuestionType = "text" | "rating" | "choice" | "multiple" | "file";

// Sentinel branch targets. A choice option can route to another section by id, or
// to one of these special destinations.
export const BRANCH_NEXT = "__next__"; // continue to the next section in order
export const BRANCH_SUBMIT = "__submit__"; // jump straight to submission

export interface FormQuestion {
  id: string;
  type: QuestionType;
  label: string;
  required?: boolean;
  options?: string[];

  // Grading (optional, per question). A form may freely mix graded and ungraded
  // questions; the score is the sum of points from graded questions only.
  graded?: boolean;
  points?: number; // points awarded when answered correctly (defaults to 1)
  // Correct answer: a single option string for "choice"/"text", or an array of
  // option strings for "multiple". Ignored for "rating".
  correct?: string | string[];

  // Section branching (single-choice "choice" questions only): maps a selected
  // option value to a target section id, BRANCH_NEXT, or BRANCH_SUBMIT.
  branches?: Record<string, string>;

  // Per-question conditional visibility: this question is shown only when the
  // answer to `questionId` matches `value`. The controller must be a "choice"
  // (answer === value) or "multiple" (answer includes value) question. Absent =>
  // always visible.
  visibleIf?: { questionId: string; value: string };
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  questions: FormQuestion[];
}

export interface NormalizedForm {
  sections: FormSection[];
}

type AnswerValue = string | number | string[];
export type AnswerMap = Record<string, AnswerValue>;

let sectionCounter = 0;
/** Stable-ish id generator that does not rely on Date.now/Math.random at module
 * eval (fine for client-side interactive use). */
export function newId(prefix: string): string {
  sectionCounter += 1;
  return `${prefix}_${sectionCounter}_${Date.now().toString(36)}`;
}

/** Accept legacy flat-array forms and v2 section objects; always return sections. */
export function normalizeForm(raw: unknown): NormalizedForm {
  if (Array.isArray(raw)) {
    return {
      sections: [{ id: "section-1", title: "", questions: raw as FormQuestion[] }],
    };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { sections?: unknown }).sections)) {
    const sections = (raw as { sections: FormSection[] }).sections;
    // Defensive: a v2 form must still have at least one section.
    if (sections.length > 0) return { sections };
  }
  return { sections: [{ id: "section-1", title: "", questions: [] }] };
}

/** Serialize the in-memory section model for storage in forms.questions. */
export function serializeForm(sections: FormSection[]): { version: 2; sections: FormSection[] } {
  return { version: 2, sections };
}

/** Every question across all sections, in document order. */
export function allQuestions(form: NormalizedForm): FormQuestion[] {
  return form.sections.flatMap((s) => s.questions);
}

/** Whether any question in the form is graded (drives "show a score" behavior). */
export function hasGradedQuestions(form: NormalizedForm): boolean {
  return allQuestions(form).some((q) => q.graded && q.correct != null);
}

/** Is a single answer correct for a graded question? */
export function isAnswerCorrect(q: FormQuestion, answer: AnswerValue | undefined): boolean {
  if (!q.graded || q.correct == null) return false;
  if (q.type === "choice") {
    return typeof answer === "string" && answer === q.correct;
  }
  if (q.type === "multiple") {
    const given = Array.isArray(answer) ? [...answer].sort() : [];
    const want = Array.isArray(q.correct) ? [...q.correct].sort() : [];
    return given.length > 0 && given.length === want.length && given.every((v, i) => v === want[i]);
  }
  if (q.type === "text") {
    return (
      typeof answer === "string" &&
      typeof q.correct === "string" &&
      answer.trim().toLowerCase() === q.correct.trim().toLowerCase()
    );
  }
  return false; // rating is never graded
}

/**
 * Whether a question is currently shown, given the answers so far. A question
 * with a `visibleIf` condition appears only when its controller answer matches.
 */
export function isQuestionVisible(q: FormQuestion, answers: AnswerMap): boolean {
  if (!q.visibleIf) return true;
  const ctrl = answers[q.visibleIf.questionId];
  if (Array.isArray(ctrl)) return ctrl.includes(q.visibleIf.value);
  return ctrl === q.visibleIf.value;
}

/**
 * Resolve the section that follows `index`, honoring branching. Mirrors Google
 * Forms: a section's flow is governed by its choice question(s); when several
 * branch, the LAST one with a matching answer wins. Returns a section index, or
 * "submit" to end the form.
 */
export function resolveNextSection(
  form: NormalizedForm,
  index: number,
  answers: AnswerMap,
): number | "submit" {
  const section = form.sections[index];
  let target: string | null = null;

  if (section) {
    for (const q of section.questions) {
      // A hidden choice question can't drive branching.
      if (q.type === "choice" && q.branches && isQuestionVisible(q, answers)) {
        const ans = answers[q.id];
        if (typeof ans === "string" && q.branches[ans]) {
          target = q.branches[ans];
        }
      }
    }
  }

  if (target && target !== BRANCH_NEXT) {
    if (target === BRANCH_SUBMIT) return "submit";
    const ti = form.sections.findIndex((s) => s.id === target);
    if (ti >= 0) return ti;
    // Dangling target (section was deleted) — fall through to sequential flow.
  }

  return index + 1 < form.sections.length ? index + 1 : "submit";
}

/**
 * Replay branching from the given answers to determine which sections the student
 * actually traversed. Used so scoring only counts graded questions the student was
 * shown, and so skipped branches don't inflate the denominator. Cycle-safe.
 */
export function getVisitedSectionIndices(form: NormalizedForm, answers: AnswerMap): number[] {
  const visited: number[] = [];
  const seen = new Set<number>();
  let idx = 0;
  while (idx >= 0 && idx < form.sections.length && !seen.has(idx)) {
    seen.add(idx);
    visited.push(idx);
    const next = resolveNextSection(form, idx, answers);
    if (next === "submit") break;
    idx = next;
  }
  return visited;
}

export interface ScoreResult {
  score: number;
  maxScore: number;
  hasGraded: boolean;
  /** Per-question breakdown, keyed by question id (only graded, visited questions). */
  breakdown: Record<string, { correct: boolean; earned: number; points: number }>;
}

/**
 * Authoritative score: sum points of graded questions in the sections the student
 * actually visited (per branching). maxScore is the total available on that path.
 */
export function computeScore(form: NormalizedForm, answers: AnswerMap): ScoreResult {
  const visited = getVisitedSectionIndices(form, answers);
  let score = 0;
  let maxScore = 0;
  const breakdown: ScoreResult["breakdown"] = {};

  for (const idx of visited) {
    for (const q of form.sections[idx].questions) {
      if (!q.graded || q.correct == null) continue;
      // A hidden graded question wasn't shown to the student — exclude it from
      // both the earned score and the max, so conditional questions never skew it.
      if (!isQuestionVisible(q, answers)) continue;
      const points = typeof q.points === "number" && q.points > 0 ? q.points : 1;
      maxScore += points;
      const correct = isAnswerCorrect(q, answers[q.id]);
      if (correct) score += points;
      breakdown[q.id] = { correct, earned: correct ? points : 0, points };
    }
  }

  return { score, maxScore, hasGraded: maxScore > 0, breakdown };
}
