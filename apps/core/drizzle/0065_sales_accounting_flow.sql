-- 0065 — Issued sales documents, settlement ledger and auditable accounting projection.
-- Forward-only: restore the verified pre-deployment backup instead of dropping
-- financial history after this migration has accepted production events.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales.quote
    WHERE reference IS NOT NULL
    GROUP BY company_id, reference HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM sales.delivery_note
    WHERE reference IS NOT NULL
    GROUP BY company_id, reference HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM sales.invoice
    WHERE reference IS NOT NULL
    GROUP BY company_id, reference HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0065 preflight: duplicate legacy sales references detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sales.invoice
    WHERE status NOT IN ('brouillon', 'envoyee', 'payee', 'annulee')
  ) THEN
    RAISE EXCEPTION '0065 preflight: unexpected legacy invoice status detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sales.quote
    WHERE status NOT IN ('brouillon', 'envoye', 'accepte', 'refuse', 'expire')
  ) THEN
    RAISE EXCEPTION '0065 preflight: unexpected legacy quote status detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sales.delivery_note
    WHERE status NOT IN ('brouillon', 'livre')
  ) THEN
    RAISE EXCEPTION '0065 preflight: unexpected legacy delivery-note status detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sales.quote
    WHERE status <> 'brouillon'
      AND reference !~ '^DEV-[0-9]{4}-[0-9]{4,6}$'
  ) OR EXISTS (
    SELECT 1 FROM sales.delivery_note
    WHERE status <> 'brouillon'
      AND reference !~ '^BL-[0-9]{4}-[0-9]{4,6}$'
  ) OR EXISTS (
    SELECT 1 FROM sales.invoice
    WHERE status <> 'brouillon'
      AND reference !~ '^FAC-[0-9]{4}-[0-9]{4,6}$'
  ) THEN
    RAISE EXCEPTION '0065 preflight: malformed legacy official reference detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sales.invoice
    WHERE status = 'payee' AND paid_at IS NULL
  ) THEN
    RAISE EXCEPTION '0065 preflight: paid legacy invoice has no paid_at date';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE sales.client
  ADD COLUMN client_type text NOT NULL DEFAULT 'professionnel';
--> statement-breakpoint
ALTER TABLE sales.client
  ADD CONSTRAINT sales_client_type_chk
  CHECK (client_type IN ('professionnel', 'particulier'));
--> statement-breakpoint

ALTER TABLE sales.quote
  ADD COLUMN legacy_reference text,
  ADD COLUMN issued_at timestamp with time zone,
  ADD COLUMN issued_by text,
  ADD COLUMN issue_idempotency_key text,
  ADD COLUMN legal_snapshot jsonb,
  ADD COLUMN content_hash text,
  ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE sales.quote SET legacy_reference = reference WHERE reference IS NOT NULL;
--> statement-breakpoint
UPDATE sales.quote
SET issued_at = created_at,
    issued_by = 'migration:legacy',
    legal_snapshot = jsonb_build_object('legacy', true),
    content_hash = 'legacy-md5:' || md5(concat_ws('|', id::text, reference, status, total_ht_mad::text, total_ttc_mad::text))
