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
    if (new URL(url!).pathname !== '/atlas_security_verify') {
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
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.statut).toBe('brouillon');
      expect(row.total_debit).toBe(row.total_credit);
    }
    const ids = rows.map((row) => row.id as string);
    await expect(accounting.validateSelectedEntries([...ids, randomUUID()], 'comptable-test')).rejects.toThrow(/aucune/);
    expect((await accounting.getEcriture(ids[0]!))?.statut).toBe('brouillon');
    const validated = await accounting.validateSelectedEntries(ids, 'comptable-test');
    expect(validated).toHaveLength(3);
    for (const entry of validated) {
      expect(entry.validatedBy).toBe('comptable-test');
      expect(entry.validatedAt).toBeInstanceOf(Date);
    }
    await expect(sales.deleteDraftInvoice(issued.id)).rejects.toThrow(/émise/);
    expect((await sales.getInvoice(issued.id))?.reference).toBe(issued.reference);
  }, 30_000);
});
