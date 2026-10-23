import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Thai, Noto_Sans_Myanmar, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

// Primary UI font (Latin), preloaded into the critical path. NOTE: do not add
// an explicit `fallback` of system fonts here — this variable sits first in the
// font-family chain, and system fonts (e.g. -apple-system) carry Thai glyphs,
// so they would swallow Thai text before it reaches IBM Plex Sans Thai below.
const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-ibm-sans",
  display: "swap",
  preload: true,
});

// Thai is a primary script for this audience, so preload it into the critical
// path alongside the Latin font for crisp Thai LCP text without a swap flash.
const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-ibm-thai",
  display: "swap",
  preload: true,
});

// Myanmar — rarely used. Trim to two weights and never preload (these glyph
// sets are large and were being downloaded by every user unnecessarily).
const notoSansMyanmar = Noto_Sans_Myanmar({
  weight: ["400", "700"],
  subsets: ["myanmar"],
  variable: "--font-noto-myanmar",
  display: "swap",
  preload: false,
});

// Simplified Chinese — large CJK family, rarely used. Trim weights, no preload.
const notoSansSC = Noto_Sans_SC({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-noto-sc",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  // Absolute origin for og:image URLs (public event pages). Uses AUTH_URL's origin when set.
  metadataBase: new URL(process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : "https://activecamt.camt.cmu.ac.th"),
  title: "ActiveCAMT — CAMT Student Activity Hub",
  description:
    "The official student activity management platform for CAMT, Chiang Mai University. Register for events, track your house points, and manage attendance.",
  keywords: ["CAMT", "CMU", "student activities", "house points", "attendance"],
  icons: {
    icon: "/smocamt-logo-icon.png",
    apple: "/apple-icon.png",
  },
  // iOS ignores the web manifest for standalone-launch metadata, so it needs
  // its own tags to open in a chromeless window from the home screen icon.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ActiveCAMT",
  },
};

// The page ships its own light and dark themes (globals.css), so tell browsers
// it is dark-aware and must not be algorithmically inverted. The attendance QR
// on /dashboard and /dashboard/id additionally hard-codes a white background so
// it stays scannable in either theme.
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#ff6b00",
};

import { SessionProvider } from "@/components/providers/SessionProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { LanguageWrapper } from "@/lib/i18n/LanguageWrapper";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MovedNotice } from "@/components/MovedNotice";
import { isSiteMoved } from "@/lib/ui/site-moved";
import { PWARegister } from "@/components/PWARegister";
import { InstallPushPrompt } from "@/components/pwa/InstallPushPrompt";

// The app is now self-hosted at activecamt.camt.cmu.ac.th. The retired Vercel
// deployment points at a separate, now-stale Supabase DB — so on Vercel we replace
// the entire app with a "we've moved" screen to prevent split-brain writes. The flag
// lives in @/lib/site-moved so the edge proxy and auth module share the exact same
// definition (see src/lib/site-moved.ts).
const SITE_MOVED = isSiteMoved();

// Runs in <head>, before first paint, so the saved (or OS-preferred) theme is on
// <html> before any content renders — no flash of the wrong theme. Printing
// always uses the light theme (paper is white), restoring the theme afterwards.
// Keep the storage key and attribute in sync with src/lib/theme.ts.
const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.setAttribute("data-theme",t)}catch(e){}var p;addEventListener("beforeprint",function(){p=d.getAttribute("data-theme");d.setAttribute("data-theme","light")});addEventListener("afterprint",function(){if(p)d.setAttribute("data-theme",p)})})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${ibmPlexSansThai.variable} ${notoSansMyanmar.variable} ${notoSansSC.variable} h-full`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        {SITE_MOVED ? (
          <MovedNotice />
        ) : (
          <LanguageProvider>
            <LanguageWrapper>
              <SessionProvider>
                {children}
                <PWARegister />
                <InstallPushPrompt />
                <Analytics />
                <SpeedInsights />
              </SessionProvider>
            </LanguageWrapper>
          </LanguageProvider>
        )}
      </body>
    </html>
  );
}
