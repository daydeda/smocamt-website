"use client";

// Cmd/Ctrl+K quick-jump for the admin sidebar. Reuses
// src/components/layout/ServicesLauncher.tsx's already-proven overlay
// pattern wholesale (portal to document.body, hydration-safe `hasOpened`
// gating, manual focus trap, Escape-to-close, body-scroll-lock) rather than
// reinventing it — that component is the only role="dialog"/aria-modal
// precedent in this codebase.
//
// Why a palette and not a launcher grid, unlike the student side: admin
// users are frequent/expert, not casual browsers — they want recall-speed
// jump-to-page as the sidebar grows past what fits in one glance, not a
// recognition-oriented icon grid. See the admin-nav redesign plan.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { getVisibleAdminItems, type AdminNavContext, type AdminNavItem } from "@/lib/admin-nav-config";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled])';

function matches(item: AdminNavItem, label: string, query: string): boolean {
  const haystack = [label, item.id, ...(item.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function AdminCommandPalette({
  open,
  onClose,
  ctx,
}: {
  open: boolean;
  onClose: () => void;
  ctx: AdminNavContext;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const tr = t as Record<string, string>;

  const results = useMemo(() => {
    const items = getVisibleAdminItems(ctx).filter((item) => !item.comingSoon);
    if (!query.trim()) return items;
    return items.filter((item) => matches(item, tr[item.i18nKey] || item.fallback, query));
  }, [ctx, query, tr]);

  // Reset search + selection each time the palette opens, and reset the
  // selection whenever the query (and therefore `results`) changes.
  // Deliberately NOT a useEffect: an effect here would setState a tick after
  // the render that changed `open`/`query`, visible as a one-frame flash of
  // stale results while typing. Adjusting during render (React's documented
  // pattern for "resetting state when a prop changes", gated on comparing to
  // the previous rendered value so it still terminates) avoids that.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  function navigateTo(item: AdminNavItem) {
    onClose();
    router.push(item.href);
  }

  // Same hydration-safe gating as ServicesLauncher: `open` starts false
  // identically on server/client, so the very first render (SSR + client
  // hydration pass) renders null on both sides — document.body is only
  // touched from a later, client-only render after a real open. Declared
  // here (not further down) because the focus-capture effect below needs it:
  // the panel/input don't exist in the DOM until `hasOpened` flips, one tick
  // after `open` does, so focusing/capturing keyed on `open` alone would
  // race the DOM not existing yet.
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

  // Capture what to return focus to, and focus the search input — kept as
  // its own effect keyed on hasOpened (not folded into the keydown effect
  // below) precisely because it must run AFTER the panel/input exist in the
  // DOM, i.e. once hasOpened catches up to open.
  useEffect(() => {
    if (!open || !hasOpened) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
  }, [open, hasOpened]);

  // Focus trap + Escape-to-close + Arrow/Enter selection, mirroring
  // ServicesLauncher's effect for the Tab-cycling/Escape part.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const item = results[activeIndex];
        if (item) {
          e.preventDefault();
          navigateTo(item);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, results, activeIndex]);

  useEffect(() => {
    if (!open && previouslyFocused.current) {
      previouslyFocused.current.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!hasOpened) return null;

  return createPortal(
    <>
      <div
        className={`palette-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        ref={panelRef}
        className={`palette-panel ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={tr.commandPaletteLabel || "Search"}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="palette-search-row">
          <Search size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr.commandPalettePlaceholder || "Search admin pages…"}
            aria-label={tr.commandPalettePlaceholder || "Search admin pages…"}
          />
          <button className="palette-close touch-target" onClick={onClose} aria-label={t.notifDismiss || "Close"}>
            <X size={18} />
          </button>
        </div>

        <div className="palette-results">
          {results.length === 0 && (
            <p className="palette-empty">{tr.commandPaletteEmpty || "No matching pages"}</p>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            const label = tr[item.i18nKey] || item.fallback;
            return (
              <button
                key={item.id}
                className={`palette-result ${index === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => navigateTo(item)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .palette-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2000;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease;
        }
        .palette-backdrop.open {
          opacity: 1;
          visibility: visible;
        }

        .palette-panel {
          position: fixed;
          top: 12vh;
          left: 50%;
          width: min(92vw, 560px);
          max-height: 70vh;
          background: var(--bg-surface);
          border-radius: var(--radius-xl);
          border: 1px solid var(--border-subtle);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.25);
          z-index: 2001;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transform: translate(-50%, -8px) scale(0.98);
          opacity: 0;
          visibility: hidden;
          transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.15s ease, visibility 0.15s ease;
        }
        .palette-panel.open {
          transform: translate(-50%, 0) scale(1);
          opacity: 1;
          visibility: visible;
        }

        .palette-search-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .palette-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .palette-input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-size: 15px;
          font-family: inherit;
          color: var(--text-primary);
        }
        .palette-input::placeholder {
          color: var(--text-muted);
        }
        .palette-close {
          border: none;
          background: var(--bg-glass);
          border-radius: 10px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .palette-results {
          overflow-y: auto;
          padding: 8px;
        }
        .palette-empty {
          padding: 20px 12px;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
        }

        :global(.palette-result) {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          border: none;
          background: transparent;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
          text-align: left;
          cursor: pointer;
        }
        :global(.palette-result.active) {
          background: var(--accent-glow);
          color: var(--accent-primary);
        }
      `}</style>
    </>,
    document.body
  );
}
