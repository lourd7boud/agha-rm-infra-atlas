CREATE TABLE "tender"."list_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender"."list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"owner_sub" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender"."saved_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text DEFAULT 'agha-rm-infra' NOT NULL,
	"owner_sub" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tender"."list_member" ADD CONSTRAINT "list_member_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "tender"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender"."list_member" ADD CONSTRAINT "list_member_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "tender"."tender"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tender_list_member_uniq" ON "tender"."list_member" USING btree ("list_id","tender_id");--> statement-breakpoint
CREATE INDEX "tender_list_member_list_idx" ON "tender"."list_member" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "tender_list_member_tender_idx" ON "tender"."list_member" USING btree ("tender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_list_owner_name_uniq" ON "tender"."list" USING btree ("company_id","owner_sub","name");--> statement-breakpoint
CREATE INDEX "tender_list_owner_idx" ON "tender"."list" USING btree ("owner_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_saved_search_owner_name_uniq" ON "tender"."saved_search" USING btree ("company_id","owner_sub","name");--> statement-breakpoint
CREATE INDEX "tender_saved_search_owner_idx" ON "tender"."saved_search" USING btree ("owner_sub");