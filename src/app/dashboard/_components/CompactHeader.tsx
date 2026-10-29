"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, QrCode, LogIn } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { houseLogo } from "./dashboard-parts";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { Language } from "@/lib/i18n/i18n";
import type { DashboardCtx } from "../_lib/useDashboard";

const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "th", label: "ไทย" },
  { code: "mm", label: "မြန်မာ" },
  { code: "cn", label: "中文" },
];

// Small globe button. It opens a short list of the four languages, so students can switch
// without opening the menu.
function GlobeLanguageButton() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        aria-expanded={open}
        className="dash-globe"
      >
        <Globe size={18} />
      </button>
      {open && (
        <div role="listbox" aria-label="Language" className="dash-globe-menu">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={lang === l.code}
              onClick={() => { setLang(l.code); setOpen(false); }}
              className={`dash-globe-option${lang === l.code ? " active" : ""}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Phones and tablets (below lg): one line with the greeting, the student's house
// (rank and points) and a Digital ID button. It replaces the big greeting plus the
// house/ID tiles so the event list starts near the top of the screen. From lg up the
// large heading and the sidebar show instead.
export function CompactHeader({ ctx }: { ctx: DashboardCtx }) {
  const { houseId, houseInfo, houses, lang, myPoints, t, user } = ctx;
  const firstName = user ? (user.name?.split(" ")[0] || "Student") : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest");

  const rank = houses.findIndex((h) => h.id === houseId);
  const logo = houseLogo(houseId);

  return (
    <div className="dash-compact-head lg:hidden">
      <p className="dash-compact-hello">
        {t.hey} <span className="gradient-text">{firstName}</span>
      </p>
      <GlobeLanguageButton />

      {user ? (
        <>
          <Link
            href="/dashboard/houses"
            aria-label={t.yourHouse}
            className="dash-chip"
            style={{ color: houseInfo.color, background: alpha(houseInfo.color, 0.08), border: `1px solid ${alpha(houseInfo.color, 0.2)}` }}
          >
            {logo && <img src={logo} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />}
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {houseInfo.name}
              {rank >= 0 && <span style={{ color: "var(--text-secondary)" }}> #{rank + 1}</span>}
              {myPoints != null && <span style={{ color: "var(--text-secondary)" }}> · {myPoints} PTS</span>}
            </span>
          </Link>
          <Link href="/dashboard/id" aria-label={t.digitalId} className="dash-chip dash-chip-id">
            <QrCode size={16} />
            <span className="dash-chip-id-label">{t.digitalId}</span>
          </Link>
        </>
      ) : (
        <Link href="/login" className="dash-chip dash-chip-id" style={{ marginLeft: "auto" }}>
          <LogIn size={16} />
          <span>{t.dashSignInBtn}</span>
        </Link>
      )}
    </div>
  );
}
