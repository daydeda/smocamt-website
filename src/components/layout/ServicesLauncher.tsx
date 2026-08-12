"use client";

// The "Apps/Services" overlay for the student nav — one component, two CSS-
// media-gated layouts (mobile left-drawer / desktop centered grid), so there
// is exactly one accessibility implementation to get right and exactly one
// mobile entry point (replacing the old hamburger-drawer + avatar-dropdown
// split, which left secondaryLinks unreachable from the hamburger drawer).
//
// Patterns reused from elsewhere in this codebase rather than reinvented:
//  - backdrop + click-outside-to-dismiss: src/components/NotificationModal.tsx
//  - portal to document.body (escapes the sticky, blurred <nav>'s stacking
//    context): src/components/admin/EventFormBuilderModal.tsx
//  - Escape-to-close: the CustomSelect duplicated in ShopClient.tsx /
//    EventFormBuilderModal.tsx — the only such precedent in the codebase
//  - mobile slide-in transform: StudentNav's own former .mobile-sidebar
//
// No focus-trap/role="dialog" precedent exists anywhere in this codebase —
// this component establishes that pattern for the first time, deliberately
// kept small (manual Tab-cycle, no library) rather than pulling in a new
// dependency for one overlay.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  getAllGroups,
  resolveHref,
  type NavContext,
} from "@/lib/nav-config";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

