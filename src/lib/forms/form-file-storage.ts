// Storage for evaluation-form file-answer uploads. These can hold personal
// documents / a student's own work (PDPA), so they go to a PRIVATE Supabase
// bucket ("form-uploads") and are NEVER served by public URL — the app streams
// them back through an auth-guarded endpoint that checks, per request, that the
// viewer is the submitter or an admin. Mirrors src/lib/shop-storage.ts (slips).
//
// In production both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set AND a
// PRIVATE bucket named "form-uploads" must exist (Supabase dashboard: Storage →
// New bucket → name "form-uploads", "Public" OFF). In local dev (no Supabase
// env) files are written under .uploads-private/form-uploads/ at the project
// root, which is git-ignored and outside /public, so they are not web-accessible.

import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";

const BUCKET = "form-uploads";
const DEV_DIR = path.join(process.cwd(), ".uploads-private", BUCKET);

// A storage-layer failure (Supabase upload rejected, disk write failed, ...).
// Distinct from a generic Error so callers (the upload route) can surface this
// specific, pre-written message instead of a bare "Internal Server Error" —
// it never wraps a raw driver exception/stack, just a safe fixed string.
export class StorageError extends Error {}

function hasSupabase(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".gif")) return "image/gif";
  return "image/webp";
}

// Store a file and return its object key (NOT a URL). The key is what gets saved
// as the student's answer for a "file" question.
export async function uploadFormFile(buffer: Buffer, ext: string): Promise<string> {
  const key = `${randomUUID()}${ext}`;

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const opts = { contentType: contentTypeForKey(key), upsert: false };

    let result = await supabase.storage.from(BUCKET).upload(key, buffer, opts);
    // The private bucket must exist before any upload lands. It's meant to be
    // created out-of-band (Supabase dashboard: Storage → New bucket → name
    // "form-uploads", Public OFF), but on a fresh deploy where that step was
    // missed EVERY upload 500s with "Bucket not found". So if it's missing we
    // create it once — private, never public — and retry, instead of failing.
    if (result.error && /bucket not found/i.test(result.error.message)) {
      const created = await supabase.storage.createBucket(BUCKET, { public: false });
      if (created.error) console.error("Form bucket auto-create error:", created.error);
      result = await supabase.storage.from(BUCKET).upload(key, buffer, opts);
    }
    if (result.error) {
      console.error("Form file upload error:", result.error);
      throw new StorageError("Failed to store the uploaded file.");
    }
    return key;
  }

  try {
    await mkdir(DEV_DIR, { recursive: true });
    await writeFile(path.join(DEV_DIR, key), buffer);
  } catch (e) {
    // Surface the real fs error (e.g. EACCES, ENOSPC) rather than a generic
    // "Internal Server Error" — this is the active path on the self-hosted
    // deploy (SUPABASE_* is intentionally unset there, see docker-stack.yml),
    // and a bare "Internal Server Error" gave staff nothing to act on.
    console.error("Form file local-disk write error:", e);
    const detail = e instanceof Error ? e.message : String(e);
    throw new StorageError(`Failed to store the uploaded file (${detail}).`);
  }
  return key;
}

// Read a file back for the auth-guarded view endpoint to stream.
export async function downloadFormFile(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  // Guard against traversal — keys are server-generated UUIDs, never client paths.
  if (key.includes("/") || key.includes("..")) throw new Error("Invalid file key");

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error || !data) {
      console.error("Form file download error:", error);
      throw new Error("File not found");
    }
    return { buffer: Buffer.from(await data.arrayBuffer()), contentType: contentTypeForKey(key) };
  }

  const buffer = await readFile(path.join(DEV_DIR, key));
  return { buffer, contentType: contentTypeForKey(key) };
}

// Best-effort delete of a previously uploaded file, used to reclaim storage when
// a student removes or replaces an un-submitted "file" answer (the bucket has no
// other GC path, so an orphaned object would live forever against the free-tier
// cap). Callers should not block the UI on this — a failure just leaves an orphan,
// which is no worse than before.
export async function deleteFormFile(key: string): Promise<void> {
  // Same traversal guard as download — keys are server-generated UUIDs.
  if (!key || key.includes("/") || key.includes("..")) return;

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase.storage.from(BUCKET).remove([key]);
    if (error) console.error("Form file delete error:", error);
    return;
  }

  try {
    await unlink(path.join(DEV_DIR, key));
  } catch {
    // Missing file (already gone) is fine; nothing else to do.
  }
}

// List every object in the bucket with its creation time. Used by the scheduled
// GC sweep (src/lib/form-file-gc.ts) to find orphans — files a crashed/closed
// browser never got to clean up. createdAt is epoch ms; when the store can't tell
// us an age we report "now" so the sweeper errs toward KEEPING the file.
export async function listFormFiles(): Promise<{ key: string; createdAt: number }[]> {
  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const out: { key: string; createdAt: number }[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list("", { limit: pageSize, offset, sortBy: { column: "created_at", order: "asc" } });
      if (error) {
        console.error("Form file list error:", error);
        throw new Error("Failed to list form files");
      }
      if (!data || data.length === 0) break;
      for (const obj of data) {
        if (!obj.name) continue; // skip folder/prefix placeholders
        out.push({ key: obj.name, createdAt: obj.created_at ? Date.parse(obj.created_at) : Date.now() });
      }
      if (data.length < pageSize) break;
    }
    return out;
  }

  try {
    const names = await readdir(DEV_DIR);
    const out: { key: string; createdAt: number }[] = [];
    for (const name of names) {
      const st = await stat(path.join(DEV_DIR, name));
      out.push({ key: name, createdAt: st.mtimeMs });
    }
    return out;
  } catch {
    return []; // dir not created yet (no uploads in this dev env)
  }
}
