import { db } from "@/db";
import { clubs, eventProposals } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { and, desc, eq } from "drizzle-orm";

// Thrown inside the transaction when the proposal was already resolved by a
// concurrent request between the pre-check and the update (double-click, or
// staff creating the linked event at the same moment — see the proposalId
// linkage in POST /api/admin/events).
export class AlreadyResolvedError extends Error {}

export type ProposalContentInput = {
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  registrationOpenTime?: string | null;
  registrationCloseTime?: string | null;
  location?: string | null;
  quota?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  walkInsEnabled?: boolean;
  walkInsOnly?: boolean;
  quotaWalkIn?: number | null;
  registrationMode?: "once" | "per_session";
  sessions?: { title?: string | null; startTime: string; endTime: string }[] | null;
  targetThai?: boolean;
  targetInternational?: boolean;
  quotaThai?: number | null;
  quotaInternational?: number | null;
  firstYearOnly?: boolean;
  allowedRoles?: string[] | null;
  allowedMajors?: string[] | null;
  allowedClubs?: string[] | null;
};

export type ProposalCreateInput = ProposalContentInput & {
  clubId?: string;
  majorCode?: string;
};

export class EventProposalsService {
  /**
   * Resolves the club ids a club_president may propose for — reuses
   * EventScopeService.getPresidentScope so "which clubs can I act on" stays a
   * single source of truth shared with event ownership scoping.
   */
  static async getSubmittableClubIds(userId: string, roles: string[]): Promise<string[]> {
    const scope = await EventScopeService.getPresidentScope(userId, roles);
    return scope.clubIds;
  }

  /**
   * Resolves the major code(s) a major_president may propose for — same
   * scope object as above, just the majors[] side of it. In practice this is
   * at most one major (a president's own users.major), but returned as a list
   * to mirror getSubmittableClubIds's shape.
   */
  static async getSubmittableMajors(userId: string, roles: string[]): Promise<string[]> {
    const scope = await EventScopeService.getPresidentScope(userId, roles);
    return scope.majors;
  }

  /**
   * Lists proposals for a viewer: staff (isStaff=true) see everything,
   * optionally filtered by status; a club_president sees only proposals for
   * clubs they preside over, a major_president only proposals for their own
   * major. Never trusts a client-supplied scope — always re-resolves it from
   * the viewer's own userId/roles.
   *
   * `type`, when passed ('club' | 'major'), further restricts the result to
   * only club-owned or only major-owned rows. This exists because a single
   * user can hold BOTH club_president and major_president roles at once —
   * without this, /admin/clubs's club-only UI and /admin/majors's major-only
   * UI would otherwise both call the same unfiltered endpoint and end up
   * showing each other's proposals mixed in (a club row has no `club`
   * relation to render on the majors page and vice versa).
   */
  static async listForViewer(userId: string, roles: string[], isStaff: boolean, status?: string | null, type?: string | null) {
    const scope = isStaff ? null : await EventScopeService.getPresidentScope(userId, roles);
    if (!isStaff && scope!.clubIds.length === 0 && scope!.majors.length === 0) return [];

    const rows = await db.query.eventProposals.findMany({
      where: status ? eq(eventProposals.status, status) : undefined,
      orderBy: [desc(eventProposals.createdAt)],
      with: {
        club: { columns: { id: true, name: true, isArchived: true } },
        proposer: { columns: { id: true, name: true, studentId: true } },
        reviewer: { columns: { id: true, name: true } },
      },
    });

    // No pagination for v1 — mirrors the existing /api/admin/appeals precedent
    // of fetch-all + client-side paging at this data volume. A row is either
    // club-owned or major-owned (clubId/majorCode are mutually exclusive, see
    // schema.ts), so exactly one of these two checks can ever match.
    const scoped = isStaff
      ? rows
      : rows.filter((r) =>
          (r.clubId != null && scope!.clubIds.includes(r.clubId)) ||
          (r.majorCode != null && scope!.majors.includes(r.majorCode))
        );

    if (type === "club") return scoped.filter((r) => r.clubId != null);
    if (type === "major") return scoped.filter((r) => r.majorCode != null);
    return scoped;
  }

  /** Is this clubId one the given president may act on? Never trust a client-sent clubId. */
  static async isClubInScope(userId: string, roles: string[], clubId: string): Promise<boolean> {
    const clubIds = await EventProposalsService.getSubmittableClubIds(userId, roles);
    return clubIds.includes(clubId);
  }

  /** Is this majorCode one the given president may act on? Never trust a client-sent majorCode. */
  static async isMajorInScope(userId: string, roles: string[], majorCode: string): Promise<boolean> {
    const majors = await EventProposalsService.getSubmittableMajors(userId, roles);
    return majors.includes(majorCode);
  }

  static async getClub(clubId: string) {
    return db.query.clubs.findFirst({ where: eq(clubs.id, clubId), columns: { id: true, name: true, isArchived: true } });
  }

