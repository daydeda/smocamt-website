import { db } from "@/db";
import { forms } from "@/db/schema";
import { desc } from "drizzle-orm";

export class FormsService {
  /** All forms (newest first) with their submission ids, for the admin forms list. */
  static async listFormsWithSubmissions() {
    return db.query.forms.findMany({
      orderBy: [desc(forms.createdAt)],
      with: {
        submissions: {
          columns: {
            id: true
          }
        }
      }
    });
  }

  /** Inserts a new custom form and returns the created row. */
  static async createForm(values: typeof forms.$inferInsert) {
    const [newForm] = await db.insert(forms).values(values).returning();
    return newForm;
  }
}
