import { db } from "@/db";

export class ActivityService {
  /** Latest genuine check-ins (with student + event) for the admin activity feed. */
  static async listRecentCheckins() {
    return db.query.attendance.findMany({
      limit: 100, // Show more for "View All"
      // Only genuine check-ins. Registration rows have checkInTime = null, and
      // `ORDER BY ... DESC` is NULLS FIRST in Postgres, so without this filter
      // those un-checked-in rows sort to the top and fall back to new Date()
      // below — making every entry show the current time.
      where: (attendance, { isNotNull }) => isNotNull(attendance.checkInTime),
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
      with: {
        user: { columns: { name: true, nickname: true, studentId: true } },
        event: { columns: { title: true } },
      },
    });
  }

  /** Latest house score changes (with house) for the admin activity feed. */
  static async listRecentScores() {
    return db.query.scoreHistory.findMany({
      limit: 100,
      orderBy: (scoreHistory, { desc }) => [desc(scoreHistory.timestamp)],
      with: {
        house: { columns: { id: true, name: true, color: true } },
      },
    });
  }
}
