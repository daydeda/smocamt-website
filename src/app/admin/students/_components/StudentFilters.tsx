"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Toolbar } from "@/components/admin/ui";
import { POSITION_IDS, POSITION_I18N_KEY } from "@/lib/access/positions";
import { fill, type House, type Student } from "../_lib/students";

export type FilterKey = "house" | "role" | "major" | "education" | "year" | "position";
export type Filters = Record<FilterKey, string>;
export const EMPTY_FILTERS: Filters = { house: "all", role: "all", major: "all", education: "all", year: "all", position: "all" };

type Option = { value: string; label: string };

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="adm-field-label">
        {label}
        <select className="input" style={{ marginTop: 4 }} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function StudentFilters({
  search,
  onSearch,
  filters,
  onFilter,
  onClear,
  students,
  houses,
  getHouseName,
  filteredCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  filters: Filters;
  onFilter: (key: FilterKey, value: string) => void;
  onClear: () => void;
  students: Student[];
  houses: House[];
  getHouseName: (id: string, defaultName: string) => string;
  filteredCount: number;
}) {
  const { t } = useLanguage();
  const [showMore, setShowMore] = useState(false);

  const houseOptions: Option[] = [
    { value: "all", label: t.allHouses },
    ...houses.map((h) => ({ value: h.id, label: getHouseName(h.id, h.name) })),
  ];
  const roleOptions: Option[] = [
    { value: "all", label: t.allRoles },
    { value: "student", label: t.roleStudentPlural },
    { value: "staff", label: t.roleStaffPlural },
    { value: "smo", label: t.roleSMOPlural },
    { value: "anusmo", label: t.roleANUSMOPlural },
    { value: "admin", label: t.roleAdminPlural },
    { value: "super_admin", label: t.roleSuperAdminPlural },
    { value: "club_president", label: t.roleClubPresidentPlural },
    { value: "major_president", label: t.roleMajorPresidentPlural },
  ];
  const majorOptions: Option[] = [
    { value: "all", label: t.allMajors },
    ...Array.from(new Set(students.map((s) => (s.major || "").trim()).filter((m) => m !== "")))
      .sort((a, b) => a.localeCompare(b))
      .map((m) => ({ value: m, label: m })),
  ];
  const educationOptions: Option[] = [
    { value: "all", label: t.allEducationLevels },
    { value: "undergrad", label: t.educationUndergrad },
    { value: "masters", label: t.educationMasters },
    { value: "phd", label: t.educationPhD },
  ];
  const yearOptions: Option[] = [
    { value: "all", label: t.allYears },
    ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: t.yearN.replace("{n}", String(n)) })),
    { value: "5plus", label: t.yearNPlus.replace("{n}", "5") },
  ];
  // SMO/ANUSMO staff titles: the only "position" data on the Student object.
  const positionOptions: Option[] = [
    { value: "all", label: t.allPositions },
    ...POSITION_IDS.map((id) => ({ value: id, label: t[POSITION_I18N_KEY[id] as keyof typeof t] as string })),
  ];

  const defs: { key: FilterKey; label: string; options: Option[]; advanced?: boolean }[] = [
    { key: "house", label: t.adminStuFilterHouse, options: houseOptions },
    { key: "role", label: t.adminStuFilterRole, options: roleOptions },
    { key: "major", label: t.adminStuFilterMajor, options: majorOptions },
    { key: "education", label: t.adminStuFilterLevel, options: educationOptions, advanced: true },
    { key: "year", label: t.adminStuFilterYear, options: yearOptions, advanced: true },
    { key: "position", label: t.adminStuFilterPosition, options: positionOptions, advanced: true },
  ];

  const activeChips = defs
    .filter((d) => filters[d.key] !== "all")
    .map((d) => ({
      key: d.key as FilterKey | "search",
      text: `${d.label}: ${d.options.find((o) => o.value === filters[d.key])?.label ?? filters[d.key]}`,
    }));
  if (search.trim()) activeChips.unshift({ key: "search", text: fill(t.adminStuSearchChip, { text: search.trim() }) });

  const hiddenActive = defs.filter((d) => d.advanced && filters[d.key] !== "all").length;
  const visibleDefs = defs.filter((d) => !d.advanced || showMore || filters[d.key] !== "all");
  const total = students.length;

  return (
    <>
      <Toolbar>
        <div style={{ position: "relative", flex: "1 1 280px", maxWidth: 520 }}>
          <Search size={18} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input
            id="student-search-input"
            type="search"
            className="input"
            style={{ paddingLeft: 42, width: "100%" }}
            aria-label={t.adminStuSearchLabel}
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {showMore ? t.adminStuFewerFilters : t.adminStuMoreFilters}
          {!showMore && hiddenActive > 0 ? ` (${hiddenActive})` : ""}
        </button>
      </Toolbar>

      {/* Fixed-width columns that start at the left edge, so three filters do
          not stretch across a 1400px laptop screen. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 240px))", gap: 12, marginBottom: 16 }}>
        {visibleDefs.map((d) => (
          <FilterSelect key={d.key} label={d.label} value={filters[d.key]} options={d.options} onChange={(v) => onFilter(d.key, v)} />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <p role="status" aria-live="polite" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginRight: 8 }}>
          {activeChips.length > 0
            ? fill(t.adminStuCountFiltered, { count: filteredCount, total })
            : fill(t.adminStuCountAll, { total })}
        </p>
        {activeChips.length > 0 && (
          <>
            <ul aria-label={t.adminStuActiveFilters} style={{ display: "contents", listStyle: "none" }}>
              {activeChips.map((c) => (
                <li key={c.key} style={{ listStyle: "none" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ borderRadius: 999, background: "var(--accent-glow)" }}
                    aria-label={fill(t.adminStuRemoveFilter, { name: c.text })}
                    onClick={() => (c.key === "search" ? onSearch("") : onFilter(c.key, "all"))}
                  >
                    {c.text} <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
              {t.adminStuClearFilters}
            </button>
          </>
        )}
      </div>
    </>
  );
}
