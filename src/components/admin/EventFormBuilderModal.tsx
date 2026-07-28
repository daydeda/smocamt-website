"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import {
  AlertCircle, AlertTriangle, BarChart3, Calendar, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardList, CornerDownRight, Download, Eye, EyeOff, FileText, Lock, MessageSquare,
  Plus, Sparkles, Trash2, Trophy, X, Zap,
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { isGlobalRegistrationPosition } from "@/lib/admin-access";
import {
  normalizeForm,
  serializeForm,
  newId,
  BRANCH_NEXT,
  BRANCH_SUBMIT,
  type FormQuestion,
  type FormSection,
} from "@/lib/form-schema";

interface FormBuilderSubmission {
  id: string;
  studentName: string;
  studentId: string;
  houseId: string;
  nickname?: string;
  major?: string;
  phone?: string;
  contactChannels?: string;
  // Server-side masked (name/studentId/nickname/major/phone/contactChannels come
  // back empty) because the viewer isn't a super_admin/admin and this form's
  // showRespondentIdentity is off — see canSeeRespondentIdentity in form-access.ts.
  identityHidden?: boolean;
  answers: Record<string, string | number | string[]>;
  submittedAt: string;
  score?: number;
  maxScore?: number;
  hasGraded?: boolean;
}

