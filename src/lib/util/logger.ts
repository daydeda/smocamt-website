// Structured JSON logging + a single error-capture chokepoint for ActiveCAMT.
//
// Why a small in-house logger (not pino / the Sentry SDK):
//  - We self-host ONE Next container behind nginx, and Docker already captures
//    stdout — structured JSON lines are queryable by any log collector with zero new
//    runtime dependencies and no edge-runtime caveats.
//  - The heavy Sentry Next SDK's support for Next 16 is still catching up; wiring it
//    in could break the build. Instead, error monitoring funnels through ONE function
//    (`captureException`) so we can later point it at a self-hosted GlitchTip/Sentry
//    or a Discord/Slack webhook WITHOUT touching any call site.
//
// PDPA: logs must NEVER leak medical detail, contact info, or auth secrets. Every
// context object is deep-redacted by key name before it is emitted or alerted.
//
// Use this from Node runtime code (route handlers, services) — NOT from the edge
// proxy (src/proxy.ts runs on the edge runtime).

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) || "info"] ?? LEVELS.info;

// Keys whose values are PDPA-sensitive or secret — redacted anywhere they appear in
// a logged context object (case-insensitive, at any depth). Mirrors the medical /
// contact fields gated elsewhere plus auth material.
const REDACT_KEYS = new Set([
  // Medical detail (admin-only; never log the values)
  "chronicdiseases", "medicalhistory", "drugallergies", "foodallergies",
  "dietaryrestrictions", "emergencymedication", "faintinghistory", "medscheckoption",
  // Contact / identity
  "emergencycontacts", "phone", "email",
  // Auth + tokens
  "qrtoken", "rawtoken", "token", "password", "authorization", "cookie",
  "authsecret", "auth_secret", "secret", "dsn",
]);

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, seen);
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context ? { ctx: redact(context) } : {}),
  });
  // Route to the matching console method so existing Docker/stderr handling is kept.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};

async function sendAlert(webhook: string, err: Error, context?: Record<string, unknown>) {
  const summary = `🚨 ActiveCAMT error: ${err.name}: ${err.message}`;
  // Discord incoming webhooks expect { content }; everything else gets a generic
  // JSON envelope (works for Slack-compatible and custom collectors).
  const isDiscord = webhook.includes("discord.com/api/webhooks");
  const body = isDiscord
    ? { content: `${summary}\n\`\`\`${(err.stack || "").slice(0, 1500)}\`\`\`` }
    : {
        text: summary,
        error: { name: err.name, message: err.message, stack: err.stack },
        context: context ? redact(context) : undefined,
      };
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Never let a slow/unreachable webhook hang the request path.
    signal: AbortSignal.timeout(3000),
  });
}

// Single chokepoint for unexpected errors. ALWAYS emits a structured error log; if an
// alert sink is configured (ERROR_WEBHOOK_URL — a Discord/Slack incoming webhook or
// any JSON endpoint), it also fires a redacted, fire-and-forget alert so the team
// learns about prod failures without scraping logs. Never throws — error reporting
// must not itself break the request.
export function captureException(error: unknown, context?: Record<string, unknown>) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(err.message || "Unhandled error", {
    ...context,
    error: { name: err.name, message: err.message, stack: err.stack },
  });

  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (webhook) {
    void sendAlert(webhook, err, context).catch(() => {
      // Swallow: alerting is best-effort and must not affect the request.
    });
  }
}
