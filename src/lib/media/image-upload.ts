// Shared image-hardening used by both /api/upload (public posters) and the shop
// slip upload (private bucket). MIME type and extension are both client-controlled,
// so the only trustworthy signal is the file's own magic bytes. Re-encoding to WebP
// also destroys any polyglot payload, so a file sharp cannot decode is rejected,
// never stored raw.

export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  const ascii6 = buf.subarray(0, 6).toString("ascii");
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// ISO base media (HEIC/HEIF) container: bytes 4-7 are "ftyp", followed by a
// 4-byte major brand. iPhones save camera photos in this format by default
// (unless the device is set to "Most Compatible"), and it has no simple magic
// number sniffImageType recognizes, so without this check every such upload
// silently fell through to the generic "File content is not a valid image."
// error below with no way for staff to tell what went wrong.
function isHeicBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buf.subarray(8, 12).toString("ascii");
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand);
}

export class ImageValidationError extends Error {}

export interface HardenedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

// Validate a raw upload and return a safe, re-encoded image. Throws
// ImageValidationError with a user-facing message on anything suspicious.
// maxBytes guards memory; maxDim caps the re-encoded longest edge.
export async function hardenImageUpload(
  file: File,
  { maxBytes = 5 * 1024 * 1024, maxDim = 1600 }: { maxBytes?: number; maxDim?: number } = {}
): Promise<HardenedImage> {
  if (!file) throw new ImageValidationError("No file uploaded");
  if (file.size > maxBytes) {
    throw new ImageValidationError(`File size exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`);
  }
  if (!file.type.startsWith("image/")) {
    throw new ImageValidationError("Only images are allowed");
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  const sniffedType = sniffImageType(buffer);
  if (!sniffedType) {
    if (isHeicBuffer(buffer)) {
      throw new ImageValidationError(
        "HEIC/HEIF photos aren't supported. On iPhone, switch Camera format to \"Most Compatible\" in Settings, or choose an existing JPG/PNG image instead.",
      );
    }
    throw new ImageValidationError("File content is not a valid image.");
  }

  // Animated GIFs are left untouched to preserve animation; everything else is
  // re-encoded to WebP, which shrinks slips/posters and neutralizes payloads.
  if (sniffedType === "image/gif") {
    return { buffer, contentType: "image/gif", ext: ".gif" };
  }

  try {
    const sharp = (await import("sharp")).default;
    buffer = await sharp(buffer)
      .rotate() // honor EXIF orientation before stripping metadata
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (e) {
    console.error("Image re-encode failed, rejecting upload:", e);
    throw new ImageValidationError("File could not be processed as an image.");
  }

  return { buffer, contentType: "image/webp", ext: ".webp" };
}
