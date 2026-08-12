"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
LogOut,
User,
ShieldCheck,
Menu,
LayoutGrid,
Gamepad2
} from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { canEnterAdminAny, effectiveRoles } from "@/lib/admin-access";
import { canAccessBattle } from "@/lib/battle-access";
import { getPinnedItems, resolveHref, type NavContext } from "@/lib/nav-config";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ServicesLauncher } from "@/components/layout/ServicesLauncher";
import { useState, useRef, useEffect } from "react";

export function StudentNav() {
const { data: session } = useSession();
const { t, lang } = useLanguage();
const pathname = usePathname();
// One shared overlay (see ServicesLauncher) drives both the mobile hamburger
// drawer and the desktop "Apps" grid — replaces the old separate mobile
// drawer + avatar-dropdown split, which left the account items unreachable
// from the hamburger drawer.
const [isLauncherOpen, setIsLauncherOpen] = useState(false);
const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

const mobileProfileRef = useRef<HTMLDivElement>(null);
const desktopProfileRef = useRef<HTMLDivElement>(null);

useEffect(() => {
function handleClickOutside(event: MouseEvent) {
const target = event.target as Node;
const clickedOutsideMobile = !mobileProfileRef.current || !mobileProfileRef.current.contains(target);
const clickedOutsideDesktop = !desktopProfileRef.current || !desktopProfileRef.current.contains(target);
if (clickedOutsideMobile && clickedOutsideDesktop) {
setIsProfileDropdownOpen(false);
}
}
document.addEventListener("mousedown", handleClickOutside);
return () => document.removeEventListener("mousedown", handleClickOutside);
}, []);

const user = session?.user;

// Config-driven nav (src/lib/nav-config.ts): both the pinned top-bar strip
// and the Services launcher grid read the SAME item list, filtered by role
// and sign-in state, so re-tiering (which items are pinned vs one tap
// deeper) is a data edit there, not a component change.
const navCtx: NavContext = {
roles: effectiveRoles(user?.role, user?.roles),
houseId: user?.houseId ?? null,
signedIn: !!user,
};
// nav-config keys are plain `string` (not a string-literal union), so index
// through an untyped view rather than relying on `t`'s literal key type.
const tr = t as Record<string, string>;
const pinnedLinks = getPinnedItems(navCtx).map((item) => ({
...item,
href: resolveHref(item, navCtx),
label: tr[item.i18nKey] || item.fallback,
}));

// Standalone icon affordance — not a core destination tab, not an account action,
// so it gets its own slot next to the language switcher instead of competing for
// space in either list (see nav-right / mobile-controls below).
const battleLabel = lang === "th" ? "เกม P2P" : "P2P Battle";

const isAdmin = canEnterAdminAny(effectiveRoles(user?.role, user?.roles), user?.hasStaffPosition);

return (
<>
<nav className="student-nav">
<div className="nav-content">

{/* Mobile Left: Hamburger (opens the shared launcher), and Profile Icon */}
<div className="mobile-controls">
<button
className="mobile-toggle touch-target"
onClick={() => setIsLauncherOpen(true)}
aria-label={t.servicesLauncher || "Open Menu"}
>
<Menu size={24} />
</button>

<div className="mobile-profile-wrapper" ref={mobileProfileRef}>
<button
className="avatar-btn"
onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
aria-label="User Menu"
>
<div className="avatar">
{user?.image ? (
<img
src={user.image}
alt={user.name || "User Avatar"}
className="avatar-img"
style={{
transform: user.imageTransform ? `scale(${user.imageTransform.scale}) translate(${user.imageTransform.x}%, ${user.imageTransform.y}%)` : 'none'
}}
/>
) : (
<User size={18} color="var(--text-secondary)" />
)}
</div>
</button>

{/* Mobile Profile Dropdown (GitHub style) — account-scoped actions only
    (sign out / admin escape hatch); every destination lives in the
    launcher now, so this stays identical to the desktop version below. */}
{isProfileDropdownOpen && (
<div className="profile-dropdown mobile-dropdown-pos">
<AccountDropdownContent
user={user}
t={t}
lang={lang}
isAdmin={isAdmin}
onNavigate={() => setIsProfileDropdownOpen(false)}
/>
</div>
)}
</div>
</div>

{/* Brand/Logo (Desktop Left, Mobile Right) */}
<div className="nav-left">
<Link href="/dashboard" className="logo">
<img src="/smocamt-logo-icon.png" alt="SMOCAMT Logo" className="logo-icon" width={32} height={32} style={{ width: 32, height: 32 }} />
<div className="logo-text">
<span className="gradient-text">ActiveCAMT</span>
</div>
</Link>
</div>

{/* Center: Desktop Nav (Hidden on Mobile) */}
<div className="nav-center desktop-links">
{pinnedLinks.map((link) => {
const Icon = link.icon;
const isActive = pathname === link.href;
return (
<Link
key={link.id}
href={link.href}
className={`nav-link ${isActive ? "active" : ""}`}
>
<Icon size={16} />
{link.label}
</Link>
);
})}
<button
className={`nav-link launcher-trigger ${isLauncherOpen ? "active" : ""}`}
onClick={() => setIsLauncherOpen(true)}
>
<LayoutGrid size={16} />
{t.servicesLauncher || "Services"}
</button>
</div>

{/* Right: Desktop Actions & User */}
<div className="nav-right desktop-links">
<LanguageSwitcher />

<div className="user-section">
<div className="user-info">
<p className="user-name">{user ? user.name : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest")}</p>
<p className="user-role">
{user ? (
  user.role === "super_admin" ? t.roleSuperAdmin :
  user.role === "admin" ? t.roleAdmin :
  user.role === "registration" ? t.roleRegistration :
  user.role === "organizer" ? t.roleOrganizer :
  user.role === "staff" ? t.roleStaff :
  (user.studentId || t.roleStudent)
) : (
  lang === "th" ? "ไม่ได้เข้าสู่ระบบ" : "Not logged in"
)}
</p>
</div>

<div className="desktop-profile-wrapper" ref={desktopProfileRef}>
<button
className="avatar-btn"
onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
aria-label="User Menu"
>
<div className="avatar">
{user?.image ? (
<img
src={user.image}
alt={user.name || "User Avatar"}
className="avatar-img"
style={{
transform: user.imageTransform ? `scale(${user.imageTransform.scale}) translate(${user.imageTransform.x}%, ${user.imageTransform.y}%)` : 'none'
}}
/>
) : (
<User size={18} color="var(--text-secondary)" />
)}
</div>
</button>

{/* Desktop Profile Dropdown (GitHub style) */}
{isProfileDropdownOpen && (
<div className="profile-dropdown desktop-dropdown-pos">
<AccountDropdownContent
user={user}
t={t}
lang={lang}
isAdmin={isAdmin}
onNavigate={() => setIsProfileDropdownOpen(false)}
/>
</div>
)}
</div>
</div>
</div>
</div>
</nav>

{/* Battle shortcut: a floating action button, not a nav item — it's a side
    activity, not a core destination, so it shouldn't compete with the tab
    bar or the account menu for space. Fixed bottom-right on every viewport.
    Staged rollout: SMO/ANUSMO/Admin only while battle is tested on prod —
    hiding it for everyone else avoids a dead-end into the /dashboard bounce
    the proxy/layout gates already enforce. Deliberately kept OUT of
    nav-config.ts: folding it into the launcher grid would mean re-wiring
    canAccessBattle a second time and risks it drifting from the FAB's gate. */}
{user && canAccessBattle(effectiveRoles(user.role, user.roles)) && (
<Link
href="/battle"
className={`battle-fab ${pathname.startsWith("/battle") ? "active" : ""}`}
aria-label={battleLabel}
title={battleLabel}
>
<Gamepad2 size={22} />
</Link>
)}

{/* The single Services launcher — mobile left-drawer / desktop centered
    grid, driven entirely by nav-config.ts. See ServicesLauncher.tsx. */}
<ServicesLauncher
open={isLauncherOpen}
onClose={() => setIsLauncherOpen(false)}
ctx={navCtx}
/>

<style jsx>{`
.student-nav {
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border-bottom: 1px solid var(--border-subtle);
position: sticky;
top: 0;
z-index: 1000;
padding: 0 24px;
}
.nav-content {
max-width: 1400px;
margin: 0 auto;
height: 72px;
display: flex;
justify-content: space-between;
align-items: center;
}
.nav-left {
display: flex;
align-items: center;
flex-shrink: 0;
}
.nav-center {
display: flex;
align-items: center;
gap: 8px;
}
.nav-right {
display: flex;
align-items: center;
gap: 20px;
}
.logo {
display: flex;
align-items: center;
gap: 12px;
text-decoration: none;
color: inherit;
}
.logo-icon {
width: 32px;
height: 32px;
object-fit: contain;
}
.logo-text {
font-weight: 800;
font-size: 20px;
letter-spacing: -0.03em;
}
.user-section {
display: flex;
align-items: center;
gap: 12px;
}
.user-info {
text-align: right;
flex-shrink: 0;
}
.user-name {
font-size: 13px;
font-weight: 700;
color: var(--text-primary);
line-height: 1.4;
margin: 0;
white-space: nowrap;
}
.user-role {
font-size: 11px;
color: var(--text-muted);
margin-top: 3px;
text-transform: capitalize;
white-space: nowrap;
}
.desktop-links {
display: flex;
}
.avatar {
width: 38px;
height: 38px;
border-radius: 50%;
border: 2px solid var(--accent-primary);
overflow: hidden;
display: flex;
align-items: center;
justify-content: center;
background: var(--bg-elevated);
}
.avatar-img {
width: 100%;
height: 100%;
object-fit: cover;
}
.avatar-btn {
background: none;
border: none;
padding: 0;
cursor: pointer;
display: block;
}
:global(.launcher-trigger) {
border: none;
background: transparent;
font-family: inherit;
}
:global(.battle-fab) {
position: fixed;
right: 20px;
bottom: 20px;
width: 52px;
height: 52px;
border-radius: 50%;
background: var(--accent-primary);
color: white;
display: flex;
align-items: center;
justify-content: center;
text-decoration: none;
box-shadow: 0 6px 20px rgba(255, 107, 0, 0.35), 0 2px 6px rgba(0,0,0,0.15);
z-index: 998;
transition: transform 0.2s ease, box-shadow 0.2s ease;
}
:global(.battle-fab:hover) {
transform: translateY(-2px) scale(1.05);
box-shadow: 0 10px 26px rgba(255, 107, 0, 0.45), 0 3px 8px rgba(0,0,0,0.18);
}
:global(.battle-fab.active) {
background: var(--text-primary);
box-shadow: 0 6px 20px rgba(0,0,0,0.25);
}
:global(.battle-fab::after) {
content: '';
position: absolute;
inset: -4px;
border-radius: 50%;
border: 2px solid rgba(255, 107, 0, 0.35);
animation: fab-pulse 2.2s ease-out infinite;
}
:global(.battle-fab.active::after) {
display: none;
}
@keyframes fab-pulse {
0% { transform: scale(0.9); opacity: 0.8; }
70% { transform: scale(1.3); opacity: 0; }
100% { opacity: 0; }
}

/* Dropdown style */
.mobile-profile-wrapper,
.desktop-profile-wrapper {
position: relative;
}
.profile-dropdown {
position: absolute;
min-width: 220px;
width: max-content;
background: rgba(255, 255, 255, 0.96);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border-radius: 16px;
border: 1px solid var(--border-subtle);
box-shadow: 0 10px 40px rgba(0,0,0,0.08);
z-index: 999;
padding: 8px 0;
margin-top: 8px;
display: flex;
flex-direction: column;
animation: fade-in-up 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.profile-dropdown::before {
content: '';
position: absolute;
top: -6px;
width: 10px;
height: 10px;
background: rgba(255, 255, 255, 0.96);
border-left: 1px solid var(--border-subtle);
border-top: 1px solid var(--border-subtle);
transform: rotate(45deg);
}
.desktop-dropdown-pos {
right: 0;
top: 100%;
}
.desktop-dropdown-pos::before {
right: 14px;
}
.mobile-dropdown-pos {
left: 0;
top: 100%;
}
.mobile-dropdown-pos::before {
left: 14px;
}
:global(.dropdown-header) {
padding: 12px 16px;
text-align: left;
display: flex;
flex-direction: column;
gap: 2px;
}
:global(.dropdown-name) {
font-size: 14px;
font-weight: 800;
color: var(--text-primary);
margin: 0;
line-height: 1.4;
}
:global(.dropdown-sub) {
font-size: 11px;
color: var(--text-muted);
margin: 0;
font-weight: 600;
letter-spacing: 0.02em;
}
:global(.dropdown-divider) {
height: 1px;
background: var(--border-subtle);
margin: 6px 0;
}
:global(.dropdown-item) {
display: flex;
align-items: center;
gap: 12px;
padding: 10px 16px;
font-size: 14px;
font-weight: 600;
color: var(--text-secondary);
text-decoration: none;
border: none;
background: none;
width: 100%;
white-space: nowrap;
text-align: left;
cursor: pointer;
transition: background 0.2s ease, color 0.2s ease;
}
:global(.dropdown-item:hover) {
background: var(--accent-glow);
color: var(--accent-primary);
}
/* Icon nudges on hover — uniform motion that works for every label length,
   since the icon always has the 12px gap to slide into (long labels never clip). */
:global(.dropdown-item svg) {
transition: transform 0.2s ease;
}
:global(.dropdown-item:hover svg) {
transform: translateX(3px);
}
:global(.dropdown-item.admin-item) {
color: var(--accent-primary);
background: rgba(255, 107, 0, 0.03);
}
:global(.dropdown-item.admin-item:hover) {
background: var(--accent-glow);
}
:global(.dropdown-item.text-danger) {
color: #ef4444;
}
:global(.dropdown-item.text-danger:hover) {
background: rgba(239, 68, 68, 0.05);
}

/* Mobile Controls */
.mobile-controls {
display: none;
align-items: center;
gap: 12px;
}
.mobile-toggle {
padding: 8px;
border-radius: 12px;
background: rgba(0,0,0,0.03);
border: none;
cursor: pointer;
color: var(--text-primary);
display: flex;
align-items: center;
justify-content: center;
}

:global(.nav-link) {
font-size: 14px;
font-weight: 700;
color: var(--text-secondary);
text-decoration: none;
display: flex;
align-items: center;
gap: 8px;
transition: all 0.2s;
padding: 12px 20px;
border-radius: 12px;
min-height: 44px;
}
.desktop-links :global(.nav-link) {
white-space: nowrap;
}
:global(.nav-link:hover) {
color: var(--accent-primary);
background: rgba(255,107,0,0.05);
}
:global(.nav-link.active) {
background: var(--accent-glow) !important;
color: var(--accent-primary) !important;
border: 1px solid rgba(255, 107, 0, 0.15) !important;
}

@media (max-width: 1400px) {
.nav-right {
gap: 12px;
}
.user-section {
gap: 8px;
}
.nav-center {
gap: 4px;
}
:global(.nav-link) {
padding: 6px 12px !important;
min-height: 36px !important;
}
}

/* Tablet band (e.g. iPad landscape): tabs stay visible but the textual
   user name/role is dropped to leave room for the tabs — avatar remains. */
@media (max-width: 1280px) and (min-width: 1024px) {
.user-info {
display: none;
}
.nav-right {
gap: 10px;
}
}
@media (max-width: 1023px) {
.desktop-links {
display: none !important;
}
.mobile-controls {
display: flex;
}
}
@keyframes fade-in-up {
from { opacity: 0; transform: translateY(10px); }
to { opacity: 1; transform: translateY(0); }
}
`}</style>
</>
);
}

// Account-scoped actions only (identity header, admin escape hatch, sign
// out / register) — every actual destination now lives in the Services
// launcher (nav-config.ts), so this is intentionally the same content on
// mobile and desktop (the old version only showed Admin Panel in the
// mobile hamburger drawer, never the mobile avatar dropdown — this fixes
// that asymmetry too).
function AccountDropdownContent({
user,
t,
lang,
isAdmin,
onNavigate,
}: {
user: { name?: string | null; role?: string; studentId?: string | null } | undefined;
t: Record<string, string>;
lang: string;
isAdmin: boolean;
onNavigate: () => void;
}) {
return (
<>
<div className="dropdown-header">
<p className="dropdown-name">{user ? user.name : (lang === "th" ? "ผู้เยี่ยมชม" : "Guest")}</p>
<p className="dropdown-sub">
{user ? (
  user.role === "super_admin" ? t.roleSuperAdmin :
  user.role === "admin" ? t.roleAdmin :
  user.role === "registration" ? t.roleRegistration :
  user.role === "organizer" ? t.roleOrganizer :
  user.role === "staff" ? t.roleStaff :
  (user.studentId || t.roleStudent)
) : (
  lang === "th" ? "ไม่ได้เข้าสู่ระบบ" : "Not logged in"
)}
</p>
</div>
<div className="dropdown-divider" />
{user ? (
  <>
    {isAdmin && (
      <Link href="/admin" className="dropdown-item admin-item" onClick={onNavigate}>
        <ShieldCheck size={16} />
        {t.adminPanel}
      </Link>
    )}
    <button className="dropdown-item text-danger" onClick={() => signOut({ callbackUrl: "/" })}>
      <LogOut size={16} />
      {t.signOut}
    </button>
  </>
) : (
  <Link href="/login" className="dropdown-item" onClick={onNavigate}>
    <User size={16} />
    {lang === "th" ? "ลงทะเบียนบัญชี" : "Register Account"}
  </Link>
)}
</>
);
}
