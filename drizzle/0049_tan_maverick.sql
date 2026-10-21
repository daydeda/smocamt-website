ALTER TABLE "shop_orders" ADD COLUMN "welfare_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "welfare_price" integer;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "welfare_roles" jsonb;