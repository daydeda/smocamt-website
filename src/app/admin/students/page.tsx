"use client";

import { useEffect, useState, useRef } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { useSession } from "next-auth/react";
import { yearOfStudy } from "@/lib/event-access";
import { effectiveRoles } from "@/lib/admin-access";
import {
  Search, Users, ShieldAlert, Heart, Phone,
  X, ShieldCheck, User as UserIcon,
  Activity, GraduationCap, ChevronDown,
  Edit2, Trash2, Check, Home, Shield,
  BookOpen, Briefcase, Award, AlertTriangle, RotateCcw
} from "lucide-react";
import { NO_SHOW_STRIKE_THRESHOLD, RESET_STRIKES_ROLES } from "@/lib/strikes";
import { POSITION_IDS, POSITION_I18N_KEY } from "@/lib/positions";

type Student = {
  id: string;
  studentId?: string;
  prefix?: string;
  name: string;
  nickname?: string;
  major?: string;
  // SMO/ANUSMO staff titles (src/lib/positions.ts), scoped independently — a
  // student can hold both roles at once with a different title in each. Club
  // titles live on club_members.position (edited in admin/clubs's Members
  // modal) and major titles on users.majorPosition (admin/majors's Team
  // panel) — neither is edited from this page.
  smoPosition?: string | null;
  anusmoPosition?: string | null;
  email?: string;
  phone?: string;
  // Both email and phone are only ever present on this Student object when the
  // requester is super_admin — see GET /api/admin/students, which strips
  // these columns for every other role (PDPA minimization).
  contactChannels?: string | null;
  houseId?: string;
  house?: { id: string; name: string; color?: string } | null;
  profileCompleted?: boolean;
  role?: string;
  roles?: string[];
  noShowCount?: number;
  registrationBlocked?: boolean;
  chronicDiseases?: string | null;
  medicalHistory?: string | null;
  drugAllergies?: string | null;
  foodAllergies?: string | null;
  dietaryRestrictions?: string | null;
  faintingHistory?: boolean | null;
  emergencyContacts?: Array<{
    name: string;
    relationship: string;
    phone: string;
  }> | null;
  // Clubs this user presides over (club_president identity — see
  // EventScopeService). Only fetched/shown when the club_president checkbox is
  // checked in the edit modal.
  clubIds?: string[];
};

type DropdownOption = {
  value: string;
  label: string;
  color?: string;
  icon?: React.ReactNode;
};

interface CustomDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  placeholder?: string;
  className?: string;
}

