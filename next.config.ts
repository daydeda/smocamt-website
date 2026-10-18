import type { NextConfig } from "next";
import os from "os";

const getLocalIPs = () => {
  const interfaces = os.networkInterfaces();
  const ips = ["localhost", "127.0.0.1"];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
};

// 'unsafe-eval' is required by webpack/react-refresh in dev only; never ship it.
// 'unsafe-inline' for scripts is required by Next.js hydration without a nonce
// setup; styles need it for styled-jsx and inline style props used throughout.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https:${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
].join("; ");

const nextConfig: NextConfig = {
  // Runtime-uploaded images are written to public/uploads, but `next start` only
  // serves files that existed in public/ at build time — so /uploads/<file> 404s
  // in production. This afterFiles rewrite (runs only when no real static file
  // matches) sends those requests to the streaming handler in
  // src/app/api/media/[name]/route.ts. Keeps every /uploads/... URL already saved
  // in the DB working. No-op when Supabase Storage is configured (absolute URLs).
  async rewrites() {
    return [{ source: "/uploads/:name", destination: "/api/media/:name" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        // Runtime-uploaded images have content-unique UUID filenames, so their
        // bytes never change — cache hard. Set here rather than in the route
        // handler, which Next forces to max-age=0. Matches the original request
        // path before the /uploads -> /api/media rewrite.
        source: "/uploads/:name",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  distDir: (typeof __dirname !== "undefined" && (__dirname.includes("CloudDocs") || __dirname.includes("Mobile Documents")))
    ? ".next.nosync"
    : undefined,
  allowedDevOrigins: getLocalIPs(),
  serverExternalPackages: ["@electric-sql/pglite", "tesseract.js"],
  turbopack: {},
  // Tree-shake large barrel-export packages so each route only ships the icons
  // it actually uses instead of the whole library.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
