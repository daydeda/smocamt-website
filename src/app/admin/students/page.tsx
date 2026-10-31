"use client";

import { prefillContactParts, prefillNameParts } from "@/lib/profile/name";
import { EMPTY_CONTACT } from "./_components/ContactsEditor";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useSession } from "next-auth/react";
import { yearOfStudy } from "@/lib/access/event-access";
import { effectiveRoles } from "@/lib/access/admin-access";
import { RESET_STRIKES_ROLES, NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import { EmptyState, ErrorState, LoadingState, PageHeader, useConfirm, useToast } from "@/components/admin/ui";
import { Search } from "lucide-react";
import {
  deriveEducationLevel,
  fill,
  ITEMS_PER_PAGE,
  rolesOf,
  type Club,
  type House,
  type Student,
} from "./_lib/students";
import { EMPTY_FILTERS, StudentFilters, type FilterKey, type Filters } from "./_components/StudentFilters";
import { StudentTable } from "./_components/StudentTable";
import { MedicalRecordModal } from "./_components/MedicalRecordModal";
import { EditStudentModal } from "./_components/EditStudentModal";

export default function AdminStudentsDirectory() {
  const { data: session } = useSession();
  const userRole = session?.user?.role || "student";
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const confirm = useConfirm();
  const toast = useToast();

  const canViewMedicalLog = userRole === "super_admin";
  // UI-only mirror of RESET_STRIKES_ROLES (src/lib/strikes.ts) — the server
  // route (/api/admin/students/[id]/strikes/reset) independently re-checks it,
  // this just decides whether to show the edit/delete/reset-strikes buttons.
  // Uses the full role set (not just the primary role) so a user whose
  // admin/super_admin grant isn't their primary role still sees the buttons.
  const canEditOrDelete = myRoles.some((r) => (RESET_STRIKES_ROLES as readonly string[]).includes(r));

  const { t } = useLanguage();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [sensitiveData, setSensitiveData] = useState<Student | null>(null);
  const [loadingSensitive, setLoadingSensitive] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  const [resettingStrikesId, setResettingStrikesId] = useState<string | null>(null);

  const [houses, setHouses] = useState<House[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    // Deferred page reset on filter change, keeping setState out of the effect body.
    const timer = setTimeout(() => setCurrentPage(1), 0);
    return () => clearTimeout(timer);
  }, [debouncedSearch, filters]);

  const refreshData = () => {
    setLoading(true);
    setLoadError(false);
    fetch("/api/admin/students")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setStudents(d);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));

    fetch("/api/admin/houses")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHouses(d); })
      .catch(() => {});

    fetch("/api/admin/clubs")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClubs(d); })
      .catch(() => {});
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshData();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const getHouseName = (id: string, defaultName: string) => {
    const h = houses.find((x) => x.id === id);
    const cg = h?.colorGroup || id;
    return cg === "red" ? (t.houseMom || "Mom")
      : cg === "green" ? (t.houseTo || "To")
      : cg === "yellow" ? (t.houseLuang || "Luang")
      : cg === "blue" ? (t.houseMakara || "Makon")
      : defaultName;
  };

  const filtered = students.filter((s) => {
    const fullName = `${s.prefix || ""}${s.name || ""}`.toLowerCase();
    const matchesSearch = fullName.includes(debouncedSearch.toLowerCase()) ||
      s.studentId?.includes(debouncedSearch) ||
      s.nickname?.toLowerCase().includes(debouncedSearch.toLowerCase());

    const matchesHouse = filters.house === "all" || s.houseId === filters.house;

    const matchesMajor = filters.major === "all" || (s.major || "").trim() === filters.major;

    const studentRoles = rolesOf(s);
    const matchesRole = filters.role === "all" ||
      studentRoles.some((r: string) => {
        if (filters.role === "staff") return ["staff", "professor", "officer"].includes(r);
        return r === filters.role;
      });

    const matchesEducation = filters.education === "all" ||
      deriveEducationLevel(s.studentId) === filters.education;

    const matchesYear = (() => {
      if (filters.year === "all") return true;
      const yr = yearOfStudy(s.studentId);
      if (filters.year === "5plus") return yr != null && yr >= 5;
      return yr === parseInt(filters.year, 10);
    })();

    const matchesPosition = filters.position === "all" ||
      s.smoPosition === filters.position || s.anusmoPosition === filters.position;

    return matchesSearch && matchesHouse && matchesRole && matchesMajor && matchesEducation && matchesYear && matchesPosition;
  });

  const paginatedStudents = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const hasActiveFilters = search.trim() !== "" || Object.values(filters).some((v) => v !== "all");
  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setFilters(EMPTY_FILTERS);
  };

  const idOf = (s: Student) => s.studentId ?? t.adminStuNoId;

  // PDPA: the audited medical read. The confirmation below MUST stay before
  // the fetch: nothing is requested (and so nothing is logged or shown) until
  // the admin has accepted that the access is permanently logged.
  const viewSensitive = async (s: Student) => {
    const accepted = await confirm({
      title: t.adminStuMedicalConfirmTitle,
      message: fill(t.adminStuMedicalConfirmBody, { name: s.name, id: idOf(s) }),
      confirmLabel: t.adminStuMedicalConfirmBtn,
      tone: "danger",
    });
    if (!accepted) return;
    const id = s.id;
    setViewingId(id);
    setLoadingSensitive(true);
    setSensitiveData(null);
    setSensitiveError(null);
    try {
      const res = await fetch(`/api/admin/students/${id}`);
      if (res.ok) {
        setSensitiveData(await res.json());
      } else {
        const data = await res.json().catch(() => null);
        setSensitiveError((data && data.error) || t.adminStuMedicalLoadFailed);
      }
    } catch (err) {
      console.error(err);
      setSensitiveError(t.adminStuMedicalLoadFailed);
    } finally {
      setLoadingSensitive(false);
    }
  };

  const closeSensitive = () => {
    setViewingId(null);
    setSensitiveData(null);
    setSensitiveError(null);
  };

  // Clears a student's no-show strikes/block (super_admin/admin only, see
  // canEditOrDelete above — narrower RESET_STRIKES_ROLES enforced server-side
  // at /api/admin/students/[id]/strikes/reset). Does not refund deducted
  // points; that penalty already stands as served.
  const resetStrikes = async (s: Student) => {
    const accepted = await confirm({
      title: t.adminStuResetTitle,
      message: fill(s.registrationBlocked ? t.adminStuResetBodyBlocked : t.adminStuResetBody, {
        name: s.name,
        id: idOf(s),
        count: s.noShowCount ?? 0,
        max: NO_SHOW_STRIKE_THRESHOLD,
      }),
      confirmLabel: t.adminStuResetStrikes,
    });
    if (!accepted) return;
    setResettingStrikesId(s.id);
    try {
      const res = await fetch(`/api/admin/students/${s.id}/strikes/reset`, { method: "POST" });
      if (res.ok) {
        toast.success(fill(t.adminStuResetDone, { name: s.name }));
        refreshData();
      } else {
        toast.error(t.adminStuResetFailed, t.adminStuResetFailedBody);
      }
    } catch {
      toast.error(t.adminStuResetFailed, t.adminStuResetFailedBody);
    } finally {
      setResettingStrikesId(null);
    }
  };

  const deleteStudent = async (s: Student) => {
    const accepted = await confirm({
      title: fill(t.adminStuDeleteTitle, { name: s.name }),
      message: s.studentId
        ? fill(t.adminStuDeleteBody, { name: s.name, id: s.studentId })
        : fill(t.adminStuDeleteBodyNoId, { name: s.name }),
      confirmLabel: t.adminStuDelete,
      tone: "danger",
      // Irreversible: make the admin type the student ID (when there is one).
      requireText: s.studentId || undefined,
    });
    if (!accepted) return;
    try {
      const res = await fetch(`/api/admin/users/${s.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(fill(t.adminStuDeleteDone, { name: s.name }));
        refreshData();
      } else {
        toast.error(fill(t.adminStuDeleteFailed, { name: s.name }), t.adminStuDeleteFailedBody);
      }
    } catch {
      toast.error(fill(t.adminStuDeleteFailed, { name: s.name }), t.adminStuDeleteFailedBody);
    }
  };

  const startEdit = (s: Student) => {
    // Legacy rows have no name parts yet: suggest a split the admin can correct.
    setEditingStudent({
      ...s,
      ...(s.firstName || s.lastName
        ? { firstName: s.firstName || "", middleName: s.middleName || "", lastName: s.lastName || "" }
        : prefillNameParts(s.name)),
    });
    // HN is medical detail: super_admin only, loaded through the audited
    // sensitive-detail endpoint (never in the bulk list). Until it loads the
    // fields stay hidden and the PATCH carries no HN, so nothing is blanked.
    if (userRole === "super_admin") {
      fetch(`/api/admin/students/${s.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setEditingStudent((prev) => (prev && prev.id === s.id
            ? {
                ...prev,
                hospitalNumber: d.hospitalNumber ?? "",
                hospitalName: d.hospitalName ?? "",
                // Same audited read: contacts load only for super_admin, as split parts.
                emergencyContacts: [0, 1].map((k) => prefillContactParts(d.emergencyContacts?.[k] ?? EMPTY_CONTACT)),
              }
            : prev));
        })
        .catch(() => {});
    }
    // Pre-check the club picker with this user's current
    // presidencies (not included in the student list fetch).
    fetch(`/api/admin/clubs?presidentUserId=${s.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        const clubIds = d.filter((c) => c.isPresident).map((c) => c.id);
        setEditingStudent((prev) => (prev && prev.id === s.id ? { ...prev, clubIds } : prev));
      });
  };

  const viewingStudent = viewingId ? students.find((x) => x.id === viewingId) : undefined;
  const initialLoad = loading && students.length === 0;

  return (
    <>
      <div className="animate-fade-in-up">
        <PageHeader title={t.adminStudentsDirectory} description={t.adminStuDesc} />

        {initialLoad ? (
          <LoadingState label={t.adminStuLoading} />
        ) : loadError && students.length === 0 ? (
          <ErrorState title={t.adminStuLoadError} message={t.adminStuLoadErrorBody} onRetry={refreshData} />
        ) : (
          <>
            <StudentFilters
              search={search}
              onSearch={setSearch}
              filters={filters}
              onFilter={(key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value }))}
              onClear={clearFilters}
              students={students}
              houses={houses}
              getHouseName={getHouseName}
              filteredCount={filtered.length}
            />

            {filtered.length === 0 ? (
              <section className="adm-panel">
                {hasActiveFilters ? (
                  <EmptyState
                    icon={<Search size={24} />}
                    title={t.adminStuEmptyNoMatchTitle}
                    description={t.adminStuEmptyNoMatchBody}
                    action={<button type="button" className="btn btn-ghost" onClick={clearFilters}>{t.adminStuClearFilters}</button>}
                  />
                ) : (
                  <EmptyState title={t.adminStuEmptyDirectoryTitle} description={t.adminStuEmptyDirectoryBody} />
                )}
              </section>
            ) : (
              <StudentTable
                students={paginatedStudents}
                total={filtered.length}
                page={currentPage}
                onPageChange={setCurrentPage}
                canEditOrDelete={canEditOrDelete}
                canViewMedicalLog={canViewMedicalLog}
                userRole={userRole}
                resettingStrikesId={resettingStrikesId}
                getHouseName={getHouseName}
                onEdit={startEdit}
                onDelete={deleteStudent}
                onMedical={viewSensitive}
                onResetStrikes={resetStrikes}
              />
            )}
          </>
        )}
      </div>

      {viewingId && (
        <MedicalRecordModal
          student={viewingStudent}
          data={sensitiveData}
          loading={loadingSensitive}
          error={sensitiveError}
          // Retry goes back through viewSensitive, so the logged-access confirmation is asked again.
          onRetry={() => { if (viewingStudent) viewSensitive(viewingStudent); }}
          onClose={closeSensitive}
        />
      )}

      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          setStudent={setEditingStudent}
          houses={houses}
          clubs={clubs}
          userRole={userRole}
          getHouseName={getHouseName}
          onClose={() => setEditingStudent(null)}
          onSaved={refreshData}
        />
      )}
    </>
  );
}
