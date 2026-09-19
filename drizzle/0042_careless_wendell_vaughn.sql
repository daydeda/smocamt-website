CREATE TABLE "prize_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prize_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"prize_name" text NOT NULL,
	"event_id" uuid,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"method" text DEFAULT 'qr' NOT NULL,
	"photo_key" text,
	"note" text,
	"one_per_student" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_id" uuid,
	"rank" integer,
	"quantity" integer,
	"one_per_student" boolean DEFAULT true NOT NULL,
	"require_check_in" boolean DEFAULT false NOT NULL,
	"eligibility_event_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_prize_id_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."prizes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_eligibility_event_id_events_id_fk" FOREIGN KEY ("eligibility_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prize_claims_once" ON "prize_claims" USING btree ("prize_id","student_id") WHERE "prize_claims"."one_per_student";--> statement-breakpoint
CREATE INDEX "idx_prize_claims_prize" ON "prize_claims" USING btree ("prize_id");--> statement-breakpoint
CREATE INDEX "idx_prize_claims_student" ON "prize_claims" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_prize_claims_event" ON "prize_claims" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_prize_claims_claimed_at" ON "prize_claims" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "idx_prizes_event" ON "prizes" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_prizes_eligibility_event" ON "prizes" USING btree ("eligibility_event_id");--> statement-breakpoint
CREATE INDEX "idx_prizes_status" ON "prizes" USING btree ("status");