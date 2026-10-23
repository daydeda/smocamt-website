CREATE TABLE "form_reminders" (
	"form_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_reminders" ADD CONSTRAINT "form_reminders_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_form_reminders_form_stage" ON "form_reminders" USING btree ("form_id","stage");