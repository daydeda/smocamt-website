import { db } from "@/db";
import { propertyTagGroups, propertyTags, users } from "@/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AuditService } from "../audit/audit.service";
import { effectiveRoles } from "@/lib/access/admin-access";
import { yearOfStudy } from "@/lib/access/event-access";
import { splitCombinedQrToken, verifyCrossAppQrToken, verifyQrToken } from "@/lib/qr/qr-token";
import { formatTagLabel, generateTagCode, maskPhone, seriesRoleMismatch } from "@/lib/property-tags/property-tag";

// Property tags (ป้ายทรัพย์สิน) — see docs/features/property-tags.md.
//
// The PDPA line this service holds: staff (canManagePropertyTags) see who owns a
// tag plus a masked phone to tell namesakes apart; everyone else who scans a
// sticker gets ONLY name, รหัสนักศึกษา, major and year (getPublicView). Nothing
// here reads medical, contact or emergency fields for display.

export interface TagOwner {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
  major: string | null;
}

export interface StaffTagView {
  id: string;
  code: string;
  series: string;
  serial: number;
  label: string;
  groupId: string;
  groupName: string;
  groupStatus: "open" | "archived";
  assignedAt: Date | null;
  owner: TagOwner | null;
}

export interface AssignWarnings {
  /** Other tags in the SAME group this student already owns (labels). */
  alreadyOwnsInGroup: string[];
  /** Role the tag's series hints at that the student doesn't hold, e.g. "smo". */
  seriesRoleMismatch: string | null;
}

export type AssignResult =
  | { status: "preview"; tag: StaffTagView; student: TagOwner; warnings: AssignWarnings }
  | { status: "success"; tag: StaffTagView }
  | { status: "not_found" | "student_not_found" | "changed" };

const ownerUser = alias(users, "owner_user");

function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, "\\$&");
}

export class PropertyTagsService {
  static async listGroups() {
    const rows = await db
      .select({
        id: propertyTagGroups.id,
        name: propertyTagGroups.name,
        description: propertyTagGroups.description,
        status: propertyTagGroups.status,
        createdAt: propertyTagGroups.createdAt,
        total: sql<number>`count(${propertyTags.id})::int`,
        assigned: sql<number>`count(${propertyTags.ownerUserId})::int`,
      })
      .from(propertyTagGroups)
      .leftJoin(propertyTags, eq(propertyTags.groupId, propertyTagGroups.id))
      .groupBy(propertyTagGroups.id)
      .orderBy(desc(propertyTagGroups.createdAt));
    return rows;
  }

