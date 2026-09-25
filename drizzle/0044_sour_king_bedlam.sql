ALTER TABLE "shop_orders" ADD COLUMN "discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "bundle_deals" jsonb;