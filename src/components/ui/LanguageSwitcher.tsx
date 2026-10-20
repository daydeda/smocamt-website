"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { Language } from "@/lib/i18n";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface LanguageSwitcherProps {
  align?: "left" | "right";
  position?: "top" | "bottom";
  variant?: "dropdown" | "segmented";
  fullWidth?: boolean;
}

export function LanguageSwitcher({ align = "right", position = "bottom", variant = "dropdown", fullWidth = false }: LanguageSwitcherProps) {
  const { lang, setLang } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const languages: { code: Language; label: string }[] = [
    { code: "en", label: "English" },
    { code: "th", label: "ไทย" },
    { code: "mm", label: "မြန်မာ" },
    { code: "cn", label: "中文" },
  ];

  const currentLang = languages.find((l) => l.code === lang) || languages[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const renderFlag = (code: Language) => {
    switch (code) {
      case "th":
        return (
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
            <rect width="18" height="3" fill="#ED1C24" />
            <rect y="3" width="18" height="3" fill="#FFFFFF" />
            <rect y="6" width="18" height="6" fill="#241D4F" />
            <rect y="12" width="18" height="3" fill="#FFFFFF" />
            <rect y="15" width="18" height="3" fill="#ED1C24" />
          </svg>
        );
      case "en":
        return (
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
            <rect width="18" height="18" fill="#B22234" />
            <rect y="2" width="18" height="2" fill="#FFFFFF" />
            <rect y="6" width="18" height="2" fill="#FFFFFF" />
            <rect y="10" width="18" height="2" fill="#FFFFFF" />
            <rect y="14" width="18" height="2" fill="#FFFFFF" />
            <rect width="10" height="10" fill="#3C3B6E" />
            <circle cx="2" cy="2" r="0.6" fill="#FFFFFF" />
            <circle cx="5" cy="2" r="0.6" fill="#FFFFFF" />
            <circle cx="8" cy="2" r="0.6" fill="#FFFFFF" />
            <circle cx="3.5" cy="4" r="0.6" fill="#FFFFFF" />
            <circle cx="6.5" cy="4" r="0.6" fill="#FFFFFF" />
            <circle cx="2" cy="6" r="0.6" fill="#FFFFFF" />
            <circle cx="5" cy="6" r="0.6" fill="#FFFFFF" />
            <circle cx="8" cy="6" r="0.6" fill="#FFFFFF" />
            <circle cx="3.5" cy="8" r="0.6" fill="#FFFFFF" />
            <circle cx="6.5" cy="8" r="0.6" fill="#FFFFFF" />
          </svg>
        );
      case "mm":
        return (
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
            <rect width="18" height="6" fill="#FECB00" />
            <rect y="6" width="18" height="6" fill="#109B48" />
            <rect y="12" width="18" height="6" fill="#EA2228" />
            <polygon points="9,4 10.5,8.5 15,8.5 11.3,11.2 12.7,15.7 9,13 5.3,15.7 6.7,11.2 3,8.5 7.5,8.5" fill="#FFFFFF" />
          </svg>
        );
      case "cn":
        return (
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
            <rect width="18" height="18" fill="#EE1C25" />
            <polygon points="4,3.5 4.5,5 6,5 4.8,6 5.3,7.5 4,6.5 2.7,7.5 3.2,6 2,5 3.5,5" fill="#FFFF00" />
            <polygon transform="translate(8, 2.5) scale(0.35) rotate(23)" points="4,4 4.5,6 6,6 4.8,7 5.3,9 4,8 2.7,9 3.2,7 2,6 3.5,6" fill="#FFFF00" />
            <polygon transform="translate(9.2, 4) scale(0.35) rotate(45)" points="4,4 4.5,6 6,6 4.8,7 5.3,9 4,8 2.7,9 3.2,7 2,6 3.5,6" fill="#FFFF00" />
            <polygon transform="translate(9.2, 6) scale(0.35) rotate(0)" points="4,4 4.5,6 6,6 4.8,7 5.3,9 4,8 2.7,9 3.2,7 2,6 3.5,6" fill="#FFFF00" />
            <polygon transform="translate(8, 7.5) scale(0.35) rotate(23)" points="4,4 4.5,6 6,6 4.8,7 5.3,9 4,8 2.7,9 3.2,7 2,6 3.5,6" fill="#FFFF00" />
          </svg>
        );
      default:
        return null;
    }
  };

  if (variant === "segmented") {
    return (
      <div 
        style={{ 
          display: fullWidth ? "flex" : "inline-flex", 
          width: fullWidth ? "100%" : "auto",
          background: "rgb(var(--accent-rgb) / 0.04)", 
          padding: 4, 
          borderRadius: 16, 
          border: "1px solid var(--border-subtle)",
          gap: 4
        }}
      >
        {languages.map((l) => {
          const isActive = lang === l.code;
          return (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              aria-label={`Switch to ${l.label}`}
              title={l.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: fullWidth ? 1 : "0 0 auto",
                height: 34,
                ...(fullWidth ? {} : { width: 34 }),
                borderRadius: 10,
                cursor: "pointer",
                transition: "all 0.2s ease",
                border: "none",
                background: isActive ? "var(--bg-surface)" : "transparent",
                boxShadow: isActive ? "0 4px 12px rgb(var(--accent-rgb) / 0.08), 0 2px 4px rgb(var(--shadow-rgb) / 0.04)" : "none",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {renderFlag(l.code)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "fit-content" }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select Language"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          height: 44,
          borderRadius: 14,
          background: isOpen ? "var(--bg-elevated)" : "rgb(var(--accent-rgb) / 0.05)",
          border: `1px solid ${isOpen ? "var(--border-medium)" : "transparent"}`,
          cursor: "pointer",
          transition: "all 0.2s ease",
          color: "var(--text-primary)",
        }}
      >
        <Globe size={16} className={isOpen ? "text-accent" : "text-muted"} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          {renderFlag(lang)} {currentLang.label}
        </span>
        <ChevronDown size={14} style={{ 
          opacity: 0.5, 
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s"
        }} />
      </button>

      {isOpen && (
        <div style={{
          position: "absolute",
          ...(position === "top" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
          ...(align === "left" ? { left: 0 } : { right: 0 }),
          width: 180,
          background: "var(--bg-surface)",
          borderRadius: 18,
          border: "1px solid var(--border-medium)",
          boxShadow: "0 10px 40px rgb(var(--shadow-rgb) / 0.12)",
          padding: 8,
          zIndex: 99999,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          animation: "fade-in-up 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }}>
          {languages.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code);
                setIsOpen(false);
              }}
              aria-label={`Switch to ${l.label}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 12px",
                height: 44,
                borderRadius: 12,
                fontSize: 13,
                fontWeight: lang === l.code ? 800 : 600,
                background: lang === l.code ? "rgb(var(--accent-rgb) / 0.08)" : "transparent",
                color: lang === l.code ? "var(--accent-primary)" : "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "left"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {renderFlag(l.code)}
                {l.label}
              </div>
              {lang === l.code && <Check size={14} />}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
