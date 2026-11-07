CREATE TABLE project.terrain_expense_reconciliation (
  expense_id uuid PRIMARY KEY REFERENCES finance.expense(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES project.project(id),
  treatment text NOT NULL CHECK (treatment IN ('standalone','linked_resource','non_cost')),
  resource_kind text CHECK (resource_kind IN ('main_oeuvre','materiel','consommation')),
  resource_id uuid,
  expense_amount_mad numeric(14,2) NOT NULL,
  resource_amount_mad numeric(14,2),
  note text NOT NULL,
  actor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  history jsonb NOT NULL DEFAULT '[]',
  CHECK ((treatment = 'linked_resource' AND resource_kind IS NOT NULL AND resource_id IS NOT NULL AND resource_amount_mad IS NOT NULL)
      OR (treatment <> 'linked_resource' AND resource_kind IS NULL AND resource_id IS NULL AND resource_amount_mad IS NULL))
);
CREATE INDEX terrain_expense_reconciliation_project_idx ON project.terrain_expense_reconciliation(project_id);