  /** One proposal with its club/proposer/reviewer relations (staff single-record fetch). */
  static async getProposalDetail(id: string) {
    return db.query.eventProposals.findFirst({
      where: eq(eventProposals.id, id),
      with: {
        club: { columns: { id: true, name: true, isArchived: true } },
        proposer: { columns: { id: true, name: true, studentId: true } },
        reviewer: { columns: { id: true, name: true } },
      },
    });
  }

  /** The minimal proposal columns the PATCH pre-checks need. */
  static async getProposalForAction(id: string) {
    return db.query.eventProposals.findFirst({
      where: eq(eventProposals.id, id),
      columns: { id: true, proposedBy: true, status: true, title: true, clubId: true, majorCode: true },
    });
  }

  /**
   * Inserts a new proposal and its audit log in one transaction and returns the
   * created row. `staffUserIds` is the already-sanitised suggested staff list.
   */
  static async createProposal(
    data: ProposalCreateInput,
    staffUserIds: string[] | null,
    proposerId: string,
    ipAddress: string,
  ) {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .insert(eventProposals)
        .values({
          clubId: data.clubId ?? null,
          majorCode: data.majorCode ?? null,
          proposedBy: proposerId,
          title: data.title,
          description: data.description,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
          registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
          location: data.location,
          quota: data.quota,
          imageUrl: data.imageUrls?.[0] ?? data.imageUrl ?? null,
          imageUrls: data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : null),
          walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
          walkInsOnly: data.walkInsOnly ?? false,
          quotaWalkIn: data.quotaWalkIn,
          registrationMode: data.registrationMode ?? "once",
          sessions: data.sessions && data.sessions.length > 0
            ? data.sessions.map((s) => ({ title: s.title?.trim() || null, startTime: s.startTime, endTime: s.endTime }))
            : null,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          quotaThai: data.quotaThai,
          quotaInternational: data.quotaInternational,
          firstYearOnly: data.firstYearOnly ?? false,
          staffUserIds,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
        })
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId: proposerId,
        action: data.clubId
          ? `Submitted event proposal "${proposal.title}" for club ${data.clubId}`
          : `Submitted event proposal "${proposal.title}" for major ${data.majorCode}`,
        ipAddress,
      });

      return proposal;
    });
  }

  /**
   * Resubmits a REJECTED proposal: rewrites its content, flips it back to
   * pending and writes the audit log, in one transaction. Throws
   * AlreadyResolvedError if it is no longer in the 'rejected' state.
   */
  static async resubmitProposal(
    id: string,
    data: ProposalContentInput,
    staffUserIds: string[] | null,
    actorId: string,
    ipAddress: string,
  ) {
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(eventProposals)
        .set({
          title: data.title,
          description: data.description ?? null,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
          registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
          location: data.location ?? null,
          quota: data.quota ?? null,
          imageUrl: data.imageUrls?.[0] ?? data.imageUrl ?? null,
          imageUrls: data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : null),
          walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
          walkInsOnly: data.walkInsOnly ?? false,
          quotaWalkIn: data.quotaWalkIn ?? null,
          registrationMode: data.registrationMode ?? "once",
          sessions: data.sessions && data.sessions.length > 0
            ? data.sessions.map((s) => ({ title: s.title?.trim() || null, startTime: s.startTime, endTime: s.endTime }))
            : null,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          quotaThai: data.quotaThai ?? null,
          quotaInternational: data.quotaInternational ?? null,
          firstYearOnly: data.firstYearOnly ?? false,
          staffUserIds,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
          // Back to pending for staff to re-review; the prior rejection's
          // reviewer/note is cleared (the audit log below is the permanent
          // record of it, not this row).
          status: "pending",
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          updatedAt: new Date(),
        })
        .where(and(eq(eventProposals.id, id), eq(eventProposals.status, "rejected")))
        .returning({ id: eventProposals.id });

      if (!updated) {
        throw new AlreadyResolvedError();
      }

      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Resubmitted event proposal "${data.title}" (${id}) after rejection`,
        ipAddress,
      });
    });
  }

  /**
   * Rejects (staff) or withdraws (proposer) a PENDING proposal and writes the
   * audit log in one transaction. Throws AlreadyResolvedError if it is no
   * longer pending.
   */
  static async resolveProposal(params: {
    id: string;
    action: "reject" | "withdraw";
    newStatus: string;
    reviewNote?: string | null;
    title: string;
    reviewerId: string;
    ipAddress: string;
  }) {
    const { id, action, newStatus, reviewNote, title, reviewerId, ipAddress } = params;
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(eventProposals)
        .set({
          status: newStatus,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(eventProposals.id, id), eq(eventProposals.status, "pending")))
        .returning({ id: eventProposals.id });

      if (!updated) {
        throw new AlreadyResolvedError();
      }

      await AuditService.logActionInternal(tx, {
        actorId: reviewerId,
        action: `${action === "reject" ? "Rejected" : "Withdrew"} event proposal "${title}" (${id})`,
        ipAddress,
      });
    });
  }
}
