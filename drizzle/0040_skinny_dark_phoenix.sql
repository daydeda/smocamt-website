ALTER TABLE "attendance" ADD COLUMN "check_out_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "require_check_out" boolean DEFAULT false NOT NULL;