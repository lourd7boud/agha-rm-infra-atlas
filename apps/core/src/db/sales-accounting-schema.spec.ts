import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import {
  clients,
  creditNoteLines,
  creditNotes,
  deliveryNotes,
  docSequences,
  invoicePayments,
  invoices,
  quotes,
  salesAccountingEvents,
} from './schema/sales';
import {
  comptaProfil,
  comptaProfilAudits,
  ecritures,
  legalDocuments,
} from './schema/compta';

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.flatMap((entry) =>
    entry.config.name ? [entry.config.name] : [],
  );
}

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((entry) => entry.name);
}

function foreignKeyNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).foreignKeys.map((entry) => entry.getName());
}

describe('sales accounting schema contract', () => {
  test.each([
    ['quote', quotes],
    ['delivery note', deliveryNotes],
    ['invoice', invoices],
  ] as const)('$name drafts can exist without consuming an official reference', (_, table) => {
    const columns = getTableColumns(table);
    expect(columns.reference?.notNull).toBe(false);
    expect(columns.issuedAt).toBeDefined();
    expect(columns.issuedBy).toBeDefined();
    expect(columns.issueIdempotencyKey).toBeDefined();
    expect(columns.legalSnapshot).toBeDefined();
    expect(columns.contentHash).toBeDefined();
    expect(columns.version?.notNull).toBe(true);
  });

  test('scopes official document counters by company, type, and fiscal year', () => {
    expect(getTableColumns(docSequences)).toMatchObject({
      companyId: { notNull: true },
      docType: { notNull: true },
      fiscalYear: { notNull: true },
      lastValue: { notNull: true },
    });
    expect(indexNames(docSequences)).toContain('sales_doc_sequence_scope_uniq');
  });

  test('keeps lifecycle and monetary constraints in Drizzle metadata', () => {
    expect(checkNames(clients)).toContain('sales_client_type_chk');
    expect(checkNames(quotes)).toEqual(
      expect.arrayContaining([
        'sales_quote_issue_state_chk',
        'sales_quote_status_chk',
        'sales_quote_version_chk',
      ]),
    );
    expect(checkNames(deliveryNotes)).toEqual(
      expect.arrayContaining([
        'sales_delivery_note_issue_state_chk',
        'sales_delivery_note_status_chk',
        'sales_delivery_note_version_chk',
      ]),
    );
    expect(checkNames(invoices)).toEqual(
      expect.arrayContaining([
        'sales_invoice_status_chk',
        'sales_invoice_issue_state_chk',
        'sales_invoice_totals_chk',
        'sales_invoice_version_chk',
        'sales_invoice_currency_chk',
      ]),
    );
    expect(getTableColumns(invoices).legacyPaid?.notNull).toBe(true);
  });

  test('models payments and corrections as append-only first-class records', () => {
    const paymentColumns = getTableColumns(invoicePayments);
    expect(paymentColumns).toMatchObject({
      invoiceId: { notNull: true },
      movementType: { notNull: true },
      amountMad: { notNull: true },
      valueDate: { notNull: true },
      createdBy: { notNull: true },
      createdAt: { notNull: true },
    });
    expect(paymentColumns.originalMovementId).toBeDefined();
    expect(paymentColumns.creditNoteId).toBeDefined();
    expect(paymentColumns.tvaTransferredMad).toBeDefined();
    expect(indexNames(invoicePayments)).toContain(
      'sales_invoice_payment_idempotency_uniq',
    );
    expect(foreignKeyNames(invoicePayments)).toEqual(
      expect.arrayContaining([
        'sales_invoice_payment_original_fk',
        'sales_invoice_payment_treasury_account_fk',
      ]),
    );

    expect(getTableColumns(creditNotes)).toMatchObject({
      invoiceId: { notNull: true },
      reference: { notNull: false },
      status: { notNull: true },
      totalHtMad: { notNull: true },
      tvaMad: { notNull: true },
      totalTtcMad: { notNull: true },
      version: { notNull: true },
    });
    expect(getTableColumns(creditNoteLines).creditNoteId?.notNull).toBe(true);
    expect(checkNames(creditNotes)).toEqual(
      expect.arrayContaining([
        'sales_credit_note_components_chk',
        'sales_credit_note_reversed_tva_chk',
        'sales_credit_note_issue_state_chk',
        'sales_credit_note_version_chk',
      ]),
    );
    expect(checkNames(creditNoteLines)).toContain(
      'sales_credit_note_line_amounts_chk',
    );
  });

  test('persists every accounting projection attempt as an idempotent event', () => {
    expect(getTableColumns(salesAccountingEvents)).toMatchObject({
      eventKey: { notNull: true },
      eventType: { notNull: true },
      sourceId: { notNull: true },
      payload: { notNull: true },
      status: { notNull: true },
      attempts: { notNull: true },
    });
    expect(indexNames(salesAccountingEvents)).toContain(
      'sales_accounting_event_company_key_uniq',
    );
    expect(foreignKeyNames(salesAccountingEvents)).toContain(
      'sales_accounting_event_entry_fk',
    );
    expect(checkNames(salesAccountingEvents)).toEqual(
      expect.arrayContaining([
        'sales_accounting_event_source_version_chk',
        'sales_accounting_event_projection_chk',
      ]),
    );
  });

  test('separates TVA filing frequency, taxable event, and configurable accounts', () => {
    const columns = getTableColumns(comptaProfil);
    expect(columns.regimeTva?.notNull).toBe(true);
    expect(columns.faitGenerateurTva?.notNull).toBe(true);
    expect(columns.compteClientVentes).toBeDefined();
    expect(columns.compteProduitVentes).toBeDefined();
    expect(columns.compteTvaAttente).toBeDefined();
    expect(columns.compteTvaDue).toBeDefined();
    expect(foreignKeyNames(comptaProfil)).toEqual(
      expect.arrayContaining([
        'compta_profil_compte_client_ventes_fk',
        'compta_profil_compte_produit_ventes_fk',
        'compta_profil_compte_tva_attente_fk',
        'compta_profil_compte_tva_due_fk',
      ]),
    );

    expect(getTableColumns(comptaProfilAudits)).toMatchObject({
      profilId: { notNull: true },
      field: { notNull: true },
      changedBy: { notNull: true },
      changedAt: { notNull: true },
    });
  });

  test('makes generated accounting idempotent per event and auditable on validation', () => {
    const columns = getTableColumns(ecritures);
    expect(columns.sourceEvent?.notNull).toBe(true);
    expect(columns.validatedBy).toBeDefined();
    expect(columns.validatedAt).toBeDefined();
    expect(indexNames(ecritures)).toContain('compta_ecriture_source_event_uniq');
    expect(indexNames(ecritures)).not.toContain('compta_ecriture_source_uniq');
    expect(checkNames(ecritures)).toContain('compta_ecriture_validation_audit_chk');
  });

  test('retains the shared legal-document storage surface', () => {
    expect(getTableConfig(legalDocuments)).toMatchObject({
      schema: 'compta',
      name: 'legal_document',
    });
    expect(getTableColumns(legalDocuments).storageKey).toBeDefined();
  });
});
