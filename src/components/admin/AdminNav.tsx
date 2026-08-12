"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Search, User } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  buildAdminNavContext,
  getVisibleAdminGroups,
  type AdminNavGroup,
} from "@/lib/admin-nav-config";

// Sidebar item/group data now lives in src/lib/admin-nav-config.ts (single
// source of truth shared with AdminCommandPalette) rather than an inline
// array here — see the admin-nav redesign plan for why. This component is
// left with rendering + the collapsible-groups affordance.

// Below this many total visible items, render exactly as before this
// refactor: fully expanded, no chevrons, no localStorage. Covers every
// narrow role (scanner-only smo, club/major president, registration,
// organizer) so their sidebar stays pixel-identical — collapsing only
// matters once a full super_admin/admin's list actually grows past a glance.
const COLLAPSE_THRESHOLD = 10;

const COLLAPSE_STORAGE_KEY = "admin-nav-collapsed-groups";

export function AdminNav({
  roles,
  hasStaffPosition,
  hasClubPosition,
  smoPosition,
  anusmoPosition,
  onOpenPalette,
}: {
  roles: string[];
  hasStaffPosition?: boolean;
  hasClubPosition?: boolean;
  smoPosition?: string | null;
  anusmoPosition?: string | null;
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const tr = t as Record<string, string>;

  const ctx = buildAdminNavContext({ roles, hasStaffPosition, hasClubPosition, smoPosition, anusmoPosition });
  const groups = getVisibleAdminGroups(ctx);
  const totalVisible = groups.reduce((sum, g) => sum + g.items.length, 0);
  const collapsible = totalVisible > COLLAPSE_THRESHOLD;

  // Starts empty on both server and client render (no collapsed groups) —
  // the real persisted set is only read after mount, same post-mount-only
  // localStorage pattern as LanguageContext.tsx, to avoid a hydration
  // mismatch between what the server rendered and a returning user's
  // previously-collapsed groups.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!collapsible) return;
    // The timeout keeps the setState out of the synchronous effect body
    // (react-hooks/set-state-in-effect) — same trick as LanguageContext.tsx's
    // post-mount localStorage read.
    const timer = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (raw) setCollapsed(new Set(JSON.parse(raw)));
      } catch {
        // Corrupt/blocked storage — fall back to "everything expanded".
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [collapsible]);

  function toggleGroup(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Storage unavailable — collapse state just won't persist.
      }
      return next;
    });
  }

  // A group holding the active route always renders expanded, regardless of
  // stored state — a past collapse action must never hide the page you're
  // currently on.
  function isGroupCollapsed(group: AdminNavGroup): boolean {
    if (!collapsible) return false;
    if (group.items.some((item) => item.href === pathname)) return false;
    return collapsed.has(group.id);
  }

  return (
    <nav style={{ flex: 1 }}>
      <p className="section-title" style={{ paddingLeft: 0, marginBottom: 16 }}>{t.mainMenu}</p>

      <button
        type="button"
        onClick={onOpenPalette}
        className="admin-palette-trigger touch-target"
        aria-label={tr.commandPaletteLabel || "Search"}
      >
        <Search size={16} />
        <span>{tr.commandPaletteLabel || "Search"}</span>
        <span className="admin-palette-kbd">⌘K</span>
      </button>

      {groups.map((group, groupIndex) => {
        const groupCollapsed = isGroupCollapsed(group);
        return (
          <div key={group.id} style={{ marginTop: groupIndex === 0 ? 20 : 20 }}>
            {group.titleI18nKey && (
              collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="admin-group-toggle"
                  aria-expanded={!groupCollapsed}
                >
                  <span className="section-title" style={{ paddingLeft: 0, marginBottom: 0, fontSize: 10, opacity: 0.7 }}>
                    {tr[group.titleI18nKey] || group.titleI18nKey}
                  </span>
                  <ChevronDown size={14} className={`admin-group-chevron ${groupCollapsed ? "collapsed" : ""}`} />
                </button>
              ) : (
                <p
                  className="section-title"
                  style={{ paddingLeft: 0, marginBottom: 8, fontSize: 10, opacity: 0.7 }}
                >
                  {tr[group.titleI18nKey] || group.titleI18nKey}
                </p>
              )
            )}
            {!groupCollapsed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: group.titleI18nKey && collapsible ? 8 : 0 }}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  const labelText = tr[item.i18nKey] || item.fallback;

                  if (item.comingSoon) {
                    return (
                      <div key={item.id} className="nav-link admin-coming-soon" style={{ gap: 12, position: "relative" }} aria-disabled="true">
                        <Icon size={18} strokeWidth={2} style={{ pointerEvents: "none" }} />
                        <span style={{ fontWeight: 500, pointerEvents: "none", flex: 1 }}>{labelText}</span>
                        <span className="admin-coming-soon-badge">{t.comingSoon || "Coming soon"}</span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`nav-link ${isActive ? "active" : ""}`}
                      style={{ gap: 12, position: "relative" }}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.5 : 2} style={{ pointerEvents: "none" }} />
                      <span style={{ fontWeight: isActive ? 700 : 500, pointerEvents: "none" }}>{labelText}</span>
                      {isActive && (
                        <div style={{
                          position: "absolute",
                          right: 12,
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--accent-primary)",
                          pointerEvents: "none"
                        }} />
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="divider" style={{ margin: "24px 0", opacity: 0.5 }} />
      <p className="section-title" style={{ paddingLeft: 0, marginBottom: 16 }}>{t.accountLabel}</p>
      <Link href="/dashboard" className="nav-link" style={{ gap: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        <User size={18} strokeWidth={2} style={{ pointerEvents: "none" }} />
        <span style={{ fontWeight: 500, pointerEvents: "none" }}>{t.switchToStudentView}</span>
      </Link>

      <AdminLanguageSwitcher />

      <style jsx>{`
        .admin-palette-trigger {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 10px 12px;
          margin-bottom: 4px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
        }
        .admin-palette-trigger:hover {
          color: var(--text-primary);
          border-color: var(--border-medium);
        }
        .admin-palette-trigger span:nth-child(2) {
          flex: 1;
        }
        .admin-palette-kbd {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 6px;
          background: var(--bg-glass);
          color: var(--text-muted);
        }

        .admin-group-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          border: none;
          background: transparent;
          padding: 0;
          cursor: pointer;
        }
        .admin-group-chevron {
          color: var(--text-muted);
          transition: transform 0.15s;
          flex-shrink: 0;
        }
        .admin-group-chevron.collapsed {
          transform: rotate(-90deg);
        }

        .admin-coming-soon {
          opacity: 0.55;
          cursor: default;
        }
        .admin-coming-soon-badge {
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          background: var(--bg-glass);
          padding: 2px 6px;
          border-radius: 999px;
          flex-shrink: 0;
        }
      `}</style>
    </nav>
  );
}

function AdminLanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  return (
    <div style={{ padding: "0 12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, background: "var(--bg-elevated)", padding: 4, borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
        {(["en", "th", "mm", "cn"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              padding: "6px 0",
              borderRadius: 8,
              border: "none",
              fontSize: 10,
              fontWeight: 800,
              cursor: "pointer",
              background: lang === l ? "var(--accent-primary)" : "transparent",
              color: lang === l ? "#fff" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