function CustomDropdown({ value, options, onChange, icon, placeholder = "Select...", className = "" }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const currentOption = options.find(o => o.value === value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Check if a specific filter (not "all" or empty) is selected
  const hasActiveFilter = value !== "all" && value !== "";

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-between w-full h-14 bg-[var(--bg-elevated)] border rounded-2xl px-4 text-base font-bold text-[var(--text-primary)] shadow-sm transition-all duration-300 cursor-pointer ${
          open
            ? "border-[var(--accent-primary)] shadow-[0_0_0_3px_var(--accent-glow)] bg-[var(--bg-surface)]"
            : "border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 hover:bg-[var(--bg-surface)] hover:shadow-md"
        }`}
      >
        <div className="flex items-center gap-3">
          {/* Left badge for category icon */}
          {icon && (
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ml-2 mr-0.5 ${
              hasActiveFilter
                ? "bg-[var(--accent-glow)] text-[var(--accent-primary)] shadow-[0_0_10px_rgba(255,107,0,0.15)]"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            }`}>
              {currentOption?.icon ? currentOption.icon : icon}
            </div>
          )}

          {/* Option details block */}
          <div className="flex items-center gap-2">
            {currentOption?.color && (
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: currentOption.color,
                boxShadow: `0 0 8px ${currentOption.color}88`,
                flexShrink: 0
              }} />
            )}
            {currentOption?.icon && !icon && (
              <span className="flex-shrink-0 text-[var(--accent-primary)]">
                {currentOption.icon}
              </span>
            )}
            <span className="text-sm font-extrabold text-[var(--text-primary)] leading-normal truncate max-w-[140px]">
              {currentOption ? currentOption.label : placeholder}
            </span>
          </div>
        </div>

        <ChevronDown
          size={16}
          className={`text-muted transition-transform duration-300 ${open ? "text-[var(--accent-primary)]" : ""}`}
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-2 bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-medium)] rounded-none animate-fade-in-up overflow-hidden"
          style={{
            zIndex: 9999,
            boxShadow: "0 16px 48px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex flex-col gap-0 max-h-[280px] overflow-y-auto custom-scrollbar">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              
              // Dynamic text color for selected state
              const dynamicText = opt.color
                ? opt.color
                : "var(--accent-primary)";

              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`group flex items-center justify-between w-full px-5 py-3.5 text-left text-sm font-semibold transition-all duration-200 cursor-pointer rounded-none hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]`}
                  style={{
                    color: isSelected ? dynamicText : "var(--text-secondary)",
                  }}
                >
                  <div className="flex items-center gap-3 transition-transform duration-300">
                    {/* Explicit 20px spacer to ensure absolute vertical alignment */}
                    <div style={{ width: '20px', height: '20px' }} className="flex items-center justify-center flex-shrink-0">
                      {opt.color ? (
                        <div
                          className="transition-all duration-300 group-hover:scale-125"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: opt.color,
                            boxShadow: `0 0 8px ${opt.color}66`,
                          }}
                        />
                      ) : opt.icon ? (
                        <span className={`flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${
                          isSelected ? "" : "text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]"
                        }`}>
                          {opt.icon}
                        </span>
                      ) : null}
                    </div>
                    <span className={`truncate transition-colors duration-200 ${
                      isSelected ? "font-bold text-[var(--text-primary)]" : "group-hover:text-[var(--text-primary)]"
                    }`}
                      style={{
                        color: isSelected ? dynamicText : undefined
                      }}
                    >
                      {opt.label}
                    </span>
                  </div>
                  {isSelected && <Check size={16} className="flex-shrink-0 ml-2 animate-fade-in" style={{ color: dynamicText }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminStudentsDirectory() {
  const { data: session } = useSession();
  const userRole = session?.user?.role || "student";
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);

  const canViewMedicalLog = userRole === "super_admin";
  // UI-only mirror of RESET_STRIKES_ROLES (src/lib/strikes.ts) — the server
  // route (/api/admin/students/[id]/strikes/reset) independently re-checks it,
  // this just decides whether to show the edit/delete/reset-strikes buttons.
  // Uses the full role set (not just the primary role) so a user whose
  // admin/super_admin grant isn't their primary role still sees the buttons.
  const canEditOrDelete = myRoles.some((r) => (RESET_STRIKES_ROLES as readonly string[]).includes(r));

  const { t, lang } = useLanguage();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [sensitiveData, setSensitiveData] = useState<Student | null>(null);
  const [loadingSensitive, setLoadingSensitive] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  const [resettingStrikesId, setResettingStrikesId] = useState<string | null>(null);

  const [houses, setHouses] = useState<{ id: string; name: string; faculty?: string; colorGroup?: string }[]>([]);
  const [clubs, setClubs] = useState<{ id: string; name: string; isArchived: boolean }[]>([]);
  const [houseFilter, setHouseFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [majorFilter, setMajorFilter] = useState<string>("all");
  const [educationFilter, setEducationFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [updating, setUpdating] = useState(false);

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
  }, [debouncedSearch, houseFilter, roleFilter, majorFilter, educationFilter, yearFilter, positionFilter]);

  const refreshData = () => {
    setLoading(true);
    fetch("/api/admin/students")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setStudents(d); })
      .finally(() => setLoading(false));

    fetch("/api/admin/houses")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHouses(d); });

    fetch("/api/admin/clubs")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClubs(d); });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshData();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const hasActualMedicalInfo = (user: Student) => {
    if (!user) return false;
    const fields = [
      user.chronicDiseases,
      user.medicalHistory,
      user.drugAllergies,
      user.foodAllergies,
      user.dietaryRestrictions
    ];
    const isMeaningful = (val: string | null | undefined) => {
      if (typeof val !== 'string') return !!val;
      const t = val.trim();
      return t !== "" && t !== "-";
    };
    return fields.some(isMeaningful) || user.faintingHistory === true;
  };

  const getHouseName = (id: string, defaultName: string) => {
    const h = houses.find(x => x.id === id);
    const cg = h?.colorGroup || id;
    return cg === "red" ? (t.houseMom || "Mom")
      : cg === "green" ? (t.houseTo || "To")
      : cg === "yellow" ? (t.houseLuang || "Luang")
      : cg === "blue" ? (t.houseMakara || "Makon")
      : defaultName;
  };

  const houseOptions = [
    { value: "all", label: t.allHouses },
    ...houses.map(h => {
      const cg = h.colorGroup || h.id;
      return {
      value: h.id,
      label: getHouseName(h.id, h.name),
      color: cg === "red" ? "#ef4444" : cg === "blue" ? "#3b82f6" : cg === "green" ? "#10b981" : cg === "yellow" ? "#f59e0b" : "var(--accent-primary)"
    };
    })
  ];

  const roleOptions = [
    { value: "all", label: t.allRoles },
    { value: "student", label: t.roleStudentPlural, icon: <GraduationCap size={16} className="text-muted" /> },
    { value: "staff", label: t.roleStaffPlural, icon: <Briefcase size={16} className="text-[#14b8a6]" /> },
    { value: "smo", label: t.roleSMOPlural, icon: <Award size={16} className="text-[#8b5cf6]" /> },
    { value: "anusmo", label: t.roleANUSMOPlural, icon: <Award size={16} className="text-[#ec4899]" /> },
    { value: "admin", label: t.roleAdminPlural, icon: <ShieldCheck size={16} className="text-[var(--accent-primary)]" /> },
    { value: "super_admin", label: t.roleSuperAdminPlural, icon: <Shield size={16} className="text-[#ef4444]" /> },
    { value: "registration", label: t.roleRegistrationPlural, icon: <UserIcon size={16} className="text-[#3b82f6]" /> },
    { value: "organizer", label: t.roleOrganizerPlural, icon: <Award size={16} className="text-[#10b981]" /> },
    { value: "club_president", label: t.roleClubPresidentPlural, icon: <Award size={16} className="text-[#f59e0b]" /> },
    { value: "major_president", label: t.roleMajorPresidentPlural, icon: <Award size={16} className="text-[#06b6d4]" /> }
  ];

  const majorOptions = [
    { value: "all", label: t.allMajors, icon: <BookOpen size={16} className="text-muted" /> },
    ...Array.from(
      new Set(
        students
          .map(s => (s.major || "").trim())
          .filter(m => m !== "")
      )
    )
      .sort((a, b) => a.localeCompare(b))
      .map(m => ({ value: m, label: m, icon: <BookOpen size={16} className="text-[var(--accent-primary)]" /> }))
  ];

  const deriveEducationLevel = (studentId: string | undefined): "undergrad" | "masters" | "phd" | null => {
    if (!studentId || studentId.length < 5) return null;
    const d = studentId.trim()[4];
    if (d === "3") return "masters";
    if (d === "5") return "phd";
    return "undergrad";
  };

  const educationOptions = [
    { value: "all", label: t.allEducationLevels },
    { value: "undergrad", label: t.educationUndergrad },
    { value: "masters", label: t.educationMasters },
    { value: "phd", label: t.educationPhD },
  ];

  const yearOptions = [
    { value: "all", label: t.allYears },
    ...[1, 2, 3, 4].map(n => ({ value: String(n), label: t.yearN.replace("{n}", String(n)) })),
    { value: "5plus", label: t.yearNPlus.replace("{n}", "5") },
  ];

  // SMO/ANUSMO staff titles (src/lib/positions.ts) — the only "position" data
  // present on this Student object (club/major titles live elsewhere, see the
  // comment on Student.smoPosition above). Filters on either field so a
  // student holding the same title in just one of the two roles still matches.
  const positionOptions = [
    { value: "all", label: t.allPositions || "All Positions", icon: <Briefcase size={16} className="text-muted" /> },
    ...POSITION_IDS.map(id => ({
      value: id,
      label: t[POSITION_I18N_KEY[id] as keyof typeof t] as string,
      icon: <Briefcase size={16} className="text-[var(--accent-primary)]" />,
    })),
  ];

  const editRoleOptions = [
    { value: "student", label: t.roleStudent, icon: <GraduationCap size={16} className="text-muted" /> },
    { value: "staff", label: t.roleStaff, icon: <Briefcase size={16} className="text-[#14b8a6]" /> },
    { value: "smo", label: t.roleSMO, icon: <Award size={16} className="text-[#8b5cf6]" /> },
    { value: "anusmo", label: t.roleANUSMO, icon: <Award size={16} className="text-[#ec4899]" /> },
    { value: "admin", label: t.roleAdmin, icon: <ShieldCheck size={16} className="text-[var(--accent-primary)]" /> },
    { value: "super_admin", label: t.roleSuperAdmin, icon: <Shield size={16} className="text-[#ef4444]" /> },
    { value: "registration", label: t.roleRegistration, icon: <UserIcon size={16} className="text-[#3b82f6]" /> },
    { value: "organizer", label: t.roleOrganizer, icon: <Award size={16} className="text-[#10b981]" /> },
    { value: "club_president", label: t.roleClubPresident, icon: <Award size={16} className="text-[#f59e0b]" /> },
    { value: "major_president", label: t.roleMajorPresident, icon: <Award size={16} className="text-[#06b6d4]" /> }
  ];

  const allowedEditRoleOptions = editRoleOptions.filter(opt => {
    if (opt.value === "super_admin" && userRole !== "super_admin") {
      return false;
    }
    return true;
  });

  const editHouseOptions = [
    { value: "", label: t.unassignedLabel, icon: <X size={16} className="text-muted" /> },
    ...houses.map(h => {
      const cg = h.colorGroup || h.id;
      return {
      value: h.id,
      label: getHouseName(h.id, h.name),
      color: cg === "red" ? "#ef4444" : cg === "blue" ? "#3b82f6" : cg === "green" ? "#10b981" : cg === "yellow" ? "#f59e0b" : "var(--accent-primary)"
    };
    })
  ];

  const filtered = students.filter(
    (s) => {
      const fullName = `${s.prefix || ""}${s.name || ""}`.toLowerCase();
      const matchesSearch = fullName.includes(debouncedSearch.toLowerCase()) ||
        s.studentId?.includes(debouncedSearch) ||
        s.nickname?.toLowerCase().includes(debouncedSearch.toLowerCase());

      const matchesHouse = houseFilter === "all" || s.houseId === houseFilter;

      const matchesMajor = majorFilter === "all" || (s.major || "").trim() === majorFilter;

      const studentRoles = s.roles || (s.role ? [s.role] : ["student"]);
      const matchesRole = roleFilter === "all" ||
        studentRoles.some((r: string) => {
          if (roleFilter === "staff") return ["staff", "professor", "officer"].includes(r);
          return r === roleFilter;
        });

      const matchesEducation = educationFilter === "all" ||
        deriveEducationLevel(s.studentId) === educationFilter;

      const matchesYear = (() => {
        if (yearFilter === "all") return true;
        const yr = yearOfStudy(s.studentId);
        if (yearFilter === "5plus") return yr != null && yr >= 5;
        return yr === parseInt(yearFilter, 10);
      })();

      const matchesPosition = positionFilter === "all" ||
        s.smoPosition === positionFilter || s.anusmoPosition === positionFilter;

      return matchesSearch && matchesHouse && matchesRole && matchesMajor && matchesEducation && matchesYear && matchesPosition;
    }
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedStudents = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const viewSensitive = async (id: string) => {
    if (!confirm("⚠ CRITICAL ACCESS: Viewing medical/emergency data will be permanently logged. Continue?")) return;
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
        setSensitiveError((data && data.error) || "Failed to load health records.");
      }
    } catch (err) {
      console.error(err);
      setSensitiveError("Failed to load health records.");
    } finally {
      setLoadingSensitive(false);
    }
  };

  // Clears a student's no-show strikes/block (super_admin/admin only, see
  // canEditOrDelete below — narrower RESET_STRIKES_ROLES enforced server-side
  // at /api/admin/students/[id]/strikes/reset). Does not refund deducted
  // points; that penalty already stands as served.
  const resetStrikes = async (s: Student) => {
    if (!confirm(`Reset ${s.name}'s no-show strikes (${s.noShowCount ?? 0}/3)${s.registrationBlocked ? " and unblock registration" : ""}?`)) return;
    setResettingStrikesId(s.id);
    try {
      const res = await fetch(`/api/admin/students/${s.id}/strikes/reset`, { method: "POST" });
      if (res.ok) refreshData();
      else alert("Failed to reset strikes. Check permissions.");
    } catch {
      alert("Failed to reset strikes.");
    } finally {
      setResettingStrikesId(null);
    }
  };

  return (
    <>
      <div className="animate-fade-in-up pb-24">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6" style={{ marginBottom: 40 }}>
          <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">{t.adminStudentsDirectory}</h1>
          <div className="flex items-center gap-5 bg-[var(--bg-surface)] px-7 py-4 rounded-[40px] border border-[var(--border-subtle)] shadow-xl shadow-black/5 flex-shrink-0">
            <div className="flex-shrink-0 w-14 h-14 rounded-[20px] bg-[var(--accent-glow)] flex items-center justify-center text-[var(--accent-primary)]">
              <Users size={26} />
            </div>
            <div className="flex flex-col min-w-[120px]">
              <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{filtered.length}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.15em", marginTop: 5, whiteSpace: "nowrap" }}>Active Members</span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div
          className="relative group bg-[var(--bg-surface)] p-4 rounded-[32px] border border-[var(--border-subtle)] shadow-2xl shadow-black/5"
          style={{ marginBottom: 16 }}
        >
          <Search size={20} className="absolute left-9 top-1/2 -translate-y-1/2 text-muted transition-colors group-focus-within:text-[var(--accent-primary)]" />
          <input
            id="student-search-input"
            className="input w-full h-14 bg-[var(--bg-elevated)] border-none rounded-2xl text-base font-medium transition-all focus:ring-2 focus:ring-[var(--accent-primary)]/20"
            style={{ paddingLeft: 56 }}
            type="text"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Filters */}
        <div
          className="bg-[var(--bg-surface)] p-4 rounded-[32px] border border-[var(--border-subtle)] shadow-2xl shadow-black/5 overflow-visible"
          style={{ marginBottom: 48 }}
        >
          <div className="flex flex-wrap gap-4">
            <CustomDropdown
              className="min-w-[200px] flex-1"
              value={houseFilter}
              options={houseOptions}
              onChange={setHouseFilter}
              icon={<Home size={18} />}
            />
            <CustomDropdown
              className="min-w-[200px] flex-1"
              value={roleFilter}
              options={roleOptions}
              onChange={setRoleFilter}
              icon={<Shield size={18} />}
            />
            <CustomDropdown
              className="min-w-[200px] flex-1"
              value={majorFilter}
              options={majorOptions}
              onChange={setMajorFilter}
              icon={<BookOpen size={18} />}
            />
            <CustomDropdown
              className="min-w-[180px] flex-1"
              value={educationFilter}
              options={educationOptions}
              onChange={setEducationFilter}
              icon={<GraduationCap size={18} />}
            />
            <CustomDropdown
              className="min-w-[160px] flex-1"
              value={yearFilter}
              options={yearOptions}
              onChange={setYearFilter}
              icon={<Activity size={18} />}
            />
            <CustomDropdown
              className="min-w-[200px] flex-1"
              value={positionFilter}
              options={positionOptions}
              onChange={setPositionFilter}
              icon={<Briefcase size={18} />}
            />
          </div>
        </div>

        {/* Data Table Container */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 40,
            overflow: "hidden",
            boxShadow: "0 20px 50px rgba(0,0,0,0.02)"
          }}
        >
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 100, gap: 20 }}>
              <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
              <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Retrieving Student Records...</p>
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ borderCollapse: "separate", borderSpacing: "0 0" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "24px 32px" }}>Identification</th>
                    <th>{t.prefix}</th>
                    <th>{t.fullName}</th>
                    <th>Academic Info</th>
                    <th>House Affiliation</th>
                    <th>System Status</th>
                    <th style={{ textAlign: "right", paddingRight: 32 }}>Security Access</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedStudents.map((s) => {
                    const isTargetSuperAdmin = s.role === "super_admin";
                    const canModifyThisRow = canEditOrDelete && (!isTargetSuperAdmin || userRole === "super_admin");
                    return (
                      <tr key={s.id} style={{ transition: "all 0.2s" }} className="student-row">
                      <td style={{ padding: "24px 32px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border-subtle)" }}>
                            <GraduationCap size={16} className="text-muted" />
                          </div>
                          <code style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.02em" }}>
                            {s.studentId ?? "—"}
                          </code>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: "var(--text-secondary)", fontSize: 15 }}>
                          {s.prefix || "—"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 800, color: "var(--text-primary)", fontSize: 16 }}>
                            {s.name}
                          </span>
                          {(() => {
                            const studentRoles = s.roles || (s.role ? [s.role] : ["student"]);
                            return studentRoles.map((r: string, idx: number) => {
                              if (r === "super_admin") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Super Administrator">
                                  <Shield size={10} /> {t.roleSuperAdmin}
                                </span>
                              );
                              if (r === "admin") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(249,115,22,0.1)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="System Administrator">
                                  <ShieldCheck size={10} /> {t.roleAdmin}
                                </span>
                              );
                              if (r === "registration") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Registration Staff">
                                  <UserIcon size={10} /> {t.roleRegistration}
                                </span>
                              );
                              if (r === "organizer") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Event Organizer">
                                  <Award size={10} /> {t.roleOrganizer}
                                </span>
                              );
                              if (r === "smo") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(139,92,246,0.1)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Student Council (SMO)">
                                  <Award size={10} /> {t.roleSMO}
                                </span>
                              );
                              if (r === "anusmo") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(236,72,153,0.1)", color: "#ec4899", border: "1px solid rgba(236,72,153,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Junior Student Council (ANUSMO)">
                                  <Award size={10} /> {t.roleANUSMO}
                                </span>
                              );
                              if (r === "club_president") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Club President">
                                  <Award size={10} /> {t.roleClubPresident}
                                </span>
                              );
                              if (r === "major_president") return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(6,182,212,0.1)", color: "#06b6d4", border: "1px solid rgba(6,182,212,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Major President">
                                  <Award size={10} /> {t.roleMajorPresident}
                                </span>
                              );
                              if (["staff", "professor", "officer"].includes(r)) return (
                                <span key={idx} className="badge" style={{ padding: "2px 8px", background: "rgba(20,184,166,0.1)", color: "#14b8a6", border: "1px solid rgba(20,184,166,0.2)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title="Staff">
                                  <Briefcase size={10} /> {t.roleStaff}
                                </span>
                              );
                              return null;
                            });
                          })()}
                          {s.nickname && (
                            <span className="badge" style={{ padding: "2px 8px", background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>&ldquo;{s.nickname}&rdquo;</span>
                          )}
                          {hasActualMedicalInfo(s) && (
                            <div style={{ color: "#ef4444", animation: "pulse-glow 2s infinite", display: "inline-flex", flexShrink: 0 }} title="Medical Condition">
                              <Activity size={20} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-primary)" }} />
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>{s.major ?? "N/A"}</span>
                        </div>
                      </td>
                      <td>
                        {s.house ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: s.house.color || "var(--accent-primary)",
                              boxShadow: `0 0 10px ${s.house.color}44`
                            }} />
                            <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 14 }}>{getHouseName(s.house.id, s.house.name)}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}>Unassigned</span>
                        )}
                      </td>
                      <td>
                        {s.profileCompleted ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981" }}>
                            <ShieldCheck size={16} />
                            <span style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>Verified</span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-secondary)" }}>
                            <Activity size={16} />
                            <span style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>Pending</span>
                          </div>
                        )}
                        {(s.noShowCount ?? 0) > 0 && (
                          <div
                            style={{ display: "flex", alignItems: "center", gap: 6, color: (s.registrationBlocked || (s.noShowCount ?? 0) >= NO_SHOW_STRIKE_THRESHOLD - 1) ? "#ef4444" : "#f59e0b", marginTop: 6 }}
                            title={s.registrationBlocked ? "Pre-registration blocked due to repeated no-shows" : "Has recorded no-show strike(s)"}
                          >
                            <AlertTriangle size={14} />
                            <span style={{ fontWeight: 800, fontSize: 11, textTransform: "uppercase" }}>
                              No-show {s.noShowCount}/{NO_SHOW_STRIKE_THRESHOLD}{s.registrationBlocked ? " · Blocked" : ""}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 32 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                          {canModifyThisRow ? (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: 8, borderRadius: 10, color: "var(--text-secondary)" }}
                              onClick={() => {
                                setEditingStudent(s);
                                // Pre-check the club picker with this user's current
                                // presidencies (not included in the student list fetch).
                                fetch(`/api/admin/clubs?presidentUserId=${s.id}`)
                                  .then((r) => r.json())
                                  .then((d) => {
                                    if (!Array.isArray(d)) return;
                                    const clubIds = d.filter((c) => c.isPresident).map((c) => c.id);
                                    setEditingStudent((prev) => (prev && prev.id === s.id ? { ...prev, clubIds } : prev));
                                  });
                              }}
                              title="Edit User"
                            >
                              <Edit2 size={16} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: 8, borderRadius: 10, color: "var(--text-muted)", opacity: 0.4, cursor: "not-allowed" }}
                              disabled
                              title="Edit User (Restricted)"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {canModifyThisRow ? (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: 8, borderRadius: 10, color: "#ef4444" }}
                              onClick={async () => {
                                if (confirm(`⚠ PERMANENT ACTION: Are you sure you want to delete ${s.name}? This cannot be undone.`)) {
                                  const res = await fetch(`/api/admin/users/${s.id}`, { method: "DELETE" });
                                  if (res.ok) refreshData();
                                  else alert("Failed to delete user. Check permissions.");
                                }
                              }}
                              title="Delete User"
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: 8, borderRadius: 10, color: "var(--text-muted)", opacity: 0.4, cursor: "not-allowed" }}
                              disabled
                              title="Delete User (Restricted)"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {canViewMedicalLog && (
                            <>
                              <div style={{ width: 1, height: 24, background: "var(--border-subtle)", margin: "0 4px" }} />
                              <button
                                id={`view-sensitive-${s.id}-btn`}
                                className="btn btn-sm"
                                style={{
                                  borderRadius: 10,
                                  background: "rgba(239,68,68,0.08)",
                                  border: "1px solid rgba(239,68,68,0.15)",
                                  fontWeight: 700,
                                  color: "#ef4444",
                                  fontSize: 12,
                                  gap: 6
                                }}
                                onClick={() => viewSensitive(s.id)}
                              >
                                <ShieldAlert size={13} /> Medical Log
                              </button>
                            </>
                          )}
                          {canEditOrDelete && (s.noShowCount ?? 0) > 0 && (
                            <button
                              className="btn btn-sm"
                              style={{
                                borderRadius: 10,
                                background: "rgba(245,158,11,0.08)",
                                border: "1px solid rgba(245,158,11,0.15)",
                                fontWeight: 700,
                                color: "#f59e0b",
                                fontSize: 12,
                                gap: 6,
                                opacity: resettingStrikesId === s.id ? 0.6 : 1,
                              }}
                              disabled={resettingStrikesId === s.id}
                              onClick={() => resetStrikes(s)}
                              title="Reset no-show strikes and unblock registration"
                            >
                              <RotateCcw size={13} /> Reset Strikes
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 80 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                            <Search size={32} />
                          </div>
                          <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>{search ? "No matches found for your criteria." : "Directory is currently empty."}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > ITEMS_PER_PAGE && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 32px",
                borderTop: "1px solid var(--border-subtle)",
                flexWrap: "wrap",
                gap: 16,
                background: "var(--bg-elevated)",
                borderBottomLeftRadius: 40,
                borderBottomRightRadius: 40
              }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                  {lang === "th"
                    ? `กำลังแสดง ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} จากทั้งหมด ${filtered.length} คน`
                    : `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of ${filtered.length} members`}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "8px 16px", borderRadius: 10, fontWeight: 700 }}
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  >
                    {lang === "th" ? "ก่อนหน้า" : "Previous"}
                  </button>
                  <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 800 }}>
                    {lang === "th" ? `หน้า ${currentPage} จาก ${totalPages}` : `Page ${currentPage} of ${totalPages}`}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "8px 16px", borderRadius: 10, fontWeight: 700 }}
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  >
                    {lang === "th" ? "ถัดไป" : "Next"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Sensitive Data Modal */}
      {viewingId && (
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
            zIndex: 9999,
            padding: 24
          }}
          onClick={() => { setViewingId(null); setSensitiveData(null); setSensitiveError(null); }}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-medium)",
              borderRadius: 40,
              padding: 0,
              maxWidth: 600,
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column"
            }}
          >
            {/* Modal Header */}
            <div style={{ padding: "32px 40px", borderBottom: "1px solid var(--border-subtle)", background: "linear-gradient(to bottom, var(--bg-surface), var(--bg-elevated))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="badge animate-pulse-glow" style={{ background: "#ef4444", color: "#fff", border: "none", marginBottom: 12 }}>
                    <ShieldAlert size={12} /> SECURE ACCESS
                  </div>
                  <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)" }}>Member Health Profile</h2>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ borderRadius: "50%", width: 44, height: 44, padding: 0, background: "var(--bg-elevated)" }}
                  onClick={() => { setViewingId(null); setSensitiveData(null); setSensitiveError(null); }}
                >
                  <X size={20} />
                </button>
              </div>

              {loadingSensitive ? (
                <div style={{ height: 20 }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 16, background: "var(--accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)" }}>
                    <UserIcon size={24} />
                  </div>
                  <div>
                    <p style={{ fontWeight: 800, fontSize: 18, color: "var(--text-primary)" }}>
                      {sensitiveData?.prefix || ""}{sensitiveData?.name}
                    </p>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600 }}>Member ID: {sensitiveData?.studentId}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "40px" }} className="custom-scrollbar">
              {loadingSensitive ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "40px 0" }}>
                  <div className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
                  <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Decrypting health records...</p>
                </div>
              ) : sensitiveError ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "40px 0", textAlign: "center" }}>
                  <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
                    <ShieldAlert size={36} />
                  </div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>Couldn&apos;t load health records</h3>
                  <p style={{ color: "var(--text-muted)", fontWeight: 600, maxWidth: 360 }}>{sensitiveError}</p>
                  <p style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 600, maxWidth: 360 }}>
                    This does <strong>not</strong> mean the member has no medical conditions — the records simply failed to load. Please retry.
                  </p>
                  <button className="btn btn-primary" style={{ borderRadius: 12, padding: "10px 24px", marginTop: 4 }} onClick={() => { if (viewingId) viewSensitive(viewingId); }}>
                    Retry
                  </button>
                </div>
              ) : sensitiveData && (
                <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                  {/* Medical Section */}
                  <div>
                    <p className="section-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <Heart size={14} style={{ color: "#ef4444" }} /> CLINICAL OBSERVATIONS
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                      {[
                        ["Chronic Diseases", sensitiveData.chronicDiseases],
                        ["Medical History", sensitiveData.medicalHistory],
                        ["Drug Allergies", sensitiveData.drugAllergies],
                        ["Food Allergies", sensitiveData.foodAllergies],
                        ["Dietary Restrictions", sensitiveData.dietaryRestrictions],
                        ["History of Fainting", sensitiveData.faintingHistory ? "YES, Report of Fainting History" : "No known history"],
                      ].map(([label, value]) => (
                        <div key={label as string} style={{ padding: "16px 20px", background: "var(--bg-elevated)", borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
                          <p style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</p>
                          <p style={{ fontSize: 15, fontWeight: 600, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>
                            {value || "No records provided"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Emergency Contacts */}
                  <div>
                    <p className="section-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <Phone size={14} style={{ color: "var(--accent-primary)" }} /> EMERGENCY CONTACT PROTOCOL
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {Array.isArray(sensitiveData.emergencyContacts) && sensitiveData.emergencyContacts.length > 0 ? (
                        sensitiveData.emergencyContacts.map((c, i) => (
                          <div key={i} style={{ padding: "20px", background: "var(--bg-elevated)", borderRadius: 20, border: "1px solid var(--border-subtle)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-primary)" }} />
                              <p style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)" }}>{c.name}</p>
                            </div>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>
                              {c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship}
                            </p>
                            <a href={`tel:${c.phone}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: "var(--accent-primary)", fontWeight: 800, textDecoration: "none", fontSize: 16 }}>
                              <Phone size={16} />
                              {c.phone}
                            </a>
                          </div>
                        ))
                      ) : (
                        <div style={{ gridColumn: "span 2", padding: 32, textAlign: "center", background: "var(--bg-elevated)", borderRadius: 20, border: "1px dashed var(--border-medium)" }}>
                          <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>No emergency contacts listed.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Security Disclaimer */}
                  <div style={{ padding: 20, borderRadius: 20, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.1)", display: "flex", gap: 16, alignItems: "center" }}>
                    <ShieldAlert size={24} style={{ color: "#ef4444" }} />
                    <p style={{ fontSize: 13, color: "#ef4444", fontWeight: 600, lineHeight: 1.5 }}>
                      SECURITY PROTOCOL: This session has been audited. Unauthorized disclosure of this information is strictly prohibited and subject to institutional discipline.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "24px 40px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" style={{ borderRadius: 12, padding: "12px 32px" }} onClick={() => { setViewingId(null); setSensitiveData(null); setSensitiveError(null); }}>Close Records</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingStudent && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(12px, 4vw, 24px)",
          overflowY: "auto"
        }} onClick={() => setEditingStudent(null)}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "100%",
            maxWidth: 500,
            maxHeight: "90vh",
            borderRadius: "clamp(20px, 5vw, 32px)",
            overflow: "hidden",
            boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
            border: "1px solid var(--border-medium)",
            display: "flex",
            flexDirection: "column"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, padding: "clamp(20px, 5vw, 32px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ fontSize: "clamp(18px, 5vw, 20px)", fontWeight: 900 }}>{t.manageUser}</h3>
              <button className="btn btn-ghost" onClick={() => setEditingStudent(null)} style={{ borderRadius: "50%", width: 40, height: 40, padding: 0, flexShrink: 0 }}><X size={20} /></button>
            </div>
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "clamp(20px, 5vw, 32px)", display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.prefix}</label>
                  <select
                    className="input"
                    value={editingStudent.prefix || "นาย"}
                    onChange={e => setEditingStudent({ ...editingStudent, prefix: e.target.value })}
                  >
                    <option value="นาย">{lang === "th" ? "นาย" : "Mr."}</option>
                    <option value="นางสาว">{lang === "th" ? "น.ส." : "Ms."}</option>
                    <option value="นาง">{lang === "th" ? "นาง" : "Mrs."}</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.fullName}</label>
                  <input
                    className="input"
                    value={editingStudent.name}
                    onChange={e => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.studentId}</label>
                  <input
                    className="input"
                    value={editingStudent.studentId || ""}
                    onChange={e => setEditingStudent({ ...editingStudent, studentId: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.nickname}</label>
                  <input
                    className="input"
                    value={editingStudent.nickname || ""}
                    onChange={e => setEditingStudent({ ...editingStudent, nickname: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.house}</label>
                  <CustomDropdown
                    value={editingStudent.houseId || ""}
                    options={editHouseOptions}
                    onChange={val => setEditingStudent({ ...editingStudent, houseId: val })}
                    icon={<Home size={18} />}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, display: "block" }}>System Roles (Multi-select)</label>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: 10,
                  padding: 12,
                  background: "var(--bg-elevated)",
                  borderRadius: 16,
                  border: "1px solid var(--border-subtle)"
                }}>
                  {allowedEditRoleOptions.map((opt) => {
                    const currentRoles = editingStudent.roles || (editingStudent.role ? [editingStudent.role] : ["student"]);
                    const isChecked = currentRoles.includes(opt.value);
                    const handleToggle = () => {
                      if (!editingStudent) return;
                      const updated = isChecked
                        ? currentRoles.filter((r: string) => r !== opt.value)
                        : [...currentRoles, opt.value];
                      const finalRoles = updated.length > 0 ? updated : ["student"];
                      setEditingStudent({
                        ...editingStudent,
                        roles: finalRoles,
                        role: finalRoles[0] || "student",
                        // Unchecking club_president clears their club picks too —
                        // otherwise a stale clubIds value would still get PATCHed
                        // and re-grant presidencies to a non-president.
                        ...(opt.value === "club_president" && isChecked ? { clubIds: [] } : {}),
                      });
                    };

                    return (
                      <label
                        key={opt.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          borderRadius: 10,
                          cursor: "pointer",
                          transition: "all 0.2s",
                          background: isChecked ? "var(--bg-surface)" : "transparent",
                          border: isChecked ? "1px solid var(--accent-primary)" : "1px solid transparent",
                          boxShadow: isChecked ? "0 2px 8px rgba(0,0,0,0.05)" : "none"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={handleToggle}
                          style={{
                            accentColor: "var(--accent-primary)",
                            cursor: "pointer"
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: isChecked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {(editingStudent.roles || (editingStudent.role ? [editingStudent.role] : [])).includes("club_president") && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, display: "block" }}>
                    Presides Over (Clubs)
                  </label>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: 10,
                    padding: 12,
                    background: "var(--bg-elevated)",
                    borderRadius: 16,
                    border: "1px solid var(--border-subtle)"
                  }}>
                    {clubs.filter((c) => !c.isArchived).length === 0 && (
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>No clubs created yet — add one under Admin &gt; Clubs.</span>
                    )}
                    {clubs.filter((c) => !c.isArchived).map((club) => {
                      const currentClubIds = editingStudent.clubIds || [];
                      const isChecked = currentClubIds.includes(club.id);
                      const handleToggle = () => {
                        if (!editingStudent) return;
                        const updated = isChecked
                          ? currentClubIds.filter((id) => id !== club.id)
                          : [...currentClubIds, club.id];
                        setEditingStudent({ ...editingStudent, clubIds: updated });
                      };
                      return (
                        <label
                          key={club.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            borderRadius: 10,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            background: isChecked ? "var(--bg-surface)" : "transparent",
                            border: isChecked ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            boxShadow: isChecked ? "0 2px 8px rgba(0,0,0,0.05)" : "none"
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={handleToggle}
                            style={{ accentColor: "var(--accent-primary)", cursor: "pointer" }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: isChecked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                            {club.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.major}</label>
                <input
                  className="input"
                  value={editingStudent.major || ""}
                  onChange={e => setEditingStudent({ ...editingStudent, major: e.target.value })}
                  placeholder="e.g. SE, ANI, MMIT"
                />
              </div>

              {/* SMO/ANUSMO titles are scoped independently (src/lib/positions.ts) —
                  a student holding both roles at once (the role checkboxes above
                  are a multi-select, not mutually exclusive) gets one dropdown per
                  role, each with its own title. Club titles are edited per-club in
                  admin/clubs's Members modal; major titles in admin/majors's Team
                  panel — neither lives on this page. */}
              {(editingStudent.roles || (editingStudent.role ? [editingStudent.role] : [])).includes("smo") && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.positionSMO || "SMO Position"}</label>
                  <CustomDropdown
                    value={editingStudent.smoPosition || ""}
                    options={[
                      { value: "", label: "—", icon: <X size={16} className="text-muted" /> },
                      ...POSITION_IDS.map(id => ({
                        value: id,
                        label: t[POSITION_I18N_KEY[id] as keyof typeof t] as string,
                        icon: <Briefcase size={16} className="text-[var(--accent-primary)]" />,
                      })),
                    ]}
                    onChange={val => setEditingStudent({ ...editingStudent, smoPosition: val || null })}
                    icon={<Briefcase size={18} />}
                  />
                </div>
              )}

              {(editingStudent.roles || (editingStudent.role ? [editingStudent.role] : [])).includes("anusmo") && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.positionANUSMO || "ANUSMO Position"}</label>
                  <CustomDropdown
                    value={editingStudent.anusmoPosition || ""}
                    options={[
                      { value: "", label: "—", icon: <X size={16} className="text-muted" /> },
                      ...POSITION_IDS.map(id => ({
                        value: id,
                        label: t[POSITION_I18N_KEY[id] as keyof typeof t] as string,
                        icon: <Briefcase size={16} className="text-[var(--accent-primary)]" />,
                      })),
                    ]}
                    onChange={val => setEditingStudent({ ...editingStudent, anusmoPosition: val || null })}
                    icon={<Briefcase size={18} />}
                  />
                </div>
              )}

              {/* Contact info — email/phone/contactChannels are only ever
                  present on editingStudent for a super_admin requester (the
                  API strips them for everyone else), so this section is
                  naturally invisible to admin/registration/organizer too. */}
              {userRole === "super_admin" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, background: "var(--bg-elevated)", borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldAlert size={14} style={{ color: "#ef4444" }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {lang === "th" ? "ข้อมูลติดต่อ (Super Admin เท่านั้น)" : "Contact Info (Super Admin only)"}
                    </span>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.email}</label>
                    <input
                      className="input"
                      value={editingStudent.email || ""}
                      disabled
                      readOnly
                      style={{ opacity: 0.7, cursor: "not-allowed" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.phone}</label>
                    <input
                      className="input"
                      value={editingStudent.phone || ""}
                      onChange={e => setEditingStudent({ ...editingStudent, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, display: "block" }}>{t.contactChannels}</label>
                    <input
                      className="input"
                      value={editingStudent.contactChannels || ""}
                      onChange={e => setEditingStudent({ ...editingStudent, contactChannels: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, padding: "16px clamp(20px, 5vw, 32px)", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setEditingStudent(null)}>{t.cancel}</button>
              <button
                className="btn btn-primary"
                disabled={updating}
                onClick={async () => {
                  setUpdating(true);
                  try {
                    const res = await fetch(`/api/admin/users/${editingStudent.id}`, {
                      method: "PATCH",
                      body: JSON.stringify(editingStudent)
                    });
                    if (res.ok) {
                      setEditingStudent(null);
                      refreshData();
                    }
                  } catch (err) {
                    console.error(err);
                  } finally {
                    setUpdating(false);
                  }
                }}
              >
                {updating ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .student-row:hover {
          background: var(--bg-glass);
          cursor: default;
        }
        .student-row:hover .btn-ghost {
          background: var(--bg-surface);
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--border-medium); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
      `}</style>
    </>
  );
}