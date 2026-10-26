ALTER TABLE "events" ADD COLUMN "short_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "events_short_slug_unique" ON "events" USING btree ("short_slug");