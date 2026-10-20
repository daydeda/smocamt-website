"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { ArrowRight, ShieldCheck, Zap, UserCheck, Sparkles, AlertTriangle } from "lucide-react";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { signIn } from "next-auth/react";



export function LandingUI({
  userCount: initialUserCount = 31,
  authError = null,
  enableDevLogin = false,
}: {
  userCount?: number;
  authError?: string | null;
  enableDevLogin?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [userCount, setUserCount] = useState(initialUserCount);
  const [devEmail, setDevEmail] = useState("dev-superadmin@localhost.test");
  const [devRole, setDevRole] = useState("super_admin");

  useEffect(() => {
    fetch("/api/users/count")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.count === "number") {
          setUserCount(d.count);
        }
      })
      .catch((err) => console.error("Failed to load dynamic user count:", err));
  }, []);

  const isEnglish = lang === "en";
  const isBurmese = lang === "mm";

  // h1 (left title) adjustments are always English since the heading is hardcoded in English
  const h1LineHeight = 0.95;
  const h1LetterSpacing = "-0.05em";

  // h2 (welcome card title) adjustments
  const h2LineHeight = isEnglish ? 1.3 : (isBurmese ? 1.5 : 1.4);
  const h2LetterSpacing = isEnglish ? "-0.04em" : "normal";

  const displayCount = userCount > 500 ? `${userCount}+` : userCount;
  const joinText = userCount === 1 ? t.studentSingle : t.studentPlural;

  return (
    <div
      className="min-h-screen relative flex flex-col items-center overflow-x-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Dynamic Background Elements - Hidden on mobile for performance & click safety */}
      <div className="hidden lg:block absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div 
          className="absolute opacity-[0.03] pointer-events-none"
          style={{
            inset: 0,
            backgroundImage: `radial-gradient(var(--accent-primary) 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />
        
        {/* Animated Orbs */}
        <div
          className="absolute animate-pulse pointer-events-none"
          style={{
            width: 800,
            height: 800,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgb(var(--accent-rgb) / 0.06) 0%, transparent 70%)",
            top: "-10%",
            right: "-5%",
            animationDuration: '8s'
          }}
        />
        <div
          className="absolute animate-pulse pointer-events-none"
          style={{
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgb(var(--rating-star-rgb) / 0.04) 0%, transparent 70%)",
            bottom: "-10%",
            left: "-5%",
            animationDuration: '12s',
            animationDelay: '2s'
          }}
        />
      </div>

      <main className="relative z-10 w-full mx-auto px-6 sm:px-12 lg:px-16 py-[12vh] lg:py-0 flex-1 flex flex-col lg:flex-row gap-12 lg:gap-24 items-center justify-center max-w-5xl">
        
        {/* Left: Branding & Value Prop */}
        <div className="flex flex-col gap-6 lg:gap-12 text-center sm:text-left items-center sm:items-start w-full max-w-[400px] lg:max-w-[480px]">
          <div className="flex flex-col gap-3 lg:gap-8">
            <h1 
              className="landing-title"
              style={{ 
                fontSize: "clamp(40px, 8vw, 84px)", 
                fontWeight: 950, 
                letterSpacing: h1LetterSpacing, 
                lineHeight: h1LineHeight, 
                color: "var(--text-primary)",
                wordBreak: "keep-all",
                overflowWrap: "break-word"
              }}
            >
              Experience <br />
              <span className="gradient-text" style={{ whiteSpace: "nowrap", paddingRight: "0.05em" }}>ActiveCAMT</span>
            </h1>
            <p style={{ fontSize: "clamp(16px, 1.8vw, 22px)", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "520px" }}>
              {t.signInSub}
            </p>
          </div>

          <div className="hidden sm:flex flex-row flex-nowrap gap-6 lg:gap-8 mt-2 lg:mt-4">
            <div className="flex items-center gap-3 lg:gap-4 group">
              <div 
                style={{ borderRadius: 16, background: "var(--bg-surface)", boxShadow: "0 8px 20px var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.3s ease" }} 
                className="w-11 h-11 lg:w-12 lg:h-12 group-hover:scale-110 group-hover:shadow-lg"
              >
                <Zap size={22} color="var(--accent-primary)" />
              </div>
              <p style={{ fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.5 }} className="text-base lg:text-[17px]">{t.instantCheckin}</p>
            </div>
            <div className="flex items-center gap-3 lg:gap-4 group">
              <div 
                style={{ borderRadius: 16, background: "var(--bg-surface)", boxShadow: "0 8px 20px var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.3s ease" }} 
                className="w-11 h-11 lg:w-12 lg:h-12 group-hover:scale-110 group-hover:shadow-lg"
              >
                <Sparkles size={22} color="var(--accent-secondary)" />
              </div>
              <p style={{ fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.5 }} className="text-base lg:text-[17px]">{t.houseRewards}</p>
            </div>
          </div>
        </div>

        {/* Right: Auth Card */}
        <div className="flex justify-center w-full lg:w-full max-w-[360px] lg:max-w-[500px]">
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid rgb(var(--ink-rgb) / 0.06)",
              borderRadius: "clamp(32px, 5vw, 48px)",
              padding: "clamp(24px, 6vw, 64px)",
              width: "100%",
              boxShadow: "0 50px 140px -20px rgb(var(--shadow-rgb) / 0.12), 0 0 0 1px rgb(var(--surface-rgb) / 0.6)",
              display: "flex",
              flexDirection: "column",
              gap: "clamp(32px, 5vw, 48px)",
              position: "relative",
            }}
          >
            <div className="flex flex-col gap-3 lg:gap-4">
              <h2 style={{ 
                fontSize: "clamp(28px, 4vw, 42px)", 
                fontWeight: 850, 
                color: "var(--text-primary)", 
                letterSpacing: h2LetterSpacing, 
                lineHeight: h2LineHeight,
                paddingBottom: isBurmese ? "4px" : "0"
              }}>{t.welcome}</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "clamp(16px, 1.5vw, 18px)", fontWeight: 500, lineHeight: 1.5 }}>{t.accessDashboard}</p>
            </div>

            {authError && (
              <div
                role="alert"
                style={{
                  background: "rgb(var(--red-500-rgb) / 0.07)",
                  border: "1px solid rgb(var(--red-500-rgb) / 0.3)",
                  borderRadius: 16,
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--red-700)" }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--red-700)" }}>{t.signInErrorTitle}</span>
                </div>
                <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>{t.signInErrorBody}</p>
                <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>{t.signInErrorHint}</p>
              </div>
            )}

            <div className="flex flex-col gap-5 lg:gap-6">
              <button
                onClick={() => signIn("google")}
                className="btn btn-primary btn-full touch-target"
                aria-label={t.signInBtn}
                style={{ 
                  height: "clamp(64px, 8vw, 76px)", 
                  borderRadius: "clamp(18px, 2vw, 24px)", 
                  fontSize: "clamp(18px, 2vw, 20px)", 
                  boxShadow: "0 28px 56px var(--accent-glow)",
                  gap: 16,
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                  lineHeight: "normal",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity="0.8" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity="0.6" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity="0.9" />
                </svg>
                {t.signInBtn}
              </button>

              {process.env.NODE_ENV === "development" && (
                <div 
                  style={{
                    marginTop: "16px",
                    padding: "20px",
                    background: "rgb(var(--accent-rgb) / 0.04)",
                    border: "1.5px dashed rgb(var(--accent-rgb) / 0.3)",
                    borderRadius: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Zap size={16} color="var(--accent-primary)" style={{ animation: "pulse 2s infinite" }} />
                    <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--accent-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Dev Bypass Login
                    </span>
                  </div>

                  {enableDevLogin ? (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>Test Role</label>
                        <select
                          value={devRole}
                          onChange={(e) => {
                            const r = e.target.value;
                            setDevRole(r);
                            // Only swap in the preset address while the field still holds a
                            // preset; never clobber an email the tester typed (e.g. a seeded account).
                            if (!/^dev-[a-z_]+@localhost\.test$/.test(devEmail)) return;
                            if (r === "super_admin") {
                              setDevEmail("dev-superadmin@localhost.test");
                            } else if (r === "admin") {
                              setDevEmail("dev-admin@localhost.test");
                            } else {
                              setDevEmail(`dev-${r}@localhost.test`);
                            }
                          }}
                          style={{
                            padding: "10px 12px",
                            background: "var(--bg-surface)",
                            border: "1px solid rgb(var(--ink-rgb) / 0.1)",
                            borderRadius: "10px",
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            outline: "none"
                          }}
                        >
                          <option value="super_admin">Super Admin (dev-superadmin@localhost.test)</option>
                          <option value="admin">Admin (dev-admin@localhost.test)</option>
                          <option value="smo">SMO Student Union (dev-smo@localhost.test)</option>
                          <option value="club_president">Club President (dev-club_president@localhost.test)</option>
                          <option value="student">Regular Student (dev-student@localhost.test)</option>
                        </select>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>Email Address</label>
                        <input
                          type="email"
                          value={devEmail}
                          onChange={(e) => setDevEmail(e.target.value)}
                          style={{
                            padding: "10px 12px",
                            background: "var(--bg-surface)",
                            border: "1px solid rgb(var(--ink-rgb) / 0.1)",
                            borderRadius: "10px",
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            outline: "none"
                          }}
                        />
                      </div>

                      <button
                        onClick={() => signIn("credentials", { email: devEmail, name: `Dev ${devRole}`, role: devRole, callbackUrl: "/dashboard" })}
                        style={{
                          width: "100%",
                          padding: "12px",
                          background: "var(--accent-primary)",
                          color: "white",
                          borderRadius: "12px",
                          fontSize: "14px",
                          fontWeight: 700,
                          border: "none",
                          cursor: "pointer",
                          boxShadow: "0 10px 20px -5px rgb(var(--accent-rgb) / 0.3)",
                          transition: "all 0.2s ease"
                        }}
                      >
                        Bypass Sign In
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", background: "rgb(var(--red-600-rgb) / 0.05)", border: "1px solid rgb(var(--red-600-rgb) / 0.2)", borderRadius: "12px", padding: "12px" }}>
                      <AlertTriangle size={16} color="rgb(var(--red-600-rgb))" style={{ marginTop: "2px", flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", fontWeight: 500, color: "rgb(var(--red-600-rgb))", lineHeight: 1.4 }}>
                        Dev Bypass Login is disabled. Enable it by setting <strong>ENABLE_DEV_LOGIN=true</strong> in your <strong>.env</strong> file.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 justify-center group cursor-default">
                <ShieldCheck size={20} className="text-gray-400 group-hover:text-green-500 transition-colors" />
                <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500, lineHeight: 1.5 }}>{t.verified}</p>
              </div>
            </div>

            <div className="mt-2 pt-8 lg:pt-12 border-t border-[var(--border-subtle)] flex flex-col gap-6 lg:gap-8">
              <div className="flex items-center gap-3 justify-center">
                <UserCheck size={18} style={{ color: "var(--text-muted)" }} />
                <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.5 }}>
                  Join {displayCount} active {joinText}
                </p>
              </div>

              {/* Language Switcher in the Card */}
              <div className="pt-1 flex justify-center items-center gap-3">
                <ThemeToggle />
                <LanguageSwitcher variant="segmented" />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer - Absolute on desktop, relative on mobile */}
      <footer className="w-full px-8 py-10 lg:py-6 lg:absolute lg:bottom-0 flex flex-col lg:flex-row items-center justify-center gap-4 lg:gap-8 border-t border-[var(--border-subtle)] bg-transparent lg:bg-[var(--bg-glass)] lg:backdrop-blur-md lg:z-20">
        <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.02em", lineHeight: 1.4 }}>© SMO CAMT 2026</p>
        <div className="hidden lg:block" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--text-muted)" }} />
        <p style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500, textAlign: "center", lineHeight: 1.5 }}>{t.modernizing}</p>
      </footer>
    </div>
  );
}
