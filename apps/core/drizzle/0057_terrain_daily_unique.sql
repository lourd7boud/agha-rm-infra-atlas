CREATE UNIQUE INDEX terrain_journee_project_date_uq
ON project.terrain_journee(project_id, (payload->>'date'));
