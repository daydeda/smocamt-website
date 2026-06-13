"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  QrCode,
  Users,
  ShieldCheck,
  Megaphone,
  User
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";

const NAV = [
  { href: "/admin/dashboard", key: "overview",             icon: LayoutDashboard },
  { href: "/admin/events",    key: "manageEvents",         icon: Calendar },
  { href: "/admin/scanner",   key: "qrScanner",            icon: QrCode },
  { href: "/admin/students",  key: "adminStudentsDirectory",icon: Users },
  { href: "/admin/audit-logs",key: "auditTrails",          icon: ShieldCheck },
  { href: "/admin/announcement",key: "manageAnnouncement", icon: Megaphone },
] as const;

export function AdminNav({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const filteredNav = NAV.filter(item => {
    // Organizer cannot see Students list or Audit Logs
    if (role === "organizer") {
      if (item.href === "/admin/students" || item.href === "/admin/audit-logs") {
        return false;
      }
    }
    // Registration cannot see Audit Logs
    if (role === "registration") {
      if (item.href === "/admin/audit-logs") {
        return false;
      }
    }
    // Announcement editor is super_admin/admin only (matches the page + API gate)
    if (item.href === "/admin/announcement" && role !== "super_admin" && role !== "admin") {
      return false;
    }
    return true;
  });

  return (
    <nav style={{ flex: 1 }}>
      <p className="section-title" style={{ paddingLeft: 0, marginBottom: 16 }}>{t.mainMenu}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {filteredNav.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          const labelText = t[item.key] || item.key;
          return (
            <Link 
              key={item.href} 
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

      <div className="divider" style={{ margin: "24px 0", opacity: 0.5 }} />
      <p className="section-title" style={{ paddingLeft: 0, marginBottom: 16 }}>{t.accountLabel}</p>
      <Link href="/dashboard" className="nav-link" style={{ gap: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        <User size={18} strokeWidth={2} style={{ pointerEvents: "none" }} />
        <span style={{ fontWeight: 500, pointerEvents: "none" }}>{t.switchToStudentView}</span>
      </Link>

      <AdminLanguageSwitcher />
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
