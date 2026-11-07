CREATE TABLE project.terrain_journee (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project.project(id),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','returned','reviewed')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0), payload jsonb NOT NULL,
 return_reason text, materialized_refs jsonb NOT NULL DEFAULT '[]', history jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX terrain_journee_project_idx ON project.terrain_journee(project_id,created_at DESC);
CREATE TABLE project.terrain_source (
 kind text NOT NULL, resource_id uuid NOT NULL, journee_id uuid NOT NULL REFERENCES project.terrain_journee(id),
 PRIMARY KEY(kind,resource_id)
);
-- Unknown valuations stay NULL, including when projected into existing resource tabs.
ALTER TABLE project.chantier_materiel ALTER COLUMN cout_carburant_mad DROP NOT NULL;
ALTER TABLE project.chantier_materiel ALTER COLUMN cout_location_mad DROP NOT NULL;
ALTER TABLE project.chantier_consommation ALTER COLUMN cout_mad DROP NOT NULL;
-- Accepted resources cannot be silently edited/deleted through a legacy endpoint.
CREATE FUNCTION project.guard_terrain_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM project.terrain_source s JOIN project.terrain_journee j ON j.id=s.journee_id
 WHERE s.kind=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME AND s.resource_id=OLD.id AND j.status='reviewed') THEN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='chantier_attachement' AND to_jsonb(OLD)->>'statut'='saisi' AND to_jsonb(NEW)->>'statut'='integre' AND (to_jsonb(NEW)-ARRAY['statut','metre_id','integrated_at','integrated_by'])=(to_jsonb(OLD)-ARRAY['statut','metre_id','integrated_at','integrated_by']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Ressource validée: correction auditable requise' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON project.daily_log FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON project.chantier_materiel FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON project.chantier_consommation FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON project.chantier_attachement FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON finance.expense FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
CREATE TRIGGER terrain_guard BEFORE UPDATE OR DELETE ON people.work_day FOR EACH ROW EXECUTE FUNCTION project.guard_terrain_source();