export function ServicesLauncher({
  open,
  onClose,
  ctx,
}: {
  open: boolean;
  onClose: () => void;
  ctx: NavContext;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape-to-close + a minimal manual focus trap. Only wired up while open,
  // `open` starts false (parent state), identical on server and client, so
  // gating the portal on `hasOpened` — rather than on `typeof document` —
  // means the very first render (SSR + the client's hydration pass) renders
  // null on BOTH sides: no mismatch. `document.body` is only ever touched
  // from a later, client-only render after the user actually opens this,
  // by which point we're well past hydration. Once opened, we keep
  // rendering (toggling the "open" CSS class) so close transitions can
  // still animate instead of the panel just vanishing. Declared here (not
  // further down) because the focus-capture effect right below needs it:
  // the panel doesn't exist in the DOM until hasOpened catches up to open,
  // one tick later, so focusing/capturing keyed on `open` alone races the
  // DOM not existing yet (panelRef.current was still null, so
  // firstFocusable?.focus() below silently no-op'd every time).
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    // The timeout keeps the setState out of the synchronous effect body
    // (react-hooks/set-state-in-effect) — same trick as LanguageContext.tsx's
    // localStorage read. Timing doesn't matter here: `hasOpened` only needs
    // to flip true sometime after `open` does, well before the user can
    // perceive it.
    if (!open) return;
    const timer = setTimeout(() => setHasOpened(true), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Capture what to return focus to, and focus the first focusable element —
  // kept as its own effect keyed on hasOpened (not folded into the keydown
  // effect below) precisely because it must run AFTER the panel exists in
  // the DOM.
  useEffect(() => {
    if (!open || !hasOpened) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();
  }, [open, hasOpened]);

  // Escape-to-close + a minimal manual focus trap. Only wired up while open,
  // torn down on close/unmount.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Return focus to whichever trigger opened this (mobile hamburger vs
  // desktop Apps button differ, so this can't be a single fixed ref).
  useEffect(() => {
    if (!open && previouslyFocused.current) {
      previouslyFocused.current.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  // Lock body scroll while open (mobile drawer + desktop grid both sit above
  // page content).
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!hasOpened) return null;

  const groups = getAllGroups(ctx);
  // nav-config keys are plain `string` (not a string-literal union), so index
  // through an untyped view rather than relying on `t`'s literal key type.
  const tr = t as Record<string, string>;

  return createPortal(
    <>
      <div
        className={`launcher-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        ref={panelRef}
        className={`launcher-panel ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t.servicesLauncher || "Services"}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="launcher-header">
          <p className="launcher-title">{t.servicesLauncher || "Services"}</p>
          <button
            className="launcher-close touch-target"
            onClick={onClose}
            aria-label={t.notifDismiss || "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <div className="launcher-body">
          {groups.map((group) => (
            <div key={group.id} className="launcher-group">
              {group.titleI18nKey && (
                <p className="section-title launcher-group-title">
                  {tr[group.titleI18nKey] || group.titleI18nKey}
                </p>
              )}
              <div className="launcher-grid">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const label = tr[item.i18nKey] || item.fallback;
                  const href = resolveHref(item, ctx);
                  const isActive = pathname === href;

                  if (item.comingSoon) {
                    // Full-width row, not a grid tile — a group with only
                    // one or two placeholder items (Feedback, Learning
                    // today) would otherwise sit in a 3-4 column grid with
                    // empty cells beside it, reading like missing content
                    // rather than "more of these are coming later" (looked
                    // broken in review). Spanning the row sidesteps that
                    // regardless of how many real columns the grid has.
                    return (
                      <div
                        key={item.id}
                        className="launcher-tile coming-soon"
                        aria-disabled="true"
                      >
                        <span className="tile-icon-wrap">
                          <Icon size={22} />
                        </span>
                        <span className="coming-soon-label">{label}</span>
                        <span className="launcher-badge">{t.comingSoon || "Coming soon"}</span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.id}
                      href={href}
                      className={`launcher-tile ${isActive ? "active" : ""}`}
                      onClick={onClose}
                    >
                      <span className="tile-icon-wrap">
                        <Icon size={22} />
                      </span>
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .launcher-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2000;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.25s ease, visibility 0.25s ease;
        }
        .launcher-backdrop.open {
          opacity: 1;
          visibility: visible;
        }

        .launcher-panel {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          width: min(85vw, 320px);
          background: var(--bg-surface);
          z-index: 2001;
          transform: translateX(-100%);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          visibility: hidden;
          padding: calc(20px + var(--safe-top)) 20px calc(20px + var(--safe-bottom));
        }
        .launcher-panel.open {
          transform: translateX(0);
          visibility: visible;
        }

        .launcher-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          flex-shrink: 0;
        }
        .launcher-title {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: var(--text-primary);
          margin: 0;
        }
        .launcher-close {
          border: none;
          background: var(--bg-glass);
          border-radius: 12px;
          cursor: pointer;
          color: var(--text-primary);
        }

        .launcher-body {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .launcher-group-title {
          margin-bottom: 10px;
        }

        .launcher-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        :global(.launcher-tile) {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px 8px;
          min-height: 88px;
          border-radius: var(--radius-lg);
          background: var(--bg-elevated);
          border: 1px solid transparent;
          text-decoration: none;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          text-align: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        :global(.launcher-tile:hover) {
          background: var(--accent-glow);
          color: var(--accent-primary);
          border-color: rgba(255, 107, 0, 0.15);
        }
        :global(.launcher-tile.active) {
          background: var(--accent-glow);
          color: var(--accent-primary);
          border-color: rgba(255, 107, 0, 0.2);
        }
        :global(.launcher-tile.coming-soon) {
          grid-column: 1 / -1;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          min-height: unset;
          padding: 14px 16px;
          text-align: left;
          opacity: 0.55;
          cursor: default;
        }
        :global(.launcher-tile.coming-soon .coming-soon-label) {
          flex: 1;
        }
        :global(.launcher-tile .tile-icon-wrap) {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 107, 0, 0.08);
          color: var(--accent-primary);
          flex-shrink: 0;
        }
        :global(.launcher-tile.coming-soon .tile-icon-wrap) {
          background: var(--bg-glass);
          color: var(--text-muted);
        }
        :global(.launcher-badge) {
          flex-shrink: 0;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          background: var(--bg-glass);
          padding: 2px 6px;
          border-radius: 999px;
        }

        @media (min-width: 1024px) {
          .launcher-panel {
            top: 50%;
            left: 50%;
            bottom: auto;
            width: min(90vw, 720px);
            max-height: 80vh;
            border-radius: var(--radius-xl);
            border: 1px solid var(--border-subtle);
            box-shadow: 0 30px 70px rgba(0, 0, 0, 0.25);
            transform: translate(-50%, -50%) scale(0.96);
            opacity: 0;
            transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease, visibility 0.2s ease;
            padding: 28px 28px calc(28px + var(--safe-bottom));
          }
          .launcher-panel.open {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          .launcher-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
          }
        }
      `}</style>
    </>,
    document.body
  );
}
