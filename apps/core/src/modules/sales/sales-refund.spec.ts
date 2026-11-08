import { expect, test } from 'vitest';
import { InMemorySalesRepository } from './sales.repository';

test('refunds only issued credit notes, caps the amount and keeps retries idempotent', async () => {
  const repo = new InMemorySalesRepository();
  const date = new Date('2026-11-08T00:00:00Z');
  const client = await repo.upsertClient({ name: 'Refund test', address: 'Test' });
  const draft = await repo.createInvoice({
    clientId: client.id, invoiceDate: date, tvaPct: 20,
    lines: [{ designation: 'Test', quantity: 1, unitPriceMad: 100 }],
  });
  const invoice = await repo.issueInvoice(draft.id, 'direction', date, {
    legalName: 'Test', address: 'Test', ice: '123', taxId: '123', tradeRegister: '123',
  });
  await repo.recordPayment({
    invoiceId: invoice.id, amountCents: 12000, method: 'virement',
    treasuryAccount: '5141', valueDate: date, idempotencyKey: 'payment-test', actor: 'direction',
  });
  const credit = await repo.createCreditNote({
    invoiceId: invoice.id, creditDate: date, totalHtCents: 10000, tvaCents: 2000,
    reason: 'Correction test', createdBy: 'direction',
  });
  const command = {
    invoiceId: invoice.id, creditNoteId: credit.id, amountCents: 12000,
    method: 'virement', treasuryAccount: '5141', valueDate: date,
    idempotencyKey: 'refund-test', actor: 'direction',
  };
  await expect(repo.refundCreditNote(command)).rejects.toThrow(/émis/i);
  await repo.issueCreditNote(credit.id, 'direction', date);
  await expect(repo.refundCreditNote({ ...command, amountCents: 12001 })).rejects.toThrow(/solde|montant/i);
  const refunded = await repo.refundCreditNote(command);
  expect(refunded.settlement.state).toBe('remboursee');
  expect(refunded.settlement.customerCreditCents).toBe(0);
  expect((await repo.refundCreditNote(command)).payments).toHaveLength(2);
  await expect(repo.refundCreditNote({ ...command, amountCents: 1 })).rejects.toThrow(/idempotence/i);
});
