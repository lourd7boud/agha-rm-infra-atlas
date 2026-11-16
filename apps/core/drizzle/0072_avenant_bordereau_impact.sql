ALTER TABLE project.avenant
  ADD COLUMN bordereau_impact jsonb,
  ADD COLUMN bordereau_impact_order integer;
--> statement-breakpoint
CREATE UNIQUE INDEX avenant_bordereau_impact_order_uq
  ON project.avenant(project_id, bordereau_impact_order)
  WHERE bordereau_impact_order IS NOT NULL;
