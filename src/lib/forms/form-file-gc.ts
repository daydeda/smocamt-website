// Scheduled garbage-collection for orphaned form file-answer uploads.
//
// A "file" answer is uploaded to the private "form-uploads" bucket the moment the
// student picks it — BEFORE they submit. The student form deletes the object again
// on every deterministic exit (remove, replace, modal close, rejected submit), so
// the only orphans left are the ones a *crash* stranded: the browser was killed
// (tab closed, laptop died, reload) after the upload but before submit, so the
// cleanup code never ran. Nothing on the server references those files, so without
// this sweep they would live in the bucket forever against the free-tier cap.
//
// The sweep is deliberately conservative: it deletes an object ONLY when ALL hold:
//   1. its name is an app-minted key ("<uuid>.<ext>") — never touches anything else,
//   2. no submission anywhere references it, and
//   3. it is older than MIN_AGE_MS — so a file a student uploaded and is about to
//      submit (an active, not-yet-saved session) is never swept out from under them.

import { db } from "@/db";
import { deleteFormFile, listFormFiles } from "@/lib/forms/form-file-storage";

// Only app-minted keys are ever candidates for deletion.
const FILE_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

// Grace period before an unreferenced file is considered abandoned. A form is
// normally filled in one sitting, so 24h is comfortably longer than any live
// session while still reclaiming storage promptly.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface FormFileGcResult {
  scanned: number;     // total objects seen in the bucket
  referenced: number;  // distinct keys a submission points at (kept)
  deleted: number;     // orphans removed this run
  keptRecent: number;  // orphans left alone because they're younger than MIN_AGE_MS
}

/**
 * Delete orphaned form-upload objects. Safe to run anytime and on any schedule —
 * it never touches a referenced or recent file.
 */
export async function sweepOrphanFormFiles(): Promise<FormFileGcResult> {
  // 1. Build the off-limits set: every file key any submission currently points at.
  //    Answers are a small JSON map per row; scanning them in JS keeps this simple
  //    and storage-format agnostic (a referenced key is just a value that looks
  //    like a minted key, regardless of which question it belongs to).
  const subs = await db.query.formSubmissions.findMany({ columns: { answers: true } });
  const referenced = new Set<string>();
  for (const s of subs) {
    const answers = (s.answers as Record<string, unknown>) || {};
    for (const v of Object.values(answers)) {
      if (typeof v === "string" && FILE_KEY_PATTERN.test(v)) referenced.add(v);
    }
  }

  // 2. Walk the bucket and delete only clearly-abandoned, app-minted, unreferenced
  //    objects older than the grace period.
  const files = await listFormFiles();
  const cutoff = Date.now() - MIN_AGE_MS;
  let deleted = 0;
  let keptRecent = 0;
  for (const f of files) {
    if (!FILE_KEY_PATTERN.test(f.key)) continue;   // never touch a non-minted object
    if (referenced.has(f.key)) continue;           // in use by a submission
    if (f.createdAt > cutoff) { keptRecent++; continue; } // possibly an active upload
    await deleteFormFile(f.key);                    // best-effort; logs on failure
    deleted++;
  }

  return { scanned: files.length, referenced: referenced.size, deleted, keptRecent };
}
