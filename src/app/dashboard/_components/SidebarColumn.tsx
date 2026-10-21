"use client";

import Link from "next/link";
import { User, RefreshCw, Trophy, ArrowRight } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { QRCodeCanvas } from "./dashboard-parts";
import type { DashboardCtx } from "../_lib/useDashboard";

export function SidebarColumn({ ctx }: { ctx: DashboardCtx }) {
  const { countdownColor, countdownMM, countdownSS, houseId, houses, lang, loadingHouses, qrValue, t, user } = ctx;
  return (
    <div className="hidden lg:flex lg:order-2" style={{ flexDirection: "column", gap: 32 }}>
              {/* Digital ID Card / Guest Promo Card */}
              {user ? (
                <div
                  className="stat-card animate-fade-in-up"
                  style={{ 
                    padding: "24px", 
                    background: "var(--bg-surface)",
                    display: "flex", 
                    flexDirection: "column", 
                    alignItems: "center", 
                    gap: 24,
                    boxShadow: "0 20px 50px rgb(var(--shadow-rgb) / 0.06)",
                    border: "1px solid var(--border-medium)",
                    width: "100%",
                    maxWidth: "340px",
                    alignSelf: "center"
                  }}
                >
                   <div
                     style={{
                       background: "var(--qr-surface)",
                       padding: "20px",
                       borderRadius: 28,
                       border: "1px solid var(--border-medium)",
                       boxShadow: "0 0 50px rgb(var(--shadow-rgb) / 0.03)",
                       display: "flex",
                       flexDirection: "column",
                       alignItems: "center",
                       gap: 16,
                       width: "100%",
                       maxWidth: 300
                     }}
                   >
                    {user?.image ? (
                      <div style={{ width: 80, height: 80, borderRadius: 16, overflow: "hidden", border: "1px solid var(--border-subtle)", position: "relative" }}>
                        <img 
                          src={user.image} 
                          alt="" 
                          style={{ 
                            position: "absolute",
                            width: "100%", 
                            height: "100%", 
                            objectFit: "cover",
                            transform: user.imageTransform ? `scale(${user.imageTransform.scale}) translate(${user.imageTransform.x}%, ${user.imageTransform.y}%)` : 'none'
                          }} 
                        />
                      </div>
                    ) : (
                      <div style={{ width: 80, height: 80, borderRadius: 16, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <User size={32} color="var(--text-muted)" />
                      </div>
                    )}
                    <QRCodeCanvas
                      value={qrValue}
                      // Rendered internally larger than its display maxWidth
                      // below for crispness on a high-DPI screen (canvas
                      // resolution vs CSS-scaled display size, not a layout
                      // change) — see the identical comment on /dashboard/id's
                      // QRCodeCanvas, which this widget mirrors.
                      size={320}
                      // 240 -> 260: fills the existing wrapper's available
                      // space (maxWidth: 300 above, minus its 20px padding on
                      // each side = 260px usable) without widening the card.
                      style={{ width: "100%", height: "auto", maxWidth: 260 }}
                      // "H" (30% error correction) is for a PRINTED code that
                      // might get scuffed; this is a backlit phone screen —
                      // "M" (15%) still has margin to spare and produces a
                      // lower QR version (fewer, larger modules) at the same
                      // physical size, which is what actually speeds up a
                      // close-range camera read. See /dashboard/id for the
                      // same change with the fuller rationale.
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />

                    {/* Countdown pill */}
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      background: alpha(countdownColor, 0.08),
                      border: `1px solid ${alpha(countdownColor, 0.25)}`,
                    }}>
                      <RefreshCw size={11} color={countdownColor} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: countdownColor, fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em" }}>
                        {countdownMM}:{countdownSS}
                      </span>
                      <span style={{ fontSize: 11, color: countdownColor, opacity: 0.8 }}>
                        {lang === "th" ? "รีเฟรช" : "refresh"}
                      </span>
                    </div>
                  </div>

                   <div style={{ textAlign: "center", width: "100%" }}>
                     <p style={{ fontSize: 24, fontWeight: 900, color: "var(--text-primary)", wordBreak: "break-word", overflowWrap: "break-word" }}>{user?.name}</p>
                     <p style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 }}>ID: {user?.studentId || "212110XXX"}</p>
                   </div>
                </div>
              ) : (
                <div
                  className="stat-card animate-fade-in-up"
                  style={{ 
                    padding: "32px 24px", 
                    display: "flex", 
                    flexDirection: "column", 
                    alignItems: "center", 
                    justifyContent: "center",
                    textAlign: "center",
                    gap: 20,
                    boxShadow: "0 20px 50px rgb(var(--shadow-rgb) / 0.06)",
                    border: "1px solid var(--border-medium)",
                    borderRadius: "28px",
                    width: "100%",
                    maxWidth: "340px",
                    alignSelf: "center",
                    minHeight: "280px",
                    background: "linear-gradient(135deg, rgb(var(--accent-rgb) / 0.03) 0%, rgb(var(--surface-rgb) / 0.8) 100%)"
                  }}
                >
                   <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgb(var(--accent-rgb) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", marginBottom: 4 }}>
                     <User size={32} />
                   </div>
                   <h4 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)", margin: 0 }}>
                     {lang === "th" ? "สัมผัสประสบการณ์เต็มรูปแบบ" : "Get the Full Experience"}
                   </h4>
                   <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                     {lang === "th" 
                       ? "ลงทะเบียนเข้าสู่ระบบเพื่อเช็กชั่วโมงกิจกรรม สะสมคะแนนบ้าน และรับคิวอาร์โค้ดประจำตัวนักศึกษาสำหรับเข้าร่วมงาน" 
                       : "Sign in to track your activities, earn house points, and get your digital Student ID QR code."}
                   </p>
                   <Link 
                     href="/login" 
                     className="btn btn-primary"
                     style={{ 
                       width: "100%", 
                       borderRadius: 16, 
                       height: 48, 
                       fontWeight: 800, 
                       display: "flex", 
                       alignItems: "center", 
                       justifyContent: "center",
                       boxShadow: "0 8px 20px var(--accent-glow)",
                       textDecoration: "none"
                     }}
                   >
                     {lang === "th" ? "ลงทะเบียน / เข้าสู่ระบบ" : "Sign In / Register"}
                   </Link>
                </div>
              )}

              {/* Leaderboard Sidebar */}
              <div className="glass" style={{ padding: 24, borderRadius: 24, background: "var(--bg-glass-strong)" }}>
                 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                   <h3 style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                      <Trophy size={14} className="text-accent" />
                      {t.leaderboard}
                   </h3>
                   <span style={{ fontSize: 10, fontWeight: 900, background: "var(--bg-elevated)", padding: "4px 8px", borderRadius: 8, color: "var(--text-muted)" }}>LIVE</span>
                 </div>
                 
                 {loadingHouses ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[1, 2, 3, 4].map((i) => (
                        <div 
                          key={i} 
                          className="animate-pulse"
                          style={{ 
                            height: 54, 
                            background: "var(--bg-elevated)", 
                            borderRadius: 16 
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                   <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {houses.map((h, idx) => {
                        const isUserHouse = h.id === houseId;
                        const maxPoints = Math.max(...houses.map(x => x.points || 0), 1);
                        const percentage = Math.min(100, ((h.points || 0) / maxPoints) * 100);
                        
                        return (
                          <div key={h.id} style={{ 
                            padding: "12px 16px", 
                            background: isUserHouse ? alpha(h.color, 0.06) : "var(--bg-elevated)",
                            borderRadius: 16,
                            border: `1px solid ${isUserHouse ? alpha(h.color, 0.19) : "transparent"}`,
                            position: "relative",
                            overflow: "hidden"
                          }}>
                            {isUserHouse && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: h.color }} />}
                            
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                 <span style={{ fontSize: 12, fontWeight: 900, color: idx === 0 ? "var(--amber-400)" : "var(--text-muted)", width: 14 }}>{idx + 1}</span>
                                 <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>
                                    {h.id === 'red' ? t.houseMom : h.id === 'green' ? t.houseTo : h.id === 'yellow' ? t.houseLuang : h.id === 'blue' ? t.houseMakara : h.name}
                                  </span>
                                 {isUserHouse && <span style={{ fontSize: 9, fontWeight: 900, background: h.color, color: "var(--text-on-color)", padding: "2px 6px", borderRadius: 6 }}>YOU</span>}
                              </div>
                              <span style={{ fontSize: 14, fontWeight: 900, color: h.color }}>{h.points || 0} <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>PTS</span></span>
                            </div>
                            
                            <div style={{ width: "100%", height: 6, background: "rgb(var(--ink-rgb) / 0.05)", borderRadius: 99 }}>
                              <div style={{ 
                                width: `${percentage}%`, 
                                height: "100%", 
                                background: h.color, 
                                borderRadius: 99,
                                boxShadow: idx === 0 ? `0 0 10px ${alpha(h.color, 0.25)}` : "none",
                                transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)"
                              }} />
                            </div>
                          </div>
                        );
                      })}
                   </div>
                 )}
                 
                 <Link href="/dashboard/houses" style={{ 
                   marginTop: 20, 
                   display: "flex", 
                   alignItems: "center", 
                   justifyContent: "center", 
                   gap: 8, 
                   fontSize: 12, 
                   fontWeight: 800, 
                   color: "var(--accent-primary)",
                   textDecoration: "none",
                   padding: "12px",
                   borderRadius: 16,
                   background: "rgb(var(--accent-rgb) / 0.05)"
                 }}>
                    {t.houseRankings}
                    <ArrowRight size={14} />
                 </Link>
              </div>
            </div>
  );
}
