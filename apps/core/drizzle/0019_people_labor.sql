CREATE TABLE "people"."work_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"days_worked" numeric(4, 2) DEFAULT '1' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people"."assignment" ADD COLUMN "rate_type" text;--> statement-breakpoint
ALTER TABLE "people"."assignment" ADD COLUMN "rate_amount_mad" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "people"."work_day" ADD CONSTRAINT "work_day_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "people"."assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_day_assignment_id_idx" ON "people"."work_day" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_day_assignment_date_uniq" ON "people"."work_day" USING btree ("assignment_id","work_date");