WHERE status <> 'brouillon';
--> statement-breakpoint
ALTER TABLE sales.quote ALTER COLUMN reference DROP NOT NULL;
--> statement-breakpoint
UPDATE sales.quote SET reference = NULL WHERE status = 'brouillon';
--> statement-breakpoint
CREATE UNIQUE INDEX sales_quote_issue_idempotency_uniq
  ON sales.quote (company_id, issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE sales.quote
  ADD CONSTRAINT sales_quote_status_chk
    CHECK (status IN ('brouillon', 'envoye', 'accepte', 'refuse', 'expire')),
  ADD CONSTRAINT sales_quote_issue_state_chk CHECK (
    (status = 'brouillon' AND reference IS NULL AND issued_at IS NULL
      AND issued_by IS NULL AND legal_snapshot IS NULL AND content_hash IS NULL)
    OR (status <> 'brouillon' AND reference IS NOT NULL AND issued_at IS NOT NULL
      AND issued_by IS NOT NULL AND legal_snapshot IS NOT NULL AND content_hash IS NOT NULL)
  ),
  ADD CONSTRAINT sales_quote_version_chk CHECK (version > 0);
--> statement-breakpoint

ALTER TABLE sales.delivery_note
  ADD COLUMN legacy_reference text,
  ADD COLUMN issued_at timestamp with time zone,
  ADD COLUMN issued_by text,
  ADD COLUMN issue_idempotency_key text,
  ADD COLUMN legal_snapshot jsonb,
  ADD COLUMN content_hash text,
  ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE sales.delivery_note SET legacy_reference = reference WHERE reference IS NOT NULL;
--> statement-breakpoint
UPDATE sales.delivery_note
SET issued_at = created_at,
    issued_by = 'migration:legacy',
    legal_snapshot = jsonb_build_object('legacy', true),
    content_hash = 'legacy-md5:' || md5(concat_ws('|', id::text, reference, status, delivery_date::text))
WHERE status <> 'brouillon';
--> statement-breakpoint
ALTER TABLE sales.delivery_note ALTER COLUMN reference DROP NOT NULL;
--> statement-breakpoint
UPDATE sales.delivery_note SET reference = NULL WHERE status = 'brouillon';
--> statement-breakpoint
CREATE UNIQUE INDEX sales_delivery_note_issue_idempotency_uniq
  ON sales.delivery_note (company_id, issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE sales.delivery_note
  ADD CONSTRAINT sales_delivery_note_status_chk
    CHECK (status IN ('brouillon', 'livre')),
  ADD CONSTRAINT sales_delivery_note_issue_state_chk CHECK (
    (status = 'brouillon' AND reference IS NULL AND issued_at IS NULL
      AND issued_by IS NULL AND legal_snapshot IS NULL AND content_hash IS NULL)
    OR (status <> 'brouillon' AND reference IS NOT NULL AND issued_at IS NOT NULL
      AND issued_by IS NOT NULL AND legal_snapshot IS NOT NULL AND content_hash IS NOT NULL)
  ),
  ADD CONSTRAINT sales_delivery_note_version_chk CHECK (version > 0);
--> statement-breakpoint

ALTER TABLE sales.invoice
  ADD COLUMN legacy_reference text,
  ADD COLUMN tva_mad numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN legacy_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_terms text,
  ADD COLUMN planned_payment_method text,
  ADD COLUMN currency text NOT NULL DEFAULT 'MAD',
  ADD COLUMN issued_at timestamp with time zone,
  ADD COLUMN issued_by text,
  ADD COLUMN issue_idempotency_key text,
  ADD COLUMN legal_snapshot jsonb,
  ADD COLUMN content_hash text,
  ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE sales.invoice
SET legacy_reference = reference,
    tva_mad = total_ttc_mad - total_ht_mad,
    legacy_paid = (status = 'payee')
WHERE reference IS NOT NULL;
--> statement-breakpoint
UPDATE sales.invoice
SET issued_at = created_at,
    issued_by = 'migration:legacy',
    legal_snapshot = jsonb_build_object('legacy', true),
    content_hash = 'legacy-md5:' || md5(concat_ws('|', id::text, reference, status, total_ht_mad::text, total_ttc_mad::text))
WHERE status <> 'brouillon';
--> statement-breakpoint
ALTER TABLE sales.invoice ALTER COLUMN reference DROP NOT NULL;
--> statement-breakpoint
UPDATE sales.invoice SET reference = NULL WHERE status = 'brouillon';
--> statement-breakpoint
UPDATE sales.invoice SET status = 'emise' WHERE status IN ('envoyee', 'payee');
--> statement-breakpoint
CREATE UNIQUE INDEX sales_invoice_issue_idempotency_uniq
  ON sales.invoice (company_id, issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE sales.invoice
  ADD CONSTRAINT sales_invoice_status_chk
    CHECK (status IN ('brouillon', 'emise', 'annulee')),
  ADD CONSTRAINT sales_invoice_issue_state_chk CHECK (
    (status = 'brouillon' AND reference IS NULL AND issued_at IS NULL
      AND issued_by IS NULL AND legal_snapshot IS NULL AND content_hash IS NULL)
    OR (status <> 'brouillon' AND reference IS NOT NULL AND issued_at IS NOT NULL
      AND issued_by IS NOT NULL AND legal_snapshot IS NOT NULL AND content_hash IS NOT NULL)
  ),
  ADD CONSTRAINT sales_invoice_totals_chk
    CHECK (total_ht_mad >= 0 AND tva_mad >= 0 AND total_ht_mad + tva_mad = total_ttc_mad),
  ADD CONSTRAINT sales_invoice_version_chk CHECK (version > 0),
  ADD CONSTRAINT sales_invoice_currency_chk CHECK (currency = 'MAD'),
  ADD CONSTRAINT sales_invoice_legacy_paid_chk CHECK (NOT legacy_paid OR paid_at IS NOT NULL);
--> statement-breakpoint

-- 0051 already created the legacy counter. Keep it intact for audit and
-- migrate its high-water marks; issuing a draft must never reuse an old number.
ALTER TABLE sales.doc_sequence RENAME TO doc_sequence_legacy_0051;
--> statement-breakpoint
CREATE TABLE sales.doc_sequence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id text NOT NULL,
  doc_type text NOT NULL,
  fiscal_year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_doc_sequence_type_chk CHECK (doc_type IN ('DEV', 'BL', 'FAC', 'AV')),
  CONSTRAINT sales_doc_sequence_year_chk CHECK (fiscal_year BETWEEN 2000 AND 9999),
  CONSTRAINT sales_doc_sequence_value_chk CHECK (last_value >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_doc_sequence_scope_uniq
  ON sales.doc_sequence (company_id, doc_type, fiscal_year);
--> statement-breakpoint

INSERT INTO sales.doc_sequence (company_id, doc_type, fiscal_year, last_value)
SELECT company_id, 'DEV', substring(reference FROM '^DEV-([0-9]{4})-')::integer,
       max(substring(reference FROM '-([0-9]{4,6})$')::integer)
FROM sales.quote
WHERE reference ~ '^DEV-[0-9]{4}-[0-9]{4,6}$'
GROUP BY company_id, substring(reference FROM '^DEV-([0-9]{4})-')::integer;
--> statement-breakpoint
INSERT INTO sales.doc_sequence (company_id, doc_type, fiscal_year, last_value)
SELECT company_id, 'BL', substring(reference FROM '^BL-([0-9]{4})-')::integer,
       max(substring(reference FROM '-([0-9]{4,6})$')::integer)
FROM sales.delivery_note
WHERE reference ~ '^BL-[0-9]{4}-[0-9]{4,6}$'
GROUP BY company_id, substring(reference FROM '^BL-([0-9]{4})-')::integer;
--> statement-breakpoint
INSERT INTO sales.doc_sequence (company_id, doc_type, fiscal_year, last_value)
SELECT company_id, 'FAC', substring(reference FROM '^FAC-([0-9]{4})-')::integer,
       max(substring(reference FROM '-([0-9]{4,6})$')::integer)
FROM sales.invoice
WHERE reference ~ '^FAC-[0-9]{4}-[0-9]{4,6}$'
GROUP BY company_id, substring(reference FROM '^FAC-([0-9]{4})-')::integer;
--> statement-breakpoint

INSERT INTO sales.doc_sequence (company_id, doc_type, fiscal_year, last_value)
SELECT company_id,
       CASE doc_type WHEN 'devis' THEN 'DEV' WHEN 'bl' THEN 'BL'
         WHEN 'facture' THEN 'FAC' WHEN 'avoir' THEN 'AV' ELSE doc_type END,
       exercice, last_number
FROM sales.doc_sequence_legacy_0051
ON CONFLICT (company_id, doc_type, fiscal_year)
DO UPDATE SET last_value = GREATEST(sales.doc_sequence.last_value, EXCLUDED.last_value);
--> statement-breakpoint

CREATE TABLE sales.invoice_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  invoice_id uuid NOT NULL,
  movement_type text NOT NULL,
  reason text NOT NULL DEFAULT 'reglement_client',
  amount_mad numeric(14,2) NOT NULL,
  method text NOT NULL,
  reference text,
  treasury_account text NOT NULL,
  value_date date NOT NULL,
  original_movement_id uuid,
  credit_note_id uuid,
  tva_transferred_mad numeric(14,2) NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  note text,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoice_payment_type_chk
    CHECK (movement_type IN ('encaissement', 'remboursement')),
  CONSTRAINT sales_invoice_payment_reason_chk
    CHECK (reason IN ('reglement_client', 'contrepassation', 'remboursement_avoir')),
  CONSTRAINT sales_invoice_payment_link_chk CHECK (
    (movement_type = 'encaissement' AND reason = 'reglement_client'
      AND original_movement_id IS NULL AND credit_note_id IS NULL)
    OR (movement_type = 'remboursement' AND reason = 'contrepassation'
      AND original_movement_id IS NOT NULL AND credit_note_id IS NULL
      AND original_movement_id <> id)
    OR (movement_type = 'remboursement' AND reason = 'remboursement_avoir'
      AND original_movement_id IS NULL AND credit_note_id IS NOT NULL)
  ),
  CONSTRAINT sales_invoice_payment_amount_chk CHECK (amount_mad > 0),
  CONSTRAINT sales_invoice_payment_tva_chk
    CHECK (tva_transferred_mad >= 0 AND tva_transferred_mad <= amount_mad)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_invoice_payment_id_invoice_uniq
  ON sales.invoice_payment (id, invoice_id);
--> statement-breakpoint
ALTER TABLE sales.invoice_payment
  ADD CONSTRAINT invoice_payment_invoice_id_invoice_id_fk
  FOREIGN KEY (invoice_id) REFERENCES sales.invoice(id),
  ADD CONSTRAINT sales_invoice_payment_original_fk
  FOREIGN KEY (original_movement_id, invoice_id)
    REFERENCES sales.invoice_payment(id, invoice_id),
  ADD CONSTRAINT sales_invoice_payment_treasury_account_fk
  FOREIGN KEY (treasury_account) REFERENCES compta.compte(code);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_invoice_payment_idempotency_uniq
  ON sales.invoice_payment (invoice_id, idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_invoice_payment_reversal_uniq
  ON sales.invoice_payment (original_movement_id)
  WHERE original_movement_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sales_invoice_payment_invoice_date_idx
  ON sales.invoice_payment (invoice_id, value_date);
--> statement-breakpoint

CREATE TABLE sales.credit_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id text NOT NULL DEFAULT 'agha-rm-infra',
  invoice_id uuid NOT NULL,
  reference text,
  legacy_reference text,
  status text NOT NULL DEFAULT 'brouillon',
  credit_date date NOT NULL,
  total_ht_mad numeric(14,2) NOT NULL,
  tva_pct numeric(5,2) NOT NULL,
  tva_mad numeric(14,2) NOT NULL,
  total_ttc_mad numeric(14,2) NOT NULL,
  against_outstanding_mad numeric(14,2) NOT NULL DEFAULT 0,
  against_collected_mad numeric(14,2) NOT NULL DEFAULT 0,
  reversed_pending_tva_mad numeric(14,2) NOT NULL DEFAULT 0,
  reversed_due_tva_mad numeric(14,2) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  issue_idempotency_key text,
  legal_snapshot jsonb,
  content_hash text,
  issued_at timestamp with time zone,
  issued_by text,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_credit_note_status_chk
    CHECK (status IN ('brouillon', 'emise', 'annulee')),
  CONSTRAINT sales_credit_note_amount_chk CHECK (total_ttc_mad > 0),
  CONSTRAINT sales_credit_note_components_chk CHECK (
    total_ht_mad >= 0 AND tva_mad >= 0
    AND against_outstanding_mad >= 0 AND against_collected_mad >= 0
    AND reversed_pending_tva_mad >= 0 AND reversed_due_tva_mad >= 0
  ),
  CONSTRAINT sales_credit_note_totals_chk
    CHECK (total_ht_mad + tva_mad = total_ttc_mad),
  CONSTRAINT sales_credit_note_allocation_chk
    CHECK (status = 'brouillon' OR against_outstanding_mad + against_collected_mad = total_ttc_mad),
  CONSTRAINT sales_credit_note_reversed_tva_chk
    CHECK (status = 'brouillon' OR reversed_pending_tva_mad + reversed_due_tva_mad = tva_mad),
  CONSTRAINT sales_credit_note_issue_state_chk CHECK (
    (status = 'brouillon' AND reference IS NULL AND issued_at IS NULL
      AND issued_by IS NULL AND legal_snapshot IS NULL AND content_hash IS NULL)
    OR (status <> 'brouillon' AND reference IS NOT NULL AND issued_at IS NOT NULL
      AND issued_by IS NOT NULL AND legal_snapshot IS NOT NULL AND content_hash IS NOT NULL)
  ),
  CONSTRAINT sales_credit_note_version_chk CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_credit_note_company_reference_uniq
  ON sales.credit_note (company_id, reference);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_credit_note_issue_idempotency_uniq
  ON sales.credit_note (company_id, issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sales_credit_note_invoice_idx ON sales.credit_note (invoice_id);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_credit_note_id_invoice_uniq
  ON sales.credit_note (id, invoice_id);
--> statement-breakpoint
ALTER TABLE sales.credit_note
  ADD CONSTRAINT credit_note_invoice_id_invoice_id_fk
  FOREIGN KEY (invoice_id) REFERENCES sales.invoice(id);
--> statement-breakpoint

ALTER TABLE sales.invoice_payment
  ADD CONSTRAINT sales_invoice_payment_credit_note_fk
  FOREIGN KEY (credit_note_id, invoice_id)
    REFERENCES sales.credit_note(id, invoice_id);
--> statement-breakpoint

CREATE TABLE sales.credit_note_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  credit_note_id uuid NOT NULL,
  designation text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit text,
  unit_price_mad numeric(14,2) NOT NULL,
  tva_pct numeric(5,2) NOT NULL,
  line_total_mad numeric(14,2) NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  CONSTRAINT sales_credit_note_line_amounts_chk
    CHECK (quantity > 0 AND unit_price_mad >= 0 AND tva_pct >= 0 AND line_total_mad >= 0)
);
--> statement-breakpoint
ALTER TABLE sales.credit_note_line
  ADD CONSTRAINT credit_note_line_credit_note_id_credit_note_id_fk
  FOREIGN KEY (credit_note_id) REFERENCES sales.credit_note(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX sales_credit_note_line_credit_note_idx
  ON sales.credit_note_line (credit_note_id);
--> statement-breakpoint

CREATE FUNCTION sales.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; write a compensating record instead', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sales_invoice_payment_append_only
BEFORE UPDATE OR DELETE ON sales.invoice_payment
FOR EACH ROW EXECUTE FUNCTION sales.reject_append_only_mutation();
--> statement-breakpoint

CREATE FUNCTION sales.validate_invoice_payment_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_invoice_id uuid;
  original_type text;
  original_amount numeric(14,2);
  original_tva numeric(14,2);
BEGIN
  IF NEW.reason = 'contrepassation' THEN
    SELECT invoice_id, movement_type, amount_mad, tva_transferred_mad
      INTO original_invoice_id, original_type, original_amount, original_tva
    FROM sales.invoice_payment
    WHERE id = NEW.original_movement_id;

    IF NOT FOUND OR original_invoice_id <> NEW.invoice_id
      OR original_type <> 'encaissement'
      OR original_amount <> NEW.amount_mad
      OR original_tva <> NEW.tva_transferred_mad THEN
      RAISE EXCEPTION 'invalid payment reversal link';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sales_invoice_payment_link_guard
BEFORE INSERT ON sales.invoice_payment
FOR EACH ROW EXECUTE FUNCTION sales.validate_invoice_payment_link();
--> statement-breakpoint

CREATE FUNCTION sales.guard_issued_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'brouillon' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'issued % records cannot be deleted', TG_TABLE_NAME;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'version'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'version']) THEN
      RAISE EXCEPTION 'issued % content is immutable', TG_TABLE_NAME;
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'issued % status changes require one version increment', TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sales_quote_issued_immutable
BEFORE UPDATE OR DELETE ON sales.quote
FOR EACH ROW EXECUTE FUNCTION sales.guard_issued_document_mutation();
--> statement-breakpoint
CREATE TRIGGER sales_delivery_note_issued_immutable
BEFORE UPDATE OR DELETE ON sales.delivery_note
FOR EACH ROW EXECUTE FUNCTION sales.guard_issued_document_mutation();
--> statement-breakpoint
CREATE TRIGGER sales_invoice_issued_immutable
BEFORE UPDATE OR DELETE ON sales.invoice
FOR EACH ROW EXECUTE FUNCTION sales.guard_issued_document_mutation();
--> statement-breakpoint
CREATE TRIGGER sales_credit_note_issued_immutable
BEFORE UPDATE OR DELETE ON sales.credit_note
FOR EACH ROW EXECUTE FUNCTION sales.guard_issued_document_mutation();
--> statement-breakpoint

ALTER TABLE compta.profil
  ADD COLUMN fait_generateur_tva text NOT NULL DEFAULT 'non_configure',
  ADD COLUMN compte_client_ventes text,
  ADD COLUMN compte_produit_ventes text,
  ADD COLUMN compte_tva_attente text,
  ADD COLUMN compte_tva_due text;
--> statement-breakpoint
ALTER TABLE compta.profil
  ADD CONSTRAINT compta_profil_fait_generateur_tva_chk
    CHECK (fait_generateur_tva IN ('non_configure', 'encaissement', 'debits')),
  ADD CONSTRAINT compta_profil_compte_client_ventes_fk
    FOREIGN KEY (compte_client_ventes) REFERENCES compta.compte(code),
  ADD CONSTRAINT compta_profil_compte_produit_ventes_fk
    FOREIGN KEY (compte_produit_ventes) REFERENCES compta.compte(code),
  ADD CONSTRAINT compta_profil_compte_tva_attente_fk
    FOREIGN KEY (compte_tva_attente) REFERENCES compta.compte(code),
  ADD CONSTRAINT compta_profil_compte_tva_due_fk
    FOREIGN KEY (compte_tva_due) REFERENCES compta.compte(code);
--> statement-breakpoint

CREATE TABLE compta.profil_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  profil_id text NOT NULL,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by text NOT NULL,
  changed_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE compta.profil_audit
  ADD CONSTRAINT profil_audit_profil_id_profil_id_fk
  FOREIGN KEY (profil_id) REFERENCES compta.profil(id);
--> statement-breakpoint
CREATE INDEX compta_profil_audit_profile_date_idx
  ON compta.profil_audit (profil_id, changed_at);
--> statement-breakpoint
CREATE TRIGGER compta_profil_audit_append_only
BEFORE UPDATE OR DELETE ON compta.profil_audit
FOR EACH ROW EXECUTE FUNCTION sales.reject_append_only_mutation();
--> statement-breakpoint

ALTER TABLE compta.ecriture
  ADD COLUMN source_event text NOT NULL DEFAULT 'principal',
  ADD COLUMN validated_by text,
  ADD COLUMN validated_at timestamp with time zone;
--> statement-breakpoint
UPDATE compta.ecriture
SET validated_by = 'migration:legacy',
    validated_at = COALESCE(updated_at, created_at)
WHERE statut = 'validee';
--> statement-breakpoint
DROP INDEX IF EXISTS compta.compta_ecriture_source_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX compta_ecriture_source_event_uniq
  ON compta.ecriture (source, source_id, source_event)
  WHERE source_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE compta.ecriture
  ADD CONSTRAINT compta_ecriture_validation_audit_chk CHECK (
    (statut = 'brouillon' AND validated_by IS NULL AND validated_at IS NULL)
    OR (statut = 'validee' AND validated_by IS NOT NULL AND validated_at IS NOT NULL)
  );
--> statement-breakpoint

CREATE FUNCTION compta.guard_validated_ecriture_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.statut = 'validee' THEN
    RAISE EXCEPTION 'validated accounting entries are immutable; create a counter-entry';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER compta_ecriture_validated_immutable
BEFORE UPDATE OR DELETE ON compta.ecriture
FOR EACH ROW EXECUTE FUNCTION compta.guard_validated_ecriture_mutation();
--> statement-breakpoint

CREATE TABLE sales.accounting_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id text NOT NULL DEFAULT 'agha-rm-infra',
  event_key text NOT NULL,
  event_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_version integer NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  accounting_entry_id uuid,
  projected_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_accounting_event_status_chk
    CHECK (status IN ('pending', 'projected', 'blocked')),
  CONSTRAINT sales_accounting_event_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT sales_accounting_event_source_version_chk CHECK (source_version > 0),
  CONSTRAINT sales_accounting_event_projection_chk CHECK (
    (status = 'projected' AND accounting_entry_id IS NOT NULL AND projected_at IS NOT NULL)
    OR (status <> 'projected' AND accounting_entry_id IS NULL AND projected_at IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE sales.accounting_event
  ADD CONSTRAINT sales_accounting_event_entry_fk
  FOREIGN KEY (accounting_entry_id) REFERENCES compta.ecriture(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX sales_accounting_event_company_key_uniq
  ON sales.accounting_event (company_id, event_key);
--> statement-breakpoint
CREATE INDEX sales_accounting_event_status_date_idx
  ON sales.accounting_event (status, occurred_at);
--> statement-breakpoint
CREATE INDEX sales_accounting_event_source_idx
  ON sales.accounting_event (source_type, source_id);
