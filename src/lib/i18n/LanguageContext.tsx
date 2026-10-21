
"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { Language, translations } from "./i18n";

type LanguageContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: typeof translations.en;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    // Deferred: localStorage can only be read post-mount (SSR renders "en"),
    // and the timeout keeps the setState out of the synchronous effect body.
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem("app-lang") as Language;
        if (saved && ["en", "th", "mm", "cn"].includes(saved)) {
          setLangState(saved);
        }
      } catch (err) {
        console.warn("Storage access failed:", err);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem("app-lang", newLang);
    } catch (err) {
      console.warn("Storage write failed:", err);
    }
  };

  // MM/CN may be missing keys (admin strings are EN/TH only — see i18n.ts), so
  // they fall back to EN per key. EN/TH are complete by construction.
  const t = useMemo<typeof translations.en>(
    () => (lang === "mm" || lang === "cn" ? { ...translations.en, ...translations[lang] } : translations[lang]),
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
