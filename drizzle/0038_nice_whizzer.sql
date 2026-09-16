CREATE TABLE "shop_sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_info" text DEFAULT '' NOT NULL,
	"qr_image_url" text,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"pickup_info" text DEFAULT '' NOT NULL,
	"review_note" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "checkout_group_id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_sellers" ADD CONSTRAINT "shop_sellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_sellers_user_unique" ON "shop_sellers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shop_sellers_status_idx" ON "shop_sellers" USING btree ("status");--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_seller_id_shop_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."shop_sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_seller_id_shop_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."shop_sellers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shop_orders_seller" ON "shop_orders" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_checkout_group" ON "shop_orders" USING btree ("checkout_group_id");--> statement-breakpoint
CREATE INDEX "idx_shop_products_seller" ON "shop_products" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_shop_products_approval" ON "shop_products" USING btree ("approval_status");