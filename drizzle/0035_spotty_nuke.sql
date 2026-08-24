ALTER TABLE "shop_orders" ADD COLUMN "slip_hash" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "slip_qr_payload" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "slip_flag" text;--> statement-breakpoint
CREATE INDEX "idx_shop_orders_slip_hash" ON "shop_orders" USING btree ("slip_hash");--> statement-breakpoint
CREATE INDEX "idx_shop_orders_slip_qr" ON "shop_orders" USING btree ("slip_qr_payload");