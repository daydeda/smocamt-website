// Storage for payment slips. Slips carry names + bank details (PDPA), so they go
// to a PRIVATE Supabase bucket ("slips") and are NEVER served by public URL — the
// app reads them back through an auth-guarded endpoint that streams the bytes.
//
// In production both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set AND a
// PRIVATE bucket named "slips" must exist (create it in the Supabase dashboard:
// Storage → New bucket → name "slips", "Public" OFF). In local dev (no Supabase
// env) slips are written under .uploads-private/ at the project root, which is git-
// ignored and outside /public, so they are not web-accessible.

import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";

const BUCKET = "slips";
const DEV_DIR = path.join(process.cwd(), ".uploads-private", BUCKET);

// A storage-layer failure (Supabase upload rejected, disk write failed, ...).
// Distinct from a generic Error so the route can surface this specific,
// pre-written (or fs-detail-carrying) message instead of a bare "Internal
// Server Error" — mirrors src/lib/form-file-storage.ts's StorageError.
export class StorageError extends Error {}

function hasSupabase(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function contentTypeForKey(key: string): string {
  if (key.endsWith(".gif")) return "image/gif";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "image/webp";
}

// Store a slip and return its object key (NOT a URL). The key is what gets saved
// on shop_orders.slipPath.
export async function uploadSlip(buffer: Buffer, ext: string): Promise<string> {
  const key = `${randomUUID()}${ext}`;

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType: contentTypeForKey(key), upsert: false });
    if (error) {
      console.error("Slip upload error:", error);
      throw new StorageError("Failed to store the payment slip.");
    }
    return key;
  }

  // Dev fallback: private (non-public, git-ignored) disk dir. Also the ACTIVE
  // path on the self-hosted deploy (SUPABASE_* intentionally unset there, see
  // docker-stack.yml) — wrap so a disk fault (e.g. EACCES from stale volume
  // ownership) surfaces its real fs error instead of an opaque 500.
  try {
    await mkdir(DEV_DIR, { recursive: true });
    await writeFile(path.join(DEV_DIR, key), buffer);
  } catch (e) {
    console.error("Slip local-disk write error:", e);
    const detail = e instanceof Error ? e.message : String(e);
    throw new StorageError(`Failed to store the payment slip (${detail}).`);
  }
  return key;
}

// Read a slip back for the auth-guarded view endpoint to stream.
export async function downloadSlip(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  // Guard against traversal — keys are server-generated UUIDs, never client paths.
  if (key.includes("/") || key.includes("..")) throw new Error("Invalid slip key");

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error || !data) {
      console.error("Slip download error:", error);
      throw new Error("Slip not found");
    }
    return { buffer: Buffer.from(await data.arrayBuffer()), contentType: contentTypeForKey(key) };
  }

  const buffer = await readFile(path.join(DEV_DIR, key));
  return { buffer, contentType: contentTypeForKey(key) };
}

// Delete a slip object. Only used by the one-off cleanup script
// (scripts/purge-shop-slips.ts) — the app itself never deletes slips, since a slip
// is the payment record for its order. A missing object is not an error.
export async function deleteSlip(key: string): Promise<void> {
  if (!key || key.includes("/") || key.includes("..")) return;

  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase.storage.from(BUCKET).remove([key]);
    if (error) throw new StorageError(`Failed to delete slip ${key}: ${error.message}`);
    return;
  }

  try {
    await unlink(path.join(DEV_DIR, key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

// List every slip object with its creation time (epoch ms) and size in bytes.
// Mirrors listFormFiles: when the store can't report an age we say "now", so a
// caller filtering on age errs toward KEEPING the file.
export async function listSlips(): Promise<{ key: string; createdAt: number; size: number }[]> {
  if (hasSupabase()) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const out: { key: string; createdAt: number; size: number }[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list("", { limit: pageSize, offset, sortBy: { column: "created_at", order: "asc" } });
      if (error) throw new Error(`Failed to list slips: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const obj of data) {
        if (!obj.name) continue;
        out.push({
          key: obj.name,
          createdAt: obj.created_at ? Date.parse(obj.created_at) : Date.now(),
          size: Number(obj.metadata?.size ?? 0),
        });
      }
      if (data.length < pageSize) break;
    }
    return out;
  }

  try {
    const names = await readdir(DEV_DIR);
    const out: { key: string; createdAt: number; size: number }[] = [];
    for (const name of names) {
      const st = await stat(path.join(DEV_DIR, name));
      out.push({ key: name, createdAt: st.mtimeMs, size: st.size });
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; // no slips yet
    throw e;
  }
}
