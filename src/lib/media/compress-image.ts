// Client-side image downscale + re-encode, run in the BROWSER before upload.
//
// Why this exists: phone photos (payment slips, posters) are routinely 2–5MB.
// The reverse proxy in front of the app caps request bodies, so a raw multi-MB
// upload is rejected with a 413 BEFORE it ever reaches Next.js — the user just
// sees a generic "server error" with nothing in the app logs. Shrinking the
// image here (typically to a few hundred KB) keeps every upload well under any
// proxy limit and cuts upload time. The server still re-encodes and hardens the
// result (src/lib/image-upload.ts) — this is a size/UX optimization, not a
// security boundary.
//
// Mirrors the proven Canvas→WebP pipeline from the admin event-poster uploader.

export interface CompressOptions {
  // Longest-edge cap. 1600 matches the server's re-encode maxDim, so slip text
  // (amounts, names) stays legible while the payload shrinks dramatically.
  maxDim?: number;
  quality?: number; // WebP quality 0–1
}

// Downscale + re-encode to WebP. Returns a new File on success, or the ORIGINAL
// file if compression wouldn't help or isn't possible (e.g. a browser that can't
// decode the format, like HEIC outside Safari) — never throws, so the caller can
// always proceed to upload.
export async function compressImageFile(
  file: File,
  { maxDim = 1600, quality = 0.8 }: CompressOptions = {},
): Promise<File> {
  // Only attempt raster images. Animated GIFs would lose animation through a
  // canvas, so leave them untouched.
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const encode = (canvas: HTMLCanvasElement, type: string) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality),
      );
    const blob = await new Promise<Blob>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode failed"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("no 2d context"));
          ctx.drawImage(img, 0, 0, width, height);
          // Safari (all iOS browsers) can't ENCODE WebP: toBlob silently falls
          // back to a lossless PNG, which for a phone photo is usually bigger
          // than the original — so the "keep the smaller" check below threw it
          // away and iPhones uploaded the raw multi-MB file. Fall back to JPEG,
          // which every browser encodes.
          encode(canvas, "image/webp")
            .then((b) => (b.type === "image/webp" ? b : encode(canvas, "image/jpeg")))
            .then(resolve, reject);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });

    // Keep whichever is smaller — re-encoding a tiny/already-optimized image can
    // grow it.
    if (blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: blob.type || "image/jpeg" });
  } catch {
    // Couldn't decode/encode in this browser — upload the original and let the
    // server decide.
    return file;
  }
}
