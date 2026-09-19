import { auth } from "@/auth";
import { hardenImageUpload, ImageValidationError } from "@/lib/image-upload";
import { uploadFormFile, deleteFormFile, StorageError } from "@/lib/form-file-storage";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

// A stored key is always "<uuid>.<ext>"; reject anything else so DELETE can only
// ever target an object this app minted, never a client-crafted path.
const KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

// Vercel serverless functions reject request bodies larger than ~4.5MB before
// they ever reach this handler, and a PDF can't be shrunk the way an image is.
// So both branches cap the raw upload at 4MB — comfortably under that wall and
// gentle on the Supabase free-tier storage cap.
const MAX_BYTES = 4 * 1024 * 1024;

// "%PDF-" magic header. MIME type and extension are client-controlled, so the
// file's own first bytes are the only trustworthy signal of what it is.
function isPdf(head: Buffer): boolean {
  return (
    head.length >= 5 &&
    head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d
  );
}

// POST /api/forms/upload — upload a single "file" answer to the PRIVATE bucket.
// Returns the object key ({ key }) which the student stores as their answer and
// submits with the form. Images are re-encoded to WebP (no raw bytes kept, which
// also neutralizes polyglot payloads); PDFs are validated by magic bytes and
// stored as-is. The bytes are streamed back only through the auth-guarded
// /api/forms/file/[submissionId] route — never a public URL.
export async function POST(req: Request) {
  try {
    // Each upload writes a (capped, but real) object to the private bucket and has
    // no other GC than the close/remove cleanup, so an authenticated user spraying
    // uploads could exhaust the free-tier storage cap. 30/min comfortably covers a
    // form with several file questions plus retries while blocking a spam loop.
    const ip = getClientIp(req);
    const limiter = await rateLimit(ip, 30, 60000);
    if (!limiter.success) {
      return NextResponse.json(
        { error: "Too many uploads. Please slow down." },
        { status: 429, headers: { "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString() } },
      );
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      // Seen in prod as "TypeError: Failed to parse body as FormData." with no
      // deeper detail from undici — the multipart body never even reached the
      // point of extracting a file. Log the headers Next saw so a reverse-proxy
      // issue (stripped Content-Length, mangled boundary, request buffering)
      // can actually be diagnosed instead of guessed at. User-Agent and Referer
      // pin down which device/browser/page produced it — three rounds of
      // client-side fixes (fetch->XHR, File->Blob, arrayBuffer materialization)
      // have each been guesses without this, so if it recurs again we need the
      // actual device fingerprint instead of another blind theory.
      console.error("Form file upload: failed to parse multipart body", {
        error: e,
        contentType: req.headers.get("content-type"),
        contentLength: req.headers.get("content-length"),
        userAgent: req.headers.get("user-agent"),
        referer: req.headers.get("referer"),
      });
      return NextResponse.json(
        { error: "Could not read the uploaded file. Please check your connection and try again." },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File size exceeds the 4MB limit." }, { status: 400 });
    }

    // Peek at the magic bytes to route PDF vs image (slice() is a view, it does
    // not consume the File, so hardenImageUpload can still read the whole thing).
    const head = Buffer.from(await file.slice(0, 8).arrayBuffer());
    if (isPdf(head)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = await uploadFormFile(buffer, ".pdf");
      return NextResponse.json({ key });
    }

    // Otherwise it must be an image — hardenImageUpload validates the magic bytes
    // and re-encodes to WebP, rejecting anything it can't decode as an image.
    const { buffer, ext } = await hardenImageUpload(file, { maxBytes: MAX_BYTES, maxDim: 1600 });
    // GIFs are passed through un-recompressed by hardenImageUpload (to keep
    // animation) — but a form answer never needs animation, and an un-shrunk GIF
    // wastes the storage budget. Reject it here so only static, recompressed
    // images and PDFs land in this bucket.
    if (ext === ".gif") {
      return NextResponse.json(
        { error: "GIF files are not allowed. Please upload a JPG, PNG, WEBP, or PDF." },
        { status: 400 },
      );
    }
    const key = await uploadFormFile(buffer, ext);
    return NextResponse.json({ key });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // StorageError carries a safe, pre-written message (never a raw driver
    // exception) — surface it instead of the opaque generic string below, so
    // staff/admins actually see WHY storage failed (see form-file-storage.ts).
    if (error instanceof StorageError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Form file upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/forms/upload?key=<key> — reclaim an un-submitted upload when the
// student removes or replaces a "file" answer before submitting. Best-effort:
// the client fires it and clears the answer regardless, so a failure just leaves
// an orphan (no worse than before). A caller can only target keys it already
// holds (its own upload response), so no cross-user enumeration is possible.
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const key = new URL(req.url).searchParams.get("key");
    if (!key || !KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "Invalid file key" }, { status: 400 });
    }

    await deleteFormFile(key);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Form file delete error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
