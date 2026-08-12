// Business logic for Anonymous Feedback & Complaints. See
// docs/features/feedback-complaints.md for the full design — the property
// this file must never violate: no query here selects `submitterRef` into an
// admin-facing response, and no function accepts a raw userId from anywhere
// other than the caller's own authenticated session.
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { feedbackComplaintMessages, feedbackComplaints } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import {
  CATEGORY_DEFAULT_SEVERITY,
  computeSubmitterRef,
  isEmailLike,
  type FeedbackCategory,
  type FeedbackSeverity,
  type FeedbackStatus,
} from "@/lib/feedback-token";
import { notifyComplaintResolved, notifyNewComplaint, notifyStaffMessage, notifySubmitterMessage } from "@/lib/feedback-notify";

export interface CreateComplaintInput {
  /** The logged-in user's own id. Used ONLY to derive submitterRef via HMAC —
   * never stored or returned raw, never passed anywhere else. */
  submitterId: string;
  category: FeedbackCategory;
  message: string;
  contactOptIn: boolean;
  contactInfo?: string | null;
  attachmentKeys?: string[];
}

// Account-level abuse control, in addition to the IP rate-limit the route
// applies. 24h / 10 submissions is generous for a genuine reporter (multiple
// distinct concerns in a day is plausible) while bounding a compromised or
// scripted account.
const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DAILY_SUBMISSION_LIMIT = 10;

// Shared between listMine and listForAdmin so the two surfaces render the
// same shape of message. staffUserId is deliberately excluded from BOTH —
// neither the submitter nor the admin queue needs to know WHICH staff
// member replied, just that staff did; it's tracked internally (see
// postStaffMessage's audit log) for accountability, not surfaced here.
const MESSAGE_COLUMNS = {
  id: true,
  senderType: true,
  body: true,
  createdAt: true,
} as const;

const ADMIN_LIST_COLUMNS = {
  id: true,
  category: true,
  severity: true,
  message: true,
  contactOptIn: true,
  contactInfo: true,
  attachmentKeys: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // submitterRef is deliberately NOT listed — see the file-level comment and
  // schema.ts's feedbackComplaints.submitterRef doc comment.
} as const;

export class FeedbackService {
  /** How many submissions has this account made in the last 24h — via the
   * keyed-hash reference, never a raw userId join. */
  static async accountSubmissionCountRecent(userId: string): Promise<number> {
    const ref = computeSubmitterRef(userId);
    const since = new Date(Date.now() - ABUSE_WINDOW_MS);
    const rows = await db
      .select({ id: feedbackComplaints.id })
      .from(feedbackComplaints)
      .where(and(eq(feedbackComplaints.submitterRef, ref), gte(feedbackComplaints.createdAt, since)));
    return rows.length;
  }

  static async createComplaint(input: CreateComplaintInput) {
    const submitterRef = computeSubmitterRef(input.submitterId);
    // harassment_safety is always 'urgent' at creation — CATEGORY_DEFAULT_SEVERITY
    // is authoritative here; a submitter-supplied severity is never accepted.
    const severity = CATEGORY_DEFAULT_SEVERITY[input.category];

    const [row] = await db
      .insert(feedbackComplaints)
      .values({
        category: input.category,
        severity,
        message: input.message,
        contactOptIn: input.contactOptIn,
        contactInfo: input.contactOptIn ? input.contactInfo || null : null,
        attachmentKeys: input.attachmentKeys ?? [],
        submitterRef,
      })
      .returning({
        id: feedbackComplaints.id,
        category: feedbackComplaints.category,
        severity: feedbackComplaints.severity,
        status: feedbackComplaints.status,
        message: feedbackComplaints.message,
      });

    // Fire-and-forget: notification failures must never fail the submission
    // (feedback-notify.ts is itself fail-open, this is belt-and-suspenders).
    void notifyNewComplaint(row).catch(() => {});

    return { id: row.id };
  }

