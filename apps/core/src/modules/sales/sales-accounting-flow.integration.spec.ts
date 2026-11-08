import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Db } from '../../db/client';
import { DrizzleSalesRepository } from './sales.drizzle.repository';
import { DrizzleSalesAccountingEventStore } from './sales-accounting-event.module';
import { DrizzleComptaRepository } from '../compta/compta.repository';
import { ComptaAutoPostingService } from '../compta/compta-auto-posting.service';

const url = process.env.SALES_FLOW_DATABASE_URL;
describe.skipIf(!url)('sales/accounting PostgreSQL workflow', () => {
  let pool: Pool;
  let sales: DrizzleSalesRepository;
  let accounting: DrizzleComptaRepository;
  let events: DrizzleSalesAccountingEventStore;
  let projector: ComptaAutoPostingService;
  beforeAll(async () => {
    if (!['/atlas_security_verify', '/atlas_restore_verify'].includes(new URL(url!).pathname)) {
      throw new Error('Dedicated migrated verification database required.');
    }
    pool = new Pool({ connectionString: url });
    const db = drizzle(pool) as Db;
    sales = new DrizzleSalesRepository(db);
    accounting = new DrizzleComptaRepository(db);
    events = new DrizzleSalesAccountingEventStore(db);
    projector = new ComptaAutoPostingService(events, accounting);
    await pool.query(`INSERT INTO compta.compte(code,intitule,classe)
      VALUES ('3421','Clients',3),('71242','Ventes',7),('4455','TVA attente',4),
        ('4456','TVA due',4),('5141','Banque',5) ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO compta.journal(code,intitule)
      VALUES ('VTE','Ventes'),('BQ','Banque'),('CAI','Caisse') ON CONFLICT DO NOTHING`);
    await accounting.getProfil();
    await accounting.ensureExercice(2026);
  });
  afterAll(async () => { await pool?.end(); });

  test('projects issue and receipts into balanced drafts, then explicitly audits approval', async () => {
    const date = new Date('2026-11-08T00:00:00Z');
    const client = await sales.upsertClient({
      name: `Verification ${randomUUID()}`, clientType: 'professionnel',
      address: 'Errachidia', ice: '001234567890123',
    });
    const draft = await sales.createInvoice({
      clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1000 }],
    });
    expect(draft.reference).toBeNull();
    const issued = await sales.issueInvoice(draft.id, 'direction-test', date, {
      legalName: 'Verification SARL', address: 'Siège',
      ice: '001111111111111', taxId: '1234', tradeRegister: 'RC-1234',
    });
    expect(issued.legalSnapshot?.client?.name).toBe(client.name);
    await accounting.updateFaitGenerateurTva('non_configure', 'comptable-test', {
      compteClientVentes: '3421', compteProduitVentes: '71242',
      compteTvaAttente: '4455', compteTvaDue: '4456',
    });
    const issuedEvent = (await events.listReconciliation({})).find(
      (event) => event.sourceId === issued.id && event.eventType === 'invoice_issued',
    )!;
    expect((await projector.projectEvent(issuedEvent.id, 'comptable-test')).status).toBe('blocked');
    await accounting.updateFaitGenerateurTva('encaissement', 'comptable-test');
    expect((await projector.projectEvent(issuedEvent.id, 'comptable-test')).status).toBe('projected');
    const firstReceipt = await sales.recordPayment({
      invoiceId: issued.id, amountCents: 40001, method: 'virement',
      treasuryAccount: '5141', valueDate: date,
      idempotencyKey: randomUUID(), actor: 'direction-test',
    });
    await sales.reversePayment({
      invoiceId: issued.id, paymentId: firstReceipt.payments[0]!.id,
      valueDate: date, idempotencyKey: randomUUID(), actor: 'direction-test',
    });
    expect((await sales.getInvoiceAggregate(issued.id))?.settlement.netReceivedCents).toBe(0);
    for (const amountCents of [40001, 79999]) {
      await sales.recordPayment({
        invoiceId: issued.id, amountCents, method: 'virement',
        treasuryAccount: '5141', valueDate: date,
        idempotencyKey: randomUUID(), actor: 'direction-test',
      });
    }
    expect((await sales.getInvoiceAggregate(issued.id))?.settlement.outstandingCents).toBe(0);
    const invoiceEvents = (await events.listReconciliation({})).filter(
      (event) => event.sourceId === issued.id,
    );
    for (const event of invoiceEvents) {
      expect((await projector.projectEvent(event.id, 'comptable-test')).status).toBe('projected');
    }
    const { rows } = await pool.query(
      'SELECT id, statut, total_debit, total_credit FROM compta.ecriture WHERE source_id=$1',
      [issued.id],
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.statut).toBe('brouillon');
      expect(row.total_debit).toBe(row.total_credit);
    }
    const ids = rows.map((row) => row.id as string);
    await expect(accounting.validateSelectedEntries([...ids, randomUUID()], 'comptable-test')).rejects.toThrow(/aucune/);
    expect((await accounting.getEcriture(ids[0]!))?.statut).toBe('brouillon');
    const validated = await accounting.validateSelectedEntries(ids, 'comptable-test');
    expect(validated).toHaveLength(5);
    for (const entry of validated) {
      expect(entry.validatedBy).toBe('comptable-test');
      expect(entry.validatedAt).toBeInstanceOf(Date);
    }
    await expect(sales.deleteDraftInvoice(issued.id)).rejects.toThrow(/émise/);
    expect((await sales.getInvoice(issued.id))?.reference).toBe(issued.reference);
    const credit = await sales.createCreditNote({
      invoiceId: issued.id, creditDate: date, totalHtCents: 100000, tvaCents: 20000,
      reason: 'Integration refund test', createdBy: 'direction-test',
    });
    await sales.issueCreditNote(credit.id, 'direction-test', date);
    expect((await sales.getInvoiceAggregate(issued.id))?.settlement.customerCreditCents).toBe(120000);
    const movements = (await sales.getInvoiceAggregate(issued.id))!.payments;
    const payment = movements.find((item) => item.movementType === 'encaissement' &&
      !movements.some((reversal) => reversal.originalMovementId === item.id))!;
    await expect(sales.reversePayment({
      invoiceId: issued.id, paymentId: payment.id, valueDate: date,
      idempotencyKey: randomUUID(), actor: 'direction-test',
    })).rejects.toThrow(/remboursement/);
    const refundCommand = {
      invoiceId: issued.id, creditNoteId: credit.id, amountCents: 120000,
      method: 'virement', treasuryAccount: '5141', valueDate: date,
      idempotencyKey: randomUUID(), actor: 'direction-test',
    };
    await Promise.all([sales.refundCreditNote(refundCommand), sales.refundCreditNote(refundCommand)]);
    const refunded = (await sales.getInvoiceAggregate(issued.id))!;
    expect(refunded.settlement.state).toBe('remboursee');
    expect(refunded.payments.filter((movement) => movement.creditNoteId === credit.id)).toHaveLength(1);
    for (const event of (await events.listReconciliation({})).filter((item) => item.payload.invoiceId === issued.id)) {
      expect((await projector.projectEvent(event.id, 'comptable-test')).status).toBe('projected');
    }
    const allEntries = (await pool.query(
      'SELECT total_debit, total_credit FROM compta.ecriture WHERE source_id=ANY($1::uuid[])', [[issued.id, credit.id]],
    )).rows;
    expect(allEntries).toHaveLength(7);
    expect(allEntries.every((entry) => entry.total_debit === entry.total_credit)).toBe(true);
  }, 30_000);

  test('serializes concurrent issue and rejects concurrent overpayment', async () => {
    const date = new Date('2026-11-08T00:00:00Z');
    const client = await sales.upsertClient({ name: `Concurrent ${randomUUID()}`, address: 'Test' });
    const drafts = await Promise.all([1, 2].map(() => sales.createInvoice({
      clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Test', quantity: 1, unitPriceMad: 100 }],
    })));
    const seller = { legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123' };
    const issued = await Promise.all(drafts.map((draft) => sales.issueInvoice(draft.id, 'direction-test', date, seller)));
    expect(new Set(issued.map((invoice) => invoice.reference)).size).toBe(2);
    const results = await Promise.allSettled([1, 2].map(() => sales.recordPayment({
      invoiceId: issued[0]!.id, amountCents: 8000, method: 'virement',
      treasuryAccount: '5141', valueDate: date, idempotencyKey: randomUUID(), actor: 'direction-test',
    })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await sales.getInvoiceAggregate(issued[0]!.id))?.settlement.outstandingCents).toBe(4000);
  });

  test('preserves actual TVA centimes across out-of-order reversal and supports debits receipts', async () => {
    const date = new Date('2026-11-08T00:00:00Z');
    const client = await sales.upsertClient({ name: `Rounding ${randomUUID()}`, address: 'Test' });
    const draft = await sales.createInvoice({ clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Test', quantity: 1, unitPriceMad: 1000 }] });
    const invoice = await sales.issueInvoice(draft.id, 'test', date,
      { legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123' });
    const receipt = async (amountCents: number) => sales.recordPayment({ invoiceId: invoice.id,
      amountCents, method: 'virement', treasuryAccount: '5141', valueDate: date,
      idempotencyKey: randomUUID(), actor: 'test' });
    const first = await receipt(40001);
    await receipt(79999);
    await sales.reversePayment({ invoiceId: invoice.id, paymentId: first.payments[0]!.id,
      valueDate: date, idempotencyKey: randomUUID(), actor: 'test' });
    const remainderCredit = await sales.createCreditNote({ invoiceId: invoice.id, creditDate: date,
      totalHtCents: 33334, tvaCents: 6667, reason: 'Rounding test', createdBy: 'test' });
    await sales.issueCreditNote(remainderCredit.id, 'test', date);
    const secondDraft = await sales.createInvoice({ clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Small recollection test', quantity: 1, unitPriceMad: 1000 }] });
    const second = await sales.issueInvoice(secondDraft.id, 'test', date,
      { legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123' });
    const secondReceipt = async (amountCents: number) => sales.recordPayment({ invoiceId: second.id,
      amountCents, method: 'virement', treasuryAccount: '5141', valueDate: date,
      idempotencyKey: randomUUID(), actor: 'test' });
    const secondFirst = await secondReceipt(40001);
    await secondReceipt(79999);
    await sales.reversePayment({ invoiceId: second.id, paymentId: secondFirst.payments[0]!.id,
      valueDate: date, idempotencyKey: randomUUID(), actor: 'test' });
    await secondReceipt(1);
    await secondReceipt(40000);
    const { rows } = await pool.query(`SELECT sum(CASE WHEN movement_type='encaissement'
      THEN tva_transferred_mad ELSE -tva_transferred_mad END)::text tva
      FROM sales.invoice_payment WHERE invoice_id=$1`, [second.id]);
    expect(Number(rows[0].tva)).toBe(200);
    await accounting.updateFaitGenerateurTva('debits', 'test');
    for (const event of (await events.listReconciliation({})).filter((item) => [invoice.id, second.id].includes(item.payload.invoiceId as string))) {
      expect((await projector.projectEvent(event.id, 'test')).status).toBe('projected');
    }
  });

  test('refunds the legacy paid opening and honors the business date and closed exercise', async () => {
    const date = new Date('2026-11-08T00:00:00Z');
    const client = await sales.upsertClient({ name: `Legacy ${randomUUID()}`, address: 'Test' });
    const draft = await sales.createInvoice({ clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Test', quantity: 1, unitPriceMad: 100 }] });
    await pool.query('UPDATE sales.invoice SET legacy_paid=true, paid_at=$2 WHERE id=$1', [draft.id, date]);
    const invoice = await sales.issueInvoice(draft.id, 'test', date,
      { legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123' });
    expect((await sales.getInvoiceAggregate(invoice.id))?.settlement.state).toBe('payee');
    const credit = await sales.createCreditNote({ invoiceId: invoice.id, creditDate: date,
      totalHtCents: 10000, tvaCents: 2000, reason: 'Legacy test', createdBy: 'test' });
    expect((await sales.issueCreditNote(credit.id, 'test', date)).againstCollectedCents).toBe(12000);
    const refunded = await sales.refundCreditNote({ invoiceId: invoice.id, creditNoteId: credit.id,
      amountCents: 12000, method: 'virement', treasuryAccount: '5141',
      valueDate: new Date('2025-12-31T00:00:00Z'), idempotencyKey: randomUUID(), actor: 'test' });
    expect(refunded.legacyPaidOpening).toBe(true);
    expect(refunded.settlement.state).toBe('remboursee');
    expect(refunded.settlement.customerCreditCents).toBe(0);
    await accounting.ensureExercice(2025);
    await accounting.setExerciceStatut(2025, 'cloture');
    const event = (await events.listReconciliation({})).find(
      (item) => item.payload.invoiceId === invoice.id && item.eventType === 'refund_recorded')!;
    expect((await projector.projectEvent(event.id, 'test')).lastErrorCode).toBe('exercice_cloture');
    await accounting.setExerciceStatut(2025, 'ouvert');
    const projected = await projector.projectEvent(event.id, 'test');
    expect(projected.status).toBe('projected');
    const entry = (await accounting.getEcriture(projected.accountingEntryId!))!;
    expect(entry.dateEcriture.toISOString().slice(0, 10)).toBe('2025-12-31');
    expect(entry.journalCode).toBe('BQ');
  });

  test('clears the final TVA centime when a partial credit precedes the last receipt', async () => {
    const date = new Date('2026-11-08T00:00:00Z');
    const client = await sales.upsertClient({ name: `Credit residual ${randomUUID()}`, address: 'Test' });
    const draft = await sales.createInvoice({ clientId: client.id, invoiceDate: date, tvaPct: 20,
      lines: [{ designation: 'Test', quantity: 1, unitPriceMad: 1000 }] });
    const invoice = await sales.issueInvoice(draft.id, 'test', date,
      { legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123' });
    const receipt = async (amountCents: number) => sales.recordPayment({ invoiceId: invoice.id,
      amountCents, method: 'virement', treasuryAccount: '5141', valueDate: date,
      idempotencyKey: randomUUID(), actor: 'test' });
    await receipt(40001);
    const credit = await sales.createCreditNote({ invoiceId: invoice.id, creditDate: date,
      totalHtCents: 41667, tvaCents: 8333, reason: 'Residual test', createdBy: 'test' });
    await sales.issueCreditNote(credit.id, 'test', date);
    await receipt(29999);
    expect((await sales.getInvoiceAggregate(invoice.id))?.settlement.outstandingCents).toBe(0);
    const { rows } = await pool.query(`SELECT sum(tva_transferred_mad)::text tva
      FROM sales.invoice_payment WHERE invoice_id=$1`, [invoice.id]);
    expect(Number(rows[0].tva)).toBe(116.67);
    await accounting.updateFaitGenerateurTva('encaissement', 'test');
    for (const event of (await events.listReconciliation({})).filter((item) => item.payload.invoiceId === invoice.id)) {
      expect((await projector.projectEvent(event.id, 'test')).status).toBe('projected');
    }
  });
});
