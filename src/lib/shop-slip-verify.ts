// Free, offline pre-filter for shop payment slips. This does NOT prove a slip is
// bank-authentic — that requires calling the issuing bank (either a paid aggregator
// like EasySlip/SlipOK, or the bank's own app scanning the slip's QR). What this
// module CAN do for free is catch the sloppy/common cases automatically:
//   - the exact same slip image reused across multiple orders
//   - the exact same bank QR reused across multiple orders (survives re-cropping/
//     re-compression that would change the image hash)
//   - a "slip" with no scannable QR at all (blurry, cropped, or not a real slip)
// Anything flagged still needs a human to look — but the QR payload is extracted
// here from the pixels (jsQR against a raw bitmap from sharp), so the admin who
// does look gets a one-tap link to the bank's own verify page instead of having to
// physically re-point a camera at the photo. See shop_orders.slipFlag/slipHash/
// slipQrPayload in src/db/schema.ts.

import { createHash } from "crypto";

export type SlipFlag = "duplicate_image" | "duplicate_qr" | "no_qr" | null;

// sha256 of the slip's own bytes (the hardened/re-encoded webp, not the original
// upload) — cheap, exact-match duplicate detection.
export function hashSlip(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Decode the QR code embedded in a slip photo, if any. Returns the raw decoded
// string (for a real bank slip this is almost always a URL to that bank's own
// verification page) or null if no QR was found. sharp decodes the image to a raw
// RGBA bitmap; jsQR reads that — both run fully offline, no network call.
export async function decodeSlipQr(buffer: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const jsQR = (await import("jsqr")).default;
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return result?.data || null;
  } catch (e) {
    console.error("Slip QR decode failed:", e);
    return null;
  }
}

// A prior order to compare a new slip against — only the two dedup keys matter.
export type PriorSlip = { slipHash: string | null; slipQrPayload: string | null };

// Classify a newly-submitted slip against slips already on file (typically every
// non-rejected order's slip, so a rejected+resubmitted slip isn't flagged forever).
// Pure and order-independent: duplicate checks win over "no QR" since a reused real
// slip is a stronger fraud signal than an unreadable photo.
export function classifySlip(
  candidate: { slipHash: string; slipQrPayload: string | null },
  priorSlips: PriorSlip[]
): SlipFlag {
  if (priorSlips.some((p) => p.slipHash === candidate.slipHash)) return "duplicate_image";
  if (candidate.slipQrPayload && priorSlips.some((p) => p.slipQrPayload === candidate.slipQrPayload)) {
    return "duplicate_qr";
  }
  if (!candidate.slipQrPayload) return "no_qr";
  return null;
}

// True when a decoded QR payload is a clickable bank-verify link the admin can
// open in one tap. Some banks' QR payloads are non-URL tokens (rare, older
// formats) — those still get stored/shown as text, just without a link.
export function isVerifyUrl(payload: string | null): payload is string {
  if (!payload) return false;
  try {
    const u = new URL(payload);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