  /**
   * The CALLING user's own submissions (with their full message thread),
   * matched via their own re-derived submitterRef. Safe under the anonymity
   * model in docs §5: the lookup key is computed here from `userId`, which
   * every call site derives from the caller's OWN session (never a
   * client-supplied id — see GET /api/feedback/mine) — there is no path for
   * anyone, including an admin, to use this to look up someone else's
   * submissions. This is exactly as self-scoped as "my orders" on the shop;
   * it doesn't weaken the admin-facing guarantee at all, since nothing here
   * is admin-facing.
   *
   * This is the ONLY way a submitter ever checks status/reply — there is no
   * separate tracking-code path (dropped 2026-08-13, docs §7.0/§8): as long
   * as they're signed into the same account, their history is always here.
   */
  static async listMine(userId: string) {
    const submitterRef = computeSubmitterRef(userId);
    return db.query.feedbackComplaints.findMany({
      where: eq(feedbackComplaints.submitterRef, submitterRef),
      orderBy: [desc(feedbackComplaints.createdAt)],
      columns: {
        id: true,
        category: true,
        severity: true,
        status: true,
        message: true,
        createdAt: true,
      },
      with: {
        messages: { orderBy: [asc(feedbackComplaintMessages.createdAt)], columns: MESSAGE_COLUMNS },
      },
    });
  }

  /**
   * Submitter closes their OWN resolved complaint, archiving it as history
   * (docs §7.0). Ownership is verified via submitterRef match (never a raw
   * userId/FK comparison) and the transition is restricted to
   * resolved -> closed ONLY, enforced in the WHERE clause itself (not just
   * checked-then-trusted) — a submitter can't skip a complaint straight from
   * new/in_review to closed, so something staff hasn't actually acted on yet
   * can't be prematurely hidden from the admin queue.
   *
   * Deliberately NOT audit-logged. AuditService exists to trail STAFF access
   * to someone else's data — this is the submitter acting on their own
   * resource. Logging their userId against this complaint's id would itself
   * BE a re-identification leak: audit_logs is admin-visible
   * (/admin/audit-logs), so an admin could join "user X closed complaint Y"
   * against the complaint contents they already see in /admin/feedback and
   * learn that user X submitted it — exactly what §5's architecture exists
   * to prevent.
   */
  static async closeMine(userId: string, complaintId: string) {
    const submitterRef = computeSubmitterRef(userId);
    const [row] = await db
      .update(feedbackComplaints)
      .set({ status: "closed", updatedAt: new Date() })
      .where(and(
        eq(feedbackComplaints.id, complaintId),
        eq(feedbackComplaints.submitterRef, submitterRef),
        eq(feedbackComplaints.status, "resolved"),
      ))
      .returning({ id: feedbackComplaints.id, status: feedbackComplaints.status });
    return row ?? null;
  }

  /**
   * Submitter posts a follow-up message on their OWN complaint (docs §10).
   * Ownership-checked via submitterRef, same pattern as closeMine — and same
   * reasoning for NOT audit-logging it (their own action on their own
   * resource; logging their userId against this complaint would itself leak
   * who submitted it via /admin/audit-logs). Blocked once a complaint is
   * 'closed' — that's the final state, reopening it via a message would
   * defeat the point of closing. A message on a 'resolved' complaint bumps
   * it back to 'in_review' so it resurfaces in the admin queue instead of
   * silently sitting in a "done" bucket staff has stopped checking.
   */
  static async postSubmitterMessage(userId: string, complaintId: string, body: string) {
    const submitterRef = computeSubmitterRef(userId);
    const complaint = await db.query.feedbackComplaints.findFirst({
      where: and(eq(feedbackComplaints.id, complaintId), eq(feedbackComplaints.submitterRef, submitterRef)),
      columns: { id: true, category: true, severity: true, status: true, message: true },
    });
    if (!complaint || complaint.status === "closed") return null;

    const [msg] = await db
      .insert(feedbackComplaintMessages)
      .values({ complaintId, senderType: "submitter", body })
      .returning({ id: feedbackComplaintMessages.id, senderType: feedbackComplaintMessages.senderType, body: feedbackComplaintMessages.body, createdAt: feedbackComplaintMessages.createdAt });

    if (complaint.status === "resolved") {
      await db.update(feedbackComplaints).set({ status: "in_review", updatedAt: new Date() }).where(eq(feedbackComplaints.id, complaintId));
    }

    void notifySubmitterMessage(complaint).catch(() => {});

    return msg;
  }

