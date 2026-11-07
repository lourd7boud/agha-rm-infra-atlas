-- Legal sequential numbering (art. 145 CGI) for sales documents. A per-(company,
-- doc_type, exercice) counter the repository increments ATOMICALLY inside each
-- document's insert transaction (INSERT … ON CONFLICT DO UPDATE … RETURNING), so
-- invoice numbering stays continuous and gap-free (each number used once). A
-- rolled-back insert also rolls back the increment. doc_type ∈ {facture,devis,
-- bl,avoir}; exercice is the fiscal (calendar) year. The `sales` schema already
-- exists (migration 0021).
CREATE TABLE IF NOT EXISTS "sales"."doc_sequence" (
  "company_id" text NOT NULL DEFAULT 'agha-rm-infra',
  "doc_type" text NOT NULL,
  "exercice" integer NOT NULL,
  "last_number" integer NOT NULL DEFAULT 0,
  CONSTRAINT "sales_doc_sequence_pk" PRIMARY KEY ("company_id", "doc_type", "exercice")
);