interface EventFormSummary {
  id: string;
  formType: string;
  sortOrder: number;
  title: string;
  description: string;
  questions: unknown;
  pointsAwarded: number;
  individualPointsAwarded: number;
  isActive: boolean;
  isAwarded: boolean;
  opensAt: string | null;
  closesAt: string | null;
  assignedRoles: string[];
  assignedUserIds: string[];
  showRespondentIdentity: boolean;
  stats: Record<string, number>;
  submissions: FormBuilderSubmission[];
  // Review gate for president-created forms — see forms.reviewStatus in
  // schema.ts. 'approved' for every staff-created form (no gate).
  reviewStatus: "pending" | "approved";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

const FORM_TYPE_LABELS: Record<string, string> = {
  K_pre: "K Pre-Test",
  K_post: "K Post-Test",
  A: "A - Attitude",
  S: "S - Skill",
  F: "F - Feedback",
};

// Roles an admin can assign an S (Skill) form to. Mirrors ASSIGNABLE_ROLES in
// src/lib/form-access.ts.
const ASSIGNABLE_FORM_ROLES = ["organizer", "registration", "staff", "smo", "anusmo", "student"] as const;
const ASSIGNABLE_ROLE_LABELS: Record<string, string> = {
  organizer: "Organizer",
  registration: "Registration",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
  student: "Student",
};

// Size a <textarea> to fit its content so typed/loaded line breaks are visible.
// Used as a ref callback (fires on mount + each render, so it also grows when an
// existing multi-line value is loaded into the editor) and from onChange. Without
// this a rows=1 textarea hides newlines off-screen, making line breaks look broken.
const autoGrowTextarea = (el: HTMLTextAreaElement | null): void => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

// Convert a stored ISO timestamp to a value for a <input type="datetime-local">
// in the browser's local timezone (Bangkok for on-site admins), matching how
// event registration times are handled elsewhere on this page.
const toDatetimeLocal = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

// Stable fingerprint of the form-builder's editable state, used to detect
// unsaved edits so we can warn before an accidental close / reload. Sections
// are run through serializeForm so the comparison matches exactly what gets
// persisted, and the assignment arrays are sorted so reordering alone never
// reads as a change.
type BuilderState = {
  activeFormType: string;
  formTitle: string;
  formDescription: string;
  formPoints: number;
  formIndividualPoints: number;
  formSections: FormSection[];
  formIsAwarded: boolean;
  formOpensAt: string;
  formClosesAt: string;
  formAssignedRoles: string[];
  formAssignedUserIds: string[];
  formShowRespondentIdentity: boolean;
};
const builderFingerprint = (f: BuilderState): string =>
  JSON.stringify([
    f.activeFormType, f.formTitle, f.formDescription, f.formPoints, f.formIndividualPoints,
    serializeForm(f.formSections), f.formIsAwarded, f.formOpensAt, f.formClosesAt,
    [...f.formAssignedRoles].sort(), [...f.formAssignedUserIds].sort(), f.formShowRespondentIdentity,
  ]);

const FORM_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  K_pre:  { bg: "rgba(99,102,241,0.12)",  text: "#6366f1", border: "rgba(99,102,241,0.3)"  },
  K_post: { bg: "rgba(16,185,129,0.12)",  text: "#10b981", border: "rgba(16,185,129,0.3)"  },
  A:      { bg: "rgba(245,158,11,0.12)",  text: "#f59e0b", border: "rgba(245,158,11,0.3)"  },
  S:      { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", border: "rgba(239,68,68,0.3)"   },
  F:      { bg: "rgba(6,182,212,0.12)",   text: "#06b6d4", border: "rgba(6,182,212,0.3)"   },
};
// Feedback-form builder for a single event, extracted out of
// admin/events/page.tsx so it can also be mounted directly on admin/clubs and
// admin/majors (club_president/major_president managing their own event's
// form without navigating away — see EventFeedbackFormsShortcut.tsx). Fully
// self-contained: derives its own permissions from the session (mirroring
// admin/events/page.tsx's isAttendanceOnly/canManageForms/canViewForms) and
// fetches its own forms, so it never depends on the caller's page state.
// eventId/eventTitle are fixed for the component's lifetime — mounting IS
// "open", unmounting (via onClose) IS "close"; there's no internal show/hide
// state left over from the original showFormBuilder flag.
interface EventFormBuilderModalProps {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  // Notifies the caller after a save/delete/review action succeeds, so a
  // parent list (e.g. the Feedback Forms shortcut) can refresh its own
  // per-event status summary.
  onChanged?: () => void;
}

export function EventFormBuilderModal({ eventId, eventTitle, onClose, onChanged }: EventFormBuilderModalProps) {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  // Mirrors the identical derivation in admin/events/page.tsx — kept in sync
  // deliberately rather than importing effectiveRoles(), since this exact
  // shape (session.user.roles ?? [session.user.role]) is what that page's
  // canManageForms/isAttendanceOnly were already validated against. The
  // caller (e.g. the "Feedback Form" button) is the one that decides whether
  // a view-only viewer (smo) may even open this modal — canViewForms itself
  // isn't needed inside once mounted.
  const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
  // A global registration POSITION (smo/anusmo + smoPosition/anusmoPosition ===
  // "registration") gets the same staff-tier breadth the "registration" ROLE
  // has — mirrors admin/events/page.tsx's globalRegPosition. Without this, a
  // holder of this global title saw the page's "Create Form" button (that page
  // DOES account for it) but this modal — which re-derives its own permissions
  // independently — would still open read-only.
  const globalRegPosition = isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
  const isAttendanceOnly = !globalRegPosition && !myRoles.some((r) =>
    ["super_admin", "admin", "registration", "organizer"].includes(r)
  );
  const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));
  // A "registration" TITLE (src/lib/positions.ts) held in a club or major, or
  // (via globalRegPosition above) as smo/anusmo — distinct from the
  // "registration" ROLE — also gets full form management, scoped server-side to
  // their own club/major's events (EventScopeService.hasRegistrationScope /
  // gateEventForms's isPositionScoped). Mirrors admin/events/page.tsx's
  // hasRegistrationTitle exactly.
  const hasRegistrationTitle = globalRegPosition
    || session?.user?.majorPosition === "registration"
    || !!session?.user?.hasClubRegistrationPosition;
  const canManageForms = !isAttendanceOnly || isPresidentRole || hasRegistrationTitle;

  const [formLoading, setFormLoading] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPoints, setFormPoints] = useState(0);
  const [formIndividualPoints, setFormIndividualPoints] = useState(0);
  const [formSections, setFormSections] = useState<FormSection[]>([]);
  const [formIsAwarded, setFormIsAwarded] = useState(false);
  // Scheduling window + S-form assignment
  const [formOpensAt, setFormOpensAt] = useState("");
  const [formClosesAt, setFormClosesAt] = useState("");
  const [formAssignedRoles, setFormAssignedRoles] = useState<string[]>([]);
  const [formAssignedUserIds, setFormAssignedUserIds] = useState<string[]>([]);
  // Whether non-admin viewers (registration/organizer today) see who submitted
  // each response, or an anonymized view. super_admin/admin always see identity
  // regardless — see canSeeRespondentIdentity in @/lib/form-access. Defaults to
  // false (anonymized) for every new form; the creator opts in per form.
  const [formShowRespondentIdentity, setFormShowRespondentIdentity] = useState(false);
  // People directory for the S-form person-picker (loaded on demand). A local
  // copy — admin/events/page.tsx has its own for its Staff picker, which this
  // component doesn't touch; self-contained per the pattern used elsewhere
  // (see ProposeEventSection.tsx / EventFeedbackFormsShortcut.tsx).
  const [assigneeUsers, setAssigneeUsers] = useState<{ id: string; name: string | null; studentId: string | null; role: string | null }[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const ensureAssigneeUsersLoaded = () => {
    if (assigneeUsers.length > 0) return;
    fetch("/api/admin/students")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setAssigneeUsers(d.map((u) => ({ id: u.id, name: u.name, studentId: u.studentId, role: u.role }))); })
      .catch(() => {});
  };
  const [formStats, setFormStats] = useState<Record<string, number> | null>(null);
  const [formSubmissions, setFormSubmissions] = useState<FormBuilderSubmission[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  // Review gate display state for the currently loaded form — see
  // forms.reviewStatus in schema.ts. Not part of builderFingerprint: it isn't
  // an editable draft field, it's server-computed from who last saved.
  const [formReviewStatus, setFormReviewStatus] = useState<"pending" | "approved">("approved");
  const [formReviewNote, setFormReviewNote] = useState<string | null>(null);
  const [formReviewSaving, setFormReviewSaving] = useState(false);
  // Custom "Request Changes" modal — replaces window.prompt (native dialogs
  // can't be styled/kept responsive on mobile/iPad, see reviewActiveForm below).
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [requestChangesNote, setRequestChangesNote] = useState("");
  const [formTab, setFormTab] = useState<"edit" | "stats">("edit");
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const SUBMISSIONS_PER_PAGE = 10;
  const submissionsListRef = useRef<HTMLDivElement | null>(null);
  // Change page and scroll the list back to the top so the first card on the
  // new page is in view (instead of staying at the bottom where Next was clicked).
  const goToSubmissionsPage = (updater: (p: number) => number) => {
    setSubmissionsPage(updater);
    submissionsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  
  // Multi-form state: list of all forms for the current event + which one is being edited
  const [allEventForms, setAllEventForms] = useState<EventFormSummary[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [activeFormType, setActiveFormType] = useState<string>("K_post");
  const [showNewFormPicker, setShowNewFormPicker] = useState(false);

  // Custom admin form builder premium notification states
  const [formBuilderError, setFormBuilderError] = useState<string | null>(null);
  const [formBuilderSuccess, setFormBuilderSuccess] = useState<string | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
  }>({
    show: false,
    title: "",
    message: "",
    onConfirm: () => {},
    confirmText: "",
    cancelText: "",
    isDanger: false
  });
  // Snapshot of the builder state as last loaded or saved. Current state is
  // compared against this to know whether there are unsaved edits.
  const [pristineFingerprint, setPristineFingerprint] = useState("");

  const loadFormIntoEditor = (f: EventFormSummary) => {
    setActiveFormId(f.id);
    setActiveFormType(f.formType);
    setFormTitle(f.title);
    setFormDescription(f.description || "");
    setFormPoints(f.pointsAwarded || 0);
    setFormIndividualPoints(f.individualPointsAwarded || 0);
    const loadedSections = normalizeForm(f.questions).sections;
    setFormSections(loadedSections);
    setFormIsAwarded(f.isAwarded || false);
    setFormOpensAt(toDatetimeLocal(f.opensAt));
    setFormClosesAt(toDatetimeLocal(f.closesAt));
    setFormAssignedRoles(f.assignedRoles || []);
    setFormAssignedUserIds(f.assignedUserIds || []);
    setFormShowRespondentIdentity(f.showRespondentIdentity !== false);
    setFormStats(f.stats);
    setFormSubmissions(f.submissions || []);
    setFormReviewStatus(f.reviewStatus || "approved");
    setFormReviewNote(f.reviewNote || null);
    setSubmissionsPage(1);
    // View-only viewers (smo) never get the edit tab — even a form with zero
    // submissions must stay on the read-only stats view for them.
    setFormTab(!canManageForms ? "stats" : (f.submissions && f.submissions.length > 0 ? "stats" : "edit"));
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    // Baseline = the freshly loaded form, so only later edits read as unsaved.
    setPristineFingerprint(builderFingerprint({
      activeFormType: f.formType,
      formTitle: f.title,
      formDescription: f.description || "",
      formPoints: f.pointsAwarded || 0,
      formIndividualPoints: f.individualPointsAwarded || 0,
      formSections: loadedSections,
      formIsAwarded: f.isAwarded || false,
      formOpensAt: toDatetimeLocal(f.opensAt),
      formClosesAt: toDatetimeLocal(f.closesAt),
      formAssignedRoles: f.assignedRoles || [],
      formAssignedUserIds: f.assignedUserIds || [],
      formShowRespondentIdentity: f.showRespondentIdentity !== false,
    }));
  };

  const loadForms = async () => {
    setFormLoading(true);
    // smo is read-only (no create/edit/delete) — land it on the submissions tab
    // instead of the form editor it isn't allowed to touch.
    setFormTab(canManageForms ? "edit" : "stats");
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    setShowNewFormPicker(false);
    setAllEventForms([]);
    setActiveFormId(null);
    setAssigneeSearch("");

    // Load the people directory once for the S-form person-picker (best-effort).
    ensureAssigneeUsersLoaded();

    try {
      const res = await fetch(`/api/admin/events/${eventId}/form`);
      const data = await res.json();
      const eventForms: EventFormSummary[] = data.forms || [];
      setAllEventForms(eventForms);

      if (eventForms.length > 0) {
        loadFormIntoEditor(eventForms[0]);
      } else if (canManageForms) {
        // No forms yet — show new-form picker (view-only smo gets an empty
        // state instead, see the modal body below; it can't create one).
        setShowNewFormPicker(true);
        setActiveFormId(null);
        setActiveFormType("K_post");
        const defaultSections: FormSection[] = [{
          id: "section-1",
          title: "",
          questions: [
            { id: "q1", type: "rating", label: "Overall Satisfaction", required: true },
            { id: "q2", type: "text", label: "What did you learn or enjoy the most?", required: true },
            { id: "q3", type: "text", label: "Any suggestions for improvement?", required: false },
          ],
        }];
        setFormTitle("");
        setFormDescription("");
        setFormPoints(0);
        setFormIndividualPoints(0);
        setFormSections(defaultSections);
        setFormIsAwarded(false);
        setFormOpensAt("");
        setFormClosesAt("");
        setFormAssignedRoles([]);
        setFormAssignedUserIds([]);
        setFormShowRespondentIdentity(false);
        setFormStats(null);
        setFormSubmissions([]);
        setPristineFingerprint(builderFingerprint({
          activeFormType: "K_post", formTitle: "", formDescription: "", formPoints: 0, formIndividualPoints: 0,
          formSections: defaultSections, formIsAwarded: false, formOpensAt: "", formClosesAt: "",
          formAssignedRoles: [], formAssignedUserIds: [], formShowRespondentIdentity: false,
        }));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError(lang === "th" ? "ไม่สามารถโหลดเครื่องมือสร้างฟอร์มได้ กรุณาลองใหม่อีกครั้ง" : "Couldn't load the form builder. Please try again.");
    } finally {
      setFormLoading(false);
    }
  };

  const refreshAllForms = async () => {
    if (!eventId) return;
    const res = await fetch(`/api/admin/events/${eventId}/form`);
    const data = await res.json();
    const eventForms: EventFormSummary[] = data.forms || [];
    setAllEventForms(eventForms);
    // Refresh the active form data
    if (activeFormId) {
      const updated = eventForms.find((f) => f.id === activeFormId);
      if (updated) loadFormIntoEditor(updated);
    }
    return eventForms;
  };

  const startNewForm = (type: string) => {
    setActiveFormId(null);
    setActiveFormType(type);
    setShowNewFormPicker(false);
    const newTitle = `${eventTitle || "Event"} — ${FORM_TYPE_LABELS[type] || type}`;
    const newSections: FormSection[] = [{
      id: "section-1",
      title: "",
      questions: [
        { id: "q1", type: "rating", label: "Overall Satisfaction", required: true },
        { id: "q2", type: "text", label: "What did you learn or enjoy the most?", required: true },
        { id: "q3", type: "text", label: "Any suggestions for improvement?", required: false },
      ],
    }];
    setFormTitle(newTitle);
    setFormDescription("");
    setFormPoints(0);
    setFormIndividualPoints(0);
    setFormSections(newSections);
    setFormIsAwarded(false);
    setFormOpensAt("");
    setFormClosesAt("");
    setFormAssignedRoles([]);
    setFormAssignedUserIds([]);
    // Every new form defaults to anonymized submissions — opening submissions
    // access to more roles shouldn't silently expose who said what. The admin
    // opts identity back in per form below when it's genuinely needed.
    setFormShowRespondentIdentity(false);
    setFormStats(null);
    setFormSubmissions([]);
    // Preview what saving will actually set (see the form route's review gate):
    // staff saves land 'approved' immediately, a president's save always starts
    // 'pending' — not yet true until Save is clicked, but this keeps the banner
    // from flashing a stale "Approved" for a form that hasn't been saved.
    setFormReviewStatus(isAttendanceOnly ? "pending" : "approved");
    setFormReviewNote(null);
    setFormTab("edit");
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    // Baseline = the default template, so closing an untouched new form is silent.
    setPristineFingerprint(builderFingerprint({
      activeFormType: type, formTitle: newTitle, formDescription: "", formPoints: 0, formIndividualPoints: 0,
      formSections: newSections, formIsAwarded: false, formOpensAt: "", formClosesAt: "",
      formAssignedRoles: [], formAssignedUserIds: [], formShowRespondentIdentity: false,
    }));
  };

  const saveForm = async (skipReopenConfirm = false) => {
    if (!eventId) return;
    setFormBuilderError(null);
    setFormBuilderSuccess(null);

    // "Closes at" is required: it's the trigger that closes the form and
    // auto-awards the points, so a form without it would never resolve.
    if (!formClosesAt) {
      setFormBuilderError('Please set a "Closes at" time — it is required so the form can automatically close and award points.');
      return;
    }
    if (formOpensAt && new Date(formClosesAt) <= new Date(formOpensAt)) {
      setFormBuilderError('"Closes at" must be after "Opens at".');
      return;
    }

    // Re-opening an already-awarded form (pushing its close time back into the
    // future) claws back the points it already gave the winning house. Confirm
    // first — the server then reverts the award and re-arms the form.
    const reopening = formIsAwarded && new Date(formClosesAt).getTime() > Date.now();
    if (reopening && !skipReopenConfirm) {
      setConfirmModal({
        show: true,
        title: lang === "th" ? "เปิดแบบฟอร์มที่ให้คะแนนแล้วอีกครั้ง?" : lang === "cn" ? "重新开放已计分的表单？" : lang === "mm" ? "အမှတ်ပေးပြီးသော ဖောင်ကို ပြန်ဖွင့်မလား?" : "Re-open this awarded form?",
        message: lang === "th"
          ? "แบบฟอร์มนี้ปิดและให้คะแนนบ้านที่ชนะไปแล้ว การตั้งเวลาปิดใหม่ในอนาคตจะ ดึงคะแนนที่ให้ไปแล้วคืน และเปิดรับคำตอบอีกครั้ง คะแนนจะถูกมอบใหม่เมื่อปิดอีกครั้ง"
          : lang === "cn"
          ? "此表单已关闭并向获胜宿舍计分。将关闭时间设为未来将会收回已发放的分数，并重新开放提交。下次关闭时会重新计分。"
          : lang === "mm"
          ? "ဤဖောင်သည် ပိတ်ပြီး အနိုင်ရအိမ်သို့ အမှတ်ပေးပြီးဖြစ်သည်။ ပိတ်ချိန်ကို အနာဂတ်သို့ ပြန်သတ်မှတ်ပါက ပေးပြီးသားအမှတ်များကို ပြန်ရုပ်သိမ်းပြီး တင်သွင်းမှုများ ပြန်ဖွင့်ပါမည်။ နောက်တစ်ကြိမ်ပိတ်သည့်အခါ အမှတ်ပြန်ပေးပါမည်။"
          : "This form already closed and awarded points to the winning house. Setting the close time in the future will take those points back and re-open it for entries. Points are re-awarded when it closes again.",
        confirmText: lang === "th" ? "เปิดอีกครั้งและดึงคะแนนคืน" : lang === "cn" ? "重新开放并收回分数" : lang === "mm" ? "ပြန်ဖွင့်ပြီး အမှတ်ပြန်ယူမည်" : "Re-open & revert points",
        cancelText: lang === "th" ? "ยกเลิก" : lang === "cn" ? "取消" : lang === "mm" ? "မလုပ်တော့ပါ" : "Cancel",
        isDanger: true,
        onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); saveForm(true); },
      });
      return;
    }

    setFormSaving(true);
    try {
      const isNew = !activeFormId;
      const res = await fetch(`/api/admin/events/${eventId}/form`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isNew ? { formType: activeFormType } : { formId: activeFormId }),
          title: formTitle,
          description: formDescription,
          pointsAwarded: formPoints,
          individualPointsAwarded: formIndividualPoints,
          questions: serializeForm(formSections),
          // Forms are always active now — the schedule window (opensAt/closesAt)
          // drives the lifecycle and auto-awards when closesAt passes.
          isActive: true,
          opensAt: formOpensAt ? new Date(formOpensAt).toISOString() : null,
          closesAt: formClosesAt ? new Date(formClosesAt).toISOString() : null,
          assignedRoles: activeFormType === "S" ? formAssignedRoles : [],
          assignedUserIds: activeFormType === "S" ? formAssignedUserIds : [],
          showRespondentIdentity: formShowRespondentIdentity,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setFormBuilderSuccess("Evaluation form saved successfully!");
        // Just persisted — current builder state is now the saved baseline, so
        // there are no unsaved edits (also covers the new-form path, where
        // refreshAllForms can't yet match by the not-yet-set activeFormId).
        setPristineFingerprint(builderFingerprint({
          activeFormType, formTitle, formDescription, formPoints, formIndividualPoints, formSections,
          formIsAwarded, formOpensAt, formClosesAt, formAssignedRoles, formAssignedUserIds, formShowRespondentIdentity,
        }));
        // If this was a new form, set the activeFormId
        if (isNew && saved.form?.id) {
          setActiveFormId(saved.form.id);
        }
        await refreshAllForms();
        onChanged?.();
      } else {
        const d = await res.json();
        setFormBuilderError("Failed to save: " + (d.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError("Failed to save evaluation form.");
    } finally {
      setFormSaving(false);
    }
  };

  const deleteActiveForm = async () => {
    if (!eventId || !activeFormId) return;
    try {
      const res = await fetch(`/api/admin/events/${eventId}/form`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: activeFormId }),
      });
      if (res.ok) {
        const remaining = await refreshAllForms();
        if (remaining && remaining.length > 0) {
          loadFormIntoEditor(remaining[0]);
        } else {
          setActiveFormId(null);
          setShowNewFormPicker(true);
        }
        setFormBuilderSuccess("Form deleted.");
        onChanged?.();
      } else {
        const d = await res.json();
        setFormBuilderError("Failed to delete: " + (d.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError("Failed to delete form.");
    }
  };

  // Staff-only review action on the currently loaded (already-saved) form —
  // approve a pending form, or leave a note asking the president for changes
  // (stays pending). Mirrors the server's PATCH action branch, see
  // api/admin/events/[id]/form/route.ts. Never touches form content.
  const reviewActiveForm = async (action: "approve" | "requestChanges", note?: string) => {
    if (!eventId || !activeFormId) return;
    setFormReviewSaving(true);
    setFormBuilderError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/form`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: activeFormId, action, reviewNote: note }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setFormBuilderError("Failed to update review status: " + ((d && d.error) || "Unknown error"));
        return;
      }
      setFormReviewStatus(d.form.reviewStatus);
      setFormReviewNote(d.form.reviewNote);
      await refreshAllForms();
      onChanged?.();
      setFormBuilderSuccess(action === "approve" ? "Form approved." : "Changes requested.");
    } catch (e) {
      console.error(e);
      setFormBuilderError("Failed to update review status.");
    } finally {
      setFormReviewSaving(false);
    }
  };

  // True when the builder has edits that differ from the last loaded/saved
  // state. Skipped while loading so the mid-load state churn doesn't flicker.
  const builderDirty =
    !formLoading &&
    builderFingerprint({
      activeFormType, formTitle, formDescription, formPoints, formIndividualPoints, formSections,
      formIsAwarded, formOpensAt, formClosesAt, formAssignedRoles, formAssignedUserIds, formShowRespondentIdentity,
    }) !== pristineFingerprint;

  // Guarded close: if there are unsaved edits, confirm before discarding.
  const closeFormBuilder = () => {
    if (builderDirty) {
      setConfirmModal({
        show: true,
        title: lang === "th" ? "ละทิ้งการแก้ไขที่ยังไม่บันทึก?" : lang === "cn" ? "放弃未保存的更改？" : lang === "mm" ? "မသိမ်းရသေးသော ပြင်ဆင်မှုများကို ပယ်မလား?" : "Discard unsaved changes?",
        message: lang === "th"
          ? "คุณมีการแก้ไขแบบฟอร์มที่ยังไม่ได้บันทึก หากปิดตอนนี้การเปลี่ยนแปลงจะหายไป"
          : lang === "cn"
          ? "您对表单的更改尚未保存。现在关闭将会丢失这些更改。"
          : lang === "mm"
          ? "ဖောင်ပြင်ဆင်မှုများ မသိမ်းရသေးပါ။ ယခုပိတ်ပါက ပြောင်းလဲမှုများ ပျောက်ဆုံးပါမည်။"
          : "You have unsaved changes to this form. Closing now will discard them.",
        confirmText: lang === "th" ? "ละทิ้ง" : lang === "cn" ? "放弃" : lang === "mm" ? "ပယ်မည်" : "Discard",
        cancelText: lang === "th" ? "แก้ไขต่อ" : lang === "cn" ? "继续编辑" : lang === "mm" ? "ဆက်ပြင်မည်" : "Keep editing",
        isDanger: true,
        onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); onClose(); },
      });
      return;
    }
    onClose();
  };

  // Warn on browser tab close / reload while the builder has unsaved edits.
  useEffect(() => {
    if (!builderDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [builderDirty]);

  // ---- Section-aware form-builder helpers ----
  // All mutations target a question inside a specific section, identified by
  // (secId, qId), since question ids are only unique within the whole form anyway
  // but the section is needed to scope the update efficiently.
  const mutateQuestion = (secId: string, qId: string, fn: (q: FormQuestion) => FormQuestion) => {
    setFormSections(prev =>
      prev.map(s =>
        s.id !== secId ? s : { ...s, questions: s.questions.map(q => (q.id === qId ? fn(q) : q)) }
      )
    );
  };

  const addSection = () => {
    setFormSections(prev => [
      ...prev,
      { id: newId("section"), title: "", description: "", questions: [] },
    ]);
  };

  const removeSection = (secId: string) => {
    setFormSections(prev => {
      const next = prev.filter(s => s.id !== secId);
      // Never leave a form with zero sections.
      if (next.length === 0) return [{ id: newId("section"), title: "", questions: [] }];
      // Repair any branches that pointed at the deleted section.
      return next.map(s => ({
        ...s,
        questions: s.questions.map(q => {
          if (!q.branches) return q;
          const cleaned: Record<string, string> = {};
          for (const [opt, target] of Object.entries(q.branches)) {
            cleaned[opt] = target === secId ? BRANCH_NEXT : target;
          }
          return { ...q, branches: cleaned };
        }),
      }));
    });
  };

  const updateSection = (secId: string, key: "title" | "description", val: string) => {
    setFormSections(prev => prev.map(s => (s.id === secId ? { ...s, [key]: val } : s)));
  };

  const moveSection = (secId: string, dir: -1 | 1) => {
    setFormSections(prev => {
      const idx = prev.findIndex(s => s.id === secId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  const addQuestion = (secId: string) => {
    const newQ: FormQuestion = { id: newId("q"), type: "text", label: "New Question", required: false };
    setFormSections(prev =>
      prev.map(s => (s.id === secId ? { ...s, questions: [...s.questions, newQ] } : s))
    );
  };

  const removeQuestion = (secId: string, qId: string) => {
    setFormSections(prev =>
      prev.map(s => {
        if (s.id !== secId) return s;
        const questions = s.questions
          .filter(q => q.id !== qId)
          // Any sibling whose conditional pointed at the removed question reverts
          // to always-visible.
          .map(q => (q.visibleIf?.questionId === qId ? { ...q, visibleIf: undefined } : q));
        return { ...s, questions };
      })
    );
  };

  const updateQuestion = (secId: string, qId: string, key: string, val: string | boolean | string[]) => {
    setFormSections(prev =>
      prev.map(s => {
        if (s.id !== secId) return s;
        let questions = s.questions.map(q => {
          if (q.id !== qId) return q;
          const updated = { ...q, [key]: val } as FormQuestion;
          if (key === "type") {
            if ((val === "choice" || val === "multiple") && !updated.options) {
              updated.options = ["Option 1", "Option 2"];
            }
            // Branching is single-choice only; correct-answer shape differs per
            // type — clear both so we never carry a stale value across a change.
            if (val !== "choice") delete updated.branches;
            delete updated.correct;
          }
          return updated;
        });
        // If this question is no longer a usable controller (not choice/multiple),
        // drop sibling conditionals that depended on it.
        if (key === "type" && val !== "choice" && val !== "multiple") {
          questions = questions.map(q => (q.visibleIf?.questionId === qId ? { ...q, visibleIf: undefined } : q));
        }
        return { ...s, questions };
      })
    );
  };

  const addOption = (secId: string, qId: string) => {
    mutateQuestion(secId, qId, q => {
      const opts = q.options ? [...q.options] : [];
      opts.push(`Option ${opts.length + 1}`);
      return { ...q, options: opts };
    });
  };

  const removeOption = (secId: string, qId: string, optIdx: number) => {
    setFormSections(prev =>
      prev.map(s => {
        if (s.id !== secId) return s;
        const removed = s.questions.find(q => q.id === qId)?.options?.[optIdx];
        const questions = s.questions.map(q => {
          if (q.id === qId) {
            const opts = q.options ? q.options.filter((_, idx: number) => idx !== optIdx) : [];
            const next: FormQuestion = { ...q, options: opts };
            // Drop any branch/correct references to the removed option.
            if (removed != null) {
              if (next.branches) {
                const b = { ...next.branches };
                delete b[removed];
                next.branches = b;
              }
              if (typeof next.correct === "string" && next.correct === removed) delete next.correct;
              if (Array.isArray(next.correct)) next.correct = next.correct.filter(c => c !== removed);
            }
            return next;
          }
          // A sibling conditioned on the removed option value reverts to always-visible.
          if (removed != null && q.visibleIf?.questionId === qId && q.visibleIf.value === removed) {
            return { ...q, visibleIf: undefined };
          }
          return q;
        });
        return { ...s, questions };
      })
    );
  };

  const updateOption = (secId: string, qId: string, optIdx: number, val: string) => {
    setFormSections(prev =>
      prev.map(s => {
        if (s.id !== secId) return s;
        const prevVal = s.questions.find(q => q.id === qId)?.options?.[optIdx];
        const questions = s.questions.map(q => {
          if (q.id === qId) {
            const opts = q.options ? [...q.options] : [];
            opts[optIdx] = val;
            const next: FormQuestion = { ...q, options: opts };
            // Keep branch/correct keys aligned when an option label is renamed.
            if (prevVal != null && prevVal !== val) {
              if (next.branches && next.branches[prevVal] !== undefined) {
                const b = { ...next.branches };
                b[val] = b[prevVal];
                delete b[prevVal];
                next.branches = b;
              }
              if (typeof next.correct === "string" && next.correct === prevVal) next.correct = val;
              if (Array.isArray(next.correct)) next.correct = next.correct.map(c => (c === prevVal ? val : c));
            }
            return next;
          }
          // Keep a sibling's conditional value aligned with the renamed option.
          if (prevVal != null && prevVal !== val && q.visibleIf?.questionId === qId && q.visibleIf.value === prevVal) {
            return { ...q, visibleIf: { questionId: qId, value: val } };
          }
          return q;
        });
        return { ...s, questions };
      })
    );
  };

  // ---- Grading ----
  const toggleGraded = (secId: string, qId: string) => {
    mutateQuestion(secId, qId, q => {
      const graded = !q.graded;
      return { ...q, graded, points: graded ? (q.points && q.points > 0 ? q.points : 1) : q.points };
    });
  };

  const setPoints = (secId: string, qId: string, points: number) => {
    mutateQuestion(secId, qId, q => ({ ...q, points: Math.max(1, points || 1) }));
  };

  const setChoiceCorrect = (secId: string, qId: string, opt: string) => {
    mutateQuestion(secId, qId, q => ({ ...q, correct: opt }));
  };

  const toggleMultipleCorrect = (secId: string, qId: string, opt: string) => {
    mutateQuestion(secId, qId, q => {
      const cur = Array.isArray(q.correct) ? [...q.correct] : [];
      const updated = cur.includes(opt) ? cur.filter(c => c !== opt) : [...cur, opt];
      return { ...q, correct: updated };
    });
  };

  const setTextCorrect = (secId: string, qId: string, val: string) => {
    mutateQuestion(secId, qId, q => ({ ...q, correct: val }));
  };

  // ---- Branching (single-choice): route an option to a section / next / submit ----
  const setBranch = (secId: string, qId: string, opt: string, target: string) => {
    mutateQuestion(secId, qId, q => {
      const branches = { ...(q.branches || {}) };
      if (target === BRANCH_NEXT) {
        delete branches[opt]; // default sequential flow — no need to store
      } else {
        branches[opt] = target;
      }
      return { ...q, branches };
    });
  };

  // ---- Conditional visibility: show a question only when a controlling
  // choice/multiple answer matches a given option value. ----
  const setVisibleIf = (secId: string, qId: string, controllerId: string, value: string) => {
    mutateQuestion(secId, qId, q => {
      if (!controllerId) {
        const next = { ...q };
        delete next.visibleIf;
        return next;
      }
      return { ...q, visibleIf: { questionId: controllerId, value } };
    });
  };

  // Flattened view of every question across sections — used by the stats tab and
  // the question counter.
  const allFormQuestions = formSections.flatMap(s => s.questions);

  // Export submissions to a real .xlsx (one row per student, one column per
  // question, plus score) with auto-filter enabled for easy stats/filtering.
  // xlsx is imported lazily so it never weighs on the initial admin bundle.
  const exportSubmissionsXlsx = async () => {
    if (formSubmissions.length === 0) return;
    const XLSX = await import("xlsx");
    const qcols = allFormQuestions.map((q, i) => ({ key: `Q${i + 1}: ${q.label || "Untitled"}`, q }));
    const anyGraded = allFormQuestions.some(q => q.graded);
    const header = [
      "Name", "Nickname", "Student ID", "Major", "Phone", "Contact Channels", "House", "Submitted (Bangkok)",
      ...(anyGraded ? ["Score", "Max Score"] : []),
      ...qcols.map(c => c.key),
    ];
    const fmt = (ans: string | number | string[] | undefined) =>
      ans == null ? "" : Array.isArray(ans) ? ans.join(", ") : String(ans);

    const rows = formSubmissions.map(sub => {
      const row: Record<string, string | number> = {
        "Name": sub.identityHidden ? "Anonymous" : sub.studentName,
        "Nickname": sub.nickname || "",
        "Student ID": sub.studentId,
        "Major": sub.major || "",
        "Phone": sub.phone || "",
        "Contact Channels": sub.contactChannels || "",
        "House": sub.houseId,
        "Submitted (Bangkok)": new Date(sub.submittedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }),
      };
      if (anyGraded) {
        row["Score"] = sub.score ?? 0;
        row["Max Score"] = sub.maxScore ?? 0;
      }
      for (const c of qcols) {
        const ans = sub.answers?.[c.q.id];
        // File answers store an opaque key; export an absolute, auth-guarded URL
        // the admin can open (the raw key is meaningless in a spreadsheet).
        row[c.key] = c.q.type === "file"
          ? (typeof ans === "string" && ans ? `${window.location.origin}/api/forms/file/${sub.id}?q=${c.q.id}` : "")
          : fmt(ans);
      }
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
    ws["!cols"] = header.map(h => ({ wch: Math.min(45, Math.max(12, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submissions");
    // Name the file after the FORM (not just the event) so exports from an
    // event's different forms (K_pre/K_post/A/S/F) don't collide or get
    // confused. Prefer the form's own title; fall back to the event title plus
    // the form-type label. Keep Thai (and other Unicode) letters intact; only
    // strip characters that are illegal in filenames, then collapse
    // whitespace/separators to "_".
    const typeLabel = FORM_TYPE_LABELS[activeFormType] || activeFormType;
    const rawName = formTitle.trim() || `${eventTitle || "Event"} ${typeLabel}`;
    const safeTitle = rawName
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60)
      .replace(/^_+|_+$/g, "") || "form";
    XLSX.writeFile(wb, `submissions_${safeTitle}.xlsx`);
  };

  // Mounting this component IS "open" — load the event's forms once on mount
  // (and if the caller ever swaps eventId under an already-mounted instance).
  // Deferred via setTimeout so loadForms' setState calls fire after this
  // render commits rather than synchronously within the effect body
  // (react-hooks/set-state-in-effect) — mirrors the pattern used elsewhere in
  // this codebase (e.g. admin/clubs/page.tsx's own load effect).
  useEffect(() => {
    const timer = setTimeout(() => { loadForms(); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Portalled to document.body: this panel is mounted from admin/clubs and
  // admin/majors too, nested inside those pages' `.animate-fade-in-up`
  // wrapper. That wrapper is the target of a CSS transform animation, which
  // makes it the containing block for any `position: fixed` descendant —
  // so without a portal this "full-screen" panel was only ever full relative
  // to that wrapper's box, not the actual viewport (visibly not full-page on
  // those two pages, unlike admin/events/page.tsx which mounts this modal as
  // a sibling outside its own animate-fade-in-up div). Mirrors the same fix
  // already used for the nested requestChangesOpen modal below.
  return createPortal(
    <>
        {/* Centered dialog with a dimmed/blurred backdrop — matches the rest of
            the app's modal pattern (see admin/clubs's Members/Create modals)
            instead of a full-screen page-covering panel. The card itself is a
            flex column capped at 90vh; header/chip-selector/tabs stay fixed
            (flexShrink: 0) and only the body below scrolls. */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2200,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={closeFormBuilder}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 900,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "clamp(20px, 5vw, 32px)",
              overflow: "hidden",
              boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
              border: "1px solid var(--border-medium)",
            }}
          >

            {/* Modal Header */}
            <div style={{ padding: "20px clamp(16px, 5vw, 40px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "th" ? "แบบประเมินผู้เข้าร่วม" : lang === "cn" ? "互动反馈" : lang === "mm" ? "အပြန်အလှန် အကြံပြုချက်" : "Interactive Feedback"}</span>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", overflowWrap: "break-word", wordBreak: "break-word" }}>{eventTitle || "Event"} {t.fbFormSuffix || "Form"}</h3>
              </div>
              <button
                className="btn btn-ghost"
                onClick={closeFormBuilder}
                style={{ borderRadius: "50%", width: 40, height: 40, padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* KAS Form Selector — chips for each form + Add button */}
            <div style={{ padding: "12px clamp(12px,4vw,32px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
              {allEventForms.map((f) => {
                const c = FORM_TYPE_COLORS[f.formType] || FORM_TYPE_COLORS["K_post"];
                const isActive = f.id === activeFormId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { setShowNewFormPicker(false); loadFormIntoEditor(f); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800,
                      cursor: "pointer", transition: "all 0.15s",
                      background: isActive ? c.bg : "var(--bg-surface)",
                      color: isActive ? c.text : "var(--text-secondary)",
                      border: isActive ? `1.5px solid ${c.border}` : "1.5px solid var(--border-subtle)",
                      boxShadow: isActive ? `0 0 0 2px ${c.border}` : "none",
                    }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 900, background: c.bg, color: c.text, padding: "1px 5px", borderRadius: 4 }}>
                      {FORM_TYPE_LABELS[f.formType] || f.formType}
                    </span>
                    <span style={{ maxWidth: 200, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word", textAlign: "left", lineHeight: 1.3 }}>{f.title}</span>
                    {f.isAwarded && <Lock size={10} style={{ flexShrink: 0 }} />}
                    {!f.isActive && !f.isAwarded && <span style={{ fontSize: 10, opacity: 0.6 }}>●</span>}
                  </button>
                );
              })}
              {canManageForms && (
              <button
                type="button"
                onClick={() => { setShowNewFormPicker(true); setActiveFormId(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800,
                  cursor: "pointer", background: "transparent",
                  color: "var(--accent-primary)", border: "1.5px dashed var(--accent-primary)",
                }}
              >
                {t.fbAddForm || "+ Add Form"}
              </button>
              )}
            </div>

            {/* New Form Type Picker */}
            {canManageForms && showNewFormPicker && !formLoading && (
              <div style={{ padding: "20px clamp(12px,4vw,32px)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 12 }}>
                  {t.fbSelectFormTypePicker || "Select the type of form to create for this event:"}
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(["K_pre", "K_post", "A", "S", "F"] as const).map((type) => {
                    const c = FORM_TYPE_COLORS[type];
                    const alreadyExists = allEventForms.some((f) => f.formType === type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={alreadyExists}
                        onClick={() => startNewForm(type)}
                        style={{
                          padding: "10px 20px", borderRadius: 14, fontSize: 13, fontWeight: 800,
                          cursor: alreadyExists ? "not-allowed" : "pointer", opacity: alreadyExists ? 0.4 : 1,
                          background: c.bg, color: c.text, border: `1.5px solid ${c.border}`,
                          transition: "all 0.15s",
                        }}
                        title={alreadyExists ? (t.fbFormTypeAlreadyExists || "A form of this type already exists for this event") : ""}
                      >
                        {FORM_TYPE_LABELS[type]}
                        {alreadyExists && " ✓"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modal Navigation Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", flexShrink: 0 }}>
              {canManageForms && (
              <button
                style={{
                  flex: 1,
                  padding: "16px 20px",
                  fontSize: 14,
                  fontWeight: 800,
                  border: "none",
                  borderBottom: formTab === "edit" ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  background: "transparent",
                  color: formTab === "edit" ? "var(--accent-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => setFormTab("edit")}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <FileText size={16} style={{ flexShrink: 0 }} /> {lang === "th" ? "ออกแบบฟอร์มและกฎ" : lang === "cn" ? "设计表单与规则" : lang === "mm" ? "ပုံစံနှင့် စည်းကမ်းများ ဒီဇိုင်းဆွဲရန်" : "Design Form & Rules"}
                </span>
              </button>
              )}
              <button
                style={{
                  flex: 1,
                  padding: "16px 20px",
                  fontSize: 14,
                  fontWeight: 800,
                  border: "none",
                  borderBottom: formTab === "stats" ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  background: "transparent",
                  color: formTab === "stats" ? "var(--accent-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => setFormTab("stats")}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Trophy size={16} style={{ flexShrink: 0 }} /> {lang === "th" ? "กระดานผู้นำบ้านและการส่งข้อมูล" : lang === "cn" ? "学院排行榜与提交" : lang === "mm" ? "အိမ်တော် ဦးဆောင်သူစာရင်းနှင့် တင်သွင်းမှုများ" : "House Leaderboard & Submissions"} ({formSubmissions.length})
                </span>
              </button>
            </div>

            {/* Scrollable Modal Body — the only part of the card that scrolls;
                header/chip-selector/tabs above stay fixed (flexShrink: 0). */}
            <div className="custom-scrollbar" style={{ overflowY: "auto", flex: 1 }}>
            {formLoading ? (
              <div style={{ padding: "80px 0", textAlign: "center" }}>
                <div className="spinner w-8 h-8 border-4 border-t-transparent" style={{ margin: "0 auto 16px" }} />
                <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.fbFetchingData || "Fetching evaluation system data..."}</p>
              </div>
            ) : showNewFormPicker && !activeFormId ? (
              <div style={{ padding: "60px 40px", textAlign: "center" }}>
                <ClipboardList size={48} style={{ color: "var(--text-muted)", margin: "0 auto 20px", opacity: 0.3, display: "block" }} />
                <h4 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.fbSelectFormTypeToStart || "Select a form type above to get started"}</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t.fbSelectFormTypeDesc || "Each form type (K Pre-Test, K Post-Test, A - Attitude, S - Skill) can only be created once per event."}
                </p>
              </div>
            ) : !activeFormId && !canManageForms ? (
              // Only a genuine "nothing to show" case for view-only viewers (smo)
              // with zero forms. A manager with activeFormId === null is either
              // mid-pick (handled above) or actively drafting a brand-new,
              // not-yet-saved form (see startNewForm) — that must fall through to
              // the editor below, not this placeholder.
              <div style={{ padding: "60px 40px", textAlign: "center" }}>
                <ClipboardList size={48} style={{ color: "var(--text-muted)", margin: "0 auto 20px", opacity: 0.3, display: "block" }} />
                <h4 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.fbNoFormsYetTitle || "No feedback forms yet"}</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t.fbNoFormsYetDesc || "This event's organizer hasn't created one yet."}
                </p>
              </div>
            ) : (
              <div style={{ padding: "clamp(16px, 5vw, 40px)" }}>
                {formBuilderSuccess && (
                  <div className="animate-fade-in" style={{
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    color: "#10b981",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> {formBuilderSuccess}
                  </div>
                )}

                {formBuilderError && (
                  <div className="animate-fade-in" style={{
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    color: "#ef4444",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {formBuilderError}
                  </div>
                )}

                {/* Review gate banner (see forms.reviewStatus in schema.ts) — a
                    president's form is hidden-but-visible ("closed") to
                    participants until staff approves it here; editing an
                    approved form sends it back to pending automatically
                    (server-side, see api/admin/events/[id]/form/route.ts). */}
                {activeFormId && formReviewStatus === "pending" && (
                  <div className="animate-fade-in" style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.25)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <p style={{ fontWeight: 800, fontSize: 13, color: "#f59e0b" }}>{t.fbReviewPendingBannerTitle || "Awaiting review"}</p>
                        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>{t.fbReviewPendingBannerDesc}</p>
                      </div>
                    </div>
                    {formReviewNote && (
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", background: "var(--bg-elevated)", borderRadius: 10, padding: "8px 12px" }}>
                        <strong>{t.fbReviewNoteLabel || "Note from staff"}:</strong> {formReviewNote}
                      </p>
                    )}
                    {!isAttendanceOnly && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={formReviewSaving}
                          onClick={() => reviewActiveForm("approve")}
                        >
                          {formReviewSaving ? <div className="spinner w-3 h-3 border-2" /> : <CheckCircle2 size={14} />} {t.fbReviewApproveBtn || "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={formReviewSaving}
                          onClick={() => { setRequestChangesNote(""); setRequestChangesOpen(true); }}
                        >
                          <AlertTriangle size={14} /> {t.fbReviewRequestChangesBtn || "Request Changes"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Custom "Request Changes" modal — replaces window.prompt.
                    Portaled to document.body: this lives inside the Feedback
                    Form modal's own .animate-fade-in-up scrollable card
                    (line ~4850), which keeps a residual transform after its
                    entrance animation finishes (fill-mode: both) — that makes
                    it the containing block for any position:fixed descendant,
                    so an un-portaled overlay here scrolls WITH that card
                    instead of pinning to the viewport (the exact bug
                    ProposeEventSection.tsx's own modals already hit — see
                    that file's identical comment). Centered + clamp()-padded
                    so it stays usable on mobile (375px) and iPad (768/1024px)
                    widths. */}
                {requestChangesOpen && createPortal(
                  <div
                    style={{
                      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
                      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      zIndex: 2500, padding: "clamp(12px, 4vw, 24px)",
                    }}
                    onClick={() => { if (!formReviewSaving) setRequestChangesOpen(false); }}
                  >
                    <div
                      className="animate-fade-in-up"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "var(--bg-surface)", width: "100%", maxWidth: 440,
                        borderRadius: "clamp(20px, 5vw, 32px)", overflow: "hidden",
                        boxShadow: "0 30px 60px rgba(0,0,0,0.2)", border: "1px solid var(--border-medium)",
                      }}
                    >
                      <div style={{ padding: "24px 28px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <h3 style={{ fontSize: 18, fontWeight: 800 }}>{t.fbReviewRequestChangesBtn || "Request Changes"}</h3>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                          {t.fbReviewRequestChangesPrompt || "What needs to change? (visible to the president)"}
                        </p>
                      </div>
                      <div style={{ padding: "20px 28px" }}>
                        <textarea
                          autoFocus
                          value={requestChangesNote}
                          onChange={(e) => setRequestChangesNote(e.target.value)}
                          maxLength={1000}
                          rows={4}
                          className="input"
                          style={{ width: "100%", resize: "vertical", borderRadius: 12, padding: "10px 14px", fontSize: 14 }}
                        />
                      </div>
                      <div style={{ padding: "16px 28px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
                        <button className="btn btn-ghost" onClick={() => setRequestChangesOpen(false)} disabled={formReviewSaving}>
                          {t.adminProposalsCancelButton || "Cancel"}
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={formReviewSaving || !requestChangesNote.trim()}
                          onClick={async () => {
                            const note = requestChangesNote.trim();
                            setRequestChangesOpen(false);
                            await reviewActiveForm("requestChanges", note);
                          }}
                        >
                          {formReviewSaving ? <div className="spinner w-3 h-3 border-2" /> : null}
                          {t.adminProposalsConfirmButton || "Confirm"}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {formTab === "edit" && canManageForms ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {/* General Settings — title/description card is full-width with the
                        type badge inline (was a second, much-taller sibling card that
                        left a large dead-space gap under this one). Rewards + status
                        below get their own equal-height row instead. */}
                    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 16 }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <div className="field" style={{ flex: "1 1 260px" }}>
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.eventFormTitleLabel}</label>
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px" }}
                            value={formTitle}
                            onChange={e => setFormTitle(e.target.value)}
                            placeholder="e.g. Event Satisfaction Survey"
                          />
                        </div>
                        {/* Form Type Badge — read-only, fixed when the form was created */}
                        {(() => {
                          const c = FORM_TYPE_COLORS[activeFormType] || FORM_TYPE_COLORS["K_post"];
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "8px 14px", borderRadius: 12, background: c.bg, border: `1px solid ${c.border}`, marginTop: 22 }}>
                              <span style={{ fontSize: 12, fontWeight: 900, color: c.text }}>{FORM_TYPE_LABELS[activeFormType] || activeFormType}</span>
                              <span style={{ fontSize: 11, color: c.text, opacity: 0.7 }}>
                                {activeFormType === "K_pre" ? (t.fbFormTypeNoAttendance || "No attendance required") : activeFormType === "S" ? (t.fbFormTypeAdminOnly || "Admin/staff only") : (t.fbFormTypeRequiresCheckin || "Requires check-in")}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="field">
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.eventFormInstructionLabel}</label>
                        <textarea
                          className="input custom-scrollbar"
                          style={{ width: "100%", minHeight: 80, borderRadius: 12, padding: "12px 16px", resize: "vertical" }}
                          value={formDescription}
                          onChange={e => setFormDescription(e.target.value)}
                          placeholder="Helpful prompt text for students..."
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 24 }}>
                      <div className="field" style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Zap size={14} style={{ color: "var(--accent-primary)" }} /> {t.fbHousePointsReward || "House Points Reward"}
                        </label>
                        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{t.fbWinningHouseGetsPoints || "Winning house gets these points."}</p>
                        <input
                          type="number"
                          className="input"
                          style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", fontWeight: 800 }}
                          value={formPoints}
                          onChange={e => setFormPoints(Math.max(0, parseInt(e.target.value) || 0))}
                        />
                      </div>

                      <div className="field" style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Sparkles size={14} style={{ color: "var(--accent-primary)" }} /> {t.fbIndividualPointsReward || "Individual Points Reward"}
                        </label>
                        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{t.fbEachSubmitterGetsPoints || "Each student gets these points when they submit."}</p>
                        <input
                          type="number"
                          className="input"
                          style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", fontWeight: 800 }}
                          value={formIndividualPoints}
                          onChange={e => setFormIndividualPoints(Math.max(0, parseInt(e.target.value) || 0))}
                        />
                      </div>

                      {(() => {
                        // Read-only lifecycle status. There is no manual open/close
                        // anymore — the schedule window below drives everything, and
                        // points auto-award once the close time passes.
                        const now = new Date();
                        const opens = formOpensAt ? new Date(formOpensAt) : null;
                        const closes = formClosesAt ? new Date(formClosesAt) : null;
                        let dot = "var(--green-house)";
                        let label = t.fbStatusOpenForEntries || "Open for entries";
                        if (formIsAwarded) {
                          dot = "#10b981"; label = t.fbStatusFinalizedAwarded || "Finalized & points awarded";
                        } else if (closes && now > closes) {
                          dot = "var(--text-muted)"; label = t.fbStatusClosedAutoAward || "Closed — points will be awarded automatically";
                        } else if (opens && now < opens) {
                          dot = "#6366f1"; label = t.fbStatusScheduledNotOpen || "Scheduled — not open yet";
                        }
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)" }}>
                                {t.fbStatusPrefix || "Status:"} {label}
                              </span>
                            </div>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                              {t.fbStatusDesc || "Set the open/close times in the schedule below. When the close time passes, the house with the most submissions automatically wins the points — no manual action needed."}
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Schedule window (auto open/close by date & time) */}
                    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                        <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbScheduleHeading || "Schedule"}</h4>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
                        {t.fbScheduleDescPart1 || "Set when this form opens and closes (Bangkok time). Leave "}<b>{t.fbOpensAt || "Opens at"}</b>{t.fbScheduleDescPart2 || " blank to open immediately. "}<b>{t.fbClosesAt || "Closes at"}</b>{t.fbScheduleDescPart3 || " is required: when it passes, entries stop and the winning house is awarded automatically."}
                      </p>
                      {formIsAwarded && (
                        <p style={{ fontSize: 12, color: "#b45309", fontWeight: 700, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          <span>{t.fbReopenWarningPart1 || "This form already closed and awarded its points. Setting "}<b>{t.fbClosesAt || "Closes at"}</b>{t.fbReopenWarningPart2 || " back to a future time re-opens it and "}<b>{t.fbReopenWarningBold || "takes the awarded points back"}</b>{t.fbReopenWarningPart3 || " from the winning house — they are re-awarded when it closes again."}</span>
                        </p>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 16 }}>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.fbOpensAt || "Opens at"}</label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px" }}
                            value={formOpensAt}
                            onChange={(e) => setFormOpensAt(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.fbClosesAt || "Closes at"} <span style={{ color: "#ef4444" }}>*</span></label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", borderColor: !formClosesAt ? "#ef4444" : undefined }}
                            value={formClosesAt}
                            onChange={(e) => setFormClosesAt(e.target.value)}
                          />
                        </div>
                      </div>
                      {!formClosesAt && (
                        <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {t.fbValidationCloseRequired || "A close time is required so the form can auto-close and award points."}</p>
                      )}
                      {formOpensAt && formClosesAt && new Date(formClosesAt) <= new Date(formOpensAt) && (
                        <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {t.fbValidationCloseBeforeOpen || "Close time is before open time — students will never be able to submit."}</p>
                      )}
                    </div>

                    {/* Respondent identity visibility for non-admin viewers (registration/
                        organizer, plus the owning club/major president). super_admin/admin
                        always see identity — see canSeeRespondentIdentity. Gated on
                        canManageForms (same set allowed to create/edit this form at all) —
                        a president's choice here never goes live on its own: the review gate
                        (reviewStatus starts 'pending' for a president's create/edit, see
                        POST/PATCH .../form) means staff always reviews it before it's
                        visible to anyone. */}
                    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12, opacity: canManageForms ? 1 : 0.5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {formShowRespondentIdentity ? <Eye size={16} style={{ color: "var(--accent-primary)" }} /> : <EyeOff size={16} style={{ color: "var(--accent-primary)" }} />}
                        <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbIdentityToggleLabel || "Show respondent identity"}</h4>
                      </div>
                      <div
                        onClick={() => { if (canManageForms) setFormShowRespondentIdentity((v) => !v); }}
                        style={{
                          minHeight: 48,
                          background: "var(--bg-surface)",
                          borderRadius: 16,
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          cursor: canManageForms ? "pointer" : "not-allowed",
                          border: formShowRespondentIdentity ? "1px solid var(--accent-primary)" : "1px solid transparent",
                          transition: "all 0.2s"
                        }}
                      >
                        <div style={{
                          width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                          border: "2px solid var(--border-medium)",
                          background: formShowRespondentIdentity ? "var(--accent-primary)" : "transparent",
                          borderColor: formShowRespondentIdentity ? "var(--accent-primary)" : "var(--border-medium)",
                          display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s"
                        }}>
                          {formShowRespondentIdentity && <CheckCircle2 size={16} color="white" />}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                          {!canManageForms
                            ? (t.eventStaffOnlyFieldHint || "Editable by admin, registration, and organizer roles only.")
                            : formShowRespondentIdentity ? (t.fbIdentityToggleHintOn || "Registration/organizer viewers will see who submitted each response. Super-admins/admins always do.") : (t.fbIdentityToggleHintOff || "Registration/organizer viewers see anonymized responses — no name, student ID, or contact info. Super-admins/admins always see full identity.")}
                        </span>
                      </div>
                      {isAttendanceOnly && (
                        <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.4 }}>
                          {t.fbIdentityPresidentReviewHint || "Staff reviews your choice before this form goes live — it won't be visible to anyone until approved."}
                        </p>
                      )}
                    </div>

                    {/* S-form assignment — who may see & fill this skill form */}
                    {activeFormType === "S" && (
                      <div style={{ background: "rgba(239,68,68,0.04)", padding: 24, borderRadius: 24, border: "1px solid rgba(239,68,68,0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ClipboardList size={16} style={{ color: "#ef4444" }} />
                          <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbSFormWhoCanFill || "Who can do this form"}</h4>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
                          {t.fbSFormDesc || "Skill forms are hidden from everyone except super-admins/admins and the people you assign here (by role or by person). It appears in their dashboard history to fill — no event check-in needed."}
                        </p>

                        {/* By role */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.fbSFormAssignByRole || "Assign by role"}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                            {ASSIGNABLE_FORM_ROLES.map((role) => {
                              const on = formAssignedRoles.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  disabled={formIsAwarded}
                                  onClick={() => setFormAssignedRoles((prev) => on ? prev.filter((r) => r !== role) : [...prev, role])}
                                  style={{
                                    padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800, cursor: formIsAwarded ? "not-allowed" : "pointer",
                                    background: on ? "rgba(239,68,68,0.12)" : "var(--bg-surface)",
                                    color: on ? "#ef4444" : "var(--text-secondary)",
                                    border: on ? "1.5px solid rgba(239,68,68,0.4)" : "1.5px solid var(--border-subtle)",
                                  }}
                                >
                                  {on ? "✓ " : ""}{ASSIGNABLE_ROLE_LABELS[role] || role}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* By person */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.fbSFormAssignPeople || "Assign specific people"} ({formAssignedUserIds.length})</span>
                          {/* Selected chips */}
                          {formAssignedUserIds.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                              {formAssignedUserIds.map((uid) => {
                                const u = assigneeUsers.find((x) => x.id === uid);
                                return (
                                  <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
                                    {u ? (u.name || u.studentId || uid) : uid}
                                    <button type="button" disabled={formIsAwarded} onClick={() => setFormAssignedUserIds((prev) => prev.filter((x) => x !== uid))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px", marginTop: 10 }}
                            placeholder={t.fbSFormSearchPlaceholder || "Search people by name or student ID…"}
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            disabled={formIsAwarded}
                          />
                          {assigneeSearch.trim().length > 0 && (
                            <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                              {assigneeUsers
                                .filter((u) => {
                                  const q = assigneeSearch.trim().toLowerCase();
                                  return (u.name || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                                })
                                .slice(0, 30)
                                .map((u) => {
                                  const on = formAssignedUserIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      disabled={formIsAwarded}
                                      onClick={() => setFormAssignedUserIds((prev) => on ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                                      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgba(239,68,68,0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                                    >
                                      <span style={{ fontWeight: 700 }}>{u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}</span></span>
                                      <span style={{ fontSize: 12, fontWeight: 900, color: on ? "#ef4444" : "var(--accent-primary)" }}>{on ? (t.fbSFormAddedLabel || "✓ Added") : (t.fbSFormAddLabel || "+ Add")}</span>
                                    </button>
                                  );
                                })}
                              {assigneeUsers.length === 0 && (
                                <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{t.fbSFormLoadingPeople || "Loading people…"}</p>
                              )}
                            </div>
                          )}
                        </div>

                        {formAssignedRoles.length === 0 && formAssignedUserIds.length === 0 && (
                          <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                            {t.fbSFormNoOneAssigned || "No one assigned yet — only super-admins/admins can see and fill this form."}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Sections & Questions */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <h4 style={{ fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "var(--accent-primary)", color: "#fff", fontSize: 12 }}>{allFormQuestions.length}</span>
                          {lang === "th" ? "ส่วนและคำถาม" : lang === "cn" ? "章节与问题" : lang === "mm" ? "အပိုင်းများနှင့် မေးခွန်းများ" : "Sections & Questions"}
                        </h4>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgba(99,102,241,0.1)", color: "#6366f1", border: "none", cursor: "pointer" }}
                          onClick={addSection}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} style={{ flexShrink: 0 }} /> {lang === "th" ? "เพิ่มส่วน" : lang === "cn" ? "添加章节" : lang === "mm" ? "အပိုင်းထည့်ရန်" : "Add Section"}</span>
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                        {formSections.map((section, sIdx) => (
                          <div key={section.id} style={{ background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 24, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                            {/* Section header */}
                            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 900, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
                                    style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-elevated)", padding: "20px", borderRadius: 20, border: q.graded ? "1px solid rgba(16,185,129,0.4)" : "1px solid var(--border-subtle)" }}
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
                                          style={{ padding: "6px 12px", height: 40, borderRadius: 10, border: "none", background: q.required ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.03)", color: q.required ? "#10b981" : "var(--text-muted)", whiteSpace: "nowrap", fontWeight: 800, fontSize: 11, cursor: "pointer" }}
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
                                          {q.graded && <span style={{ color: "#10b981", marginLeft: 8 }}>{lang === "th" ? "• แตะวงกลมเพื่อตั้งคำตอบที่ถูก" : lang === "cn" ? "• 点击圆圈设为正确答案" : lang === "mm" ? "• မှန်ကန်သောအဖြေသတ်မှတ်ရန် နှိပ်ပါ" : "• tap the circle to mark the correct answer"}</span>}
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
                                              style={{ width: 22, height: 22, borderRadius: q.type === "choice" ? "50%" : 6, border: `2px solid ${isCorrect ? "#10b981" : "var(--border-medium)"}`, background: isCorrect ? "#10b981" : "transparent", color: "#fff", cursor: q.graded ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}
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
                                              style={{ width: 36, height: 36, padding: 0, color: "#ef4444", borderRadius: 8, fontSize: 14, fontWeight: 800 }}
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
                                          style={{ padding: "6px 14px", height: 36, borderRadius: 10, border: "none", background: q.graded ? "rgba(16,185,129,0.12)" : "rgba(0,0,0,0.03)", color: q.graded ? "#10b981" : "var(--text-muted)", fontWeight: 800, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
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
                                        <CornerDownRight size={14} style={{ color: "#6366f1" }} />
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
                              style={{ alignSelf: "flex-start", borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgba(255,107,0,0.1)", color: "var(--accent-primary)", border: "none", cursor: "pointer" }}
                              onClick={() => addQuestion(section.id)}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} style={{ flexShrink: 0 }} /> {t.eventAddQuestionLabel}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", borderTop: "1px solid var(--border-subtle)", paddingTop: 28, marginTop: 12 }}>
                      <div>
                        {activeFormId && !formIsAwarded && (
                          <button
                            className="btn btn-danger"
                            type="button"
                            style={{ height: 40, borderRadius: 12, padding: "0 16px", fontSize: 12 }}
                            onClick={() => setConfirmModal({
                              show: true,
                              title: t.fbDeleteFormTitle || "Delete this form?",
                              message: t.fbDeleteFormMessage || "This will permanently delete the form and all its submissions.",
                              confirmText: t.fbBtnDeleteForm || "Delete Form",
                              cancelText: t.cancel || "Cancel",
                              isDanger: true,
                              onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); deleteActiveForm(); }
                            })}
                          >
                            <Trash2 size={13} style={{ marginRight: 6 }} /> {t.fbBtnDeleteForm || "Delete Form"}
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end", flex: 1 }}>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          style={{ height: 46, borderRadius: 12, padding: "0 24px", whiteSpace: "nowrap" }}
                          onClick={closeFormBuilder}
                        >
                          {t.cancel || "Cancel"}
                        </button>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ height: 46, borderRadius: 12, padding: "0 24px", whiteSpace: "nowrap" }}
                          disabled={formSaving}
                          onClick={() => saveForm()}
                        >
                          {formSaving ? <div className="spinner w-4 h-4 border-2" /> : formIsAwarded ? (t.fbBtnReopen || "Re-open & Save") : activeFormId ? (t.fbBtnSaveChanges || "Save Changes") : (t.fbBtnCreateForm || "Create Form")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                    
                    {/* Auto-award status banner — points are awarded automatically
                        when the scheduled close time passes; there is no manual
                        award/open/close action anymore. */}
                    {(() => {
                      const now = new Date();
                      const closes = formClosesAt ? new Date(formClosesAt) : null;
                      const hasClosed = !!closes && now > closes;

                      if (formIsAwarded) {
                        return (
                          <div
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
                            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 24, padding: "24px 32px" }}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "rgba(16,185,129,0.1)", color: "#10b981", flexShrink: 0 }}>
                                <CheckCircle2 size={22} />
                              </div>
                              <div>
                                <h4 style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)", marginBottom: 4 }}>{t.fbContestFinalizedTitle || "Contest Finalized & Closed"}</h4>
                                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                  {t.fbContestFinalizedDesc || "Points have been awarded to the winning house and this evaluation form is frozen."}
                                </p>
                              </div>
                            </div>
                            <div style={{ padding: "8px 16px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#10b981", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
                              <Lock size={14} style={{ flexShrink: 0 }} /> {t.fbPermanentLock || "Permanent Lock"}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
                          style={{ background: "linear-gradient(135deg, rgba(255,107,0,0.08) 0%, rgba(255,50,0,0.08) 100%)", border: "1px solid rgba(255,107,0,0.2)", borderRadius: 24, padding: "24px 32px" }}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", background: "rgba(255,107,0,0.1)", color: "var(--accent-primary)", flexShrink: 0 }}>
                              {hasClosed ? <Trophy size={22} /> : <Calendar size={22} />}
                            </div>
                            <div>
                              <h4 style={{ fontSize: 16, fontWeight: 900, color: "var(--accent-primary)", marginBottom: 4 }}>
                                {hasClosed ? (t.fbClosedAwaitingAward || "Closed — awaiting automatic award") : (t.fbAwardsWhenFormCloses || "Awards automatically when the form closes")}
                              </h4>
                              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                {hasClosed
                                  ? <>The close time has passed. The house with the most submissions will automatically receive <b>+{formPoints} PTS</b> — it settles the next time the dashboard or scoreboard is opened, or at the daily 23:00 run.</>
                                  : formClosesAt
                                  ? <>When the close time passes, the house with the most submissions automatically receives <b>+{formPoints} PTS</b>. No manual action needed.</>
                                  : <>No <b>Closes at</b> time is set, so this form stays open and will <b>not</b> auto-award. Set a close time under Design &amp; Rules to enable automatic awarding.</>}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Stats Leaderboard Cards */}
                    <div>
                      <h4 style={{ fontSize: 16, fontWeight: 900, marginBottom: 20, display: "inline-flex", alignItems: "center", gap: 6 }}><BarChart3 size={16} style={{ flexShrink: 0 }} /> {t.fbHouseSubmissionStandings || "House Submission Standings"}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {["red", "green", "yellow", "blue"].map(hId => {
                          const houseColors: Record<string, string> = {
                            red: "var(--red-house)",
                            green: "var(--green-house)",
                            yellow: "var(--yellow-house)",
                            blue: "var(--blue-house)"
                          };
                          const houseNames: Record<string, string> = {
                            red: t.houseMom || "Mom",
                            green: t.houseTo || "To",
                            yellow: t.houseLuang || "Luang",
                            blue: t.houseMakara || "Makon"
                          };
                          const count = formStats?.[hId] || 0;
                          return (
                            <div 
                              key={hId} 
                              style={{ 
                                background: "var(--bg-elevated)", 
                                border: `1px solid var(--border-subtle)`,
                                borderTop: `5px solid ${houseColors[hId]}`,
                                borderRadius: 16, 
                                padding: 20, 
                                textAlign: "center" 
                              }}
                            >
                              <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{houseNames[hId]}</p>
                              <p style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)" }}>{count}</p>
                              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{t.fbSubmissionsCount || "submissions"}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* List of Submissions */}
                    <div ref={submissionsListRef} style={{ scrollMarginTop: 80 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                        <h4 style={{ fontSize: 16, fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 6 }}><MessageSquare size={16} style={{ flexShrink: 0 }} /> {t.fbStudentSubmissions || "Student Submissions"} ({formSubmissions.length})</h4>
                        <button
                          type="button"
                          className="btn"
                          style={{ borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 800, background: "rgba(16,185,129,0.12)", color: "#10b981", border: "none", cursor: formSubmissions.length === 0 ? "not-allowed" : "pointer", opacity: formSubmissions.length === 0 ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}
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
                                    <span style={{ fontSize: 12, fontWeight: 900, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 10px", borderRadius: 999 }}>
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
                                            style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", fontSize: 13, fontWeight: 800, color: "var(--accent-primary)", background: "rgba(255,107,0,0.08)", border: "1px solid rgba(255,107,0,0.15)", borderRadius: 10, padding: "8px 14px", textDecoration: "none" }}
                                          >
                                            <Download size={14} /> {(ans.split(".").pop() || "file").toUpperCase()} · {lang === "th" ? "เปิดไฟล์" : lang === "cn" ? "查看文件" : lang === "mm" ? "ဖိုင်ဖွင့်ရန်" : "Open file"}
                                          </a>
                                        ) : (
                                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}>
                                            {lang === "th" ? "ไม่มีไฟล์" : lang === "cn" ? "无文件" : lang === "mm" ? "ဖိုင်မရှိ" : "No file"}
                                          </span>
                                        )
                                      ) : q.type === "rating" ? (
                                        <div style={{ display: "flex", gap: 2, color: "#ffb000" }}>
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
                                                  background: "rgba(255,107,0,0.08)",
                                                  color: "var(--accent-primary)",
                                                  padding: "4px 8px",
                                                  borderRadius: 8,
                                                  border: "1px solid rgba(255,107,0,0.15)"
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
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

      {/* Premium custom Confirm Modal */}
      {confirmModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: confirmModal.isDanger ? "rgba(239, 68, 68, 0.1)" : "rgba(255, 107, 0, 0.1)",
              color: confirmModal.isDanger ? "#ef4444" : "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertCircle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {confirmModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {confirmModal.message}
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 700 }}
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              >
                {confirmModal.cancelText || "Cancel"}
              </button>
              <button
                className="btn"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  background: confirmModal.isDanger 
                    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" 
                    : "linear-gradient(135deg, #ff6b00 0%, #ff3d00 100%)",
                  color: "#fff",
                  border: "none",
                  boxShadow: confirmModal.isDanger 
                    ? "0 4px 14px rgba(239, 68, 68, 0.3)" 
                    : "0 4px 14px rgba(255, 107, 0, 0.3)"
                }}
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>,
    document.body
  );
}