  static async createGroup(input: { name: string; description: string | null }, actorId: string, ip: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(propertyTagGroups)
        .values({ name: input.name, description: input.description, createdBy: actorId })
        .returning({ id: propertyTagGroups.id });
      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Created property tag group "${input.name}" (${row.id})`,
        ipAddress: ip,
      });
      return row;
    });
  }

  static async updateGroup(
    id: string,
    patch: { name?: string; description?: string | null; status?: "open" | "archived" },
    actorId: string,
    ip: string,
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(propertyTagGroups)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(propertyTagGroups.id, id))
        .returning({ id: propertyTagGroups.id, name: propertyTagGroups.name });
      if (!row) return null;
      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Updated property tag group "${row.name}" (${id}): ${Object.keys(patch).join(", ")}`,
        ipAddress: ip,
      });
      return row;
    });
  }

  /**
   * Deletes a group and its (all empty) tags. Refused while any tag still has an
   * owner: that sticker is on a student's bag and must keep resolving, so staff
   * remove the owners first, or archive the group instead.
   */
  static async deleteGroup(id: string, actorId: string, ip: string): Promise<
    { status: "deleted"; tags: number } | { status: "has_assigned"; assigned: number } | { status: "not_found" }
  > {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .select({ name: propertyTagGroups.name })
        .from(propertyTagGroups)
        .where(eq(propertyTagGroups.id, id))
        .for("update")
        .limit(1);
      if (!group) return { status: "not_found" as const };
      const [counts] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          assigned: sql<number>`count(${propertyTags.ownerUserId})::int`,
        })
        .from(propertyTags)
        .where(eq(propertyTags.groupId, id));
      if (counts.assigned > 0) return { status: "has_assigned" as const, assigned: counts.assigned };
      await tx.delete(propertyTagGroups).where(eq(propertyTagGroups.id, id));
      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Deleted property tag group "${group.name}" (${id}) with ${counts.total} empty tags`,
        ipAddress: ip,
      });
      return { status: "deleted" as const, tags: counts.total };
    });
  }

  static async getGroup(id: string) {
    const [group] = await db.select().from(propertyTagGroups).where(eq(propertyTagGroups.id, id)).limit(1);
    if (!group) return null;
    const tags = await db
      .select({
        id: propertyTags.id,
        code: propertyTags.code,
        series: propertyTags.series,
        serial: propertyTags.serial,
        assignedAt: propertyTags.assignedAt,
        ownerId: propertyTags.ownerUserId,
        ownerName: ownerUser.name,
        ownerStudentId: ownerUser.studentId,
        ownerMajor: ownerUser.major,
      })
      .from(propertyTags)
      .leftJoin(ownerUser, eq(ownerUser.id, propertyTags.ownerUserId))
      .where(eq(propertyTags.groupId, id))
      .orderBy(asc(propertyTags.series), asc(propertyTags.serial));
    return { group, tags };
  }

  /**
   * Mint `count` new empty tags in `series`. Serials continue from the highest
   * one already used by that series in ANY group, so every printed label is
   * unique. The advisory lock serializes two staff generating the same series
   * at once; the unique (series, serial) index is the backstop.
   */
  static async generateTags(groupId: string, series: string, count: number, actorId: string, ip: string) {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .select({ id: propertyTagGroups.id, name: propertyTagGroups.name })
        .from(propertyTagGroups)
        .where(eq(propertyTagGroups.id, groupId))
        .limit(1);
      if (!group) return null;

      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`property_tags:${series}`}))`);
      const [{ maxSerial }] = await tx
        .select({ maxSerial: sql<number>`coalesce(max(${propertyTags.serial}), 0)::int` })
        .from(propertyTags)
        .where(eq(propertyTags.series, series));

      const codes = new Set<string>();
      while (codes.size < count) codes.add(generateTagCode());
      const values = [...codes].map((code, i) => ({ groupId, code, series, serial: maxSerial + i + 1 }));
      await tx.insert(propertyTags).values(values);

      const first = formatTagLabel(series, maxSerial + 1);
      const last = formatTagLabel(series, maxSerial + count);
      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Generated ${count} property tags ${first}…${last} in group "${group.name}" (${groupId})`,
        ipAddress: ip,
      });
      return { first, last, count };
    });
  }

  static async getTagByCode(code: string): Promise<StaffTagView | null> {
    const [row] = await db
      .select({
        id: propertyTags.id,
        code: propertyTags.code,
        series: propertyTags.series,
        serial: propertyTags.serial,
        groupId: propertyTags.groupId,
        groupName: propertyTagGroups.name,
        groupStatus: propertyTagGroups.status,
        assignedAt: propertyTags.assignedAt,
        ownerId: ownerUser.id,
        ownerName: ownerUser.name,
        ownerNickname: ownerUser.nickname,
        ownerStudentId: ownerUser.studentId,
        ownerMajor: ownerUser.major,
      })
      .from(propertyTags)
      .innerJoin(propertyTagGroups, eq(propertyTagGroups.id, propertyTags.groupId))
      .leftJoin(ownerUser, eq(ownerUser.id, propertyTags.ownerUserId))
      .where(eq(propertyTags.code, code))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      series: row.series,
      serial: row.serial,
      label: formatTagLabel(row.series, row.serial),
      groupId: row.groupId,
      groupName: row.groupName,
      groupStatus: row.groupStatus,
      assignedAt: row.assignedAt,
      owner: row.ownerId
        ? { id: row.ownerId, name: row.ownerName!, nickname: row.ownerNickname, studentId: row.ownerStudentId, major: row.ownerMajor }
        : null,
    };
  }

  /**
   * Staff-side student picker: name, nickname, รหัสนักศึกษา, phone or contact
   * channel. Phone/contact are MATCHED but never returned — only a masked
   * last-4 so two same-named students can be told apart.
   */
  static async searchStudents(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    const like = `%${escapeLike(q)}%`;
    const digits = q.replace(/\D/g, "");
    const conditions = [
      sql`${users.name} ILIKE ${like}`,
      sql`${users.nickname} ILIKE ${like}`,
      sql`${users.studentId} ILIKE ${like}`,
      sql`${users.contactChannels} ILIKE ${like}`,
    ];
    if (digits.length >= 4) {
      conditions.push(sql`regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`);
    }
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        major: users.major,
        phone: users.phone,
      })
      .from(users)
      .where(sql`(${sql.join(conditions, sql` OR `)})`)
      .orderBy(asc(users.name))
      .limit(10);
    return rows.map(({ phone, ...r }) => ({ ...r, phoneMasked: maskPhone(phone) }));
  }

  /**
   * Resolves a scanned Digital ID QR to the student it belongs to. Accepts only
   * the signed, short-lived tokens (never a raw user id or the legacy static
   * qrToken), so staff can't enumerate students by guessing ids. Unlike
   * check-in, it never auto-creates an account for an unknown Songsue student.
   */
  static async resolveStudentByDigitalId(token: string): Promise<TagOwner | null> {
    const { local, cross } = splitCombinedQrToken(token.trim());
    let userId = verifyQrToken(local);
    if (!userId && cross) {
      const email = verifyCrossAppQrToken(cross);
      if (email) {
        const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        userId = byEmail?.id ?? null;
      }
    }
    if (!userId) return null;
    const u = await this.loadStudent(userId);
    if (!u) return null;
    return { id: u.id, name: u.name, nickname: u.nickname, studentId: u.studentId, major: u.major };
  }

  private static async loadStudent(userId: string) {
    const [u] = await db
      .select({
        id: users.id,
        name: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        major: users.major,
        role: users.role,
        roles: users.roles,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u ?? null;
  }

  /**
   * preview: who it would go to + soft warnings (never blocks).
   * confirm: writes it. `expectedOwnerId` is what the staff member SAW on
   * screen; if someone else changed the tag in between, nothing is written
   * and "changed" comes back so they can rescan instead of silently
   * overwriting a colleague.
   */
  static async assign(params: {
    code: string;
    studentUserId: string;
    action: "preview" | "confirm";
    expectedOwnerId: string | null;
    actorId: string;
    ip: string;
  }): Promise<AssignResult> {
    const tag = await this.getTagByCode(params.code);
    if (!tag) return { status: "not_found" };
    const student = await this.loadStudent(params.studentUserId);
    if (!student) return { status: "student_not_found" };
    const owner: TagOwner = {
      id: student.id,
      name: student.name,
      nickname: student.nickname,
      studentId: student.studentId,
      major: student.major,
    };

    if (params.action === "preview") {
      const others = await db
        .select({ series: propertyTags.series, serial: propertyTags.serial })
        .from(propertyTags)
        .where(and(
          eq(propertyTags.groupId, tag.groupId),
          eq(propertyTags.ownerUserId, student.id),
          sql`${propertyTags.id} <> ${tag.id}`,
        ))
        .orderBy(asc(propertyTags.series), asc(propertyTags.serial));
      return {
        status: "preview",
        tag,
        student: owner,
        warnings: {
          alreadyOwnsInGroup: others.map((o) => formatTagLabel(o.series, o.serial)),
          seriesRoleMismatch: seriesRoleMismatch(tag.series, effectiveRoles(student.role, student.roles)),
        },
      };
    }

    const previous = tag.owner;
    const written = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(propertyTags)
        .set({ ownerUserId: student.id, assignedBy: params.actorId, assignedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(propertyTags.id, tag.id),
          params.expectedOwnerId ? eq(propertyTags.ownerUserId, params.expectedOwnerId) : isNull(propertyTags.ownerUserId),
        ))
        .returning({ id: propertyTags.id });
      if (!row) return false;
      await AuditService.logActionInternal(tx, {
        actorId: params.actorId,
        targetId: student.id,
        action: previous
          ? `Reassigned property tag ${tag.label} (${tag.code}, "${tag.groupName}") from ${previous.name} [${previous.studentId ?? previous.id}] to ${student.name} [${student.studentId ?? student.id}]`
          : `Assigned property tag ${tag.label} (${tag.code}, "${tag.groupName}") to ${student.name} [${student.studentId ?? student.id}]`,
        ipAddress: params.ip,
      });
      return true;
    });
    if (!written) return { status: "changed" };
    return { status: "success", tag: { ...tag, owner, assignedAt: new Date() } };
  }

  /** Empty the sticker again so it can be handed to someone else. */
  static async unassign(params: { code: string; expectedOwnerId: string; actorId: string; ip: string }) {
    const tag = await this.getTagByCode(params.code);
    if (!tag) return { status: "not_found" as const };
    if (!tag.owner || tag.owner.id !== params.expectedOwnerId) return { status: "changed" as const };
    const previous = tag.owner;
    const written = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(propertyTags)
        .set({ ownerUserId: null, assignedBy: null, assignedAt: null, updatedAt: new Date() })
        .where(and(eq(propertyTags.id, tag.id), eq(propertyTags.ownerUserId, params.expectedOwnerId)))
        .returning({ id: propertyTags.id });
      if (!row) return false;
      await AuditService.logActionInternal(tx, {
        actorId: params.actorId,
        targetId: previous.id,
        action: `Unassigned property tag ${tag.label} (${tag.code}, "${tag.groupName}") from ${previous.name} [${previous.studentId ?? previous.id}]`,
        ipAddress: params.ip,
      });
      return true;
    });
    if (!written) return { status: "changed" as const };
    return { status: "success" as const, tag: { ...tag, owner: null, assignedAt: null } };
  }

  /** Tags to print for a group, optionally only empty ones or one series. */
  static async getTagsForPrint(groupId: string, opts: { onlyUnassigned: boolean; series: string | null }) {
    const conditions = [eq(propertyTags.groupId, groupId)];
    if (opts.onlyUnassigned) conditions.push(isNull(propertyTags.ownerUserId));
    if (opts.series) conditions.push(eq(propertyTags.series, opts.series));
    return db
      .select({ code: propertyTags.code, series: propertyTags.series, serial: propertyTags.serial })
      .from(propertyTags)
      .where(and(...conditions))
      .orderBy(asc(propertyTags.series), asc(propertyTags.serial));
  }

  /**
   * What ANY signed-in viewer sees after scanning a sticker. Deliberately the
   * four fields agreed for PDPA — name, รหัสนักศึกษา, major, year — read live
   * from the owner's account, so a name change shows up immediately. Role is
   * never returned.
   */
  static async getPublicView(code: string, viewerId: string) {
    const [row] = await db
      .select({
        ownerId: propertyTags.ownerUserId,
        name: ownerUser.name,
        studentId: ownerUser.studentId,
        major: ownerUser.major,
      })
      .from(propertyTags)
      .leftJoin(ownerUser, eq(ownerUser.id, propertyTags.ownerUserId))
      .where(eq(propertyTags.code, code))
      .limit(1);
    if (!row) return { status: "not_found" as const };
    if (!row.ownerId || !row.name) return { status: "unassigned" as const };
    return {
      status: "assigned" as const,
      isMine: row.ownerId === viewerId,
      owner: {
        name: row.name,
        studentId: row.studentId,
        major: row.major,
        year: yearOfStudy(row.studentId),
      },
    };
  }

  /**
   * The signed-in student's own tags for "My Items". Keyed on the session
   * user id only — there is deliberately no way to ask for someone else's. No
   * code, no assigning staff member: just what the student needs to recognise
   * the item.
   */
  static async getMyTags(userId: string) {
    const rows = await db
      .select({
        series: propertyTags.series,
        serial: propertyTags.serial,
        groupName: propertyTagGroups.name,
        groupDescription: propertyTagGroups.description,
        assignedAt: propertyTags.assignedAt,
      })
      .from(propertyTags)
      .innerJoin(propertyTagGroups, eq(propertyTagGroups.id, propertyTags.groupId))
      .where(eq(propertyTags.ownerUserId, userId))
      .orderBy(desc(propertyTags.assignedAt));
    return rows.map((r) => ({ ...r, label: formatTagLabel(r.series, r.serial) }));
  }

  /** Series already used anywhere, for the generate form's suggestions. */
  static async listSeries() {
    const rows = await db
      .select({ series: propertyTags.series, maxSerial: sql<number>`max(${propertyTags.serial})::int` })
      .from(propertyTags)
      .groupBy(propertyTags.series)
      .orderBy(asc(propertyTags.series));
    return rows;
  }
}
