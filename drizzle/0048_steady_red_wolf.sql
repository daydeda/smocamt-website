CREATE TABLE "property_tag_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code" text NOT NULL,
	"series" text NOT NULL,
	"serial" integer NOT NULL,
	"owner_user_id" text,
	"assigned_by" text,
	"assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_tags_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "property_tag_groups" ADD CONSTRAINT "property_tag_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tags" ADD CONSTRAINT "property_tags_group_id_property_tag_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."property_tag_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tags" ADD CONSTRAINT "property_tags_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tags" ADD CONSTRAINT "property_tags_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_property_tag_groups_status" ON "property_tag_groups" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_property_tags_series_serial" ON "property_tags" USING btree ("series","serial");--> statement-breakpoint
CREATE INDEX "idx_property_tags_group" ON "property_tags" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_property_tags_owner" ON "property_tags" USING btree ("owner_user_id");