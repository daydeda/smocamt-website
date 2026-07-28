/**
 * Database Seed Script
 * Run with: npx tsx src/db/seed.ts
 *
 * Seeds the 4 houses required for the Balanced House Assignment system (FE-03).
 * Must be run once after the initial `npm run db:push`.
 */
import { db } from "./index";
import { houses, users } from "./schema";
import { eq } from "drizzle-orm";
import { assertDestructiveAllowed } from "./guard";
import { ALL_HOUSE_ROWS } from "../lib/faculties";

// The 4 CAMT colour houses. ActiveCAMT is CAMT-only, so ids stay the bare
// colour ids ('red'…) — house_id foreign keys never move.
const HOUSES = ALL_HOUSE_ROWS.map(({ id, faculty, color }) => ({
  id,
  name: color.name,
  color: color.color,
  faculty,
  colorGroup: color.id,
}));

const SUPER_ADMINS = [
  { email: "smocamt.official@gmail.com", name: "SMO CAMT Official" },
  { email: "daydedaa@gmail.com", name: "Daydedaa Admin" },
];

async function seed() {
  assertDestructiveAllowed("db:seed (writes houses + super admins)");
  console.log("🌱 Seeding houses...");

  for (const house of HOUSES) {
    await db
      .insert(houses)
      .values({
        id: house.id,
        name: house.name,
        color: house.color,
        points: 0,
        faculty: house.faculty,
        colorGroup: house.colorGroup,
      })
      .onConflictDoUpdate({
        target: houses.id,
        // Never overwrite points on re-seed; only keep display/grouping in sync.
        set: { name: house.name, color: house.color, faculty: house.faculty, colorGroup: house.colorGroup }
      });
    console.log(`  ✅ House: ${house.faculty} / ${house.name}`);
  }

  console.log("🌱 Seeding super admins...");
  for (const admin of SUPER_ADMINS) {
    const existing = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, admin.email),
    });

    if (existing) {
      await db
        .update(users)
        .set({ role: "super_admin", profileCompleted: true })
        .where(eq(users.email, admin.email));
      console.log(`  ✅ Updated role to super_admin for: ${admin.email}`);
    } else {
      await db.insert(users).values({
        id: crypto.randomUUID(),
        name: admin.name,
        email: admin.email,
        role: "super_admin",
        profileCompleted: true,
        qrToken: crypto.randomUUID(),
      });
      console.log(`  ✅ Created new super_admin user: ${admin.email}`);
    }
  }

  console.log("✅ Seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
