CREATE TABLE "feedback_complaint_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complaint_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"staff_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'normal' NOT NULL,
	"message" text NOT NULL,
	"contact_opt_in" boolean DEFAULT false NOT NULL,
	"contact_info" text,
	"attachment_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitter_ref" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_complaint_messages" ADD CONSTRAINT "feedback_complaint_messages_complaint_id_feedback_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."feedback_complaints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_complaint_messages_complaint_idx" ON "feedback_complaint_messages" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "feedback_complaints_submitter_ref_idx" ON "feedback_complaints" USING btree ("submitter_ref");--> statement-breakpoint
CREATE INDEX "feedback_complaints_status_idx" ON "feedback_complaints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_complaints_category_idx" ON "feedback_complaints" USING btree ("category");