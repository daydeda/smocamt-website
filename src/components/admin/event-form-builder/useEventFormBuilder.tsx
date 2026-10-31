"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { normalizeForm, serializeForm, newId, BRANCH_NEXT, type FormQuestion, type FormSection } from "@/lib/forms/form-schema";
import { FormBuilderSubmission, EventFormSummary, FORM_TYPE_LABELS, toDatetimeLocal, builderFingerprint, EventFormBuilderModalProps } from "./form-builder-model";

// State, effects and handlers for EventFormBuilderModal.tsx. Moved out of the page
// component so its JSX can be split into section components that read from
// this hook's result (passed down as `ctx`).
export function useEventFormBuilder({ eventId, eventTitle, onClose, onChanged }: EventFormBuilderModalProps) {
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
  // "registration") gets the staff-tier breadth the retired "registration" ROLE
  // had — mirrors admin/events/page.tsx's globalRegPosition. Without this, a
  // holder of this global title saw the page's "Create Form" button (that page
  // DOES account for it) but this modal — which re-derives its own permissions
  // independently — would still open read-only.
  const globalRegPosition = isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);

  const isAttendanceOnly = !globalRegPosition && !myRoles.some((r) =>
    ["super_admin", "admin"].includes(r)
  );

  const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));

  // A "registration" TITLE (src/lib/positions.ts) held in a club or major, or
  // (via globalRegPosition above) as smo/anusmo — also gets full form management, scoped server-side to
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
      setFormBuilderError(t.adminEvfErrLoad);
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
      setFormBuilderError(t.adminEvfErrCloseRequired);
      return;
    }
    if (formOpensAt && new Date(formClosesAt) <= new Date(formOpensAt)) {
      setFormBuilderError(t.adminEvfErrCloseAfterOpen);
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
        setFormBuilderSuccess(t.adminEvfSaved);
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
        setFormBuilderError(t.adminEvfErrSave + ": " + (d.error || t.adminEvfErrUnknown));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError(t.adminEvfErrSave);
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
        setFormBuilderSuccess(t.adminEvfDeleted);
        onChanged?.();
      } else {
        const d = await res.json();
        setFormBuilderError(t.adminEvfErrDelete + ": " + (d.error || t.adminEvfErrUnknown));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError(t.adminEvfErrDelete);
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
        setFormBuilderError(t.adminEvfErrReview + ": " + ((d && d.error) || t.adminEvfErrUnknown));
        return;
      }
      setFormReviewStatus(d.form.reviewStatus);
      setFormReviewNote(d.form.reviewNote);
      await refreshAllForms();
      onChanged?.();
      setFormBuilderSuccess(action === "approve" ? t.adminEvfApproved : t.adminEvfChangesRequested);
    } catch (e) {
      console.error(e);
      setFormBuilderError(t.adminEvfErrReview);
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

  return {
    t,
    lang,
    session,
    myRoles,
    globalRegPosition,
    isAttendanceOnly,
    isPresidentRole,
    hasRegistrationTitle,
    canManageForms,
    formLoading,
    setFormLoading,
    formTitle,
    setFormTitle,
    formDescription,
    setFormDescription,
    formPoints,
    setFormPoints,
    formIndividualPoints,
    setFormIndividualPoints,
    formSections,
    setFormSections,
    formIsAwarded,
    setFormIsAwarded,
    formOpensAt,
    setFormOpensAt,
    formClosesAt,
    setFormClosesAt,
    formAssignedRoles,
    setFormAssignedRoles,
    formAssignedUserIds,
    setFormAssignedUserIds,
    formShowRespondentIdentity,
    setFormShowRespondentIdentity,
    assigneeUsers,
    setAssigneeUsers,
    assigneeSearch,
    setAssigneeSearch,
    ensureAssigneeUsersLoaded,
    formStats,
    setFormStats,
    formSubmissions,
    setFormSubmissions,
    formSaving,
    setFormSaving,
    formReviewStatus,
    setFormReviewStatus,
    formReviewNote,
    setFormReviewNote,
    formReviewSaving,
    setFormReviewSaving,
    requestChangesOpen,
    setRequestChangesOpen,
    requestChangesNote,
    setRequestChangesNote,
    formTab,
    setFormTab,
    submissionsPage,
    setSubmissionsPage,
    SUBMISSIONS_PER_PAGE,
    submissionsListRef,
    goToSubmissionsPage,
    allEventForms,
    setAllEventForms,
    activeFormId,
    setActiveFormId,
    activeFormType,
    setActiveFormType,
    showNewFormPicker,
    setShowNewFormPicker,
    formBuilderError,
    setFormBuilderError,
    formBuilderSuccess,
    setFormBuilderSuccess,
    confirmModal,
    setConfirmModal,
    pristineFingerprint,
    setPristineFingerprint,
    loadFormIntoEditor,
    loadForms,
    refreshAllForms,
    startNewForm,
    saveForm,
    deleteActiveForm,
    reviewActiveForm,
    builderDirty,
    closeFormBuilder,
    mutateQuestion,
    addSection,
    removeSection,
    updateSection,
    moveSection,
    addQuestion,
    removeQuestion,
    updateQuestion,
    addOption,
    removeOption,
    updateOption,
    toggleGraded,
    setPoints,
    setChoiceCorrect,
    toggleMultipleCorrect,
    setTextCorrect,
    setBranch,
    setVisibleIf,
    allFormQuestions,
    exportSubmissionsXlsx,
    eventId,
    eventTitle,
    onClose,
    onChanged,
  };
}

export type EventFormBuilderCtx = ReturnType<typeof useEventFormBuilder>;
