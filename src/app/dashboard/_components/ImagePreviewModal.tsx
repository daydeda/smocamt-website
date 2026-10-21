"use client";

import { X } from "lucide-react";
import { PosterCarousel } from "./dashboard-parts";
import type { DashboardCtx } from "../_lib/useDashboard";

export function ImagePreviewModal({ ctx }: { ctx: DashboardCtx }) {
  const { previewImage, setPreviewImage } = ctx;
  return (
    <>{previewImage && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(var(--scrim-rgb) / 0.85)",
            backdropFilter: "blur(20px)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "pointer"
          }}
          onClick={() => setPreviewImage(null)}
        >
          {/* Close Button */}
          <button 
            style={{
              position: "absolute",
              top: 24,
              right: 24,
              background: "rgb(var(--white-rgb) / 0.15)",
              border: "none",
              borderRadius: "50%",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-on-color)",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            onClick={() => setPreviewImage(null)}
          >
            <X size={24} />
          </button>
          
          {/* Image Container — a fixed-size stage so the carousel can fill it and
              the user can keep swiping between posters at full size. */}
          <div
            style={{
              position: "relative",
              width: "min(900px, 92vw)",
              height: "85vh",
              borderRadius: 24,
              overflow: "hidden"
            }}
            onClick={e => e.stopPropagation()}
          >
            <PosterCarousel
              posters={previewImage.posters}
              objectFit="contain"
              arrowSize={24}
              initialIndex={previewImage.index}
              zoomable
            />
          </div>
        </div>
      )}</>
  );
}
