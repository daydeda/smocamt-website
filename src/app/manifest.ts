import type { MetadataRoute } from "next";

// Next.js App Router convention: this file is auto-served at /manifest.webmanifest
// and auto-linked from <head> — no manual <link rel="manifest"> needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ActiveCAMT — CAMT Student Activity Hub",
    short_name: "ActiveCAMT",
    description:
      "Student activity registration, QR attendance, and house points for CMU CAMT.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches --bg-base / --accent-primary in globals.css. The app is light-only
    // by design (see the color-scheme comment there) so there is no dark variant.
    background_color: "#fcfcfd",
    theme_color: "#ff6b00",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
