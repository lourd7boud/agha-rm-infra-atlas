ALTER TABLE "equipment"."assignment" ADD COLUMN "operator_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment"."assignment" ADD CONSTRAINT "assignment_operator_id_employee_id_fk" FOREIGN KEY ("operator_id") REFERENCES "people"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_assignment_operator_id_idx" ON "equipment"."assignment" USING btree ("operator_id");
