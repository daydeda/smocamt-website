"use client";

import { useEffect, useState } from "react";
import { Menu, X, User } from "lucide-react";
import { AdminNav } from "./AdminNav";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { LanguageProvider } from "@/lib/LanguageContext";
import { effectiveRoles } from "@/lib/admin-access";
import { buildAdminNavContext } from "@/lib/admin-nav-config";
import Link from "next/link";

export function AdminLayoutWrapper({
  children,
  user
}: {
  children: React.ReactNode;
  user: {
    name?: string | null;
    image?: string | null;
    role?: string | null;
    roles?: string[] | null;
    hasStaffPosition?: boolean;
    hasClubPosition?: boolean;
    smoPosition?: string | null;
    anusmoPosition?: string | null;
  };
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const roles = effectiveRoles(user.role, user.roles);
  const navCtx = buildAdminNavContext({
    roles,
    hasStaffPosition: user.hasStaffPosition,
    hasClubPosition: user.hasClubPosition,
    smoPosition: user.smoPosition,
    anusmoPosition: user.anusmoPosition,
  });

  // First app-wide keydown listener in this codebase (every prior one is
  // scoped to a single dropdown's own effect) — deliberately kept here
  // rather than a new provider, since the command palette is admin-only.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <LanguageProvider>
      <div className="flex h-dvh bg-[var(--bg-base)] overflow-hidden relative">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-[var(--border-subtle)] flex items-center justify-between px-6 z-[1000] backdrop-blur-md bg-white/80">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="rounded-xl bg-gray-50 text-[var(--text-primary)] flex items-center justify-center"
          style={{ width: 44, height: 44, border: "none", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        >
          {isSidebarOpen ? <X size={24} style={{ pointerEvents: "none" }} /> : <Menu size={24} style={{ pointerEvents: "none" }} />}
        </button>
        <div className="flex items-center gap-3">
          <img src="/smocamt-logo-icon.png" className="w-8 h-8 object-contain" alt="SMOCAMT Logo" width={32} height={32} style={{ width: 32, height: 32 }} />
          <span className="gradient-text font-black text-xl">ActiveCAMT</span>
        </div>
      </header>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[1001]"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        sidebar fixed lg:static inset-y-0 left-0 z-[1002] 
        transition-transform duration-300 transform
        ${isSidebarOpen ? "translate-x-0 open" : "-translate-x-full"}
        lg:translate-x-0 lg:flex
        w-[280px] bg-white border-r border-[var(--border-subtle)] flex flex-col pt-6 px-6 pb-[calc(1.5rem+var(--safe-bottom))]
      `}>
        <div style={{ marginBottom: 40, display: "flex", alignItems: "center" }}>
          <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}>
            <img 
              src="/smocamt-logo-icon.png"
              className="object-contain" 
              alt="SMOCAMT Logo"
              style={{ 
                width: 44, 
                height: 44, 
              }} 
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ 
                fontSize: 22, 
                fontWeight: 900, 
                color: "var(--text-primary)", 
                letterSpacing: "-0.03em",
                lineHeight: 1
              }}>
                Active<span style={{ color: "var(--accent-primary)" }}>CAMT</span>
              </span>
              <span style={{ 
                fontSize: 10, 
                fontWeight: 800, 
                color: "var(--text-muted)", 
                textTransform: "uppercase", 
                letterSpacing: "0.15em",
                marginTop: 4
              }}>Admin Panel</span>
            </div>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AdminNav
            roles={roles}
            hasStaffPosition={user.hasStaffPosition}
            hasClubPosition={user.hasClubPosition}
            smoPosition={user.smoPosition}
            anusmoPosition={user.anusmoPosition}
            onOpenPalette={() => setIsPaletteOpen(true)}
          />
        </div>

        <div className="mt-auto pt-6 border-t border-[var(--border-subtle)]">
          <div className="bg-[var(--bg-elevated)] p-4 rounded-2xl flex items-center gap-3 border border-[var(--border-subtle)]">
            {user.image ? (
              <img src={user.image} className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm" alt="" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[var(--text-secondary)] shadow-sm">
                <User size={20} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">{user.name}</p>
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                {user.role === "super_admin" ? "Super Admin" : user.role === "registration" ? "Registration" : user.role === "organizer" ? "Organizer" : user.role === "smo" ? "SMO" : user.role === "club_president" ? "Club President" : user.role === "major_president" ? "Major President" : "Administrator"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <div className="w-full">
          {children}
        </div>
      </main>

      <AdminCommandPalette open={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} ctx={navCtx} />

      <style jsx>{`
        .admin-main {
          flex: 1;
          overflow-y: auto;
          background: var(--bg-base);
          transition: all 0.3s ease;
          padding-left: 16px;
          padding-right: 16px;
          padding-bottom: 32px;
          padding-top: 112px;
        }
        @media (min-width: 640px) {
          .admin-main {
            padding-left: 24px;
            padding-right: 24px;
            padding-top: 128px;
          }
        }
        @media (min-width: 1024px) {
          .admin-main {
            padding-left: 40px;
            padding-right: 40px;
            padding-top: 80px;
            padding-bottom: 48px;
          }
        }
        @media (min-width: 1280px) {
          .admin-main {
            padding-left: 56px;
            padding-right: 56px;
            padding-top: 96px;
          }
        }
        @media (max-width: 1023px) {
          .sidebar {
            transform: translateX(-100%) !important;
            position: fixed !important;
            visibility: hidden !important;
          }
          .sidebar.open {
            visibility: visible !important;
            transform: translateX(0) !important;
          }
        }
      `}</style>
      </div>
    </LanguageProvider>
  );
}
