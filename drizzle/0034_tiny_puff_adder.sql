CREATE TABLE "feedback_complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_code_hash" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'normal' NOT NULL,
	"message" text NOT NULL,
	"contact_opt_in" boolean DEFAULT false NOT NULL,
	"contact_info" text,
	"attachment_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitter_ref" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"admin_reply" text,
	"replied_by" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_complaints_tracking_code_hash_idx" ON "feedback_complaints" USING btree ("tracking_code_hash");--> statement-breakpoint
CREATE INDEX "feedback_complaints_submitter_ref_idx" ON "feedback_complaints" USING btree ("submitter_ref");--> statement-breakpoint
CREATE INDEX "feedback_complaints_status_idx" ON "feedback_complaints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_complaints_category_idx" ON "feedback_complaints" USING btree ("category");