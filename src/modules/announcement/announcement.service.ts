import { db } from "@/db";
import { announcements } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { desc, eq } from "drizzle-orm";

export class AnnouncementService {
  /**
   * The singleton dashboard announcement ({ body, enabled }): the most-recently
   * updated row, or null if none exists.
   */
  static async getCurrent() {
    const [row] = await db
      .select({ body: announcements.body, enabled: announcements.enabled })
      .from(announcements)
      .orderBy(desc(announcements.updatedAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Upserts the singleton announcement and writes its audit log in one
   * transaction. Returns whether the body actually changed (or was newly
   * created) so the caller can decide whether to broadcast a push.
   */
  static async upsertSingleton(
    data: { body: string; enabled: boolean },
    actorId: string,
    ipAddress: string,
  ) {
    return db.transaction(async (tx) => {
      // Singleton: update the most-recently-updated row, or insert the first one.
      const [existing] = await tx
        .select({ id: announcements.id, body: announcements.body })
        .from(announcements)
        .orderBy(desc(announcements.updatedAt))
        .limit(1);

      if (existing) {
        await tx
          .update(announcements)
          .set({
            body: data.body,
            enabled: data.enabled,
            updatedBy: actorId,
            updatedAt: new Date(),
          })
          .where(eq(announcements.id, existing.id));
      } else {
        await tx.insert(announcements).values({
          body: data.body,
          enabled: data.enabled,
          updatedBy: actorId,
        });
      }

      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Updated dashboard announcement (enabled: ${data.enabled})`,
        ipAddress,
      });

      return !existing || existing.body !== data.body;
    });
  }
}
