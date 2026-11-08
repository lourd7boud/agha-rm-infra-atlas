import { expect, test } from 'vitest';
import { InMemorySalesRepository } from './sales.repository';
import { ComptaAutoPostingService, type AccountingProjectionPort, type SalesAccountingEvent, type SalesAccountingEventStore } from '../compta/compta-auto-posting.service';
import type { FaitGenerateurTva } from '../compta/compta-ventes.domain';

test('issued invoice survives blocked accounting, retries into one balanced draft, and settles by real receipts', async () => {
  const sales = new InMemorySalesRepository();
  const date = new Date('2026-11-08T00:00:00Z');
  const client = await sales.upsertClient({
    name: 'Client de régression', clientType: 'professionnel',
    ice: '001234567890123', address: 'Errachidia',
  });
  const draft = await sales.createInvoice({
    clientId: client.id, invoiceDate: date, tvaPct: 20,
    lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1000 }],
  });
  expect(draft.reference).toBeNull();
  const issued = await sales.issueInvoice(draft.id, 'direction-1', date, {
    legalName: 'Entreprise', address: 'Siège', ice: 'SELLER-ICE',
    taxId: 'IF-1', tradeRegister: 'RC-1',
  });
  let event: SalesAccountingEvent = {
    id: 'event-1', eventKey: `invoice_issued:${issued.id}:2`,
    eventType: 'invoice_issued', sourceId: issued.id, sourceVersion: 2,
    occurredAt: date, status: 'pending', attempts: 0,
    payload: { reference: issued.reference, clientName: client.name,
      totalHtCents: 100000, tvaCents: 20000, totalTtcCents: 120000 },
  };
  const store: SalesAccountingEventStore = {
    getEvent: async () => event,
    listReconciliation: async () => [event],
    markProjected: async (_id, entryId) => (event = { ...event, status: 'projected', accountingEntryId: entryId }),
    markBlocked: async (_id, code, message) => (event = { ...event, status: 'blocked', lastErrorCode: code, lastErrorMessage: message }),
    markRetryableFailure: async (_id, code, message) => (event = { ...event, status: 'pending', lastErrorCode: code, lastErrorMessage: message }),
  };
  let regime: FaitGenerateurTva = 'non_configure';
  const entries = new Map<string, { id: string; status: 'brouillon' }>();
  const projection: AccountingProjectionPort = {
    getContext: async () => ({
      faitGenerateurTva: regime, exerciseOpen: true,
      accounts: { client: '3421', revenue: '71242', tvaPending: '4455', tvaDue: '4456' },
    }),
    findEntryByEvent: async (key) => entries.get(key) ?? null,
    createDraftEntry: async (source, posting, actor) => {
      expect(actor).toBe('comptable-1');
      expect(posting.lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0)).toBe(0);
      const entry = { id: 'entry-1', status: 'brouillon' as const };
      entries.set(source.eventKey, entry);
      return entry;
    },
  };
  const service = new ComptaAutoPostingService(store, projection);
  expect((await service.projectEvent(event.id, 'comptable-1')).status).toBe('blocked');
  expect(entries.size).toBe(0);
  regime = 'encaissement';
  expect((await service.projectEvent(event.id, 'comptable-1')).status).toBe('projected');
  await service.projectEvent(event.id, 'comptable-1');
  expect(entries.size).toBe(1);
  const first = await sales.recordPayment({
    invoiceId: issued.id, amountCents: 40001, method: 'virement',
    treasuryAccount: '5141', valueDate: date, idempotencyKey: 'first-payment',
    actor: 'direction-1',
  });
  expect(first.settlement.state).toBe('partiellement_payee');
  expect(first.settlement.outstandingCents).toBe(79999);
  const paid = await sales.recordPayment({
    invoiceId: issued.id, amountCents: 79999, method: 'virement',
    treasuryAccount: '5141', valueDate: date, idempotencyKey: 'second-payment',
    actor: 'direction-1',
  });
  expect(paid.settlement.state).toBe('payee');
  expect(paid.invoice.status).toBe('emise');
  expect(paid.invoice.reference).toBe(issued.reference);
  expect(paid.invoice.issuedBy).toBe('direction-1');
  await expect(sales.deleteDraftInvoice(issued.id)).rejects.toThrow(/émise/);
});
