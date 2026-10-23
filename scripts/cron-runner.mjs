// Scheduler for the /api/cron/* endpoints on the self-hosted deploy. vercel.json's
// crons only run on Vercel, so nothing called these routes after the move to Docker.
// Runs inside the `scheduler` service in docker-stack.yml, which reuses the app image
// purely as a timer (same trick as the `backup` service): no ports, no volumes.
//
// Both jobs are idempotent (award-points settles only events/forms that are due and
// not yet processed; gc-form-files deletes only orphaned files), so a restart that
// re-runs a job early is harmless.
//
// Required env (set in the Portainer stack's "Environment variables", never in git):
//   CRON_SECRET     - same value the `web` service gets; sent as a Bearer token
// Optional:
//   CRON_BASE_URL   - default http://web:3000 (the `web` service on the stack network)

const BASE_URL = (process.env.CRON_BASE_URL || "http://web:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;

const MINUTE = 60_000;
const JOBS = [
  // Event-winner house bonuses and closed-form awards: hourly so points land soon
  // after an event or form ends, instead of waiting for a once-a-day run.
  { path: "/api/cron/award-points", everyMs: 60 * MINUTE },
  // Orphaned form-upload sweep: daily housekeeping.
  { path: "/api/cron/gc-form-files", everyMs: 24 * 60 * MINUTE },
];

if (!SECRET) {
  console.error("[cron-runner] CRON_SECRET is not set; the cron endpoints would reject every call. Exiting.");
  process.exit(1);
}

async function run(job) {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${job.path}`, {
      headers: { authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(5 * MINUTE),
    });
    const body = (await res.text()).slice(0, 300);
    console.log(`[cron-runner] ${job.path} -> ${res.status} in ${Date.now() - startedAt}ms ${res.ok ? "" : body}`);
  } catch (err) {
    console.error(`[cron-runner] ${job.path} failed: ${err instanceof Error ? err.message : err}`);
  }
}

const lastRun = new Map();

async function tick() {
  const now = Date.now();
  for (const job of JOBS) {
    const last = lastRun.get(job.path) ?? 0;
    if (now - last >= job.everyMs) {
      lastRun.set(job.path, now);
      await run(job);
    }
  }
}

console.log(`[cron-runner] started; target ${BASE_URL}, jobs: ${JOBS.map((j) => j.path).join(", ")}`);
// Give `web` a moment to come up, then check once a minute for due jobs.
setTimeout(() => {
  tick();
  setInterval(tick, MINUTE);
}, 30_000);
