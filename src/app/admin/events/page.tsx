"use client";

import { useEffect, useState, useRef } from "react";
import {
  Plus, Edit2, Trash2, Calendar, MapPin, Clock,
  ArrowRight, User, Users, CheckCircle2, Search,
  Sparkles, Filter, MoreVertical, X, ExternalLink,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CornerDownRight, AlertCircle, BarChart3, RefreshCw, Zap,
  Activity, Phone, HeartPulse, Info, Trophy, ClipboardList, Download
} from "lucide-react";
import { useSession } from "next-auth/react";
import { parseRichText } from "@/lib/rich-text";
import { useLanguage } from "@/lib/LanguageContext";
import { usePolling } from "@/lib/usePolling";
import {
  normalizeForm,
  serializeForm,
  newId,
  BRANCH_NEXT,
  BRANCH_SUBMIT,
  type FormQuestion,
  type FormSection,
} from "@/lib/form-schema";

interface AdminEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  registrationOpenTime: string | null;
  registrationCloseTime: string | null;
  quota: number | null;
  pointsAwarded: number;
  imageUrl: string | null;
  imageUrls: string[] | null;
  walkInsEnabled: boolean;
  quotaWalkIn: number | null;
  targetThai: boolean;
  targetInternational: boolean;
  quotaThai: number | null;
  quotaInternational: number | null;
  allowedRoles: string[] | null;
  attendeeCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

interface AdminStudent {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
  email: string;
  phone: string | null;
  major: string | null;
  role: string | null;
  roles: string[] | null;
  religion: string | null;
  contactChannels: string | null;
  chronicDiseases: string | null;
  medicalHistory: string | null;
  drugAllergies: string | null;
  foodAllergies: string | null;
  dietaryRestrictions: string | null;
  faintingHistory: boolean | null;
  emergencyMedication: string | null;
  emergencyContacts: EmergencyContact[];
  houseId: string | null;
  house: { id: string; name: string; color: string } | null;
  // Server-derived "has a medical condition" signal. Sent to all admin-area
  // roles; the raw medical detail above is only populated for super_admin/admin.
  hasMedicalInfo?: boolean;
  // For non-admins: the medical categories the student filled in, as i18n keys
  // (e.g. "drugAllergies"), with no values — so they see what kind of condition
  // exists but not the detail.
  medicalCategories?: string[];
}

interface AdminAttendance {
  id: string;
  eventId: string;
  studentId: string;
  checkInTime: string | null;
  method: string | null;
  status: string;
  scannedBy: string | null;
  medsCheckOption: string | null;
  user?: AdminStudent;
}

interface FormBuilderSubmission {
  id: string;
  studentName: string;
  studentId: string;
  houseId: string;
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
  isActive: boolean;
  isAwarded: boolean;
  opensAt: string | null;
  closesAt: string | null;
  assignedRoles: string[];
  assignedUserIds: string[];
  stats: Record<string, number>;
  submissions: FormBuilderSubmission[];
}

const FORM_TYPE_LABELS: Record<string, string> = {
  K_pre: "K Pre-Test",
  K_post: "K Post-Test",
  A: "A - Attitude",
  S: "S - Skill",
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
  formSections: FormSection[];
  formIsAwarded: boolean;
  formOpensAt: string;
  formClosesAt: string;
  formAssignedRoles: string[];
  formAssignedUserIds: string[];
};
const builderFingerprint = (f: BuilderState): string =>
  JSON.stringify([
    f.activeFormType, f.formTitle, f.formDescription, f.formPoints,
    serializeForm(f.formSections), f.formIsAwarded, f.formOpensAt, f.formClosesAt,
    [...f.formAssignedRoles].sort(), [...f.formAssignedUserIds].sort(),
  ]);

const FORM_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  K_pre:  { bg: "rgba(99,102,241,0.12)",  text: "#6366f1", border: "rgba(99,102,241,0.3)"  },
  K_post: { bg: "rgba(16,185,129,0.12)",  text: "#10b981", border: "rgba(16,185,129,0.3)"  },
  A:      { bg: "rgba(245,158,11,0.12)",  text: "#f59e0b", border: "rgba(245,158,11,0.3)"  },
  S:      { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", border: "rgba(239,68,68,0.3)"   },
};

// Role priority (mirrors ROLE_PRIORITY in src/auth.ts). A person's "primary"
// role is the highest-priority role they hold; "student" is the lowest, so an
// attendee counts as a regular student only when they hold no elevated role
// (smo, anusmo, registration, organizer, staff, office, etc.).
const ROLE_PRIORITY = ["super_admin", "admin", "registration", "organizer", "smo", "anusmo", "staff", "professor", "officer", "student"];

const isRegularStudent = (user: AdminStudent | null | undefined): boolean => {
  if (!user) return false;
  const roles = (user.roles && user.roles.length > 0)
    ? user.roles
    : (user.role ? [user.role] : ["student"]);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "student";
  return primary === "student";
};

const ALL_PARTICIPANT_ROLES = ["student", "staff", "smo", "anusmo"] as const;
type ParticipantRole = typeof ALL_PARTICIPANT_ROLES[number];

const ROLE_LABELS: Record<ParticipantRole, string> = {
  student: "Student",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
};

const EMPTY_FORM = {
  title: "",
  description: "",
  location: "",
  startTime: "",
  endTime: "",
  registrationOpenTime: "",
  registrationCloseTime: "",
  quota: 0,
  pointsAwarded: 0,
  imageUrl: "",
  imageUrls: [] as string[],
  walkInsEnabled: false,
  quotaWalkIn: null as number | null,
  targetThai: true,
  targetInternational: true,
  quotaThai: null as number | null,
  quotaInternational: null as number | null,
  allowedRoles: [] as string[], // empty = all roles allowed
};

