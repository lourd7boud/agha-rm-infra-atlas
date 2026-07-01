-- Phase 1 (datao parity): dual-lane French FTS on tender.tender.
--
-- Datao surfaces search across TWO tsvectors:
--   fts_search      = general text (reference, objet, buyer_name, location, summary)
--   fts_bdp_search  = bordereau line-item designations from raw.dossierExtraction.bpu[]
--
-- The second lane is the competitive gap ATLAS lacks: a user typing "câbles
-- électriques" finds tenders whose BPU contains that line item, not only
-- tenders whose title/summary mentions it. Both use the `french` config with
-- websearch_to_tsquery in the search endpoint.
--
-- Columns are populated by a BEFORE INSERT/UPDATE trigger; application code
-- never writes them. The trigger fires when reference, objet, buyer_name,
-- location, or raw changes — the five inputs that feed the vectors.
--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN "fts_search" tsvector;--> statement-breakpoint
ALTER TABLE "tender"."tender" ADD COLUMN "fts_bdp_search" tsvector;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tender"."tender_fts_refresh"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bpu_txt text;
BEGIN
  NEW.fts_search :=
       setweight(to_tsvector('french', coalesce(NEW.reference, '')), 'A')
    || setweight(to_tsvector('french', coalesce(NEW.objet, '')), 'B')
    || setweight(to_tsvector('french', coalesce(NEW.buyer_name, '')), 'B')
    || setweight(to_tsvector('french', coalesce(NEW.location, '')), 'C')
    || setweight(to_tsvector('french',
         coalesce(NEW.raw #>> '{dossierExtraction,summary}', '')), 'C');

  -- Fold every BPU line's section+designation into one text blob; guard against
  -- absent/invalid arrays so a legacy row with raw=null never fails the write.
  IF jsonb_typeof(NEW.raw #> '{dossierExtraction,bpu}') = 'array' THEN
    SELECT string_agg(
             coalesce(elem->>'section', '') || ' ' || coalesce(elem->>'designation', ''),
             ' '
           )
      INTO bpu_txt
      FROM jsonb_array_elements(NEW.raw #> '{dossierExtraction,bpu}') AS elem;
  END IF;

  NEW.fts_bdp_search := to_tsvector('french', coalesce(bpu_txt, ''));
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "tender_fts_refresh_biu"
  BEFORE INSERT OR UPDATE OF reference, objet, buyer_name, location, raw
  ON "tender"."tender"
  FOR EACH ROW EXECUTE FUNCTION "tender"."tender_fts_refresh"();--> statement-breakpoint

-- Backfill existing rows by nudging a trigger column. UPDATE OF fires the
-- trigger even when the value is unchanged, which is exactly what we want here.
UPDATE "tender"."tender" SET "reference" = "reference" WHERE "fts_search" IS NULL;--> statement-breakpoint

CREATE INDEX "tender_fts_search_gin" ON "tender"."tender" USING GIN ("fts_search");--> statement-breakpoint
CREATE INDEX "tender_fts_bdp_search_gin" ON "tender"."tender" USING GIN ("fts_bdp_search");
