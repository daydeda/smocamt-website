// Scheduled full-database backup: pg_dump -> gzip -> upload to a Google Drive folder
// in YOUR OWN Google account (via OAuth, not a service account), then delete the local
// copy. Self-hosted Postgres has no managed backups
// (docs/supabase-to-university-server-cutover.md); this is the automated replacement
// for the old "run pg_dump by hand before every migration" step.
//
// Why OAuth-as-you instead of a service account: service accounts have zero Drive
// storage quota of their own, so they can't own files created in a normal "My Drive"
// folder even with Editor access — only Shared Drives work for them, and not every
// Google/Workspace plan has Shared Drives. Authorizing as a real account sidesteps
// that entirely; uploads count against that account's own quota.
//
// Runs inside the `backup` service in docker-stack.yml, which loops this script once a
// day. The dump never touches a persistent volume — it's written to /tmp inside the
// container and removed immediately after upload (success or failure), so it costs zero
// server disk.
//
// Required env (set in the Portainer stack's "Environment variables", never in git):
//   DATABASE_URL              - already present on every service, points at `db`
//   GDRIVE_OAUTH_CLIENT_ID     - from a Google Cloud "Desktop app" OAuth client
//   GDRIVE_OAUTH_CLIENT_SECRET - ditto
//   GDRIVE_OAUTH_REFRESH_TOKEN - obtained once via scripts/gdrive-get-refresh-token.mjs
//   GDRIVE_FOLDER_ID           - a normal My Drive folder id (no sharing step needed —
//                                it's the same account the refresh token authorizes)
// Optional:
//   BACKUP_RETENTION_DAYS      - delete backups older than this many days (default 30)
//
// One-time Google Cloud + OAuth setup is documented in
// docs/supabase-to-university-server-cutover.md under "Backups".
//
// Safe to run manually too: node scripts/backup-db.mjs (reads the same env vars).

import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { createWriteStream, createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { drive as driveApi } from "@googleapis/drive";
import { OAuth2Client } from "google-auth-library";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const GDRIVE_OAUTH_CLIENT_ID = process.env.GDRIVE_OAUTH_CLIENT_ID;
const GDRIVE_OAUTH_CLIENT_SECRET = process.env.GDRIVE_OAUTH_CLIENT_SECRET;
const GDRIVE_OAUTH_REFRESH_TOKEN = process.env.GDRIVE_OAUTH_REFRESH_TOKEN;
for (const [name, value] of Object.entries({
  GDRIVE_OAUTH_CLIENT_ID,
  GDRIVE_OAUTH_CLIENT_SECRET,
  GDRIVE_OAUTH_REFRESH_TOKEN,
})) {
  if (!value) {
    throw new Error(`${name} not set - see docs/supabase-to-university-server-cutover.md#backups for one-time setup`);
  }
}

const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
if (!GDRIVE_FOLDER_ID) throw new Error("GDRIVE_FOLDER_ID not set");

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = `activecamtdb-${timestamp}.sql.gz`;
const tmpPath = `/tmp/${filename}`;

async function dumpToFile() {
  const child = spawn("pg_dump", [DATABASE_URL, "--no-owner", "--no-privileges"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exit = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))));
  });
  await Promise.all([pipeline(child.stdout, createGzip(), createWriteStream(tmpPath)), exit]);
}

function driveClient() {
  const auth = new OAuth2Client(GDRIVE_OAUTH_CLIENT_ID, GDRIVE_OAUTH_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GDRIVE_OAUTH_REFRESH_TOKEN });
  return driveApi({ version: "v3", auth });
}

async function uploadAndPrune(drive) {
  await drive.files.create({
    requestBody: { name: filename, parents: [GDRIVE_FOLDER_ID] },
    media: { mimeType: "application/gzip", body: createReadStream(tmpPath) },
    fields: "id",
  });
  console.log(`[backup-db] uploaded ${filename}`);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data } = await drive.files.list({
    q: `'${GDRIVE_FOLDER_ID}' in parents and name contains 'activecamtdb-' and createdTime < '${cutoff}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1000,
  });
  for (const file of data.files ?? []) {
    await drive.files.delete({ fileId: file.id });
    console.log(`[backup-db] pruned old backup ${file.name}`);
  }
}

try {
  console.log(`[backup-db] dumping database`);
  await dumpToFile();
  console.log(`[backup-db] uploading to Drive folder ${GDRIVE_FOLDER_ID}`);
  await uploadAndPrune(driveClient());
  console.log(`[backup-db] done`);
} finally {
  await unlink(tmpPath).catch(() => {});
}
