/**
 * Seeds ONE local test student for eyeballing the 3-month profile check-in modal
 * (src/components/ProfileReviewModal.tsx on /dashboard/profile).
 * Run with: npm run db:seed:test-student
 *
 * Complete profile (personal + medical + emergency contacts), profile_reviewed_at
 * left NULL so the modal shows on the first visit. Idempotent: keyed on email, so a
 * re-run resets the same row to the never-reviewed state instead of adding another.
 * Fake data only. LOCAL ONLY: refuses anything that isn't a localhost DB, with no
 * CONFIRM override (unlike guard.ts's assertDestructiveAllowed).
 */
import { db } from "./index";
import { houses, users } from "./schema";
import { eq } from "drizzle-orm";
import { isRemoteDatabase } from "./guard";

export const TEST_STUDENT_EMAIL = "review-test.student@localhost.test";

// The self-hosted prod DB host is the docker service name ("db"), which guard.ts's
// remote-DB regex does not match, so allow-list local hosts instead of deny-listing.
function assertLocalOnly() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // pglite / unset DATABASE_URL: handled below
  }
  const usingPglite = process.env.DB_TYPE === "pglite";
  const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (
    process.env.NODE_ENV === "production" ||
    isRemoteDatabase(url) ||
    (!usingPglite && !localHost)
  ) {
    console.error(
      `\n⛔ Refusing to seed a test student: not a local development database.\n` +
        `   DATABASE_URL host: ${host || "(unset/unparseable)"}  NODE_ENV: ${process.env.NODE_ENV ?? "(unset)"}\n` +
        `   Use the local DB: npm run db:seed:test-student (reads .env.local).\n`
    );
    process.exit(1);
  }
}

async function seedTestStudent() {
  assertLocalOnly();

  // users.house_id is a foreign key; `npm run db:seed` creates the houses.
  const house = await db.query.houses.findFirst({ where: eq(houses.id, "red") });
  if (!house) {
    console.error("❌ House 'red' not found. Run `npm run db:seed` against the local DB first.");
    process.exit(1);
  }

  const profile = {
    prefix: "นางสาว",
    name: "สมหญิง ใจดี",
    nickname: "มะลิ",
    studentId: "682110999", // chars 3-4 = "21" (CAMT); char 5 = "1" → base majors
    faculty: "CAMT",
    major: "SE",
    religion: "พุทธ",
    phone: "0991234567",
    contactChannels: "LINE: mali.test / IG: mali.test",
    chronicDiseases: "โรคหอบหืด (Asthma)",
    medicalHistory: "เคยเข้ารับการรักษาภาวะหอบเฉียบพลันเมื่อปี 2564",
    drugAllergies: "เพนิซิลลิน (Penicillin)",
    foodAllergies: "กุ้งและอาหารทะเลเปลือกแข็ง",
    dietaryRestrictions: "ไม่ทานเนื้อวัว",
    faintingHistory: true,
    emergencyMedication: "ยาพ่นขยายหลอดลม (Salbutamol) พกติดกระเป๋าเป้",
    emergencyContacts: [
      { name: "สมศรี ใจดี", relationship: "Mother", phone: "0812345670" },
      { name: "สมชาย ใจดี", relationship: "Father", phone: "0812345671" },
    ],
    pdpaConsent: true,
    profileCompleted: true,
    // The point of this script: never reviewed ⇒ the modal appears.
    profileReviewedAt: null,
    houseId: "red",
    role: "student",
    roles: ["student"],
  };

  const existing = await db.query.users.findFirst({
    where: eq(users.email, TEST_STUDENT_EMAIL),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(users)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    console.log(`♻️  Reset existing test student (${TEST_STUDENT_EMAIL}) to never-reviewed.`);
  } else {
    await db.insert(users).values({
      id: crypto.randomUUID(),
      email: TEST_STUDENT_EMAIL,
      qrToken: crypto.randomUUID(),
      ...profile,
    });
    console.log(`✅ Created test student (${TEST_STUDENT_EMAIL}).`);
  }

  console.log("   profile_reviewed_at = NULL → the check-in modal shows on /dashboard/profile");
  process.exit(0);
}

seedTestStudent().catch((err) => {
  console.error("❌ Seeding test student failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