export default function AdminEventsPage() {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  // The admin area also admits registration/organizer (see admin/layout.tsx),
  // but attendee exports — which include PDPA-sensitive medical & emergency
  // contact data — are restricted to super_admin/admin only.
  const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
  const canExportAttendance = myRoles.includes("super_admin") || myRoles.includes("admin");
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "live" | "upcoming" | "past">("all");

  // Attendance tracking
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendance, setAttendance] = useState<AdminAttendance[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<AdminStudent | null>(null);
  const [filterMedical, setFilterMedical] = useState(false);
  const [filterNotCheckedIn, setFilterNotCheckedIn] = useState(false);
  const [filterStudentsOnly, setFilterStudentsOnly] = useState(false);
  const [filterThai, setFilterThai] = useState(true);
  const [filterInternational, setFilterInternational] = useState(true);

  // Custom Form Builder states
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [formEventId, setFormEventId] = useState<string | null>(null);
  const [formEventTitle, setFormEventTitle] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPoints, setFormPoints] = useState(50);
  const [formSections, setFormSections] = useState<FormSection[]>([]);
  const [formIsAwarded, setFormIsAwarded] = useState(false);
  // Scheduling window + S-form assignment
  const [formOpensAt, setFormOpensAt] = useState("");
  const [formClosesAt, setFormClosesAt] = useState("");
  const [formAssignedRoles, setFormAssignedRoles] = useState<string[]>([]);
  const [formAssignedUserIds, setFormAssignedUserIds] = useState<string[]>([]);
  // People directory for the S-form person-picker (loaded on demand)
  const [assigneeUsers, setAssigneeUsers] = useState<{ id: string; name: string | null; studentId: string | null; role: string | null }[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [formStats, setFormStats] = useState<Record<string, number> | null>(null);
  const [formSubmissions, setFormSubmissions] = useState<FormBuilderSubmission[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formTab, setFormTab] = useState<"edit" | "stats">("edit");
  
  // Multi-form state: list of all forms for the current event + which one is being edited
  const [allEventForms, setAllEventForms] = useState<EventFormSummary[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [activeFormType, setActiveFormType] = useState<string>("K_post");
  const [showNewFormPicker, setShowNewFormPicker] = useState(false);

  // Custom admin form builder premium notification states
  const [formBuilderError, setFormBuilderError] = useState<string | null>(null);
  const [formBuilderSuccess, setFormBuilderSuccess] = useState<string | null>(null);

  // Custom premium modals for confirmation and errors
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

  const [errorModal, setErrorModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({
    show: false,
    title: "",
    message: ""
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
    const loadedSections = normalizeForm(f.questions).sections;
    setFormSections(loadedSections);
    setFormIsAwarded(f.isAwarded || false);
    setFormOpensAt(toDatetimeLocal(f.opensAt));
    setFormClosesAt(toDatetimeLocal(f.closesAt));
    setFormAssignedRoles(f.assignedRoles || []);
    setFormAssignedUserIds(f.assignedUserIds || []);
    setFormStats(f.stats);
    setFormSubmissions(f.submissions || []);
    setFormTab(f.submissions && f.submissions.length > 0 ? "stats" : "edit");
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    // Baseline = the freshly loaded form, so only later edits read as unsaved.
    setPristineFingerprint(builderFingerprint({
      activeFormType: f.formType,
      formTitle: f.title,
      formDescription: f.description || "",
      formPoints: f.pointsAwarded || 0,
      formSections: loadedSections,
      formIsAwarded: f.isAwarded || false,
      formOpensAt: toDatetimeLocal(f.opensAt),
      formClosesAt: toDatetimeLocal(f.closesAt),
      formAssignedRoles: f.assignedRoles || [],
      formAssignedUserIds: f.assignedUserIds || [],
    }));
  };

  const openFormBuilder = async (eventId: string, eventTitle: string) => {
    setFormEventId(eventId);
    setFormEventTitle(eventTitle);
    setShowFormBuilder(true);
    setFormLoading(true);
    setFormTab("edit");
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    setShowNewFormPicker(false);
    setAllEventForms([]);
    setActiveFormId(null);
    setAssigneeSearch("");

    // Load the people directory once for the S-form person-picker (best-effort).
    if (assigneeUsers.length === 0) {
      fetch("/api/admin/students")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (Array.isArray(d)) setAssigneeUsers(d.map((u) => ({ id: u.id, name: u.name, studentId: u.studentId, role: u.role }))); })
        .catch(() => {});
    }

    try {
      const res = await fetch(`/api/admin/events/${eventId}/form`);
      const data = await res.json();
      const eventForms: EventFormSummary[] = data.forms || [];
      setAllEventForms(eventForms);

      if (eventForms.length > 0) {
        loadFormIntoEditor(eventForms[0]);
      } else {
        // No forms yet — show new-form picker
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
        setFormPoints(50);
        setFormSections(defaultSections);
        setFormIsAwarded(false);
        setFormOpensAt("");
        setFormClosesAt("");
        setFormAssignedRoles([]);
        setFormAssignedUserIds([]);
        setFormStats(null);
        setFormSubmissions([]);
        setPristineFingerprint(builderFingerprint({
          activeFormType: "K_post", formTitle: "", formDescription: "", formPoints: 50,
          formSections: defaultSections, formIsAwarded: false, formOpensAt: "", formClosesAt: "",
          formAssignedRoles: [], formAssignedUserIds: [],
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFormLoading(false);
    }
  };

  const refreshAllForms = async () => {
    if (!formEventId) return;
    const res = await fetch(`/api/admin/events/${formEventId}/form`);
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
    const newTitle = `${formEventTitle || "Event"} — ${FORM_TYPE_LABELS[type] || type}`;
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
    setFormPoints(50);
    setFormSections(newSections);
    setFormIsAwarded(false);
    setFormOpensAt("");
    setFormClosesAt("");
    setFormAssignedRoles([]);
    setFormAssignedUserIds([]);
    setFormStats(null);
    setFormSubmissions([]);
    setFormTab("edit");
    setFormBuilderError(null);
    setFormBuilderSuccess(null);
    // Baseline = the default template, so closing an untouched new form is silent.
    setPristineFingerprint(builderFingerprint({
      activeFormType: type, formTitle: newTitle, formDescription: "", formPoints: 50,
      formSections: newSections, formIsAwarded: false, formOpensAt: "", formClosesAt: "",
      formAssignedRoles: [], formAssignedUserIds: [],
    }));
  };

  const saveForm = async () => {
    if (!formEventId) return;
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

    setFormSaving(true);
    try {
      const isNew = !activeFormId;
      const res = await fetch(`/api/admin/events/${formEventId}/form`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isNew ? { formType: activeFormType } : { formId: activeFormId }),
          title: formTitle,
          description: formDescription,
          pointsAwarded: formPoints,
          questions: serializeForm(formSections),
          // Forms are always active now — the schedule window (opensAt/closesAt)
          // drives the lifecycle and auto-awards when closesAt passes.
          isActive: true,
          opensAt: formOpensAt ? new Date(formOpensAt).toISOString() : null,
          closesAt: formClosesAt ? new Date(formClosesAt).toISOString() : null,
          assignedRoles: activeFormType === "S" ? formAssignedRoles : [],
          assignedUserIds: activeFormType === "S" ? formAssignedUserIds : [],
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setFormBuilderSuccess("Evaluation form saved successfully!");
        // Just persisted — current builder state is now the saved baseline, so
        // there are no unsaved edits (also covers the new-form path, where
        // refreshAllForms can't yet match by the not-yet-set activeFormId).
        setPristineFingerprint(builderFingerprint({
          activeFormType, formTitle, formDescription, formPoints, formSections,
          formIsAwarded, formOpensAt, formClosesAt, formAssignedRoles, formAssignedUserIds,
        }));
        // If this was a new form, set the activeFormId
        if (isNew && saved.form?.id) {
          setActiveFormId(saved.form.id);
        }
        await refreshAllForms();
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
    if (!formEventId || !activeFormId) return;
    try {
      const res = await fetch(`/api/admin/events/${formEventId}/form`, {
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
      } else {
        const d = await res.json();
        setFormBuilderError("Failed to delete: " + (d.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      setFormBuilderError("Failed to delete form.");
    }
  };

  // True when the builder has edits that differ from the last loaded/saved
  // state. Skipped while loading so the mid-load state churn doesn't flicker.
  const builderDirty =
    showFormBuilder && !formLoading &&
    builderFingerprint({
      activeFormType, formTitle, formDescription, formPoints, formSections,
      formIsAwarded, formOpensAt, formClosesAt, formAssignedRoles, formAssignedUserIds,
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
        onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); setShowFormBuilder(false); },
      });
      return;
    }
    setShowFormBuilder(false);
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
      "Name", "Student ID", "House", "Submitted (Bangkok)",
      ...(anyGraded ? ["Score", "Max Score"] : []),
      ...qcols.map(c => c.key),
    ];
    const fmt = (ans: string | number | string[] | undefined) =>
      ans == null ? "" : Array.isArray(ans) ? ans.join(", ") : String(ans);

    const rows = formSubmissions.map(sub => {
      const row: Record<string, string | number> = {
        "Name": sub.studentName,
        "Student ID": sub.studentId,
        "House": sub.houseId,
        "Submitted (Bangkok)": new Date(sub.submittedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }),
      };
      if (anyGraded) {
        row["Score"] = sub.score ?? 0;
        row["Max Score"] = sub.maxScore ?? 0;
      }
      for (const c of qcols) row[c.key] = fmt(sub.answers?.[c.q.id]);
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
    ws["!cols"] = header.map(h => ({ wch: Math.min(45, Math.max(12, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submissions");
    // Keep Thai (and other Unicode) letters intact; only strip characters that
    // are illegal in filenames, then collapse whitespace/separators to "_".
    const safeTitle = (formEventTitle || "form")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 40)
      .replace(/^_+|_+$/g, "") || "form";
    XLSX.writeFile(wb, `submissions_${safeTitle}.xlsx`);
  };

  const hasActualMedicalInfo = (user: AdminStudent | null | undefined) => {
    if (!user) return false;
    const fields = [
      user.chronicDiseases,
      user.medicalHistory,
      user.drugAllergies,
      user.foodAllergies,
      user.dietaryRestrictions,
      user.emergencyMedication
    ];
    const isMeaningful = (val: string | boolean | null | undefined) => {
      if (typeof val !== 'string') return !!val;
      const t = val.trim();
      return t !== "" && t !== "-";
    };
    return fields.some(isMeaningful) || user.faintingHistory === true;
  };

  // The "has a medical condition" signal shown to every admin-area role.
  // Admins compute it from the raw fields they receive; registration/organizer
  // only get the server-derived hasMedicalInfo boolean (no detail).
  const hasMedicalSignal = (user: AdminStudent | null | undefined) =>
    !!user && (user.hasMedicalInfo === true || hasActualMedicalInfo(user));

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchEvents = async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/events", { signal });
      const data = await res.json();
      if (Array.isArray(data)) {
        setEvents(data);
      } else {
        setEvents([]);
        if (data && data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      // usePolling aborts the in-flight request on unmount / tab-hidden / overrun.
      // That's an intentional cancellation, not a failure — don't log it (Next's
      // dev overlay surfaces console.error) and don't wipe the list.
      if ((err as Error)?.name === "AbortError") return;
      console.error(err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // Poll the events listing instead of holding an SSE connection (free-tier
  // friendly, pauses when the tab is hidden).
  usePolling(fetchEvents, 8000);

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, val: typeof EMPTY_FORM[K]) => setFormData({ ...formData, [key]: val });

  const lastInjectedRange = useRef<{ start: number, end: number } | null>(null);

  const injectMarkup = (prefix: string, suffix: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    if (prefix.startsWith("{{color:") && lastInjectedRange.current) {
      const { start: lStart, end: lEnd } = lastInjectedRange.current;
      const lastText = text.substring(lStart, lEnd);
      if (lastText.startsWith("{{color:") && lastText.endsWith("}}")) {
        const parts = lastText.split("|");
        if (parts.length >= 2) {
          const contentOnly = parts.slice(1).join("|").slice(0, -2);
          const b = text.substring(0, lStart);
          const a = text.substring(lEnd);
          const newTag = prefix + contentOnly + suffix;
          set("description", b + newTag + a);
          lastInjectedRange.current = { start: lStart, end: lStart + newTag.length };
          setTimeout(() => {
            el.focus();
            el.setSelectionRange(lStart, lStart + newTag.length);
          }, 10);
          return;
        }
      }
    }

    if (prefix.startsWith("{{color:")) {
      const lastTagStart = before.lastIndexOf("{{color:");
      const lastTagEnd = before.lastIndexOf("}}");
      const nextTagEnd = after.indexOf("}}");
      const nextTagStart = after.indexOf("{{color:");

      const isInside = (lastTagStart > -1 && (lastTagEnd === -1 || lastTagEnd < lastTagStart));
      const actualTagStart = lastTagStart;
      const actualTagEnd = end + nextTagEnd + 2;

      if (isInside && nextTagEnd > -1 && (nextTagStart === -1 || nextTagStart > nextTagEnd)) {
        const tagFullText = text.substring(actualTagStart, actualTagEnd);
        const parts = tagFullText.split("|");
        if (parts.length >= 2) {
          const contentOnly = parts.slice(1).join("|").slice(0, -2);
          const b = text.substring(0, actualTagStart);
          const a = text.substring(actualTagEnd);
          const newTag = prefix + contentOnly + suffix;
          set("description", b + newTag + a);
          lastInjectedRange.current = { start: actualTagStart, end: actualTagStart + newTag.length };
          setTimeout(() => {
            el.focus();
            el.setSelectionRange(actualTagStart, actualTagStart + newTag.length);
          }, 10);
          return;
        }
      }
    }

    let processedSelected = selected;
    if (prefix.startsWith("{{color:")) {
      processedSelected = selected.replace(/\{\{color:.*?\|/g, "").replace(/\}\}/g, "");
    }

    if (prefix !== "" && prefix.startsWith("{{color:") === false && selected.startsWith(prefix) && selected.endsWith(suffix)) {
      const unwrapped = selected.substring(prefix.length, selected.length - suffix.length);
      set("description", before + unwrapped + after);
      lastInjectedRange.current = null;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + unwrapped.length);
      }, 10);
      return;
    }

    if (prefix === "**" && before.endsWith("**") && after.startsWith("**")) {
      set("description", before.slice(0, -2) + selected + after.slice(2));
      lastInjectedRange.current = null;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start - 2, end - 2);
      }, 10);
      return;
    }

    const content = processedSelected || (prefix === "**" ? "bold text" : "text");
    const newText = before + prefix + content + suffix + after;
    set("description", newText);

    const finalStart = start;
    const finalEnd = start + prefix.length + content.length + suffix.length;
    lastInjectedRange.current = { start: finalStart, end: finalEnd };

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(finalStart, finalEnd);
    }, 10);
  };

  // ---- Multi-poster management ----
  // Compress (Canvas → WebP) then upload a single image, returning its hosted URL.
  // Mirrors the original single-poster pipeline so output size/quality is unchanged.
  const compressAndUploadPoster = async (file: File): Promise<string | null> => {
    const compressImage = (imgFile: File): Promise<Blob> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(imgFile);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX_WIDTH = 1080;
            const MAX_HEIGHT = 1350;
            let width = img.width;
            let height = img.height;
            if (width > height) {
              if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width = Math.round((width * MAX_HEIGHT) / height);
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
              "image/webp",
              0.8
            );
          };
          img.onerror = reject;
        };
        reader.onerror = reject;
      });

    const compressedBlob = await compressImage(file);
    const useCompressed = compressedBlob.size < file.size;
    const finalFile = useCompressed ? compressedBlob : file;
    const body = new FormData();
    const originalName = file.name.substring(0, file.name.lastIndexOf("."));
    const extension = useCompressed ? "webp" : file.name.split(".").pop() || "png";
    body.append("file", finalFile, `${originalName || "poster"}.${extension}`);
    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url as string;
  };

  // Tracks how many posters are still uploading so the UI can show progress.
  const [posterUploading, setPosterUploading] = useState(0);

  const addPosters = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setPosterUploading((n) => n + list.length);
    try {
      for (const file of list) {
        try {
          const url = await compressAndUploadPoster(file);
          if (url) {
            // Append one at a time so partial uploads still appear and ordering
            // follows selection order. Cover (imageUrl) stays as imageUrls[0].
            setFormData((prev) => {
              const next = [...prev.imageUrls, url];
              return { ...prev, imageUrls: next, imageUrl: next[0] };
            });
          }
        } catch (err) {
          console.error("Poster compression / upload failed:", err);
        } finally {
          setPosterUploading((n) => Math.max(0, n - 1));
        }
      }
    } catch {
      setPosterUploading(0);
    }
  };

  const removePoster = (idx: number) => {
    setFormData((prev) => {
      const next = prev.imageUrls.filter((_, i) => i !== idx);
      return { ...prev, imageUrls: next, imageUrl: next[0] || "" };
    });
  };

  const movePoster = (idx: number, dir: -1 | 1) => {
    setFormData((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.imageUrls.length) return prev;
      const next = [...prev.imageUrls];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, imageUrls: next, imageUrl: next[0] || "" };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const url = editingId ? `/api/admin/events/${editingId}` : "/api/admin/events";
      const method = editingId ? "PUT" : "POST";
      const bodyData = editingId ? formData : formData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bodyData,
          startTime: new Date(formData.startTime).toISOString(),
          endTime: new Date(formData.endTime).toISOString(),
          registrationOpenTime: formData.registrationOpenTime ? new Date(formData.registrationOpenTime).toISOString() : null,
          registrationCloseTime: formData.registrationCloseTime ? new Date(formData.registrationCloseTime).toISOString() : null,
        }),
      });

      if (res.ok) {
        setShowForm(false);
        setFormData(EMPTY_FORM);
        setEditingId(null);
        fetchEvents();
      } else {
        const err = await res.json();
        setError(err.error || "Failed to save event");
        setErrorModal({
          show: true,
          title: lang === "th" ? "การบันทึกข้อมูลล้มเหลว" : "Save Failed",
          message: err.error || (lang === "th" ? "ไม่สามารถบันทึกข้อมูลกิจกรรมได้" : "Failed to save event details.")
        });
      }
    } catch (err) {
      setError("Something went wrong");
      setErrorModal({
        show: true,
        title: lang === "th" ? "เกิดข้อผิดพลาด" : "System Error",
        message: lang === "th" ? "เกิดข้อผิดพลาดบางอย่างกรุณาลองใหม่อีกครั้ง" : "Something went wrong. Please try again."
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmModal({
      show: true,
      title: lang === "th" ? "คุณแน่ใจหรือไม่?" : "Are you sure?",
      message: lang === "th" 
        ? "การดำเนินการนี้จะลบกิจกรรมและบันทึกการเช็คอินทั้งหมดของกิจกรรมนี้อย่างถาวร!" 
        : "This will permanently delete this event and all associated attendance records!",
      confirmText: lang === "th" ? "ลบกิจกรรม" : "Delete Event",
      cancelText: lang === "th" ? "ยกเลิก" : "Cancel",
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, show: false }));
        setDeletingId(id);
        try {
          const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
          if (res.ok) {
            fetchEvents();
          } else {
            const err = await res.json();
            setErrorModal({
              show: true,
              title: lang === "th" ? "การลบล้มเหลว" : "Delete Failed",
              message: err.error || (lang === "th" ? "ไม่สามารถลบกิจกรรมได้" : "Failed to delete event")
            });
          }
        } catch (err) {
          setErrorModal({
            show: true,
            title: lang === "th" ? "เกิดข้อผิดพลาด" : "Error Occurred",
            message: lang === "th" ? "เกิดข้อผิดพลาดบางอย่าง" : "Something went wrong"
          });
        } finally {
          setDeletingId(null);
        }
      }
    });
  };

  const handleEdit = (evt: AdminEvent) => {
    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };

    setFormData({
      title: evt.title,
      description: evt.description || "",
      location: evt.location || "",
      startTime: toLocal(evt.startTime),
      endTime: toLocal(evt.endTime),
      registrationOpenTime: evt.registrationOpenTime ? toLocal(evt.registrationOpenTime) : "",
      registrationCloseTime: evt.registrationCloseTime ? toLocal(evt.registrationCloseTime) : "",
      quota: evt.quota || 0,
      pointsAwarded: evt.pointsAwarded || 0,
      imageUrl: evt.imageUrl || "",
      // Legacy events have only imageUrl — wrap it so the manager shows one poster.
      imageUrls: (evt.imageUrls && evt.imageUrls.length > 0)
        ? evt.imageUrls
        : (evt.imageUrl ? [evt.imageUrl] : []),
      walkInsEnabled: evt.walkInsEnabled || false,
      quotaWalkIn: evt.quotaWalkIn || null,
      targetThai: evt.targetThai !== false,
      targetInternational: evt.targetInternational !== false,
      quotaThai: evt.quotaThai || null,
      quotaInternational: evt.quotaInternational || null,
      allowedRoles: evt.allowedRoles || []
    });
    setEditingId(evt.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const viewAttendance = async (eventId: string) => {
    setActiveEventId(eventId);
    setShowAttendance(true);
    setLoadingAttendance(true);
    setFilterMedical(false);
    setFilterStudentsOnly(false);
    setFilterThai(true);
    setFilterInternational(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/attendance`);
      const data = await res.json();
      setAttendance(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const filteredAttendance = attendance.filter((m) => {
    if (filterMedical && !hasMedicalSignal(m.user)) {
      return false;
    }
    if (filterNotCheckedIn && m.status !== "registered") {
      return false;
    }
    if (filterStudentsOnly && !isRegularStudent(m.user)) {
      return false;
    }

    const studentId = m.user?.studentId || "";
    const cleanId = studentId.trim();
    
    let isThai = true;
    let isIntl = false;
    
    if (cleanId.length >= 3) {
      const lastThreeDigitFirst = cleanId.slice(-3)[0];
      if (lastThreeDigitFirst === "5") {
        isThai = false;
        isIntl = true;
      } else if (["0", "1", "2", "3", "4"].includes(lastThreeDigitFirst)) {
        isThai = true;
        isIntl = false;
      }
    }
    
    if (!filterThai && isThai) {
      return false;
    }
    if (!filterInternational && isIntl) {
      return false;
    }
    
    return true;
  });

  const checkInCount = attendance.filter(m => m.status === "attended").length;
  const registeredCount = attendance.length;

  const groupedAttendance = filteredAttendance.reduce((acc: Record<string, AdminAttendance[]>, curr: AdminAttendance) => {
    const houseId = curr.user?.house?.id || "Unassigned";
    if (!acc[houseId]) acc[houseId] = [];
    acc[houseId].push(curr);
    return acc;
  }, {});

  // Export the event's attendees as .xlsx. The file is built server-side at
  // /api/admin/events/[id]/export, which re-checks the super_admin/admin role
  // (the button is also gated via canExportAttendance) and audit-logs the PII
  // pull. We just trigger the download; the browser sends the session cookie.
  const exportAttendanceXlsx = () => {
    if (!activeEventId) return;
    const a = document.createElement("a");
    a.href = `/api/admin/events/${activeEventId}/export`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const filteredEvents = Array.isArray(events) ? events.filter(evt => {
    const matchesSearch = evt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (evt.location && evt.location.toLowerCase().includes(searchQuery.toLowerCase()));

    const now = new Date();
    const isLive = now >= new Date(evt.startTime) && now <= new Date(evt.endTime);
    const isPast = now > new Date(evt.endTime);
    const isUpcoming = now < new Date(evt.startTime);

    if (filterStatus === "live") return matchesSearch && isLive;
    if (filterStatus === "past") return matchesSearch && isPast;
    if (filterStatus === "upcoming") return matchesSearch && isUpcoming;
    return matchesSearch;
  }) : [];

  const getEventStatus = (evt: AdminEvent) => {
    const now = new Date();
    if (now >= new Date(evt.startTime) && now <= new Date(evt.endTime)) return "live";
    if (now > new Date(evt.endTime)) return "past";
    return "upcoming";
  };

  return (
    <>
      <div className="animate-fade-in-up" style={{ paddingBottom: 100 }}>
        {/* Main Header */}
        <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 20 }}>
          <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">{t.eventsTitle}</h1>
          <button
            className={`btn ${showForm ? "btn-ghost" : "btn-primary"} flex-shrink-0 transition-all duration-300 ${!showForm && "shadow-[0_12px_32px_var(--accent-glow)]"}`}
            style={{ gap: 10, minHeight: 52, paddingInline: 28, borderRadius: 99, fontSize: 15, fontWeight: 700 }}
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                setEditingId(null);
                setFormData(EMPTY_FORM);
              } else {
                setEditingId(null);
                setFormData(EMPTY_FORM);
                setShowForm(true);
              }
            }}
          >
            {showForm ? <><X size={18} /> {lang === "th" ? "ปิดตัวแก้ไข" : lang === "cn" ? "关闭编辑器" : lang === "mm" ? "အယ်ဒီတာ ပိတ်ရန်" : "Close Editor"}</> : <><Plus size={18} /> {t.addEventBtn}</>}
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3" style={{ marginBottom: 48 }}>
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              className="input w-full h-12"
              style={{ paddingLeft: 48, borderRadius: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
              placeholder={t.searchEventsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "live", "upcoming", "past"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "8px 20px",
                  minHeight: 44,
                  borderRadius: 99,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  border: filterStatus === s ? "1px solid var(--accent-primary)" : "1px solid transparent",
                  background: filterStatus === s ? "var(--accent-glow)" : "var(--bg-elevated)",
                  color: filterStatus === s ? "var(--accent-primary)" : "var(--text-secondary)"
                }}
              >
                {s === "all" ? t.filterAll : s === "live" ? t.filterLive : s === "upcoming" ? t.filterUpcoming : t.filterPast}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div
          className="animate-fade-in-up"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-medium)",
            borderRadius: "clamp(20px, 4vw, 32px)",
            padding: "clamp(20px, 5vw, 40px)",
            marginBottom: 48,
            boxShadow: "0 40px 80px rgba(0,0,0,0.1)",
            position: "relative",
            overflow: "hidden"
          }}
        >
          {/* Form Background Decor */}
          <div style={{ position: "absolute", top: 0, right: 0, width: 300, height: 300, background: "radial-gradient(circle at top right, var(--accent-glow), transparent)", pointerEvents: "none" }} />

          <h2 style={{ fontSize: "clamp(22px, 5vw, 28px)", fontWeight: 900, marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 28, background: "var(--accent-primary)", borderRadius: 5 }} />
            {editingId ? t.editEventTitle : t.newEventTitle}
          </h2>

          <form onSubmit={handleSubmit} className="relative">
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-10">
              {/* Left Column: Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div className="field">
                  <label className="label">{t.eventTitleLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                  <input className="input" required value={formData.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. IT Freshy Night 2026" style={{ fontSize: 16, padding: "16px 20px", borderRadius: 16 }} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventLocationLabel}</label>
                    <div style={{ position: "relative" }}>
                      <MapPin size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input className="input" value={formData.location} onChange={(e) => set("location", e.target.value)} placeholder="CAMT Auditorium" style={{ paddingLeft: 44 }} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="label">{t.eventPointsLabel}</label>
                    <div style={{ position: "relative" }}>
                      <Sparkles size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--accent-primary)" }} />
                      <input className="input" type="number" min={0} value={formData.pointsAwarded} onChange={(e) => set("pointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventStartTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input
                      className="input"
                      required
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.startTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newFormData = { ...formData, startTime: val };
                        // Automatically suggest an end time 2 hours later if not set
                        if (val && (!formData.endTime || formData.endTime < val)) {
                          const d = new Date(val);
                          d.setHours(d.getHours() + 2);
                          const offset = d.getTimezoneOffset() * 60000;
                          newFormData.endTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
                        }
                        setFormData(newFormData);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventEndTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input className="input" required type="datetime-local" lang="en-GB" value={formData.endTime} onChange={(e) => set("endTime", e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventRegistrationOpenLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationOpenTime}
                      onChange={(e) => set("registrationOpenTime", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventRegistrationCloseLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationCloseTime}
                      onChange={(e) => set("registrationCloseTime", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventQuotaLabel}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input className="input" type="number" min={1} value={formData.quota} onChange={(e) => set("quota", Number(e.target.value))} placeholder={t.unlimitedIfZero} style={{ paddingLeft: 44 }} />
                    </div>
                  </div>

                  <div className="field" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div
                      onClick={() => {
                        const nextVal = !formData.walkInsEnabled;
                        setFormData({
                          ...formData,
                          walkInsEnabled: nextVal,
                          ...(!nextVal && { quotaWalkIn: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.walkInsEnabled ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.walkInsEnabled ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.walkInsEnabled ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.walkInsEnabled && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsEnabled ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.allowWalkins}
                      </span>
                    </div>
                  </div>
                </div>

                {formData.walkInsEnabled && (
                  <div className="field" style={{ marginTop: 20 }}>
                    <label className="label">{t.walkInQuota}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input 
                        className="input" 
                        type="number" 
                        min={1} 
                        value={formData.quotaWalkIn || ""} 
                        onChange={(e) => set("quotaWalkIn", e.target.value ? Number(e.target.value) : null)} 
                        placeholder={t.unlimitedIfEmpty}
                        style={{ paddingLeft: 44 }}
                      />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                      {t.walkInQuotaHint}
                    </p>
                  </div>
                )}

                <div className="field" style={{ marginTop: 20 }}>
                  <label className="label">{t.targetAudience}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div
                      onClick={() => {
                        const nextVal = !formData.targetThai;
                        setFormData({
                          ...formData,
                          targetThai: nextVal,
                          ...(!nextVal && { quotaThai: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetThai ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetThai ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetThai ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetThai && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetThai ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.thaiStudents}
                      </span>
                    </div>

                    <div
                      onClick={() => {
                        const nextVal = !formData.targetInternational;
                        setFormData({
                          ...formData,
                          targetInternational: nextVal,
                          ...(!nextVal && { quotaInternational: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetInternational ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetInternational ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetInternational ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetInternational && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetInternational ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.internationalStudents}
                      </span>
                    </div>
                  </div>

                  {/* Cohort Quota Limits */}
                  {(formData.targetThai || formData.targetInternational) && (
                    <div className="grid gap-5 mt-5" style={{ 
                      gridTemplateColumns: formData.targetThai && formData.targetInternational ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr"
                    }}>
                      {formData.targetThai && (
                        <div className="field">
                          <label className="label">{t.thaiStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaThai || ""} 
                              onChange={(e) => set("quotaThai", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}

                      {formData.targetInternational && (
                        <div className="field">
                          <label className="label">{t.intlStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaInternational || ""} 
                              onChange={(e) => set("quotaInternational", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quota Conflicts Warning */}
                  {(() => {
                    const warnings: string[] = [];
                    const globalLimit = Number(formData.quota) || 0;
                    const thaiLimit = formData.targetThai ? (Number(formData.quotaThai) || 0) : 0;
                    const intlLimit = formData.targetInternational ? (Number(formData.quotaInternational) || 0) : 0;

                    if (globalLimit > 0) {
                      if (formData.targetThai && thaiLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาไทย (${thaiLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `Thai student limit (${thaiLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetInternational && intlLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาต่างชาติ (${intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `International student limit (${intlLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetThai && formData.targetInternational && thaiLimit > 0 && intlLimit > 0 && (thaiLimit + intlLimit) > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `ผลรวมโควตาของนักศึกษาไทยและต่างชาติ (${thaiLimit + intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit}) ทั้งนี้ ระบบจะปิดรับการลงทะเบียนเมื่อผู้สมัครเต็มตามจำนวนโควตาทั้งหมด (${globalLimit} คน)`
                            : `The sum of Thai and International student limits (${thaiLimit + intlLimit}) exceeds the overall Participant Quota (${globalLimit}). The event will stop accepting registrations once the overall limit of ${globalLimit} is reached.`
                        );
                      }
                    }
                    if (warnings.length === 0) return null;

                    return (
                      <div style={{
                        marginTop: 20,
                        padding: "16px 20px",
                        background: "rgba(245, 158, 11, 0.1)",
                        border: "1px solid rgba(245, 158, 11, 0.2)",
                        borderRadius: 16,
                        color: "#f59e0b",
                        fontSize: 13,
                        fontWeight: 600,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        boxShadow: "0 4px 12px rgba(245, 158, 11, 0.05)"
                      }}>
                        {warnings.map((w, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: "#f59e0b" }} />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Right Column: Poster & Description */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Role Access Control */}
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามบทบาท)" : "Role-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกบทบาทที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกบทบาท"
                      : "Select which roles can see & join this event. Leave all unchecked = visible to everyone."}
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_PARTICIPANT_ROLES.map((role) => {
                      const isSelected = formData.allowedRoles.includes(role);
                      const roleColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
                        student: {
                          bg: isSelected ? "rgba(99,102,241,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(99,102,241,0.5)" : "transparent",
                          text: isSelected ? "#6366f1" : "var(--text-secondary)",
                          badge: "#6366f1",
                        },
                        staff: {
                          bg: isSelected ? "rgba(20,184,166,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(20,184,166,0.5)" : "transparent",
                          text: isSelected ? "#14b8a6" : "var(--text-secondary)",
                          badge: "#14b8a6",
                        },
                        smo: {
                          bg: isSelected ? "rgba(139,92,246,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(139,92,246,0.5)" : "transparent",
                          text: isSelected ? "#8b5cf6" : "var(--text-secondary)",
                          badge: "#8b5cf6",
                        },
                        anusmo: {
                          bg: isSelected ? "rgba(236,72,153,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(236,72,153,0.5)" : "transparent",
                          text: isSelected ? "#ec4899" : "var(--text-secondary)",
                          badge: "#ec4899",
                        },
                      };
                      const c = roleColors[role];
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.allowedRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, allowedRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? c.badge : "transparent",
                            border: `2px solid ${isSelected ? c.badge : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: c.text }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedRoles.length === 0
                        ? "rgba(16,185,129,0.1)"
                        : "rgba(99,102,241,0.1)",
                      color: formData.allowedRoles.length === 0 ? "#10b981" : "#6366f1",
                      border: `1px solid ${formData.allowedRoles.length === 0 ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)"}`,
                    }}>
                      {formData.allowedRoles.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกบทบาท" : "✓ Open to all roles")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t.eventPosterLabel}
                    {formData.imageUrls.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-primary)", background: "rgba(255,107,0,0.1)", padding: "2px 8px", borderRadius: 99 }}>
                        {formData.imageUrls.length}
                      </span>
                    )}
                  </label>

                  {/* Poster thumbnails — first one is the cover. Reorder with the
                      arrows; delete with the ×. */}
                  {formData.imageUrls.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12, marginBottom: 12 }}>
                      {formData.imageUrls.map((url, idx) => (
                        <div key={url + idx} style={{
                          position: "relative",
                          aspectRatio: "4/5",
                          borderRadius: 16,
                          overflow: "hidden",
                          background: "#000",
                          border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)"
                        }}>
                          <img src={url} alt={`Poster ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />

                          {idx === 0 && (
                            <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 900, color: "#fff", background: "var(--accent-primary)", padding: "3px 7px", borderRadius: 99, letterSpacing: "0.05em", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
                              {lang === "th" ? "ปก" : "COVER"}
                            </span>
                          )}

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => removePoster(idx)}
                            title={lang === "th" ? "ลบ" : "Remove"}
                            style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}
                          >
                            <X size={14} />
                          </button>

                          {/* Reorder */}
                          <div style={{ position: "absolute", bottom: 6, left: 6, right: 6, display: "flex", justifyContent: "space-between", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, -1)}
                              disabled={idx === 0}
                              title={lang === "th" ? "ย้ายไปด้านหน้า" : "Move left"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, 1)}
                              disabled={idx === formData.imageUrls.length - 1}
                              title={lang === "th" ? "ย้ายไปด้านหลัง" : "Move right"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === formData.imageUrls.length - 1 ? "not-allowed" : "pointer", opacity: idx === formData.imageUrls.length - 1 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload dropzone — accepts multiple files at once. */}
                  <div style={{
                    position: "relative",
                    height: formData.imageUrls.length > 0 ? 110 : 180,
                    background: "var(--bg-elevated)",
                    borderRadius: 20,
                    border: "2px dashed var(--border-medium)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: posterUploading > 0 ? "wait" : "pointer",
                    transition: "all 0.2s"
                  }} onClick={() => { if (posterUploading === 0) document.getElementById("poster-upload")?.click(); }}>
                    {posterUploading > 0 ? (
                      <div style={{ textAlign: "center", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                        <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
                        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {lang === "th" ? `กำลังอัปโหลด ${posterUploading} ไฟล์...` : `Uploading ${posterUploading} image${posterUploading > 1 ? "s" : ""}...`}
                        </p>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: 20 }}>
                        <div style={{ width: formData.imageUrls.length > 0 ? 44 : 64, height: formData.imageUrls.length > 0 ? 44 : 64, borderRadius: "50%", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--text-muted)" }}>
                          <Plus size={formData.imageUrls.length > 0 ? 22 : 28} />
                        </div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {formData.imageUrls.length > 0
                            ? (lang === "th" ? "เพิ่มโปสเตอร์" : "Add more posters")
                            : (lang === "th" ? "อัปโหลดโปสเตอร์ (เลือกได้หลายไฟล์)" : "Upload Posters (select multiple)")}
                        </p>
                        {formData.imageUrls.length === 0 && (
                          <>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
                              {lang === "th" ? "แนะนำขนาด 1080x1350px (อัตราส่วน 4:5)" : "Recommended: 1080x1350px (4:5 Ratio)"}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {lang === "th" ? "ขนาดไฟล์สูงสุด 10MB (ระบบจะบีบอัดอัตโนมัติ)" : "Max file size: 10MB (Auto-compressed)"}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <input
                      type="file"
                      id="poster-upload"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        await addPosters(files);
                        // Allow re-selecting the same file(s) after a removal.
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {formData.imageUrls.length > 1 && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, fontWeight: 600 }}>
                      {lang === "th"
                        ? "นักศึกษาสามารถปัดดูโปสเตอร์ทั้งหมดได้ในหน้าแดชบอร์ด • โปสเตอร์แรกคือภาพปก"
                        : "Students can swipe through all posters on the dashboard • the first poster is the cover."}
                    </p>
                  )}
                </div>

                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <label className="label" style={{ marginBottom: 0 }}>{t.eventDescriptionLabel}</label>
                    <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", padding: 2, borderRadius: 10 }}>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("**", "**")}><Edit2 size={14} /></button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("[", "](https://...)")}><ExternalLink size={14} /></button>
                      <div style={{ position: "relative" }}>
                        <input type="color" style={{ opacity: 0, position: "absolute", inset: 0, cursor: "pointer" }} onChange={(e) => injectMarkup(`{{color:${e.target.value}|`, "}}")} />
                        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }}><Sparkles size={14} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-auto md:h-[240px]">
                    <textarea
                      ref={textareaRef}
                      className="input h-[180px] md:h-full"
                      style={{ resize: "none", borderRadius: 16, background: "var(--bg-elevated)", border: "none", fontSize: 14, padding: 16 }}
                      value={formData.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
                    />
                    <div
                      className="custom-scrollbar h-[180px] md:h-full"
                      style={{
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        padding: 16,
                        fontSize: 14,
                        lineHeight: 1.6,
                        overflowY: "auto",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-subtle)"
                      }}
                    >
                      <p style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>{lang === "th" ? "ตัวอย่างการแสดงผล" : "Live Preview"}</p>
                      <div dangerouslySetInnerHTML={{ __html: parseRichText(formData.description) || `<span style="color: var(--text-muted); font-style: italic;">${lang === "th" ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6" style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {error && <div style={{ color: "#ef4444", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><AlertCircle size={16} /> {error}</div>}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 w-full sm:w-auto">
                <button type="button" className="btn btn-ghost btn-lg w-full sm:w-auto" style={{ borderRadius: 16 }} onClick={() => setShowForm(false)}>{t.discardBtn}</button>
                <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" style={{ borderRadius: 16, minWidth: 200 }} disabled={submitting}>
                  {submitting ? <>{lang === "th" ? "กำลังบันทึก..." : "Saving..."}</> : editingId ? t.updateSystemBtn : t.activateEventBtn}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Events Grid */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "100px 0", gap: 20 }}>
          <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
          <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Loading Event Records...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div style={{
          background: "var(--bg-surface)",
          borderRadius: 40,
          padding: 80,
          textAlign: "center",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24
        }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Calendar size={48} />
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 800 }}>{t.noEventsFoundLabel}</h3>
            <p style={{ color: "var(--text-muted)", marginTop: 8 }}>{lang === "th" ? "ลองปรับตัวกรองหรือสร้างกิจกรรมใหม่เพื่อเริ่มต้น" : lang === "cn" ? "尝试调整您的筛选条件或创建一个新活动以开始。" : lang === "mm" ? "စတင်ရန် စစ်ထုတ်မှုများကို ချိန်ညှိပါ သို့မဟုတ် ပွဲအသစ်တစ်ခု ဖန်တီးပါ။" : "Try adjusting your filters or create a new event to get started."}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ {t.addEventBtn}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 32 }}>
          {filteredEvents.map((evt) => {
            const status = getEventStatus(evt);
            const isLive = status === "live";
            const isPast = status === "past";

            return (
              <div key={evt.id} className="event-card-premium" style={{
                background: "var(--bg-surface)",
                borderRadius: 32,
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                position: "relative",
                boxShadow: "0 10px 40px rgba(0,0,0,0.04)"
              }}>
                {/* Card Header (Image/Status) */}
                <div style={{ height: 220, position: "relative", background: "var(--bg-elevated)", padding: 16 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 20, overflow: "hidden", position: "relative" }}>
                    {evt.imageUrl ? (
                      <img src={evt.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, var(--bg-elevated) 0%, var(--border-subtle) 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Calendar size={48} style={{ color: "var(--accent-primary)", opacity: 0.2 }} />
                      </div>
                    )}
                  </div>

                  {/* Status Overlay */}
                  <div style={{ position: "absolute", top: 28, right: 28, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {evt.walkInsEnabled && (
                      <div className="badge" style={{ background: "rgba(99, 102, 241, 0.2)", color: "#6366f1", border: "1px solid rgba(99, 102, 241, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                        <Zap size={12} style={{ marginRight: 4 }} />
                        Walk-in
                      </div>
                    )}
                    {(evt.targetThai !== false && evt.targetInternational !== false) || (evt.targetThai === false && evt.targetInternational === false) ? (
                      <div className="badge" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                        All Students
                      </div>
                    ) : evt.targetThai !== false ? (
                      <div className="badge" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                        Thai Only
                      </div>
                    ) : evt.targetInternational !== false ? (
                      <div className="badge" style={{ background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                        {"Int'l Only"}
                      </div>
                    ) : null}
                    {isLive && (
                      <div className="badge animate-pulse-glow" style={{ background: "#10b981", color: "#fff", border: "none", padding: "6px 12px" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", marginRight: 6 }} />
                        {t.statusLive.toUpperCase()}
                      </div>
                    )}
                    {!isLive && !isPast && (
                      <div className="badge" style={{ background: "var(--accent-primary)", color: "#fff", border: "none", padding: "6px 12px" }}>{t.statusUpcoming.toUpperCase()}</div>
                    )}
                    {isPast && (
                      <div className="badge" style={{ background: "rgba(0,0,0,0.4)", color: "#fff", border: "none", padding: "6px 12px", backdropFilter: "blur(4px)" }}>{t.statusPast.toUpperCase()}</div>
                    )}
                  </div>

                  {/* Role Restriction Badge */}
                  {evt.allowedRoles && evt.allowedRoles.length > 0 && (
                    <div style={{ position: "absolute", top: 28, left: 28 }}>
                      <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(99,102,241,0.85)",
                        backdropFilter: "blur(6px)",
                        color: "#fff",
                        padding: "5px 10px",
                        borderRadius: 99,
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: "0.04em",
                        border: "1px solid rgba(255,255,255,0.15)",
                        boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                        textTransform: "uppercase",
                      }}>
                        <Users size={10} />
                        {evt.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r.toUpperCase()).join(" • ")}
                      </div>
                    </div>
                  )}

                  {/* Points Badge */}
                  {evt.pointsAwarded !== undefined && (
                    <div style={{ position: "absolute", bottom: 28, left: 28 }}>
                      <div style={{ 
                        background: "rgba(0, 0, 0, 0.7)", 
                        backdropFilter: "blur(8px)", 
                        color: "#fff", 
                        padding: "6px 12px", 
                        borderRadius: 14, 
                        fontSize: 11, 
                        fontWeight: 900, 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: 6, 
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        border: "1px solid rgba(255, 255, 255, 0.1)"
                      }}>
                        <Trophy size={12} style={{ color: "#fbbf24" }} />
                        <span>{evt.pointsAwarded} PTS</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Content */}
                <div style={{ padding: "28px", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.35, overflowWrap: "break-word", wordBreak: "break-word" }}>{evt.title}</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
                        <MapPin size={14} style={{ color: "var(--accent-primary)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.location || "Online / TBD"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                        <Calendar size={14} style={{ color: "var(--accent-primary)" }} />
                        {(() => {
                          const start = new Date(evt.startTime);
                          const end = new Date(evt.endTime);
                          const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                          const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                          
                          const startDateStr = start.toLocaleDateString('en-GB', dateOpts);
                          const endDateStr = end.toLocaleDateString('en-GB', dateOpts);
                          const startTimeStr = start.toLocaleTimeString('en-GB', timeOpts);
                          const endTimeStr = end.toLocaleTimeString('en-GB', timeOpts);

                          if (startDateStr === endDateStr) {
                            return `${startDateStr} ${startTimeStr} - ${endTimeStr}`;
                          } else {
                            return `${startDateStr} ${startTimeStr} - ${endDateStr} ${endTimeStr}`;
                          }
                        })()}
                      </div>
                      {evt.registrationCloseTime && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                          <Clock size={14} style={{ color: "var(--accent-primary)" }} />
                          <span>
                            {t.eventRegistrationCloseLabel}: {(() => {
                              const closeDate = new Date(evt.registrationCloseTime);
                              const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                              const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                              return `${closeDate.toLocaleDateString('en-GB', dateOpts)} ${closeDate.toLocaleTimeString('en-GB', timeOpts)}`;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quota Progress */}
                  <div style={{ marginTop: "auto", marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 900, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.thQuota.toUpperCase()}</span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {evt.attendeeCount || 0} / {evt.quota || "∞"}
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                      <div style={{
                        width: `${evt.quota ? Math.min(100, ((evt.attendeeCount || 0) / evt.quota) * 100) : 0}%`,
                        height: "100%",
                        background: evt.quota && (evt.attendeeCount || 0) >= evt.quota ? "var(--red-house)" : "var(--accent-primary)",
                        borderRadius: 99,
                        transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)"
                      }} />
                    </div>
                    {((evt.quotaThai !== null && evt.quotaThai > 0) || (evt.quotaInternational !== null && evt.quotaInternational > 0) || (evt.quotaWalkIn !== null && evt.quotaWalkIn > 0)) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", flexWrap: "wrap" }}>
                        {evt.quotaThai !== null && evt.quotaThai > 0 && (
                          <span>Thai Limit: <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaThai}</strong></span>
                        )}
                        {evt.quotaInternational !== null && evt.quotaInternational > 0 && (
                          <span>{"Int'l Limit:"} <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaInternational}</strong></span>
                        )}
                        {evt.quotaWalkIn !== null && evt.quotaWalkIn > 0 && (
                          <span>Walk-in (extra): <strong style={{ color: "var(--text-secondary)" }}>+{evt.quotaWalkIn}</strong></span>
                        )}
                      </div>
                    )}
                  </div>

                   {/* Actions */}
                   <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       <button
                         className="btn btn-primary"
                         style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                         onClick={() => viewAttendance(evt.id)}
                       >
                         <BarChart3 size={15} /> {lang === "th" ? "การเช็คอิน" : lang === "cn" ? "签到情况" : lang === "mm" ? "ချက်အင်ဝင်ရောက်မှု" : "Attendance"}
                       </button>
                       <button
                          className="btn"
                          style={{ 
                            flex: 1, 
                            height: 44, 
                            borderRadius: 12, 
                            fontSize: 13, 
                            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", 
                            color: "#fff",
                            border: "none",
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            gap: 6,
                            boxShadow: "0 4px 12px rgba(79, 70, 229, 0.2)",
                            cursor: "pointer"
                          }}
                          onClick={() => openFormBuilder(evt.id, evt.title)}
                        >
                          <ClipboardList size={14} /> {lang === "th" ? "แบบประเมิน" : lang === "cn" ? "评估表单" : lang === "mm" ? "အကဲဖြတ်ပုံစံ" : "Feedback Form"}
                        </button>
                     </div>
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       <button
                         className="btn btn-ghost"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(0,0,0,0.03)", fontSize: 13 }}
                         onClick={() => handleEdit(evt)}
                       >
                         <Edit2 size={13} /> {t.eventEditBtnLabel || "Edit"}
                       </button>
                       <button
                         id={`delete-event-${evt.id}-btn`}
                         className="btn btn-danger"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13 }}
                         disabled={deletingId === evt.id}
                         onClick={() => handleDelete(evt.id)}
                       >
                         {deletingId === evt.id ? <div className="spinner w-4 h-4 border-2" /> : <Trash2 size={13} />} {t.eventDeleteBtnLabel || "Delete"}
                       </button>
                     </div>
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Global CSS for the premium experience */}
      <style jsx global>{`
        .event-card-premium:hover {
          transform: translateY(-8px);
          border-color: var(--accent-primary);
          box-shadow: 0 30px 60px rgba(255,107,0,0.1);
        }
        .event-card-premium:hover .hover-overlay {
          opacity: 1;
        }
        .attendance-card:hover {
          transform: scale(1.02);
          border-color: var(--accent-primary);
          background: var(--bg-elevated);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-medium);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }

        /* Attendance Modal Responsive Styles */
        .attendance-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(16px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(12px, 3vw, 24px);
        }
        .attendance-modal-container {
          background: var(--bg-surface);
          width: 100%;
          max-width: 1100px;
          height: 100%;
          max-height: 90vh;
          border-radius: clamp(20px, 4vw, 40px);
          padding: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-medium);
          box-shadow: 0 50px 120px rgba(0,0,0,0.4);
          position: relative;
        }
        .attendance-modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(to right, var(--bg-surface), var(--bg-elevated));
          flex-shrink: 0;
        }
        .attendance-modal-header h2 {
          font-size: clamp(18px, 4vw, 28px);
          font-weight: 900;
          letter-spacing: -0.04em;
          margin: 0;
        }
        .attendance-modal-filter-bar {
          padding: 12px 20px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .attendance-modal-list {
          overflow-y: auto;
          flex: 1;
          padding: 20px;
        }

        @media (min-width: 1024px) {
          .attendance-modal-header {
            padding: 24px 40px;
          }
          .attendance-modal-header h2 {
            font-size: 32px;
          }
          .attendance-modal-filter-bar {
            padding: 16px 40px;
            gap: 16px;
          }
          .attendance-modal-list {
            padding: 40px;
          }
        }
      `}</style>
      </div>

      {/* Evaluation Form Builder Modal */}
      {showFormBuilder && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          zIndex: 2200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(12px, 3vw, 24px)"
        }} onClick={closeFormBuilder}>
          <div className="animate-fade-in-up custom-scrollbar" style={{
            background: "var(--bg-surface)",
            width: "100%",
            maxWidth: 800,
            maxHeight: "92vh",
            borderRadius: "clamp(20px, 4vw, 32px)",
            overflowY: "auto",
            boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ padding: "20px clamp(16px, 5vw, 40px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10, gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "th" ? "แบบประเมินผู้เข้าร่วม" : lang === "cn" ? "互动反馈" : lang === "mm" ? "အပြန်အလှန် အကြံပြုချက်" : "Interactive Feedback"}</span>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", overflowWrap: "break-word", wordBreak: "break-word" }}>{formEventTitle || "Event"} Form</h3>
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
            <div style={{ padding: "12px clamp(12px,4vw,32px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                    {f.isAwarded && <span style={{ fontSize: 10 }}>🔒</span>}
                    {!f.isActive && !f.isAwarded && <span style={{ fontSize: 10, opacity: 0.6 }}>●</span>}
                  </button>
                );
              })}
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
                + Add Form
              </button>
            </div>

            {/* New Form Type Picker */}
            {showNewFormPicker && !formLoading && (
              <div style={{ padding: "20px clamp(12px,4vw,32px)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)" }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 12 }}>
                  Select the type of form to create for this event:
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(["K_pre", "K_post", "A", "S"] as const).map((type) => {
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
                        title={alreadyExists ? "A form of this type already exists for this event" : ""}
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
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
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
                📝 {lang === "th" ? "ออกแบบฟอร์มและกฎ" : lang === "cn" ? "设计表单与规则" : lang === "mm" ? "ပုံစံနှင့် စည်းကမ်းများ ဒီဇိုင်းဆွဲရန်" : "Design Form & Rules"}
              </button>
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
                🏆 {lang === "th" ? "กระดานผู้นำบ้านและการส่งข้อมูล" : lang === "cn" ? "学院排行榜与提交" : lang === "mm" ? "အိမ်တော် ဦးဆောင်သူစာရင်းနှင့် တင်သွင်းမှုများ" : "House Leaderboard & Submissions"} ({formSubmissions.length})
              </button>
            </div>

            {/* Modal Body */}
            {formLoading ? (
              <div style={{ padding: "80px 0", textAlign: "center" }}>
                <div className="spinner w-8 h-8 border-4 border-t-transparent" style={{ margin: "0 auto 16px" }} />
                <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>Fetching evaluation system data...</p>
              </div>
            ) : showNewFormPicker && !activeFormId ? (
              <div style={{ padding: "60px 40px", textAlign: "center" }}>
                <ClipboardList size={48} style={{ color: "var(--text-muted)", margin: "0 auto 20px", opacity: 0.3, display: "block" }} />
                <h4 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Select a form type above to get started</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  Each form type (K Pre-Test, K Post-Test, A - Attitude, S - Skill) can only be created once per event.
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
                    <span style={{ fontSize: 16 }}>✅</span> {formBuilderSuccess}
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
                    <span style={{ fontSize: 16 }}>⚠️</span> {formBuilderError}
                  </div>
                )}
                {formTab === "edit" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {/* General Settings */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 24 }}>
                      {/* Left Panel */}
                      <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 16 }}>
                        <div className="field">
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
                      
                      {/* Right Panel */}
                      <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16 }}>
                        {/* Form Type Badge */}
                        {(() => {
                          const c = FORM_TYPE_COLORS[activeFormType] || FORM_TYPE_COLORS["K_post"];
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 12, background: c.bg, border: `1px solid ${c.border}` }}>
                              <span style={{ fontSize: 12, fontWeight: 900, color: c.text }}>{FORM_TYPE_LABELS[activeFormType] || activeFormType}</span>
                              <span style={{ fontSize: 11, color: c.text, opacity: 0.7 }}>
                                {activeFormType === "K_pre" ? "— No attendance required" : activeFormType === "S" ? "— Admin/staff only" : "— Requires check-in"}
                              </span>
                            </div>
                          );
                        })()}
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                            <Zap size={14} style={{ color: "var(--accent-primary)" }} /> House Points Reward
                          </label>
                          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Winning house gets these points.</p>
                          <input
                            type="number"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", fontWeight: 800 }}
                            value={formPoints}
                            onChange={e => setFormPoints(Math.max(0, parseInt(e.target.value) || 0))}
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
                          let label = "Open for entries";
                          if (formIsAwarded) {
                            dot = "#10b981"; label = "Finalized & points awarded";
                          } else if (closes && now > closes) {
                            dot = "var(--text-muted)"; label = "Closed — points will be awarded automatically";
                          } else if (opens && now < opens) {
                            dot = "#6366f1"; label = "Scheduled — not open yet";
                          }
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(0,0,0,0.02)", padding: 16, borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: dot }} />
                                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)" }}>
                                  Status: {label}
                                </span>
                              </div>
                              <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                                Set the open/close times in the schedule below. When the close time passes, the house with the most submissions automatically wins the points — no manual action needed.
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Schedule window (auto open/close by date & time) */}
                    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                        <h4 style={{ fontSize: 14, fontWeight: 900 }}>Schedule</h4>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
                        Set when this form opens and closes (Bangkok time). Leave <b>Opens at</b> blank to open immediately. <b>Closes at</b> is required: when it passes, entries stop and the winning house is awarded automatically.
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 16 }}>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>Opens at</label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px" }}
                            value={formOpensAt}
                            onChange={(e) => setFormOpensAt(e.target.value)}
                            disabled={formIsAwarded}
                          />
                        </div>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>Closes at <span style={{ color: "#ef4444" }}>*</span></label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", borderColor: !formClosesAt ? "#ef4444" : undefined }}
                            value={formClosesAt}
                            onChange={(e) => setFormClosesAt(e.target.value)}
                            disabled={formIsAwarded}
                          />
                        </div>
                      </div>
                      {!formClosesAt && (
                        <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>⚠️ A close time is required so the form can auto-close and award points.</p>
                      )}
                      {formOpensAt && formClosesAt && new Date(formClosesAt) <= new Date(formOpensAt) && (
                        <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>⚠️ Close time is before open time — students will never be able to submit.</p>
                      )}
                    </div>

                    {/* S-form assignment — who may see & fill this skill form */}
                    {activeFormType === "S" && (
                      <div style={{ background: "rgba(239,68,68,0.04)", padding: 24, borderRadius: 24, border: "1px solid rgba(239,68,68,0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ClipboardList size={16} style={{ color: "#ef4444" }} />
                          <h4 style={{ fontSize: 14, fontWeight: 900 }}>Who can do this form</h4>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
                          Skill forms are hidden from everyone except super-admins/admins and the people you assign here (by role or by person). It appears in their dashboard history to fill — no event check-in needed.
                        </p>

                        {/* By role */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Assign by role</span>
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
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Assign specific people ({formAssignedUserIds.length})</span>
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
                            placeholder="Search people by name or student ID…"
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
                                      <span style={{ fontSize: 12, fontWeight: 900, color: on ? "#ef4444" : "var(--accent-primary)" }}>{on ? "✓ Added" : "+ Add"}</span>
                                    </button>
                                  );
                                })}
                              {assigneeUsers.length === 0 && (
                                <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>Loading people…</p>
                              )}
                            </div>
                          )}
                        </div>

                        {formAssignedRoles.length === 0 && formAssignedUserIds.length === 0 && (
                          <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                            No one assigned yet — only super-admins/admins can see and fill this form.
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
                          ➕ {lang === "th" ? "เพิ่มส่วน" : lang === "cn" ? "添加章节" : lang === "mm" ? "အပိုင်းထည့်ရန်" : "Add Section"}
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
                                <input
                                  type="text"
                                  className="input"
                                  style={{ height: 36, borderRadius: 10, padding: "0 12px", fontSize: 13 }}
                                  value={section.description || ""}
                                  onChange={e => updateSection(section.id, "description", e.target.value)}
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
                                      <div style={{ display: "flex", gap: 12, alignItems: "center", flex: "1 1 auto", width: "100%" }}>
                                        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text-muted)", width: 20 }}>{idx + 1}.</span>
                                        <input
                                          type="text"
                                          className="input"
                                          style={{ flex: 1, height: 40, borderRadius: 10, padding: "0 12px" }}
                                          value={q.label}
                                          onChange={e => updateQuestion(section.id, q.id, "label", e.target.value)}
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
                                          ➕ {lang === "th" ? "เพิ่มตัวเลือก" : lang === "cn" ? "添加选项" : lang === "mm" ? "ရွေးချယ်စရာထည့်ရန်" : "Add Option"}
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
                              ➕ {t.eventAddQuestionLabel}
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
                              title: "Delete this form?",
                              message: "This will permanently delete the form and all its submissions.",
                              confirmText: "Delete Form",
                              cancelText: "Cancel",
                              isDanger: true,
                              onConfirm: () => { setConfirmModal(prev => ({ ...prev, show: false })); deleteActiveForm(); }
                            })}
                          >
                            <Trash2 size={13} style={{ marginRight: 6 }} /> Delete Form
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
                          Cancel
                        </button>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ height: 46, borderRadius: 12, padding: "0 24px", whiteSpace: "nowrap" }}
                          disabled={formSaving || formIsAwarded}
                          onClick={saveForm}
                        >
                          {formSaving ? <div className="spinner w-4 h-4 border-2" /> : activeFormId ? "Save Changes" : "Create Form"}
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
                                <h4 style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)", marginBottom: 4 }}>Contest Finalized &amp; Closed</h4>
                                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                  Points have been awarded to the winning house and this evaluation form is frozen.
                                </p>
                              </div>
                            </div>
                            <div style={{ padding: "8px 16px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#10b981", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
                              🔒 Permanent Lock
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
                                {hasClosed ? "Closed — awaiting automatic award" : "Awards automatically when the form closes"}
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
                      <h4 style={{ fontSize: 16, fontWeight: 900, marginBottom: 20 }}>📊 House Submission Standings</h4>
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
                              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>submissions</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* List of Submissions */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                        <h4 style={{ fontSize: 16, fontWeight: 900 }}>💬 Student Submissions ({formSubmissions.length})</h4>
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
                          <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>No feedback submissions yet.</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Once students complete the form, their answers will appear here live!</p>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          {formSubmissions.map((sub, sIdx) => (
                            <div 
                              key={sub.id || sIdx} 
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
                                  <span style={{ fontWeight: 800, fontSize: 15 }}>{sub.studentName}</span>
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>• {sub.studentId}</span>
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
                                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}>{q.label}</span>
                                      {q.type === "rating" ? (
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
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Premium custom Error Modal */}
      {errorModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}>
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
              background: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <X size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {errorModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {errorModal.message}
            </p>
            <button
              className="btn btn-ghost"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, border: "1px solid var(--border-medium)" }}
              onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "ปิด" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* Attendance Modal */}
      {showAttendance && (
        <div className="attendance-modal-overlay">
          <div className="animate-fade-in-up attendance-modal-container">
            {/* Modal Header */}
            <div className="attendance-modal-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: "#10b981",
                    boxShadow: "0 0 15px rgba(16,185,129,0.5)",
                    animation: "pulse-glow 2s infinite"
                  }} />
                  <p className="section-title" style={{ margin: 0, color: "#10b981", fontWeight: 800, fontSize: 12 }}>REAL-TIME ATTENDANCE</p>
                </div>
                <h2 style={{ fontWeight: 900, letterSpacing: "-0.04em" }}>
                  {events.find(e => e.id === activeEventId)?.title || "Attendance List"}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} className="text-muted" />
                    <p style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 15 }}>
                      <span style={{ color: "var(--text-primary)", fontWeight: 800 }}>{checkInCount}</span> / <span style={{ color: "var(--text-primary)", fontWeight: 800 }}>{registeredCount}</span> checked in
                    </p>
                  </div>
                  <div style={{ width: 1, height: 16, background: "var(--border-medium)" }} />
                  <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                    Event ID: <span style={{ fontFamily: "monospace" }}>{activeEventId?.slice(0, 8)}</span>
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {canExportAttendance && !loadingAttendance && attendance.length > 0 && (
                  <button
                    onClick={exportAttendanceXlsx}
                    title="Export all attendees of this event to Excel (.xlsx)"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 99,
                      height: 48,
                      paddingInline: 20,
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#fff",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      border: "1px solid #059669",
                      boxShadow: "0 8px 20px rgba(16,185,129,0.35)",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <Download size={18} />
                    {lang === "th" ? "ส่งออก Excel" : "Export Excel"}
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ borderRadius: "50%", width: 48, height: 48, padding: 0, fontSize: 20 }}
                  onClick={() => setShowAttendance(false)}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            {!loadingAttendance && attendance.length > 0 && (
              <div className="attendance-modal-filter-bar">
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {/* Filtering to condition-holders is signal-level (who, not
                      what), so it's available to all admin-area roles. */}
                  <button
                    onClick={() => setFilterMedical(!filterMedical)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterMedical ? "1px solid #ef4444" : "1px solid var(--border-subtle)",
                      background: filterMedical ? "rgba(239, 68, 68, 0.1)" : "var(--bg-surface)",
                      color: filterMedical ? "#ef4444" : "var(--text-secondary)"
                    }}
                  >
                    <HeartPulse size={16} />
                    {filterMedical ? "Showing: Medical Conditions Only" : "Filter: Medical Conditions Only"}
                  </button>

                  <button
                    onClick={() => setFilterNotCheckedIn(!filterNotCheckedIn)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterNotCheckedIn ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterNotCheckedIn ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterNotCheckedIn ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <Clock size={16} />
                    {filterNotCheckedIn ? "Showing: Not Checked In Only" : "Filter: Not Checked In Only"}
                  </button>

                  <button
                    onClick={() => setFilterStudentsOnly(!filterStudentsOnly)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterStudentsOnly ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterStudentsOnly ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterStudentsOnly ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <User size={16} />
                    {filterStudentsOnly ? "Showing: Students Only" : "Filter: Students Only"}
                  </button>

                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    color: filterThai ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: 99,
                    background: filterThai ? "rgba(255, 107, 0, 0.08)" : "var(--bg-surface)",
                    border: filterThai ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    transition: "all 0.2s"
                  }}>
                    <input
                      type="checkbox"
                      checked={filterThai}
                      onChange={(e) => setFilterThai(e.target.checked)}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15, cursor: "pointer" }}
                    />
                    Thai Students
                  </label>

                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    color: filterInternational ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: 99,
                    background: filterInternational ? "rgba(255, 107, 0, 0.08)" : "var(--bg-surface)",
                    border: filterInternational ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    transition: "all 0.2s"
                  }}>
                    <input
                      type="checkbox"
                      checked={filterInternational}
                      onChange={(e) => setFilterInternational(e.target.checked)}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15, cursor: "pointer" }}
                    />
                    International Students
                  </label>
                </div>
                {(filterMedical || filterNotCheckedIn || filterStudentsOnly || !filterThai || !filterInternational) && (
                  <p style={{ fontSize: 13, color: "var(--accent-primary)", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Activity size={14} className="animate-pulse" />
                    Filtered: Showing {filteredAttendance.length} of {attendance.length} students
                  </p>
                )}
              </div>
            )}

            {loadingAttendance ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
                  <div className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
                  <p style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 16 }}>Synchronizing records...</p>
                </div>
              </div>
            ) : (
              <div className="attendance-modal-list custom-scrollbar">
                {attendance.length === 0 ? (
                  <div style={{ padding: "80px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
                    <div style={{
                      width: 100,
                      height: 100,
                      borderRadius: "50%",
                      background: "var(--bg-elevated)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-subtle)"
                    }}>
                      <Search size={40} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>Waiting for first entry</h3>
                      <p style={{ color: "var(--text-muted)", marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
                        Scanning hasn&apos;t started yet. Once students begin checking in via QR code, they will appear here live.
                      </p>
                    </div>
                  </div>
                ) : filteredAttendance.length === 0 ? (
                  <div style={{ padding: "80px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
                    <div style={{
                      width: 100,
                      height: 100,
                      borderRadius: "50%",
                      background: "var(--bg-elevated)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-subtle)"
                    }}>
                      {filterMedical ? <HeartPulse size={40} style={{ color: "#ef4444" }} /> : <Search size={40} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>
                        {filterMedical 
                          ? "No medical conditions reported" 
                          : filterNotCheckedIn 
                          ? "All registered students checked in!" 
                          : "No students match the filters"}
                      </h3>
                      <p style={{ color: "var(--text-muted)", marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
                        {filterMedical 
                          ? `None of the ${attendance.length} checked-in students have reported any medical conditions or allergies for this event.` 
                          : filterNotCheckedIn 
                          ? "Great! Every student registered for this event has successfully checked in."
                          : "Try adjusting your filters to see more students."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
                    {Object.entries(groupedAttendance).map(([house, members]: [string, AdminAttendance[]]) => (
                      <div key={house}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 20,
                          padding: "12px 20px",
                          background: "var(--bg-elevated)",
                          borderRadius: 16,
                          border: "1px solid var(--border-subtle)"
                        }}>
                          <h4 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: members[0]?.user?.house?.color || "var(--accent-primary)",
                              boxShadow: `0 0 15px ${members[0]?.user?.house?.color}55`
                            }} />
                            {house === "red" ? t.houseMom : house === "green" ? t.houseTo : house === "yellow" ? t.houseLuang : house === "blue" ? t.houseMakara : house}
                          </h4>
                          <span className="badge" style={{ padding: "6px 16px", borderRadius: 99, background: "var(--bg-surface)", fontWeight: 800, color: "var(--text-secondary)" }}>
                            {members.length} Members
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
                          {members.map((m: AdminAttendance) => (
                            <div key={m.id} className="attendance-card" style={{
                              padding: "20px",
                              background: "var(--bg-surface)",
                              borderRadius: 24,
                              border: "1px solid var(--border-subtle)",
                              display: "flex",
                              alignItems: "center",
                              gap: 16,
                              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.02)"
                            }}>
                              <div style={{
                                width: 52,
                                height: 52,
                                borderRadius: 16,
                                background: "var(--bg-elevated)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 18,
                                fontWeight: 900,
                                color: "var(--accent-primary)",
                                border: "1px solid var(--border-subtle)"
                              }}>
                                {m.user?.name?.charAt(0)}
                              </div>
                              <div style={{ flex: 1 }}>
                                <p style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)" }}>{m.user?.name}</p>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                                  <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{m.user?.studentId || "No ID"}</p>
                                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--border-medium)" }} />
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <Clock size={12} className="text-muted" />
                                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                                      {m.checkInTime ? new Date(m.checkInTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) : "-"}
                                    </p>
                                  </div>
                                </div>
                                {/* The meds-check badge only appears for attendees who went
                                    through the medication check, so it reveals who has a
                                    medical condition — restrict to super_admin/admin. */}
                                {canExportAttendance && m.medsCheckOption && (
                                  <div style={{
                                    display: "inline-flex", 
                                    alignItems: "center", 
                                    gap: 6, 
                                    marginTop: 6, 
                                    padding: "4px 10px", 
                                    borderRadius: 8, 
                                    fontSize: 11, 
                                    fontWeight: 800,
                                    textTransform: "uppercase",
                                    background: m.medsCheckOption === "brought" 
                                      ? "rgba(16, 185, 129, 0.12)" 
                                      : m.medsCheckOption === "forgot" 
                                      ? "rgba(239, 68, 68, 0.12)" 
                                      : "rgba(59, 130, 246, 0.12)",
                                    color: m.medsCheckOption === "brought" 
                                      ? "#10b981" 
                                      : m.medsCheckOption === "forgot" 
                                      ? "#ef4444" 
                                      : "#3b82f6",
                                    border: m.medsCheckOption === "brought"
                                      ? "1px solid rgba(16, 185, 129, 0.2)"
                                      : m.medsCheckOption === "forgot"
                                      ? "1px solid rgba(239, 68, 68, 0.2)"
                                      : "1px solid rgba(59, 130, 246, 0.2)"
                                  }}>
                                    <span style={{ 
                                      width: 6, 
                                      height: 6, 
                                      borderRadius: "50%", 
                                      background: m.medsCheckOption === "brought" 
                                        ? "#10b981" 
                                        : m.medsCheckOption === "forgot" 
                                        ? "#ef4444" 
                                        : "#3b82f6",
                                      boxShadow: m.medsCheckOption === "brought"
                                        ? "0 0 8px #10b981"
                                        : m.medsCheckOption === "forgot"
                                        ? "0 0 8px #ef4444"
                                        : "0 0 8px #3b82f6"
                                    }} />
                                    {m.medsCheckOption === "brought" 
                                      ? "Brought Meds / พกยามาด้วย" 
                                      : m.medsCheckOption === "forgot" 
                                      ? "No Meds (Risk) / ไม่ได้พกยา (รับความเสี่ยง)" 
                                      : "Acknowledged / รับทราบข้อมูล"}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                {hasMedicalSignal(m.user) && (
                                  <div style={{ color: "#ef4444", animation: "pulse-glow 2s infinite" }} title="Medical Condition">
                                    <Activity size={20} />
                                  </div>
                                )}
                                <button
                                  className="btn btn-ghost"
                                  style={{ padding: 8, borderRadius: 10 }}
                                  onClick={() => setSelectedStudent(m.user || null)}
                                >
                                  <Info size={18} />
                                </button>{m.status === "attended" ? (

                                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#10b981" }} title="Checked In">

                                    <CheckCircle2 size={16} />

                                  </div>

                                ) : (

                                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,107,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", border: "1px dashed var(--accent-primary)" }} title="Registered (Not Checked In)">

                                    <Clock size={14} className="animate-pulse" />

                                  </div>

                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Modal Footer */}
            <div style={{ padding: "20px 40px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", background: "var(--bg-elevated)" }}>
              <button className="btn btn-primary" onClick={() => setShowAttendance(false)}>Done Tracking</button>
            </div>
          </div>
        </div>
      )}

      {/* Student Profile Modal */}
      {selectedStudent && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setSelectedStudent(null)}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "100%",
            maxWidth: 500,
            borderRadius: 32,
            overflow: "hidden",
            boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 32, borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 20, fontWeight: 900 }}>Student Profile</h3>
              <button className="btn btn-ghost" onClick={() => setSelectedStudent(null)} style={{ borderRadius: "50%", width: 40, height: 40, padding: 0 }}><X size={18} /></button>
            </div>
            <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Header Info */}
              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "var(--accent-primary)" }}>
                  {selectedStudent.name?.charAt(0)}
                </div>
                <div>
                  <p style={{ fontSize: 22, fontWeight: 900 }}>{selectedStudent.name}</p>
                  <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600 }}>{selectedStudent.studentId} • {selectedStudent.major}</p>
                </div>
              </div>

              {/* Contact */}
              <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Contact Information</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Phone size={16} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 700 }}>{selectedStudent.phone || "No phone provided"}</span>
                </div>
              </div>

              {/* Medical & Health Info: the raw detail the student filled in is
                  PDPA-sensitive and shown only to super_admin/admin
                  (canExportAttendance). Other admin-area roles (registration)
                  still see the "has a condition" signal, not the detail. */}
              {/* Medical */}
              <div style={{
                background: hasMedicalSignal(selectedStudent)
                  ? "rgba(239, 68, 68, 0.05)"
                  : "var(--bg-elevated)",
                padding: 20,
                borderRadius: 20,
                border: hasMedicalSignal(selectedStudent)
                  ? "1px solid rgba(239, 68, 68, 0.1)"
                  : "1px solid transparent"
              }}>
                <p style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: hasMedicalSignal(selectedStudent) ? "#ef4444" : "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 12,
                  letterSpacing: "0.05em",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}>
                  <HeartPulse size={14} />
                  {t.medicalHealthInfo}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {canExportAttendance ? (
                    <>
                      {selectedStudent.chronicDiseases && selectedStudent.chronicDiseases.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.chronicDiseases}:</b> {selectedStudent.chronicDiseases}</p>}
                      {selectedStudent.medicalHistory && selectedStudent.medicalHistory.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.medicalHistory}:</b> {selectedStudent.medicalHistory}</p>}
                      {selectedStudent.drugAllergies && selectedStudent.drugAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.drugAllergies}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.drugAllergies}</span></p>}
                      {selectedStudent.foodAllergies && selectedStudent.foodAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.foodAllergies}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.foodAllergies}</span></p>}
                      {selectedStudent.dietaryRestrictions && selectedStudent.dietaryRestrictions.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.dietaryRestrictions}:</b> {selectedStudent.dietaryRestrictions}</p>}
                      {selectedStudent.emergencyMedication && selectedStudent.emergencyMedication.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.emergencyMed}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.emergencyMedication}</span></p>}
                      {selectedStudent.faintingHistory && <p style={{ fontSize: 14, color: "#ef4444", fontWeight: 700 }}>⚠️ {t.faintingHistory}</p>}

                      {!hasActualMedicalInfo(selectedStudent) && (
                        <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                      )}
                    </>
                  ) : hasMedicalSignal(selectedStudent) ? (
                    // Signal only — registration sees WHICH categories exist (as
                    // bullet points), never the detail the student filled in.
                    <>
                      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                        {(selectedStudent.medicalCategories ?? []).map((cat) => (
                          <li key={cat} style={{ fontSize: 14, color: "#ef4444", fontWeight: 700 }}>
                            {t[cat as keyof typeof t] ?? cat}
                          </li>
                        ))}
                      </ul>
                      <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertCircle size={14} />
                        {t.medicalDetailsRestricted}
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                  )}
                </div>
              </div>

              {/* Emergency Contact — visible to all admin-area roles */}
              {selectedStudent.emergencyContacts && selectedStudent.emergencyContacts.length > 0 && (
                <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Emergency Contact</p>
                  {selectedStudent.emergencyContacts.map((c: EmergencyContact, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>
                          {c.name} ({c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship})
                        </p>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{c.phone}</p>
                      </div>
                      <a href={`tel:${c.phone}`} className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }}><Phone size={14} /></a>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "20px 32px", background: "var(--bg-elevated)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setSelectedStudent(null)}>Close Profile</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}