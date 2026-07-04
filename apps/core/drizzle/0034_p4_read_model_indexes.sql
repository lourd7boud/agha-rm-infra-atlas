-- P4 (scalable read architecture): hot-column btree indexes on the growing
-- module tables that still seq-scan.
--
-- After P1/P2 covered tender.tender, the ERP module tables (project, people,
-- sales, supply, intel, finance, equipment) kept growing with NO index on the
-- columns their list/facet/join reads filter and order by — so every such query
-- was a full sequential scan. These back the by-project situation/avenant/log
-- reads, the workforce/assignment joins, the sales & supply status boards, the
-- competitor_bid competitor rollup, the finance cashflow-by-date reads, the open
-- equipment-assignment lookup, and the tender pipeline+deadline wall.
-- See docs/architecture/SCALABLE-READ-ARCHITECTURE.md.
--
-- Hand-authored (drizzle-kit generate is blocked by a pre-existing snapshot
-- collision at 0026); applied by drizzle-kit migrate like every other migration.
-- IF NOT EXISTS keeps it safe to re-run and safe against any manually-created
-- index on the production box. Small tables → each CREATE is sub-second and runs
-- inside the migration transaction (no CONCURRENTLY).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "situation_project_id_idx" ON "project"."situation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avenant_project_id_idx" ON "project"."avenant" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_log_project_id_idx" ON "project"."daily_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_created_at_idx" ON "people"."employee" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_employee_id_idx" ON "people"."assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_project_id_idx" ON "people"."assignment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_invoice_status_idx" ON "sales"."invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_quote_status_idx" ON "sales"."quote" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_delivery_note_status_idx" ON "sales"."delivery_note" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supply_purchase_order_created_at_idx" ON "supply"."purchase_order" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supply_supplier_invoice_due_date_idx" ON "supply"."supplier_invoice" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supply_supplier_invoice_status_idx" ON "supply"."supplier_invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_bid_competitor_id_idx" ON "intel"."competitor_bid" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_created_at_idx" ON "finance"."payment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_created_at_idx" ON "finance"."expense" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_assignment_open_idx" ON "equipment"."assignment" USING btree ("equipment_id") WHERE "returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_pipeline_deadline_idx" ON "tender"."tender" USING btree ("pipeline_state","deadline_at");
