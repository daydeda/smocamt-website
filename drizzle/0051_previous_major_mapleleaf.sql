CREATE TABLE "event_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_waitlist" ADD CONSTRAINT "event_waitlist_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_waitlist" ADD CONSTRAINT "event_waitlist_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_event_waitlist_event_student" ON "event_waitlist" USING btree ("event_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_event_waitlist_event_created" ON "event_waitlist" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_event_waitlist_student" ON "event_waitlist" USING btree ("student_id");