"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { IconButton } from "./IconButton";

export type ModalSize = "sm" | "md" | "lg" | "xl";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small icon shown before the title (status, object type). */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** Action row, pinned to the bottom so it never scrolls away. Put Cancel first, the primary action last. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /** false blocks Escape, backdrop click and the close button, e.g. while a request is in flight. */
  dismissible?: boolean;
  /** Element to focus on open. Defaults to the first focusable element in the body, then the panel. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Hide the header close button (Escape and backdrop still work while dismissible). */
  hideCloseButton?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// Open modals, innermost last. Only the top one reacts to Escape/Tab, so a confirm
// dialog opened over an edit modal closes alone.
const stack: symbol[] = [];

const subscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribe, () => true, () => false);

/**
 * The one admin dialog. Portaled to <body> (an ancestor with a transform, like
 * `.animate-fade-in-up`, would otherwise become the containing block for
 * `position: fixed`). Handles Escape, focus trap, focus return, scroll lock and
 * the dialog ARIA wiring. On phones it is a bottom sheet so actions sit under the thumb.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  dismissible = true,
  initialFocusRef,
  hideCloseButton,
}: ModalProps) {
  const { t } = useLanguage();
  const isClient = useIsClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Keep the latest values in refs so the open/close effect runs only on `open`.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const token = Symbol("modal");
    stack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        initialFocusRef?.current ??
        panel.querySelector("[data-modal-body]")?.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        if (dismissibleRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // initialFocusRef is a ref object; reading .current at open time is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !isClient) return null;

  return createPortal(
    <div
      className="adm-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`adm-modal adm-modal-${size}`}
      >
        <div className="adm-modal-header">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
            {icon && <span className="adm-modal-icon" aria-hidden="true">{icon}</span>}
            <div style={{ minWidth: 0 }}>
              <h2 id={titleId} className="adm-modal-title">{title}</h2>
              {description && <p id={descId} className="adm-modal-desc">{description}</p>}
            </div>
          </div>
          {!hideCloseButton && (
            <IconButton label={t.adminUiClose} icon={<X size={20} />} onClick={onClose} disabled={!dismissible} />
          )}
        </div>
        {children !== undefined && children !== null && (
          <div className="adm-modal-body" data-modal-body>
            {children}
          </div>
        )}
        {footer && <div className="adm-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
