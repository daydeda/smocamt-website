"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { readStoredTheme, systemTheme } from "@/lib/ui/theme";

const subscribeNever = () => () => {};

// The before-paint theme script. It is rendered into the server HTML and kept by
// hydration, so it runs before first paint with no theme flash.
//
// When React has to build the document in the browser instead (a hydration
// mismatch, often a browser extension editing the page before React loads), two
// things go wrong with a plain <script>: React 19 logs "Encountered a script tag
// while rendering React component", and the rebuilt <html> loses its data-theme,
// dropping a dark-mode user back to light. So a fresh client mount renders no
// script and restores the theme attribute instead.
export function ThemeInitScript({ code }: { code: string }) {
  // false while hydrating the server HTML, true on a fresh client mount.
  const clientMount = useSyncExternalStore(subscribeNever, () => true, () => false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-theme")) root.setAttribute("data-theme", readStoredTheme() ?? systemTheme());
  }, []);

  if (clientMount) return null;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