  /**
   * Staff posts a message on ANY complaint (no ownership scoping — that's
   * the point of the admin surface). Wraps the insert + audit write in ONE
   * transaction, per this project's standard admin-route pattern. Notifies
   * the submitter's voluntary contact address if they opted in and it looks
   * like an email (docs §10's "only email the voluntary contact field"
   * decision) — never derived from anything else.
   */
  static async postStaffMessage(complaintId: string, staffUserId: string, body: string, req: Request) {
    const result = await db.transaction(async (tx) => {
      const complaint = await tx.query.feedbackComplaints.findFirst({
        where: eq(feedbackComplaints.id, complaintId),
        columns: { id: true, category: true, severity: true, status: true, message: true, contactOptIn: true, contactInfo: true },
      });
      if (!complaint) return null;

      const [msg] = await tx
        .insert(feedbackComplaintMessages)
        .values({ complaintId, senderType: "staff", staffUserId, body })
        .returning({ id: feedbackComplaintMessages.id, senderType: feedbackComplaintMessages.senderType, body: feedbackComplaintMessages.body, createdAt: feedbackComplaintMessages.createdAt });

      await AuditService.logActionInternal(tx, {
        actorId: staffUserId,
        targetId: complaintId,
        action: "Feedback complaint message added",
        ipAddress: getClientIp(req),
      });

      return { msg, complaint };
    });
    if (!result) return null;

    const contactEmail = result.complaint.contactOptIn && result.complaint.contactInfo && isEmailLike(result.complaint.contactInfo)
      ? result.complaint.contactInfo
      : null;
    void notifyStaffMessage(result.complaint, body, contactEmail).catch(() => {});

    return result.msg;
  }

  /** Admin triage list (with full message threads). NEVER selects
   * submitterRef — see ADMIN_LIST_COLUMNS. */
  static async listForAdmin(filters: { status?: FeedbackStatus; category?: FeedbackCategory; severity?: FeedbackSeverity }) {
    const conditions = [];
    if (filters.status) conditions.push(eq(feedbackComplaints.status, filters.status));
    if (filters.category) conditions.push(eq(feedbackComplaints.category, filters.category));
    if (filters.severity) conditions.push(eq(feedbackComplaints.severity, filters.severity));

    return db.query.feedbackComplaints.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(feedbackComplaints.createdAt)],
      columns: ADMIN_LIST_COLUMNS,
      with: {
        messages: { orderBy: [asc(feedbackComplaintMessages.createdAt)], columns: MESSAGE_COLUMNS },
      },
    });
  }

  /**
   * Admin update: status / severity ONLY — replying is now a separate action
   * (postStaffMessage above; the old single adminReply field is gone, see
   * schema.ts). Wraps the mutation + audit write in ONE transaction (this
   * project's standard admin-route pattern — see
   * .claude/skills/new-admin-route), so a failed audit append can never
   * leave the mutation applied without a trail. Fires the resolve
   * notification when status moves to 'resolved'.
   */
  static async updateComplaint(
    id: string,
    changes: { status?: FeedbackStatus; severity?: FeedbackSeverity },
    adminUserId: string,
    req: Request,
  ) {
    const values: Partial<typeof feedbackComplaints.$inferInsert> = { updatedAt: new Date() };
    if (changes.status) values.status = changes.status;
    if (changes.severity) values.severity = changes.severity;

    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(feedbackComplaints)
        .set(values)
        .where(eq(feedbackComplaints.id, id))
        .returning({
          id: feedbackComplaints.id,
          category: feedbackComplaints.category,
          severity: feedbackComplaints.severity,
          status: feedbackComplaints.status,
          message: feedbackComplaints.message,
        });
      if (!updated) return null;

      const changeDescriptors = [
        changes.status ? `status→${changes.status}` : null,
        changes.severity ? `severity→${changes.severity}` : null,
      ].filter(Boolean);

      await AuditService.logActionInternal(tx, {
        actorId: adminUserId,
        targetId: id,
        action: `Feedback complaint updated: ${changeDescriptors.join(", ")}`,
        ipAddress: getClientIp(req),
      });

      return updated;
    });
    if (!row) return null;

    if (changes.status === "resolved") {
      void notifyComplaintResolved(row).catch(() => {});
    }

    return row;
  }
}
