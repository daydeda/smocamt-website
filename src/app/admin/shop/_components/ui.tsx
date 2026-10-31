"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, XCircle, Clock, Check, ChevronLeft, ChevronRight, ChevronDown, Ban } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { LoadingState, StatusBadge, type Tone } from "@/components/admin/ui";
import { PAGE_SIZE } from "./shop-model";

// Label + control + hint. When the child is a single native control (input /
// textarea / select) the label is linked to it with htmlFor/id and the hint with
// aria-describedby. For anything else (a chip group, a dropdown, a rich-text
// editor) the label becomes the accessible name of a role="group" wrapper, so a
// screen reader still announces what the group is for.
const NATIVE_CONTROLS = new Set(["input", "textarea", "select"]);
export function Field({ label, children, style, required, hint, error }: { label: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; required?: boolean; hint?: React.ReactNode; error?: React.ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const native = isValidElement(only) && typeof only.type === "string" && NATIVE_CONTROLS.has(only.type);
  const control = native
    ? cloneElement(only as React.ReactElement<Record<string, unknown>>, {
        id: (only.props as { id?: string }).id ?? id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  const labelStyle: React.CSSProperties = { display: "block", fontWeight: 700, fontSize: 13, lineHeight: 1.5, marginBottom: hint ? 2 : 6 };
  const star = required ? <span aria-hidden="true" style={{ color: "var(--red-600)", marginLeft: 3 }}>*</span> : null;
  return (
    <div style={style} {...(native ? {} : { role: "group", "aria-labelledby": `${id}-label`, "aria-describedby": describedBy })}>
      {native ? (
        <label id={`${id}-label`} htmlFor={(only.props as { id?: string }).id ?? id} style={labelStyle}>{label}{star}</label>
      ) : (
        <span id={`${id}-label`} style={labelStyle}>{label}{star}</span>
      )}
      {hint && !error && <p id={hintId} className="adm-field-hint" style={{ margin: "0 0 6px" }}>{hint}</p>}
      {control}
      {error && <p id={errId} className="adm-field-error" role="alert" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}

// A plain labeled divider that introduces a group of fields. It does NOT wrap the
// fields — they render in the form's normal flat flow right below it — so there's
// nothing to collapse and nothing can hide. The right-aligned summary chip shows
// the group's current state at a glance (e.g. "Everyone", "Shop default fee").
export function SectionDivider({ icon, title, summary }: { icon: React.ReactNode; title: string; summary?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ color: "var(--accent-primary)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <h3 style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.5, flexShrink: 0, margin: 0 }}>{title}</h3>
      {summary && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{summary}</span>}
    </div>
  );
}

// Kept as a thin alias so every tab shares the kit's announced loading state.
export function Spinner({ label }: { label?: string }) {
  return <LoadingState label={label} />;
}

// Prev/next pager shared by the Products and Orders lists. Hidden when everything
// fits on one page. `total` is the count across all pages (post-filter).
export function Pagination({ th, page, total, onPage }: { th: boolean; page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, padding: "6px 12px" };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{th ? `${from}–${to} จาก ${total}` : `${from}–${to} of ${total}`}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onPage(1)} disabled={page <= 1} className="btn btn-ghost" style={btn} aria-label={th ? "หน้าแรก" : "First page"}>«</button>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn btn-ghost" style={btn}><ChevronLeft size={15} />{th ? "ก่อนหน้า" : "Prev"}</button>
        <PageJump key={page} th={th} page={page} pages={pages} onPage={onPage} />
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="btn btn-ghost" style={btn}>{th ? "ถัดไป" : "Next"}<ChevronRight size={15} /></button>
        <button onClick={() => onPage(pages)} disabled={page >= pages} className="btn btn-ghost" style={btn} aria-label={th ? "หน้าสุดท้าย" : "Last page"}>»</button>
      </div>
    </div>
  );
}

// "Page [ n ] / N" — type a page number and press Enter (or leave the box) to jump.
// Remounted via `key={page}` so the draft resets whenever the page changes elsewhere.
export function PageJump({ th, page, pages, onPage }: { th: boolean; page: number; pages: number; onPage: (p: number) => void }) {
  const [draft, setDraft] = useState(String(page));
  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) { setDraft(String(page)); return; }
    const clamped = Math.min(pages, Math.max(1, n));
    setDraft(String(clamped));
    if (clamped !== page) onPage(clamped);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
      {th ? "หน้า" : "Page"}
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        aria-label={th ? "ไปยังหน้า" : "Go to page"}
        className="input"
        style={{ width: 56, textAlign: "center", padding: "6px 4px" }}
      />
      / {pages}
    </span>
  );
}

// Inline-styled custom dropdown matching this page's inputs (the native <select>
// looked out of place next to the filter chips). Closes on outside-click or Escape;
// shows a check on the active option. Used for the Orders product filter.
export function FilterDropdown({ value, options, onChange, minWidth = 160, maxWidth = 260, ariaLabel }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  minWidth?: number;
  maxWidth?: number;
  /** Accessible name for the trigger (the visible label sits outside this control). */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    // Escape closes just the list: stopping it here keeps a surrounding Modal open.
    <div ref={ref} style={{ position: "relative", minWidth, maxWidth }} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${current?.label ?? ""}` : undefined}
        style={{
          ...inputStyle, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          cursor: "pointer", textAlign: "left",
          borderColor: open ? "var(--accent-primary)" : "var(--border-subtle)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.label ?? ""}</span>
        <ChevronDown size={16} style={{ flexShrink: 0, color: "var(--text-muted)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} style={{
          position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 50,
          background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgb(var(--shadow-rgb) / 0.18)",
          maxHeight: 280, overflowY: "auto", padding: 4,
        }}>
          {options.map((opt) => {
            const sel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
                  width: "100%", textAlign: "left", padding: "10px 10px", minHeight: 44, fontSize: 14,
                  border: "none", borderRadius: 8, cursor: "pointer",
                  background: sel ? "var(--bg-elevated)" : "transparent",
                  color: sel ? "var(--accent-primary)" : "var(--text-secondary)",
                  fontWeight: sel ? 700 : 500,
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{opt.label}</span>
                {sel && <Check size={15} style={{ flexShrink: 0, marginTop: 3 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Toggleable selection pill used for the role/major audience pickers.
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
        padding: "6px 14px", minHeight: 36, borderRadius: 999, cursor: "pointer",
        border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
        background: selected ? "var(--accent-primary)" : "var(--bg-base)",
        color: selected ? "var(--text-on-color)" : "var(--text-secondary)",
      }}
    >
      {selected && <Check size={13} />}{children}
    </button>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-subtle)", fontSize: 14, fontFamily: "inherit", background: "var(--bg-base)",
};

// Toggle chip for the product-owner (club/major) multi-select.
export const ownerChip = (on: boolean, accent: string): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
  background: on ? alpha(accent, 0.15) : "var(--bg-elevated)",
  color: on ? accent : "var(--text-secondary)",
  border: `1px solid ${on ? alpha(accent, 0.4) : "var(--border-subtle)"}`,
});

// Order payment status → kit badge (colour + icon + text, never colour alone).
export const ORDER_BADGE: Record<string, { th: string; en: string; tone: Tone; icon: React.ReactNode }> = {
  pending: { th: "รอตรวจสอบ", en: "Pending", tone: "warning", icon: <Clock size={12} /> },
  approved: { th: "อนุมัติแล้ว", en: "Approved", tone: "success", icon: <CheckCircle2 size={12} /> },
  rejected: { th: "ถูกปฏิเสธ", en: "Rejected", tone: "danger", icon: <XCircle size={12} /> },
};

export function OrderStatusBadge({ status, th }: { status: string; th: boolean }) {
  const b = ORDER_BADGE[status] ?? ORDER_BADGE.pending;
  return <StatusBadge tone={b.tone} icon={b.icon}>{th ? b.th : b.en}</StatusBadge>;
}

// Product / seller review state. Sellers can also be "suspended".
const APPROVAL_BADGE: Record<string, { th: string; en: string; tone: Tone; icon: React.ReactNode }> = {
  pending: { th: "รออนุมัติ", en: "Pending approval", tone: "warning", icon: <Clock size={12} /> },
  approved: { th: "อนุมัติแล้ว", en: "Approved", tone: "success", icon: <CheckCircle2 size={12} /> },
  rejected: { th: "ถูกปฏิเสธ", en: "Rejected", tone: "danger", icon: <XCircle size={12} /> },
  suspended: { th: "ถูกระงับ", en: "Suspended", tone: "danger", icon: <Ban size={12} /> },
};

export function ApprovalBadge({ status, th }: { status: string; th: boolean }) {
  const b = APPROVAL_BADGE[status] ?? { th: status, en: status, tone: "neutral" as Tone, icon: undefined };
  return <StatusBadge tone={b.tone} icon={b.icon}>{th ? b.th : b.en}</StatusBadge>;
}

// <th> style for .data-table headers: the global class upper-cases and tracks
// them (hard to read, and meaningless in Thai), so admin tables turn that off.
export const thStyle: React.CSSProperties = { textTransform: "none", letterSpacing: 0, fontSize: 12, whiteSpace: "nowrap" };
