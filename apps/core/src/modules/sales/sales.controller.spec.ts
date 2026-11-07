import { describe, expect, test, vi } from 'vitest';
import { InMemorySalesRepository } from './sales.repository';
import { SalesController } from './sales.module';
import type { ComptaRepository } from '../compta/compta.repository';

const DATE = '2026-06-21';
const REQUEST = { user: { username: 'direction-1' } };

async function makeController() {
  const repository = new InMemorySalesRepository();
  const client = await repository.upsertClient({
    name: 'Client BTP',
    clientType: 'professionnel',
    ice: '001234567890123',
    address: 'Errachidia',
  });
  const compta = {
    getProfil: vi.fn(async () => ({
      raisonSociale: 'AGHA RM INFRA SARL',
      adresse: 'Errachidia',
      ice: '001111111111111',
      identifiantFiscal: '12345678',
      registreCommerce: 'RC-1234',
      taxeProfessionnelle: 'TP-1234',
    })),
  } as unknown as ComptaRepository;
  return {
    repository,
    client,
    controller: new SalesController(repository, compta),
  };
}

describe('SalesController compliant issue workflow', () => {
  test('issues quote, delivery note, and invoice without user references', async () => {
    const { controller, repository, client } = await makeController();
    const quote = await repository.createQuote({
      clientId: client.id,
      quoteDate: new Date(`${DATE}T00:00:00Z`),
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1_000 }],
    });
    const delivery = await repository.createDeliveryNote({
      clientId: client.id,
      deliveryDate: new Date(`${DATE}T00:00:00Z`),
      lines: [{ designation: 'Travaux', quantity: 1 }],
    });
    const invoice = await repository.createInvoice({
      clientId: client.id,
      invoiceDate: new Date(`${DATE}T00:00:00Z`),
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1_000 }],
    });

    const issuedQuote = await controller.issueQuote(quote.id, REQUEST);
    const issuedDelivery = await controller.issueDeliveryNote(delivery.id, REQUEST);
    const issuedInvoice = await controller.issueInvoice(invoice.id, REQUEST);

    expect(issuedQuote.reference).toBe('DEV-2026-000001');
    expect(issuedDelivery.reference).toBe('BL-2026-000001');
    expect(issuedInvoice.reference).toBe('FAC-2026-000001');
  });

  test('rejects invoice issue when a professional client has no ICE', async () => {
    const { controller, repository } = await makeController();
    const client = await repository.upsertClient({
      name: 'Client incomplet',
      clientType: 'professionnel',
      address: 'Errachidia',
    });
    const invoice = await repository.createInvoice({
      clientId: client.id,
      invoiceDate: new Date(`${DATE}T00:00:00Z`),
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1_000 }],
    });

    await expect(controller.issueInvoice(invoice.id, REQUEST)).rejects.toThrow(
      /ICE/i,
    );
  });

  test('records and reverses a strictly positive payment', async () => {
    const { controller, repository, client } = await makeController();
    const invoice = await repository.createInvoice({
      clientId: client.id,
      invoiceDate: new Date(`${DATE}T00:00:00Z`),
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1_000 }],
    });
    await controller.issueInvoice(invoice.id, REQUEST);

    await expect(
      controller.recordPayment(invoice.id, { amountCents: 0 }, REQUEST),
    ).rejects.toThrow();
    const paid = await controller.recordPayment(
      invoice.id,
      {
        amountCents: 10_000,
        method: 'virement',
        treasuryAccount: '5141',
        valueDate: DATE,
        idempotencyKey: 'payment-1',
      },
      REQUEST,
    );
    const reversed = await controller.reversePayment(
      invoice.id,
      paid.payments[0]!.id,
      { valueDate: DATE, idempotencyKey: 'reversal-1' },
      REQUEST,
    );
    expect(reversed.payments).toHaveLength(2);
  });

  test('creates and issues a credit note through guarded commands', async () => {
    const { controller, repository, client } = await makeController();
    const invoice = await repository.createInvoice({
      clientId: client.id,
      invoiceDate: new Date(`${DATE}T00:00:00Z`),
      tvaPct: 20,
      lines: [{ designation: 'Travaux', quantity: 1, unitPriceMad: 1_000 }],
    });
    await controller.issueInvoice(invoice.id, REQUEST);
    const draft = await controller.createCreditNote(
      invoice.id,
      {
        creditDate: DATE,
        totalHtCents: 10_000,
        tvaCents: 2_000,
        reason: 'Correction',
      },
      REQUEST,
    );
    const issued = await controller.issueCreditNote(draft.id, REQUEST);
    expect(issued.reference).toBe('AV-2026-000001');
  });
});
