export type Theme = "light" | "dark";

// Keep in sync with THEME_INIT_SCRIPT in src/app/layout.tsx (rendered by ThemeInitScript).
export const THEME_STORAGE_KEY = "theme";

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Must outlast the duration of `html.theme-transition` in globals.css.
const THEME_FADE_MS = 350;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === theme) return;
  // Fade the colours instead of snapping, which is a harsh flash on a dark room's
  // screen. Skipped for reduced motion; the class is dropped once the fade is done
  // so it never slows down ordinary hover/focus transitions.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theme-transition");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("theme-transition"), THEME_FADE_MS);
  }
  root.setAttribute("data-theme", theme);
}
