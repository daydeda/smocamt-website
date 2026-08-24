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

import { createHash, createHmac, timingSafeEqual } from "crypto";

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

// --- Carrying the hash/QR from upload time to order-creation time ---------
//
// The upload endpoint (POST /api/shop/slip) already has the slip's bytes in
// memory — that's the only time hashing/decoding is free. By the time the
// buyer submits the order (POST /api/shop/orders), only the storage PATH
// travels with the request; fetching the bytes back from storage just to
// recompute the same hash/QR is a wasted round-trip to Supabase/disk, and at
// real volume (100+ slips/month) that's a lot of image downloads for no
// reason. So the upload endpoint signs the computed hash/QR into a token the
// client carries forward — order creation verifies the signature (cheap, no
// I/O) instead of re-deriving it. This is NOT a trust boundary the rest of
// the flow depends on: a missing/invalid/expired token just means "fall back
// to downloading and recomputing," same as before this existed, so it can
// never make an order fail — it only saves the round-trip in the common case.
const SLIP_META_TTL_MS = 2 * 60 * 60 * 1000; // 2h — covers a buyer pausing between upload and checkout
const SLIP_META_SIG_LEN = 32;

function slipMetaSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

// Signs {slipPath, slipHash, slipQrPayload} so it can travel with the client
// and be trusted later without re-downloading the image. Bound to the exact
// slipPath (can't be replayed onto a different object key). "|" is a safe
// field separator here since it never appears in a slipPath (uuid + extension),
// a hex hash, or base64url — unlike "." (already used inside slipPath's
// extension), which is why this doesn't reuse qr-token.ts's dot-joined format.
export function signSlipMeta(slipPath: string, slipHash: string, slipQrPayload: string | null): string {
  const exp = Date.now() + SLIP_META_TTL_MS;
  const qrPart = slipQrPayload ? Buffer.from(slipQrPayload, "utf8").toString("base64url") : "-";
  const payload = `${slipPath}|${slipHash}|${qrPart}|${exp}`;
  const sig = createHmac("sha256", slipMetaSecret()).update(payload).digest("hex").slice(0, SLIP_META_SIG_LEN);
  return `${payload}|${sig}`;
}

// Verifies a signSlipMeta token was issued for this exact slipPath, unexpired
// and untampered. Returns the carried hash/QR on success, or null on any
// failure (missing, wrong path, expired, bad signature) — callers must treat
// null as "re-derive from the slip bytes," never as a hard error.
export function verifySlipMeta(
  slipPath: string,
  token: string | null | undefined
): { slipHash: string; slipQrPayload: string | null } | null {
  if (!token) return null;
  const parts = token.split("|");
  if (parts.length !== 5) return null;
  const [tokenSlipPath, slipHash, qrPart, expStr, sig] = parts;
  if (tokenSlipPath !== slipPath || !slipHash) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  const payload = `${tokenSlipPath}|${slipHash}|${qrPart}|${expStr}`;
  const expected = createHmac("sha256", slipMetaSecret()).update(payload).digest("hex").slice(0, SLIP_META_SIG_LEN);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }

  const slipQrPayload = qrPart === "-" ? null : Buffer.from(qrPart, "base64url").toString("utf8");
  return { slipHash, slipQrPayload };
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
