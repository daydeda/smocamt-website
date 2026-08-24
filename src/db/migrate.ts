/**
 * Incremental Migration Script
 * Adds new columns and tables introduced in this session.
 * Safe to run on an existing DB — uses IF NOT EXISTS and ADD COLUMN IF NOT EXISTS.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

async function migrate() {
  if (process.env.DB_TYPE === "pglite") {
    console.log("📦 Applying migrations to PGlite local database...");
    const client = new PGlite("./.pglite-data");
    const db = drizzle(client);
    await migratePglite(db, { migrationsFolder: "./drizzle" });
    await client.close();
    console.log("✅ PGlite migrations complete!");
    process.exit(0);
  }

  const connectionString = process.env.DATABASE_URL!;
  if (!connectionString) {
    console.error("❌ DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  // The Supabase transaction pooler (port 6543) runs in transaction mode and does
  // NOT support prepared statements — postgres-js must use the simple query
  // protocol there, or every DDL statement fails. Mirrors src/db/index.ts.
  const usingTransactionPooler = connectionString.includes(":6543");

  console.log("🔄 Applying incremental migration...");
  const sql = postgres(connectionString, { max: 1, prepare: !usingTransactionPooler });

  // 1. Add qr_token column to users (if not exists)
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS qr_token text UNIQUE
  `;
  console.log("  ✅ users.qr_token");

  // 2. Add pdpa_consent column to users
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pdpa_consent boolean DEFAULT false
  `;
  console.log("  ✅ users.pdpa_consent");

  // 3. Add color column to houses
  await sql`
    ALTER TABLE houses
    ADD COLUMN IF NOT EXISTS color text DEFAULT '#6366f1'
  `;
  console.log("  ✅ houses.color");

  // 4. Add points_awarded column to events
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS points_awarded integer DEFAULT 0
  `;
  console.log("  ✅ events.points_awarded");

  // 5. Create score_history table
  await sql`
    CREATE TABLE IF NOT EXISTS score_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      house_id text NOT NULL REFERENCES houses(id),
      event_id uuid REFERENCES events(id),
      delta integer NOT NULL,
      reason text NOT NULL,
      timestamp timestamp DEFAULT now()
    )
  `;
  console.log("  ✅ score_history table");

  // 6. Add position column to users
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS position text
  `;
  console.log("  ✅ users.position");

  // 7. Add image_transform column to users
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS image_transform jsonb
  `;
  console.log("  ✅ users.image_transform");

  // 8. Add emergency_medication column to users
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS emergency_medication text
  `;
  console.log("  ✅ users.emergency_medication");

  // 9. Add meds_check_option column to attendance
  await sql`
    ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS meds_check_option text
  `;
  console.log("  ✅ attendance.meds_check_option");

  // 10. Add unique constraints to users.name and users.phone
  try {
    await sql`
      ALTER TABLE users
      ADD CONSTRAINT users_name_unique UNIQUE (name)
    `;
    console.log("  ✅ users.name unique constraint");
  } catch (e) {
    console.log("  ⚠️ users.name unique constraint already exists or failed to apply (make sure there are no duplicates)");
  }

  try {
    await sql`
      ALTER TABLE users
      ADD CONSTRAINT users_phone_unique UNIQUE (phone)
    `;
    console.log("  ✅ users.phone unique constraint");
  } catch (e) {
    console.log("  ⚠️ users.phone unique constraint already exists or failed to apply (make sure there are no duplicates)");
  }

  // 11. Add allowed_roles column to events for role-based access control
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS allowed_roles jsonb
  `;
  console.log("  ✅ events.allowed_roles");

  // 12. Add roles column to users (if not exists) and backfill from single role
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS roles jsonb DEFAULT '["student"]'::jsonb
  `;
  console.log("  ✅ users.roles");

  // Backfill roles column from role column only for users without any roles set
  await sql`
    UPDATE users SET roles = jsonb_build_array(role) WHERE roles IS NULL AND role IS NOT NULL
  `;
  console.log("  ✅ backfilled users.roles from users.role where roles was NULL");

  // 13. Add registration_close_time column to events
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS registration_close_time timestamp
  `;
  console.log("  ✅ events.registration_close_time");

  // 14. Add points column to users
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS points integer DEFAULT 0
  `;
  console.log("  ✅ users.points");

  // 15. Promote attendance(event_id, student_id) index to UNIQUE constraint
  // to prevent duplicate check-in records under concurrent scans.
  try {
    await sql`DROP INDEX IF EXISTS idx_attendance_event_student`;
    await sql`
      ALTER TABLE attendance
      ADD CONSTRAINT attendance_event_student_unique UNIQUE (event_id, student_id)
    `;
    console.log("  ✅ attendance unique constraint on (event_id, student_id)");
  } catch {
    console.log("  ⚠️  attendance unique constraint already exists, skipping");
  }

  // 16. Add tamper-evident hash chain columns to audit_logs
  await sql`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS prev_hash text NOT NULL DEFAULT ''
  `;
  await sql`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS row_hash text NOT NULL DEFAULT ''
  `;
  console.log("  ✅ audit_logs.prev_hash + row_hash (tamper-evident chain)");

  // 17. Add registration_open_time column to events (pairs with close time
  // to define a registration window; NULL = already open).
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS registration_open_time timestamp
  `;
  // 18. Add quota_walk_in column to events
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS quota_walk_in integer
  `;
  console.log("  ✅ events.quota_walk_in");

  // 19. Convert all naive `timestamp` columns to `timestamptz` (timestamp with
  // time zone) so stored values are unambiguous instants instead of bare
  // wall-clock with no offset.
  //
  // SAFETY / NON-DESTRUCTIVE:
  //  - Idempotent: each column is only altered while it is still
  //    `timestamp without time zone`. Re-running is a no-op (so it never
  //    double-converts a timestamptz back to naive).
  //  - Instant-preserving: existing naive values are reinterpreted with
  //    `AT TIME ZONE 'UTC'`. In production the DB session is UTC and
  //    postgres-js already reads these naive values AS UTC, so the absolute
  //    instant is unchanged — nothing in the app shifts. The UI keeps
  //    converting to Asia/Bangkok at render time exactly as before.
  await sql`
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT * FROM (VALUES
          ('users', 'emailVerified'),
          ('users', 'created_at'),
          ('users', 'updated_at'),
          ('session', 'expires'),
          ('verificationToken', 'expires'),
          ('events', 'start_time'),
          ('events', 'end_time'),
          ('events', 'registration_open_time'),
          ('events', 'registration_close_time'),
          ('events', 'created_at'),
          ('events', 'updated_at'),
          ('attendance', 'check_in_time'),
          ('score_history', 'timestamp'),
          ('audit_logs', 'timestamp'),
          ('forms', 'created_at'),
          ('forms', 'updated_at'),
          ('form_submissions', 'submitted_at')
        ) AS t(tbl, col)
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = r.tbl
            AND column_name = r.col
            AND data_type = 'timestamp without time zone'
        ) THEN
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
            r.tbl, r.col, r.col
          );
        END IF;
      END LOOP;
    END $$;
  `;
  console.log("  ✅ converted timestamp columns to timestamptz (instant-preserving)");

  // 20. Default new DB sessions (psql, Supabase Studio, the app's pooled
  // connections) to Asia/Bangkok so raw timestamptz values DISPLAY as Bangkok
  // local time. Changes only how instants are rendered to text, never the
  // stored instant — safe and reversible. Affects sessions opened AFTER this runs.
  await sql`
    DO $$
    BEGIN
      EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok');
    END $$;
  `;
  console.log("  ✅ database default timezone set to Asia/Bangkok");

  // 21. Backfill NULL points, then enforce NOT NULL. A single NULL poisons every
  // future `points + delta` increment (NULL + n = NULL), silently zeroing a house
  // or student. ALTER ... SET NOT NULL is a no-op if already enforced.
  await sql`UPDATE houses SET points = 0 WHERE points IS NULL`;
  await sql`UPDATE users  SET points = 0 WHERE points IS NULL`;
  await sql`ALTER TABLE houses ALTER COLUMN points SET NOT NULL`;
  await sql`ALTER TABLE users  ALTER COLUMN points SET NOT NULL`;
  console.log("  ✅ points columns backfilled and set NOT NULL");

  // 22. Drop the UNIQUE constraint on users.name. Two students can legitimately
  // share a Google display name; the second was getting a permanent sign-in failure.
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_name_unique`;
  console.log("  ✅ dropped users_name_unique");

  // 23. Event winner-bonus "processed" flag. Replaces the buggy heuristic that
  // inferred "already awarded" from ANY score_history row on the event — which let
  // mid-event individual/milestone/manual rows suppress the house winner bonus.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS winner_awarded_at timestamptz`;
  // Backfill preserves existing behavior exactly: stamp every already-ended event
  // that has any score_history row (the OLD definition of "processed"), so the new
  // code never re-awards a bonus on historical data. Events with no score_history
  // stay NULL and process normally on the next run, same as before.
  await sql`
    UPDATE events e
    SET winner_awarded_at = COALESCE(
      (SELECT max(sh.timestamp) FROM score_history sh WHERE sh.event_id = e.id),
      now()
    )
    WHERE e.winner_awarded_at IS NULL
      AND e.end_time <= now()
      AND EXISTS (SELECT 1 FROM score_history sh WHERE sh.event_id = e.id)
  `;
  console.log("  ✅ events.winner_awarded_at added and backfilled");

  // 24. De-duplicate form_submissions (keep the earliest per student+form), then
  // add the unique index that blocks duplicate-submission point farming.
  await sql`
    DELETE FROM form_submissions fs
    USING form_submissions keep
    WHERE fs.form_id = keep.form_id
      AND fs.student_id = keep.student_id
      AND (fs.submitted_at > keep.submitted_at
        OR (fs.submitted_at = keep.submitted_at AND fs.id > keep.id))
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submissions_form_student
    ON form_submissions (form_id, student_id)
  `;
  console.log("  ✅ form_submissions deduped + unique index");

  // 25. KAS multi-form: add form_type and sort_order to forms, drop single-form unique constraint
  await sql`
    ALTER TABLE forms
    ADD COLUMN IF NOT EXISTS form_type text NOT NULL DEFAULT 'K_post'
  `;
  console.log("  ✅ forms.form_type");

  await sql`
    ALTER TABLE forms
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0
  `;
  console.log("  ✅ forms.sort_order");

  try {
    await sql`ALTER TABLE forms DROP CONSTRAINT IF EXISTS forms_event_id_unique`;
    console.log("  ✅ dropped forms_event_id_unique constraint");
  } catch (e) {
    console.log("  ⚠️ forms_event_id_unique constraint already dropped or not found");
  }

  await sql`
    CREATE INDEX IF NOT EXISTS idx_forms_event_type_order ON forms(event_id, form_type, sort_order)
  `;
  console.log("  ✅ idx_forms_event_type_order index");

  // 26. Form scheduling window + assignment (who may see/fill a form). opens_at /
  // closes_at give each form an optional auto open/close window (like an event's
  // registration window); NULL means unbounded on that side. assigned_roles /
  // assigned_user_ids gate access to S (Skill) forms — empty arrays mean only
  // super_admin/admin can see the form until someone is assigned by role or person.
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS opens_at timestamptz`;
  console.log("  ✅ forms.opens_at");
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS closes_at timestamptz`;
  console.log("  ✅ forms.closes_at");
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS assigned_roles jsonb NOT NULL DEFAULT '[]'::jsonb`;
  console.log("  ✅ forms.assigned_roles");
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS assigned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb`;
  console.log("  ✅ forms.assigned_user_ids");

  // 27. Drop ALL foreign keys on audit_logs (actor_id/target_id → users.id).
  // Those column values are baked into the tamper-evident row hashes, so any
  // rewrite (manual SET NULL on user deletion, or an ON DELETE action) breaks
  // chain verification. Without FKs the rows survive user deletion untouched;
  // the app joins via drizzle relations, which don't need DB-level constraints.
  await sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'audit_logs' AND con.contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;
  `;
  console.log("  ✅ dropped audit_logs foreign keys (rows must never be rewritten)");

  // 28. Index audit_logs.timestamp. Every audit append looks up the newest row
  // (ORDER BY timestamp DESC LIMIT 1) to get the previous chain hash, and it
  // does so while holding the advisory lock that serializes ALL audit writes —
  // so without an index, every write everywhere slows down as the table grows.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs ("timestamp")
  `;
  console.log("  ✅ idx_audit_logs_timestamp index");

  // 29. Multi-poster support: events can carry an ordered list of poster image
  // URLs (carousel on the student dashboard). image_urls[0] mirrors the existing
  // image_url cover. Backfill wraps any existing single image_url into the array
  // so legacy events render in the carousel exactly as before.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS image_urls jsonb`;
  await sql`
    UPDATE events
    SET image_urls = jsonb_build_array(image_url)
    WHERE image_urls IS NULL AND image_url IS NOT NULL AND image_url <> ''
  `;
  console.log("  ✅ events.image_urls added and backfilled from image_url");

  // 30. Dashboard announcement banner (singleton table). Admins (super_admin/
  // admin) edit the body + show/hide toggle from the admin panel instead of
  // editing hardcoded JSX. Seed ONE row with the text that was hardcoded on the
  // dashboard so the banner is unchanged on first deploy — only if empty, so a
  // re-run never clobbers an edited announcement.
  await sql`
    CREATE TABLE IF NOT EXISTS announcements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      body text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO announcements (body, enabled)
    SELECT
      'ขณะนี้ Web Application ActiveCAMT อยู่ระหว่างการพัฒนาและทดสอบระบบเพื่อเพิ่มประสิทธิภาพในการใช้งานสูงสุด' || E'\n' ||
      'หากท่านพบข้อผิดพลาดหรือมีข้อสงสัยประการใด สามารถแจ้งปัญหาหรือติดต่อเราได้ที่ IG: smocamt.official',
      true
    WHERE NOT EXISTS (SELECT 1 FROM announcements)
  `;
  console.log("  ✅ announcements table created and seeded");

  // 31. Shop / merch. Five tables: a singleton settings row (payment QR + info +
  // on/off), products (multi-poster + rich-text description + per-buyer limit),
  // variants (sizes, each with its own stock), orders (slip + approval status),
  // and order line items (snapshots so deleting a product never rewrites history).
  await sql`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      payment_info text NOT NULL DEFAULT '',
      qr_image_url text,
      updated_by text,
      updated_at timestamptz DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO shop_settings (enabled, payment_info)
    SELECT false, ''
    WHERE NOT EXISTS (SELECT 1 FROM shop_settings)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shop_products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      price integer NOT NULL DEFAULT 0,
      image_url text,
      image_urls jsonb,
      max_per_order integer,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shop_variants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      product_id uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
      label text NOT NULL,
      stock integer,
      sort_order integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_variants_product ON shop_variants (product_id)`;
  // "Other (specify)" option: buyer types a custom value at checkout.
  await sql`ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS allow_custom boolean NOT NULL DEFAULT false`;
  // Optional per-product sale window (NULL = unbounded that side).
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS opens_at timestamptz`;
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS closes_at timestamptz`;

  await sql`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      buyer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending',
      slip_path text,
      total_amount integer NOT NULL DEFAULT 0,
      note text,
      reviewed_by text,
      reviewed_at timestamptz,
      rejection_reason text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_orders_buyer ON shop_orders (buyer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders (status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS shop_order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
      product_id uuid REFERENCES shop_products(id) ON DELETE SET NULL,
      variant_id uuid REFERENCES shop_variants(id) ON DELETE SET NULL,
      product_name text NOT NULL,
      variant_label text NOT NULL,
      unit_price integer NOT NULL,
      quantity integer NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items (order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_order_items_variant ON shop_order_items (variant_id)`;
  console.log("  ✅ shop tables (settings, products, variants, orders, order_items) created");

  // 32. Detach no-award activity rows from any house. An event/form that ends with no
  // real award (no attendance, all attendees unassigned, or 0 points configured) should
  // still appear in the Recent Activity feed, but attributed to NO house — pinning it to
  // an arbitrary house (the old behaviour), or naming a 0-point "winner", made no sense.
  //
  // Make house_id nullable, then convert the existing auto-generated 0-point rows to
  // house-less. The two no-attendance variants keep their (already neutral) text; the
  // 0-point "winner"/"contest" rows are also rewritten to a neutral, house-free reason
  // so the text no longer names a house. All scoped to delta = 0 + the exact generated
  // reason strings, so real point awards and manual/individual adjustments are untouched.
  // Idempotent: the rewrites change the reason out of the matched patterns, and
  // re-detaching an already-null house_id is a no-op.
  await sql`ALTER TABLE score_history ALTER COLUMN house_id DROP NOT NULL`;
  console.log("  ✅ score_history.house_id is now nullable");

  // No-attendance / all-unassigned: text is already neutral, just drop the house.
  await sql`
    UPDATE score_history
    SET house_id = NULL
    WHERE delta = 0
      AND house_id IS NOT NULL
      AND (
        reason LIKE 'Event "%" ended with no attendees. No points awarded.'
        OR reason LIKE 'Event "%" ended but all checked-in students were unassigned. No points awarded.'
      )
  `;

  // 0-point event "winner"/"tie winner": drop the house and neutralise the text.
  await sql`
    UPDATE score_history
    SET house_id = NULL,
        reason = 'Event "' || regexp_replace(reason, '^Event "(.*?)" completed!.*$', '\\1') || '" ended. No points awarded.'
    WHERE delta = 0
      AND (reason LIKE 'Event "%" completed! WINNER:%' OR reason LIKE 'Event "%" completed! TIE WINNER:%')
  `;

  // 0-point form contest "winner"/"tie winner": drop the house and neutralise the text.
  await sql`
    UPDATE score_history
    SET house_id = NULL,
        reason = 'Evaluation form "' || regexp_replace(reason, '.*evaluation form "(.*?)" most with.*$', '\\1') || '" closed. No points awarded.'
    WHERE delta = 0
      AND (reason LIKE 'Event Form Contest Winner:%' OR reason LIKE 'Event Form Contest Tie Winner:%')
  `;
  console.log("  ✅ detached no-award activity rows from any house (feed entries kept)");

  // 33. Major-based access control for events. Pairs with allowed_roles: an event
  // can be limited to specific student majors (ANI, DG, DII, MMIT, SE). NULL or []
  // means open to every major; a non-empty array restricts registration/visibility
  // to those majors and is combined with allowed_roles as AND. Admin roles bypass.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_majors jsonb`;
  console.log("  ✅ events.allowed_majors");

  // 34. Multi-day / multi-session check-in. A session = one occurrence of an event
  // (a day). Every event gets ≥1 session; attendance keys on the session, not the
  // event. Single-session events behave exactly as before. NON-DESTRUCTIVE and
  // idempotent throughout: create table, add nullable column, backfill, then
  // tighten the unique constraint and NOT NULL last. See
  // docs/features/multi-day-checkin-implementation.md.
  await sql`
    CREATE TABLE IF NOT EXISTS event_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title text,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      quota_walk_in integer,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_event_sessions_event ON event_sessions (event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_event_sessions_event_order ON event_sessions (event_id, sort_order)`;
  console.log("  ✅ event_sessions table");

  // 35. registration_mode on events ('once' | 'per_session'). Default 'once' so
  // every existing event is backward-compatible with zero behaviour change.
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'once'
  `;
  console.log("  ✅ events.registration_mode");

  // 36. Add attendance.session_id NULLABLE first, so existing rows stay legal
  // until backfilled below.
  await sql`
    ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES event_sessions(id) ON DELETE CASCADE
  `;
  console.log("  ✅ attendance.session_id (nullable, pre-backfill)");

  // 37. Backfill one default session per event that has none. Copies the event's
  // own start/end + walk-in quota so a legacy single-day event becomes a 1-session
  // event identical to before. Idempotent via NOT EXISTS.
  await sql`
    INSERT INTO event_sessions (event_id, title, start_time, end_time, sort_order, quota_walk_in)
    SELECT e.id, NULL, e.start_time, e.end_time, 0, e.quota_walk_in
    FROM events e
    WHERE NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.event_id = e.id)
  `;
  console.log("  ✅ backfilled one default session per event");

  // 38. Backfill attendance.session_id from each event's earliest session, only
  // where NULL. After this every attendance row points at a session.
  await sql`
    UPDATE attendance a
    SET session_id = (
      SELECT s.id FROM event_sessions s
      WHERE s.event_id = a.event_id
      ORDER BY s.sort_order, s.start_time
      LIMIT 1
    )
    WHERE a.session_id IS NULL
  `;
  console.log("  ✅ backfilled attendance.session_id");

  // 39. Swap the uniqueness guard from (event_id, student_id) to
  // (session_id, student_id). ADD-NEW-BEFORE-DROP-OLD so there is never a window
  // without a duplicate-scan guard. Collision-safe: one event maps to exactly one
  // default session during backfill (step 37/38), so no (session_id, student_id)
  // pair can already be duplicated that wasn't already blocked by the old
  // (event_id, student_id) constraint. The old object is kept as a plain
  // non-unique index for the report/winner roll-ups that still query by event.
  try {
    await sql`
      ALTER TABLE attendance
      ADD CONSTRAINT attendance_session_student_unique UNIQUE (session_id, student_id)
    `;
    console.log("  ✅ attendance unique constraint on (session_id, student_id)");
  } catch {
    console.log("  ⚠️  attendance_session_student_unique already exists, skipping");
  }
  await sql`ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_event_student_unique`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_attendance_event_student
    ON attendance (event_id, student_id)
  `;
  console.log("  ✅ replaced (event_id, student_id) unique with non-unique index");

  // 40. Enforce NOT NULL last, only after backfill + swap. If step 38 missed any
  // row this fails loudly BEFORE an event rather than mid-scan.
  await sql`ALTER TABLE attendance ALTER COLUMN session_id SET NOT NULL`;
  console.log("  ✅ attendance.session_id set NOT NULL");

  // 41. President-managed events. managed_by_roles lists which president role(s)
  // (club_president / major_president) MANAGE this event — i.e. see it in their
  // admin events list, view attendance, scan, and export. This is SEPARATE from
  // allowed_roles, which governs participant (student) visibility/registration.
  // NULL or [] = not president-managed (only staff manage it). Nullable, no
  // default, non-destructive.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS managed_by_roles jsonb`;
  console.log("  ✅ events.managed_by_roles");

  // 42. Calendar entries — lightweight, calendar-only annotations (deadlines,
  // registration windows, "exam week"), optionally linked to an event. New table
  // only → inherently non-destructive. event_id is ON DELETE SET NULL so deleting
  // an event keeps the annotation. Visibility columns mirror events.* exactly so
  // the same eligibility predicate filters both. NEVER read by dashboard/scan/
  // attendance/points paths.
  await sql`
    CREATE TABLE IF NOT EXISTS calendar_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      title text NOT NULL,
      description text,
      location text,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      all_day boolean NOT NULL DEFAULT false,
      event_id uuid REFERENCES events(id) ON DELETE SET NULL,
      allowed_roles jsonb,
      allowed_majors jsonb,
      target_thai boolean DEFAULT true,
      target_international boolean DEFAULT true,
      created_by text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_calendar_entries_start ON calendar_entries (start_time)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_calendar_entries_event ON calendar_entries (event_id)`;
  console.log("  ✅ calendar_entries table");

  // 43. Per-user subscribe-feed token. The token IS the auth for the .ics feed
  // (the feed route never calls auth()), so it must be a stored, revocable secret.
  // One active token per user (PK on user_id); regenerate = overwrite the row.
  await sql`
    CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
      user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      created_at timestamptz DEFAULT now(),
      last_used_at timestamptz
    )
  `;
  console.log("  ✅ calendar_feed_tokens table");

  // 44. score_history.form_id — ties a contest-award ledger row to the specific
  // form that produced it, so a re-opened form can revert ITS OWN award without
  // touching the event scans, manual adjustments, and event-winner bonus that
  // share the same event_id. Nullable + ON DELETE SET NULL: existing rows stay
  // legal (form_id NULL) and the ledger entry survives if the form is deleted.
  // Additive only — no data is rewritten or removed.
  await sql`
    ALTER TABLE score_history
    ADD COLUMN IF NOT EXISTS form_id uuid
  `;
  // Add the FK only if it isn't already present (Postgres has no
  // ADD CONSTRAINT IF NOT EXISTS). Guarded so re-runs are a no-op.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'score_history_form_id_forms_id_fk'
      ) THEN
        ALTER TABLE score_history
          ADD CONSTRAINT score_history_form_id_forms_id_fk
          FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_score_history_form ON score_history (form_id)`;
  console.log("  ✅ score_history.form_id (+ FK, index)");

  // 45. events.individual_points_awarded — a SECOND, independent point pool per
  // event. points_awarded (step 4) is the house winner bonus (winner-take-all at
  // event-end); this is per-attendee individual points added to users.points the
  // moment a check-in becomes 'attended' (per session, so multi-day attendance
  // compounds). Additive, nullable-with-default, non-destructive: existing events
  // default to 0 (no individual points), unchanged from before. Idempotent via
  // ADD COLUMN IF NOT EXISTS.
  await sql`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS individual_points_awarded integer DEFAULT 0
  `;
  console.log("  ✅ events.individual_points_awarded");

  // 46. forms.individual_points_awarded — per-submitter individual points, the
  // form analogue of step 45. points_awarded (the form's house contest, awarded
  // winner-take-all at close) is unchanged; this is added to users.points the
  // moment a student submits the form, and is NOT clawed back if the form
  // re-opens (the submission persists). Additive, default 0, idempotent.
  await sql`
    ALTER TABLE forms
    ADD COLUMN IF NOT EXISTS individual_points_awarded integer DEFAULT 0
  `;
  console.log("  ✅ forms.individual_points_awarded");

  // 47. shop_products audience targeting — mirrors the events visibility model so
  // a product can be shown only to certain roles / majors / Thai|international
  // students (shared predicate src/lib/event-access.ts). allowedRoles and
  // allowedMajors are jsonb string[] (NULL/[] = no restriction on that axis);
  // target_thai / target_international default true (both false is treated as
  // both true by the predicate). Additive, nullable / default-true,
  // non-destructive: existing products get NULL arrays + both targets true, i.e.
  // visible to everyone exactly as before. Idempotent via ADD COLUMN IF NOT EXISTS.
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS allowed_roles jsonb`;
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS allowed_majors jsonb`;
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS target_thai boolean DEFAULT true`;
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS target_international boolean DEFAULT true`;
  console.log("  ✅ shop_products.allowed_roles / allowed_majors / target_thai / target_international");

  // 48. Per-product custom fields (jersey name/number, engraving, etc.).
  // shop_products.custom_fields holds the field CONFIG (jsonb array of
  // {key,label,type,required,…}); shop_order_items.custom_values holds the buyer's
  // snapshotted answers ([{label,value}]) captured at checkout. Both nullable
  // (NULL = no custom fields / none filled). Additive, non-destructive, idempotent
  // via ADD COLUMN IF NOT EXISTS. See src/lib/shop-custom-fields.ts.
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS custom_fields jsonb`;
  await sql`ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS custom_values jsonb`;
  console.log("  ✅ shop_products.custom_fields / shop_order_items.custom_values");

  // 49. Shop delivery / fulfillment (Phase 2). shop_settings gains a flat-fee
  // delivery config (delivery_enabled / delivery_fee / pickup_info); shop_orders
  // gains the per-order choice (fulfillment) + recipient name/phone/address (PDPA
  // personal data, shop-admin only) + shipping_fee (snapshot folded into the
  // total). Existing orders default to 'pickup' with fee 0 + NULL recipient fields,
  // i.e. unchanged. Additive, non-destructive, idempotent via ADD COLUMN IF NOT EXISTS.
  await sql`ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS delivery_fee integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS pickup_info text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'pickup'`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS recipient_name text`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS recipient_phone text`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_address text`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_fee integer NOT NULL DEFAULT 0`;
  console.log("  ✅ shop_settings delivery config + shop_orders fulfillment/recipient/shipping_fee");

  // 50. Per-product delivery pricing. shop_products gains an optional base fee
  // (delivery_fee; NULL = use the shop-wide shop_settings.delivery_fee fallback)
  // and quantity tiers (delivery_tiers jsonb [{minQty,fee}] — highest applicable
  // minQty wins, "order more than N → fee goes up"). An order's total shipping is
  // the SUM of each product's computed fee. The shop-wide fee stays as the
  // fallback for products with no own config, so existing products are unchanged.
  // Additive, nullable, non-destructive, idempotent via ADD COLUMN IF NOT EXISTS.
  // See src/lib/shop-delivery.ts.
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS delivery_fee integer`;
  await sql`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS delivery_tiers jsonb`;
  console.log("  ✅ shop_products.delivery_fee / delivery_tiers");

  // 51. events.first_year_only — audience restriction limiting an event to the
  // CURRENT first-year intake, derived from the student-id prefix (CMU
  // Buddhist-era admission year, e.g. ids starting with "69" for 2026; computed
  // at runtime in src/lib/event-access.ts so it tracks the year automatically).
  // Enforced alongside the existing role/major/Thai|international predicates;
  // admin roles bypass. Additive, NOT NULL DEFAULT false: existing events
  // backfill to false (no restriction = unchanged behaviour). Idempotent via
  // ADD COLUMN IF NOT EXISTS.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS first_year_only boolean NOT NULL DEFAULT false`;
  console.log("  ✅ events.first_year_only");

  // 52. audit_logs.seq — a monotonic, gap-tolerant insertion-order column that
  // breaks ties when two appends share the same millisecond `timestamp`. The hash
  // chain is appended under an advisory lock, but tip selection
  // (ORDER BY timestamp DESC LIMIT 1) and verification (ORDER BY timestamp ASC)
  // still can't deterministically order equal-ms rows — they fork the chain and
  // raise false tamper alarms. seq is a bigint backed by its own sequence
  // (bigserial-style), assigned via nextval on insert.
  //
  // Built up in the safe, re-runnable order used for the session_id rollout
  // (steps 36-40): add NULLABLE → backfill in chain order → attach the sequence →
  // SET DEFAULT + NOT NULL LAST. All existing rows are preserved exactly.
  //
  // (a) Add nullable first so ADD COLUMN on a populated table is an instant
  //     metadata change (no default ⇒ no table rewrite).
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS seq bigint`;

  // (b) Backfill every not-yet-numbered row in CURRENT CHAIN ORDER (timestamp
  //     ASC, id ASC as the deterministic tiebreaker), only WHERE seq IS NULL.
  //     The COALESCE(max(seq),0) offset makes a partial re-run continue past
  //     whatever is already numbered instead of restarting at 1 and colliding.
  //     First run: max is NULL → 0 → existing rows get 1..N in chain order.
  await sql`
    WITH ordered AS (
      SELECT id,
             row_number() OVER (ORDER BY "timestamp" ASC, id ASC)
               + COALESCE((SELECT max(seq) FROM audit_logs), 0) AS rn
      FROM audit_logs
      WHERE seq IS NULL
    )
    UPDATE audit_logs a
    SET seq = ordered.rn
    FROM ordered
    WHERE a.id = ordered.id
  `;

  // (c) Create the sequence, make it OWNED BY the column (dropped with the column,
  //     never orphaned), and point it just past the current max so new inserts
  //     continue monotonically with no collision. setval(..., false) ⇒ the NEXT
  //     nextval returns exactly that value (max+1, or 1 on an empty table).
  await sql`CREATE SEQUENCE IF NOT EXISTS audit_logs_seq_seq`;
  await sql`ALTER SEQUENCE audit_logs_seq_seq OWNED BY audit_logs.seq`;
  await sql`SELECT setval('audit_logs_seq_seq', COALESCE((SELECT max(seq) FROM audit_logs), 0) + 1, false)`;

  // (d) Attach the sequence as the column default and enforce NOT NULL LAST, only
  //     after every existing row has a value. Both are no-ops on re-run.
  await sql`ALTER TABLE audit_logs ALTER COLUMN seq SET DEFAULT nextval('audit_logs_seq_seq')`;
  await sql`ALTER TABLE audit_logs ALTER COLUMN seq SET NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_seq ON audit_logs (seq)`;
  console.log("  ✅ audit_logs.seq (bigint sequence, backfilled in chain order, NOT NULL + indexed)");

  // 53. Performance indexes — all CREATE INDEX IF NOT EXISTS, so idempotent,
  // additive, and non-destructive. Mirror the indexes now declared in schema.ts.
  //   - forms(event_id): the forms table had NO single-column index; every
  //     "forms for this event" lookup full-scanned it.
  //   - users(role): role-filtered admin/leaderboard queries.
  //   - users(created_at): signup-time ordering / reporting.
  //   - attendance(event_id, status): attendee/head-count roll-ups by event+status.
  await sql`CREATE INDEX IF NOT EXISTS idx_forms_event_id ON forms (event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_event_status ON attendance (event_id, status)`;
  console.log("  ✅ perf indexes: forms(event_id), users(role), users(created_at), attendance(event_id,status)");

  // 54. rate_limit — durable Postgres-backed rate limiter (replaces an in-memory
  // Map that reset every deploy and wasn't shared across instances). One row per
  // limiter key; `count` is the hit count in the current window and expires_at is
  // when the window resets. The expires_at index lets a sweeper delete expired
  // rows cheaply. New table ⇒ inherently additive; IF NOT EXISTS keeps it idempotent.
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limit (
      key text PRIMARY KEY,
      count integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON rate_limit (expires_at)`;
  console.log("  ✅ rate_limit table + idx_rate_limit_expires_at");

  // 55. Index shop_order_items.product_id. The per-product order export
  // (/api/admin/shop/products/[id]/orders) filters WHERE product_id = ? to list
  // every line item bought for one product; product_id had an FK but no index,
  // so that query full-scanned shop_order_items, which grows with every purchased
  // line item. Mirrors the index now declared in schema.ts. CREATE INDEX IF NOT
  // EXISTS ⇒ additive, idempotent, non-destructive.
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_order_items_product ON shop_order_items (product_id)`;
  console.log("  ✅ idx_shop_order_items_product index");

  // 56. shop_variants.price_delta — per-variant price surcharge in whole ฿ added on
  // top of the product's base price (e.g. a special/oversized size that costs more).
  // Defaults to 0 so every existing variant keeps the product price unchanged.
  // ADD COLUMN IF NOT EXISTS + DEFAULT 0 ⇒ additive, idempotent, non-destructive.
  await sql`ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS price_delta integer NOT NULL DEFAULT 0`;
  console.log("  ✅ shop_variants.price_delta (฿ surcharge, default 0)");

  // 57. calendar_entries: recurrence support. Two additive, idempotent columns:
  //   recurrence       — rule preset (none|daily|weekly|monthly), default 'none'
  //   recurrence_until — series end timestamp, nullable; when null the rule runs
  //                      indefinitely (the grid bounds expansions by window anyway).
  await sql`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'`;
  await sql`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS recurrence_until timestamptz`;
  console.log("  ✅ calendar_entries.recurrence + recurrence_until");

  // 58. clubs — dynamic entity (created/renamed/retired by staff) used to scope
  // club-president event ownership. uuid PK (unlike the fixed-slug houses). Never
  // hard-deleted: archived via is_archived so owned events / membership history
  // survive. The partial unique index keeps two ACTIVE clubs from sharing a name
  // while letting a new club reuse an archived club's old name. New table +
  // CREATE INDEX IF NOT EXISTS ⇒ additive, idempotent, non-destructive.
  await sql`
    CREATE TABLE IF NOT EXISTS clubs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      name text NOT NULL,
      is_archived boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS clubs_active_name_unique ON clubs (name) WHERE is_archived = false`;
  console.log("  ✅ clubs table + clubs_active_name_unique (partial, active names only)");

  // 59. club_members — many-to-many membership join between users and clubs. A user
  // may preside over / belong to several clubs; a club has several members. `role`
  // ('president' | 'member') is reserved for a future per-club roster feature — the
  // current feature only writes 'president' rows. FKs ON DELETE CASCADE so deleting
  // a user or club cleans up its memberships. Unique(club_id,user_id) blocks dup
  // rows; the user/club single-column indexes back the scope lookups (by user) and
  // roster reads (by club). New table + CREATE INDEX IF NOT EXISTS ⇒ additive,
  // idempotent, non-destructive.
  await sql`
    CREATE TABLE IF NOT EXISTS club_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'member',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS club_members_club_user_unique ON club_members (club_id, user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS club_members_user_idx ON club_members (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS club_members_club_idx ON club_members (club_id)`;
  console.log("  ✅ club_members table + unique(club_id,user_id) + user/club indexes");

  // 60. events.owner_club_ids / owner_majors — president OWNERSHIP scope (which
  // club/major owns the event), separate from the existing managed_by_roles (which
  // only flags that a president role is involved at all). Both nullable jsonb with
  // NO default: null means "no owner assigned yet", which the scoping logic treats
  // as "hidden from all presidents until staff assigns one" (staff/admin bypass) —
  // intentional, mirrors the allowed_majors jsonb pattern. ADD COLUMN IF NOT EXISTS
  // ⇒ additive, idempotent, non-destructive.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_club_ids jsonb`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_majors jsonb`;
  console.log("  ✅ events.owner_club_ids + owner_majors (nullable, no default)");

  // 61. P2P Game Arena tables (game_rooms, webrtc_signals, game_stats) and indexes.
  // Additive, idempotent, safe to run via CREATE TABLE IF NOT EXISTS.
  await sql`
    CREATE TABLE IF NOT EXISTS game_rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      room_code text NOT NULL,
      game_type text NOT NULL,
      host_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guest_id text REFERENCES users(id) ON DELETE CASCADE,
      game_state jsonb NOT NULL,
      current_turn integer NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'waiting',
      winner_id text REFERENCES users(id) ON DELETE SET NULL,
      finish_reason text,
      turn_deadline timestamptz,
      expires_at timestamptz NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_rooms_code ON game_rooms (room_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms (status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS webrtc_signals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
      role text NOT NULL,
      sdp_offer text,
      sdp_answer text,
      ice_candidates jsonb DEFAULT '[]'::jsonb,
      updated_at timestamptz DEFAULT now() NOT NULL
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_webrtc_signals_room_role ON webrtc_signals (room_id, role)`;

  await sql`
    CREATE TABLE IF NOT EXISTS game_stats (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type text NOT NULL,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
      draws integer NOT NULL DEFAULT 0,
      win_streak integer NOT NULL DEFAULT 0,
      best_streak integer NOT NULL DEFAULT 0,
      total_games integer NOT NULL DEFAULT 0,
      last_played_at timestamptz DEFAULT now() NOT NULL
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_game_stats_user_game ON game_stats (user_id, game_type)`;
  console.log("  ✅ game_rooms, webrtc_signals, game_stats tables and indexes");

  // 62. houses.faculty / houses.color_group / users.faculty columns + indexes.
  // Originally added for a since-abandoned multi-faculty (MASSCOM/ARCH/ARTS)
  // house model — that model (and the 12 orphan faculty-house rows it once
  // inserted, plus the every-deploy insert-then-delete cycle that reverted it)
  // has been removed entirely (2026-07-28); those faculties belong to the
  // separate Songsue project, not here. ActiveCAMT is CAMT-only. The columns
  // themselves stay — houses.faculty is always 'CAMT', color_group mirrors id
  // — and users.faculty remains a legitimate, unrelated per-student academic
  // field (profile/onboarding/Songsue sync). NON-DESTRUCTIVE: no DROP/DELETE.
  await sql`ALTER TABLE houses ADD COLUMN IF NOT EXISTS faculty text NOT NULL DEFAULT 'CAMT'`;
  await sql`ALTER TABLE houses ADD COLUMN IF NOT EXISTS color_group text NOT NULL DEFAULT 'red'`;
  await sql`ALTER TABLE users  ADD COLUMN IF NOT EXISTS faculty text`;
  await sql`CREATE INDEX IF NOT EXISTS idx_houses_color_group ON houses (color_group)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_houses_faculty ON houses (faculty)`;
  console.log("  ✅ houses.faculty + houses.color_group + users.faculty (+ indexes)");

  // 63. Backfill the 4 EXISTING CAMT house rows. Their ids ('red'/'green'/
  // 'yellow'/'blue') MUST stay unchanged — users.house_id and score_history.house_id
  // already reference them. Set faculty='CAMT' and color_group = id.
  await sql`
    UPDATE houses
    SET faculty = 'CAMT', color_group = id
    WHERE id IN ('red', 'green', 'yellow', 'blue')
  `;
  console.log("  ✅ backfilled 4 legacy CAMT houses (faculty + color_group)");

  // 64. Backfill users.faculty for legacy rows (all existing students are CAMT).
  //
  // ⚠️ This step ORIGINALLY also ran `UPDATE users SET house_id = NULL` — a
  // one-time reset intended for the four-faculty-houses cutover. That line is
  // GONE. It ran unconditionally on every deploy (this script has no
  // migrations-tracking table; every `db:migrate`/`db:migrate:container` run
  // replays every step from the top), so it wiped EVERY user's house on every
  // single deploy — the four-faculty model was reverted, but nothing ever
  // removed the reset, so it kept firing forever after. That's the "my house
  // changed after a redeploy" bug (fixed 2026-07-06; see
  // scripts/restore-houses-from-supabase.mjs for the one-time recovery of
  // pre-reset assignments). DO NOT reintroduce an unconditional house_id
  // reset here — it will immediately reproduce that bug on the next deploy.
  await sql`UPDATE users SET faculty = 'CAMT' WHERE faculty IS NULL`;
  console.log("  ✅ backfilled users.faculty");

  // 67. No-show strike-out: users.no_show_count / users.registration_blocked.
  // Students who pre-register for an event but never check in accumulate
  // strikes; at 3 strikes registrationBlocked flips true, blocking new
  // pre-registration until a staff member resets it. Additive, NOT NULL with
  // a default so existing rows backfill to 0/false automatically — no data
  // transformation, no drop. Idempotent via ADD COLUMN IF NOT EXISTS.
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS registration_blocked boolean NOT NULL DEFAULT false
  `;
  console.log("  ✅ users.no_show_count + users.registration_blocked");

  // 68. no_show_appeals — lets a registration-blocked student (see step 67)
  // submit an appeal message instead of only ever waiting on a manual staff
  // reset (see /api/admin/students/[id]/strikes/reset). no_show_count_at_appeal
  // snapshots users.no_show_count at submission time so an admin reviewing later
  // still sees the context even if the count has since changed. The partial
  // unique index blocks a user from having more than one 'pending' appeal open
  // at once (spam guard) — once it's approved/rejected they can submit again if
  // blocked again. New table + CREATE INDEX IF NOT EXISTS ⇒ additive, idempotent,
  // non-destructive.
  await sql`
    CREATE TABLE IF NOT EXISTS no_show_appeals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message text NOT NULL,
      no_show_count_at_appeal integer NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      reviewed_by text,
      reviewed_at timestamptz,
      review_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS no_show_appeals_user_idx ON no_show_appeals (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS no_show_appeals_status_idx ON no_show_appeals (status)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS no_show_appeals_one_pending_per_user ON no_show_appeals (user_id) WHERE status = 'pending'`;
  console.log("  ✅ no_show_appeals table + user/status indexes + one-pending-per-user partial unique index");

  // 69. no_show_appeals.event_id — appeals become per-EVENT instead of one
  // blanket appeal per account (see step 68): a student with multiple strikes
  // can appeal each no-show event separately, and approving one only undoes
  // that event's strike, not the whole count. Nullable so the ADD COLUMN stays
  // additive against any pre-existing rows; the app layer requires it on every
  // new appeal. Replaces the one-pending-per-user unique index with one scoped
  // to (user_id, event_id) so concurrently-pending appeals for DIFFERENT
  // events are allowed, just not two for the same event. Additive/idempotent:
  // ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP INDEX IF EXISTS.
  await sql`
    ALTER TABLE no_show_appeals
    ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE CASCADE
  `;
  await sql`CREATE INDEX IF NOT EXISTS no_show_appeals_event_idx ON no_show_appeals (event_id)`;
  await sql`DROP INDEX IF EXISTS no_show_appeals_one_pending_per_user`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS no_show_appeals_one_pending_per_user_event ON no_show_appeals (user_id, event_id) WHERE status = 'pending'`;
  console.log("  ✅ no_show_appeals.event_id + event index; one-pending-per-user-event replaces one-pending-per-user");

  // 70. events.staff_user_ids — explicit per-event staff roster (see schema.ts
  // comment). Nullable, no default: additive/idempotent via ADD COLUMN IF NOT
  // EXISTS on a populated table.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS staff_user_ids jsonb`;
  console.log("  ✅ events.staff_user_ids");

  // 71. attendance.is_staff — snapshot of staff status at check-in/registration
  // time (see schema.ts comment), used to exempt staff from quota/no-show
  // logic. NOT NULL DEFAULT false backfills existing rows to false in the same
  // statement — additive/idempotent/non-destructive via ADD COLUMN IF NOT EXISTS.
  await sql`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false`;
  console.log("  ✅ attendance.is_staff");

  // 72. event_proposals — lets a club_president request an event for a club they
  // preside over without granting them write access to the real `events` table.
  // Requested title/time/location/quota are non-binding; staff still sets
  // pointsAwarded/allowedRoles/allowedMajors/managedByRoles/ownerClubIds/
  // staffUserIds explicitly when creating the real event (mirrors the
  // field-strip precedent for president-submitted edits in
  // api/admin/events/[id]/route.ts). Lifecycle mirrors no_show_appeals:
  // status 'pending'|'approved'|'rejected'|'withdrawn', reviewed_by has NO FK
  // (matches no_show_appeals.reviewed_by exactly). club_id CASCADEs (deleting a
  // club deletes its proposal history; the audit log keeps a free-text trail
  // independent of the row). resulting_event_id is SET NULL so a later
  // hard-delete of the created event doesn't FK-block the deletion. New table +
  // CREATE INDEX IF NOT EXISTS ⇒ additive, idempotent, non-destructive.
  await sql`
    CREATE TABLE IF NOT EXISTS event_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      proposed_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      location text,
      quota integer,
      status text NOT NULL DEFAULT 'pending',
      reviewed_by text,
      reviewed_at timestamptz,
      review_note text,
      resulting_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS event_proposals_club_idx ON event_proposals (club_id)`;
  await sql`CREATE INDEX IF NOT EXISTS event_proposals_status_idx ON event_proposals (status)`;
  await sql`CREATE INDEX IF NOT EXISTS event_proposals_proposed_by_idx ON event_proposals (proposed_by)`;
  console.log("  ✅ event_proposals table + club/status/proposed_by indexes");

  // 73. event_proposals — the full staff-create-event-parity field set (poster,
  // registration window, walk-ins, target audience, first-year-only, registration
  // mode, suggested staff). Mirrors the equivalent `events` columns exactly so a
  // proposal converts 1:1 into a real event. Additive/idempotent via ADD COLUMN
  // IF NOT EXISTS — see src/db/schema.ts's eventProposals table for field docs.
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS registration_open_time timestamptz`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS registration_close_time timestamptz`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS image_url text`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS image_urls jsonb`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS walk_ins_enabled boolean DEFAULT false`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS walk_ins_only boolean DEFAULT false`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS quota_walk_in integer`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'once'`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS sessions jsonb`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS target_thai boolean DEFAULT true`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS target_international boolean DEFAULT true`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS quota_thai integer`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS quota_international integer`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS first_year_only boolean DEFAULT false`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS staff_user_ids jsonb`;
  console.log("  ✅ event_proposals poster/registration-window/walk-ins/audience/staff columns");

  // 74. events.walk_ins_only — walk-ins-only events refuse pre-registration
  // entirely (see api/events/[id]/register). Additive/idempotent.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS walk_ins_only boolean DEFAULT false`;
  console.log("  ✅ events.walk_ins_only");

  // 75. events.allowed_clubs — club-based participant eligibility (SEPARATE from
  // owner_club_ids, which controls who MANAGES the event). null/[] = no club
  // restriction. See api/events/[id]/register and src/lib/event-access.ts.
  // Additive/idempotent.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_clubs jsonb`;
  console.log("  ✅ events.allowed_clubs");

  // 76. forms.show_respondent_identity — controls whether non-admin viewers
  // (registration/organizer, later smo/club_president/major_president) see a
  // form submission's respondent name/studentId/contact info, or a masked/
  // anonymized view. super_admin/admin always see identity regardless of this
  // flag (enforced in app code, not here). NOT NULL DEFAULT false backfills
  // every existing form to anonymized-by-default; the creator opts in per form
  // when identity is genuinely needed (app logic, not a DB-level conditional
  // default). Additive/idempotent via ADD COLUMN IF NOT EXISTS.
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS show_respondent_identity boolean NOT NULL DEFAULT false`;
  console.log("  ✅ forms.show_respondent_identity");

  // 77. event_proposals — major-based proposals (major_president). club_id
  // becomes nullable (a major-scoped proposal carries major_code instead —
  // exactly one of the two is set, enforced in app code, see POST
  // /api/admin/event-proposals). DROP NOT NULL is a no-op if already dropped,
  // so this stays idempotent on repeat runs.
  await sql`ALTER TABLE event_proposals ALTER COLUMN club_id DROP NOT NULL`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS major_code text`;
  await sql`CREATE INDEX IF NOT EXISTS event_proposals_major_idx ON event_proposals (major_code)`;
  console.log("  ✅ event_proposals.major_code (club_id now nullable)");

  // 78. events — auto-re-review for club/major president direct edits (never
  // blocked, see PUT /api/admin/events/[id]). DEFAULT 'pending' preserves
  // today's "president can always edit their owned event" behavior for every
  // existing row; re-review only starts once a president actually edits
  // (see events.detailsReviewStatus in schema.ts). Additive/idempotent.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS details_review_status text NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS details_reviewed_by text`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS details_reviewed_at timestamptz`;
  console.log("  ✅ events.details_review_status/reviewed_by/reviewed_at");

  // 79. forms — approve-then-lock for club/major president feedback forms.
  // DEFAULT 'approved' backfills every existing form (all staff-created to
  // date) as already-approved/unaffected; a president's create/edit always
  // resets this to 'pending' in app code (see forms.reviewStatus in
  // schema.ts and POST/PATCH /api/admin/events/[id]/form). Additive/idempotent.
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved'`;
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS reviewed_by text`;
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS reviewed_at timestamptz`;
  await sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS review_note text`;
  console.log("  ✅ forms.review_status/reviewed_by/reviewed_at/review_note");

  // 80. event_proposals — suggested participant-eligibility ACL, mirrors
  // events.allowedRoles/allowedMajors/allowedClubs exactly (non-binding: staff
  // reviews/adjusts these explicitly when creating the real event from an
  // approved proposal). Additive/idempotent.
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS allowed_roles jsonb`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS allowed_majors jsonb`;
  await sql`ALTER TABLE event_proposals ADD COLUMN IF NOT EXISTS allowed_clubs jsonb`;
  console.log("  ✅ event_proposals.allowed_roles/allowed_majors/allowed_clubs");

  // 81. events — pending edit proposal for club/major president edits to an
  // EXISTING event. A president's edit is no longer applied live; it's held
  // as JSON here until staff approve or discard it (the live columns above
  // are never touched by a president's edit anymore). All three nullable,
  // no default — null means "no pending edit". Additive/idempotent.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS pending_details_changes jsonb`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS pending_details_submitted_by text`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS pending_details_submitted_at timestamptz`;
  console.log("  ✅ events.pending_details_changes/submitted_by/submitted_at");

  // 82. Fix false-positive "President edited this event" badge. Step 78's
  // DEFAULT 'pending' NOT NULL retroactively stamped every event that already
  // existed at that point as 'pending', even though no president ever
  // touched it (pending_details_changes stayed NULL for those rows) — the
  // admin UI's badge only checks detailsReviewStatus === 'pending', so those
  // events show a permanent, false review badge with nothing to review.
  // Flip back to 'approved' ONLY where there is no actual pending diff, so a
  // genuine unreviewed president edit is never silently approved. Idempotent:
  // re-running only touches rows still in the false state.
  await sql`
    UPDATE events
    SET details_review_status = 'approved'
    WHERE details_review_status = 'pending'
      AND pending_details_changes IS NULL
  `;
  console.log("  ✅ backfilled false-positive events.details_review_status back to 'approved'");

  // 83. Scoped staff-title columns, replacing the single global users.position
  // (which silently clobbered a student's title across club/major/SMO/ANUSMO
  // contexts — see src/lib/positions.ts and src/lib/admin-access.ts).
  // club_members.position is the per-club analogue; users.majorPosition,
  // users.smoPosition, users.anusmoPosition are each independently scoped (a
  // student can hold both smo and anusmo with a different title in each).
  // users.position itself is left untouched (legacy, no longer written) — no
  // automated backfill, since a student active in more than one context makes
  // the old value ambiguous; see scripts/list-legacy-positions.mjs for a
  // read-only report to drive manual reassignment after this runs. All four
  // nullable, no default. Additive/idempotent.
  await sql`ALTER TABLE club_members ADD COLUMN IF NOT EXISTS position text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS major_position text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS smo_position text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS anusmo_position text`;
  console.log("  ✅ club_members.position, users.major_position/smo_position/anusmo_position");

  // 84. "Also count for Songsue" staff toggle. When true, this event's metadata
  // and registration/attendance status are mirrored one-directionally into the
  // sibling Songsue app via src/lib/songsue-sync.ts, so Songsue's own
  // house-points system can credit the right house. Songsue owns nothing about
  // this event; ActiveCAMT remains the single source of truth for creation,
  // registration, quota, and check-in. NOT NULL DEFAULT false — additive/idempotent.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS songsue_linked boolean NOT NULL DEFAULT false`;
  console.log("  ✅ events.songsue_linked");

  // 85. feedback_complaints — Anonymous Feedback & Complaints (see
  // docs/features/feedback-complaints.md). submitter_ref is a keyed-hash
  // (HMAC) abuse-control + self-service-lookup reference, NOT a foreign key
  // to users — this table deliberately has no FK back to users at all; that
  // absence is the anonymity guarantee itself, not an oversight (see the
  // table-level comment on feedbackComplaints in src/db/schema.ts for the
  // full rationale). New table + CREATE INDEX IF NOT EXISTS ⇒ additive,
  // idempotent, non-destructive. Mirrors drizzle/0034_familiar_outlaw_kid.sql
  // exactly — drizzle-kit generate only emits that file, it does NOT wire
  // into this hand-maintained script, so every new table/column here needs
  // its own step appended manually like this one. No admin_reply/replied_by/
  // replied_at here — replaced by the feedbackComplaintMessages thread
  // (step 86) before this ever shipped anywhere, same as the earlier
  // tracking_code_hash removal: amended in place rather than left as a
  // confusing "add then remove" migration pair.
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_complaints (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      category text NOT NULL,
      severity text NOT NULL DEFAULT 'normal',
      message text NOT NULL,
      contact_opt_in boolean NOT NULL DEFAULT false,
      contact_info text,
      attachment_keys jsonb NOT NULL DEFAULT '[]',
      submitter_ref text NOT NULL,
      status text NOT NULL DEFAULT 'new',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS feedback_complaints_submitter_ref_idx ON feedback_complaints (submitter_ref)`;
  await sql`CREATE INDEX IF NOT EXISTS feedback_complaints_status_idx ON feedback_complaints (status)`;
  await sql`CREATE INDEX IF NOT EXISTS feedback_complaints_category_idx ON feedback_complaints (category)`;
  console.log("  ✅ feedback_complaints table + submitter_ref/status/category indexes");

  // 86. feedback_complaint_messages — two-way conversation thread on a
  // complaint (docs/features/feedback-complaints.md §10), replacing the
  // one-shot admin_reply field step 85 used to have. sender_type is
  // 'submitter' | 'staff'; staff_user_id is set ONLY for staff messages, no
  // FK (mirrors no_show_appeals.reviewed_by) — a submitter message carries
  // NO identity at all, ownership for posting one is checked by joining to
  // the parent complaint's submitter_ref, never duplicated on this table.
  // New table + FK + CREATE INDEX IF NOT EXISTS ⇒ additive, idempotent,
  // non-destructive.
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_complaint_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      complaint_id uuid NOT NULL REFERENCES feedback_complaints(id) ON DELETE CASCADE,
      sender_type text NOT NULL,
      staff_user_id text,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS feedback_complaint_messages_complaint_idx ON feedback_complaint_messages (complaint_id)`;
  console.log("  ✅ feedback_complaint_messages table + complaint_id index");

  // 87. shop_orders slip fraud pre-filter (free/offline, NOT a bank-verified
  // authenticity check — image hash + QR decode only). slip_hash is the sha256
  // hex digest of the uploaded slip image bytes, used to catch the same physical
  // slip photo reused across multiple orders. slip_qr_payload is the raw string
  // decoded from the QR code embedded in the slip (usually the issuing bank's own
  // slip-verification URL), letting an admin one-tap open the bank's verification
  // page instead of re-scanning the photo; NULL if no QR was detected. slip_flag
  // is NULL when the slip passed the pre-filter, otherwise one of
  // 'duplicate_image' | 'duplicate_qr' | 'no_qr', set at order-creation time by
  // comparing against previously submitted slips. Mirrors
  // drizzle/0035_spotty_nuke.sql exactly. All three columns nullable, two new
  // indexes for duplicate lookups ⇒ additive, idempotent, non-destructive.
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS slip_hash text`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS slip_qr_payload text`;
  await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS slip_flag text`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_orders_slip_hash ON shop_orders (slip_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shop_orders_slip_qr ON shop_orders (slip_qr_payload)`;
  console.log("  ✅ shop_orders.slip_hash / slip_qr_payload / slip_flag + duplicate-lookup indexes");

  console.log("✅ Migration complete!");
  await sql.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
