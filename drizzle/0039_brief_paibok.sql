ALTER TABLE "attendance" ADD COLUMN "evidence_file_key" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "evidence_nonce_submitted" text;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD COLUMN "evidence_nonce" text;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD COLUMN "evidence_prompt" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "check_in_mode" text DEFAULT 'qr' NOT NULL;