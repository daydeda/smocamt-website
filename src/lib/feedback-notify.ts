// Out-of-band alert channel for Feedback & Complaints (decided 2026-08-13 —
// see docs/features/feedback-complaints.md §5.1/§8/§10). Two directions:
//  - staff-facing: every new submission, status resolve, and submitter
//    message emails the shared staff inbox smocamt.official@camt.info via
//    SMTP (that mailbox's own app password — no third-party transactional-
//    email vendor, to avoid adding a new external processor to a
//    PDPA-sensitive app that already went self-hosted specifically to
//    minimize third parties).
//  - submitter-facing: a staff reply also emails the submitter, but ONLY at
//    the voluntary contact address they opted into (contactOptIn/
//    contactInfo — see schema.ts's feedbackComplaints.contactInfo comment
//    and docs §10) — never derived from anything else, since the row has no
//    other identity-bearing field by design.
//
// This is an interim channel until the app becomes a PWA with push
// notifications — every call below is narrow and swappable for a push send
// later without touching the submit/reply logic that calls them.
//
// Fail-open by design: an SMTP error is logged but never blocks or fails the
// request it's attached to (same principle as rate-limit.ts's fail-open
// behavior) — a notification channel must never become a reason a complaint
// or message fails to save.
import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

const STAFF_INBOX = "smocamt.official@camt.info";

// category/severity/status are plain `string` here, not the literal unions
// from feedback-token.ts: drizzle's `text()` columns come back as `string`
// from `.returning()`, and this interface only ever formats them into an
// email body, so widening avoids a cast at every call site for no real
// type-safety loss (an invalid value here just prints oddly, it can't
// misroute anything).
interface NotifyComplaint {
  id: string;
  category: string;
  severity: string;
  status: string;
  message: string;
}

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null | undefined;

// Lazily built + memoized so a missing config only logs once per process, not
// once per request. Explicitly re-read each cold start (e.g. after env vars
// change on redeploy) since module-level state resets with the process.
function getTransport() {
  if (cachedTransport !== undefined) return cachedTransport;
  const user = process.env.FEEDBACK_SMTP_USER;
  const pass = process.env.FEEDBACK_SMTP_PASS;
  if (!user || !pass) {
    logger.warn("feedback-notify: FEEDBACK_SMTP_USER/FEEDBACK_SMTP_PASS not set — notifications disabled");
    cachedTransport = null;
    return null;
  }
  const host = process.env.FEEDBACK_SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.FEEDBACK_SMTP_PORT || 465);
  cachedTransport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return cachedTransport;
}

// Non-identifying reference for cross-checking against the /admin/feedback
// queue: the first 8 hex chars of the row id. Deliberately never
// submitterRef — this function must never receive that value.
function shortRef(id: string): string {
  return id.slice(0, 8);
}

async function send(to: string, subject: string, text: string) {
  const transport = getTransport();
  if (!transport) return;
  try {
    await transport.sendMail({ from: process.env.FEEDBACK_SMTP_USER, to, subject, text });
  } catch (error) {
    logger.warn("feedback-notify: send failed", {
      subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function notifyNewComplaint(c: NotifyComplaint): Promise<void> {
  await send(
    STAFF_INBOX,
    `[ActiveCAMT] New ${c.severity} feedback — ${c.category}`,
    [
      `A new ${c.severity}-severity feedback/complaint was submitted.`,
      "",
      `Category: ${c.category}`,
      `Ref: ${shortRef(c.id)}`,
      "",
      "Message:",
      c.message,
      "",
      "Review it at /admin/feedback (filter by this ref).",
    ].join("\n"),
  );
}

export async function notifyComplaintResolved(c: NotifyComplaint): Promise<void> {
  await send(
    STAFF_INBOX,
    `[ActiveCAMT] Feedback ${c.status} — ${c.category} (${shortRef(c.id)})`,
    [
      `A feedback/complaint was marked "${c.status}".`,
      "",
      `Category: ${c.category}`,
      `Ref: ${shortRef(c.id)}`,
    ].join("\n"),
  );
}

// The SUBMITTER added a follow-up message — staff-facing only (they need to
// know to go look), never sent to the submitter (they just wrote it).
export async function notifySubmitterMessage(c: NotifyComplaint): Promise<void> {
  await send(
    STAFF_INBOX,
    `[ActiveCAMT] Submitter replied — ${c.category} (${shortRef(c.id)})`,
    [
      "The submitter added a follow-up message on a feedback/complaint.",
      "",
      `Category: ${c.category}`,
      `Ref: ${shortRef(c.id)}`,
      "",
      "Review it at /admin/feedback (filter by this ref).",
    ].join("\n"),
  );
}

// STAFF added a message — notify the submitter, but ONLY if they voluntarily
// opted into a contact address (contactEmail is null/undefined otherwise —
// see docs §10's "only email the voluntary contact field" decision). A
// no-op when contactEmail is absent; the submitter still sees the reply via
// self-service (/feedback/track) either way.
export async function notifyStaffMessage(c: NotifyComplaint, replyBody: string, contactEmail?: string | null): Promise<void> {
  if (!contactEmail) return;
  await send(
    contactEmail,
    "[ActiveCAMT] Staff replied to your feedback",
    [
      `Staff replied to your feedback/complaint (category: ${c.category}).`,
      "",
      replyBody,
      "",
      "You can also check this anytime by signing in and visiting My Feedback on ActiveCAMT.",
    ].join("\n"),
  );
}
