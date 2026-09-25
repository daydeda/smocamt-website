ALTER TABLE "shop_orders" ADD COLUMN "fulfillment_status" text DEFAULT 'awaiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "carrier_name" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "tracking_url" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "shipped_by" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfilled_by" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfilled_via" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfillment_note" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "issue_note" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "issue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_shipped_by_users_id_fk" FOREIGN KEY ("shipped_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_fulfilled_by_users_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shop_orders_fulfillment" ON "shop_orders" USING btree ("fulfillment_status");