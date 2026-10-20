"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, systemTheme, type Theme } from "@/lib/theme";

// The theme lives on <html data-theme> (set before paint by the inline script in
// layout.tsx), so the DOM attribute is the store: every toggle instance on the
// page stays in sync, and a system change is followed until the user picks one.
function subscribe(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (!readStoredTheme()) applyTheme(systemTheme());
  };
  mq.addEventListener("change", onSystemChange);
  return () => {
    observer.disconnect();
    mq.removeEventListener("change", onSystemChange);
  };
}

const getSnapshot = (): Theme =>
  document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
const getServerSnapshot = (): Theme => "light";

export function ThemeToggle({ size = 40 }: { size?: number }) {
  const { t } = useLanguage();
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? (t.themeSwitchToDark || "Switch to dark mode") : (t.themeSwitchToLight || "Switch to light mode");

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          /* private mode / blocked storage: theme still applies for this visit */
        }
      }}
      aria-label={label}
      title={label}
      suppressHydrationWarning
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: 999,
        border: "1px solid var(--border-medium)",
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        cursor: "pointer",
        touchAction: "manipulation",
      }}
    >
      {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
