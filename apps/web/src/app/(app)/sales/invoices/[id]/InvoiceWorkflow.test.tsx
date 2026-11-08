import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { ClientRecord, InvoiceAggregate } from '@/lib/sales';

vi.mock('../actions', () => ({
  INITIAL_SALES_ACTION_STATE: { status: 'idle' },
  issueInvoice: vi.fn(),
  updateInvoiceDraft: vi.fn(),
  deleteInvoiceDraft: vi.fn(),
  recordInvoicePayment: vi.fn(),
  reverseInvoicePayment: vi.fn(),
  refundInvoiceCreditNote: vi.fn(),
  createInvoiceCreditNote: vi.fn(),
  issueInvoiceCreditNote: vi.fn(),
}));

import { InvoiceWorkflow } from './InvoiceWorkflow';

const client: ClientRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Client BTP',
  clientType: 'professionnel',
  ice: '001234567890123',
  address: 'Errachidia',
  status: 'actif',
  createdAt: '2026-11-07T12:00:00.000Z',
};

function fixture(status: 'brouillon' | 'emise' = 'emise'): InvoiceAggregate {
  return {
    invoice: {
      id: '11111111-1111-4111-8111-111111111111',
      clientId: client.id,
      reference: status === 'emise' ? 'FAC-2026-000001' : null,
      invoiceDate: '2026-11-07',
      status,
      totalHtMad: 1000,
      tvaPct: 20,
      tvaMad: 200,
      totalTtcMad: 1200,
      version: 2,
      legacyPaid: false,
      createdAt: '2026-11-07T12:00:00.000Z',
      lines: [],
    },
    payments: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        invoiceId: '11111111-1111-4111-8111-111111111111',
        movementType: 'encaissement',
        amountCents: 40_001,
        method: 'virement',
        treasuryAccount: '5141',
        valueDate: '2026-11-07',
        idempotencyKey: 'payment-key-1',
        createdBy: 'direction-1',
        createdAt: '2026-11-07T12:00:00.000Z',
      },
    ],
    creditNotes: [],
    settlement: {
      state: 'partiellement_payee',
      netInvoiceCents: 120_000,
      netReceivedCents: 40_001,
      outstandingCents: 79_999,
      customerCreditCents: 0,
    },
    accountingProjection: 'blocked',
    legacyPaidOpening: false,
  };
}

describe('InvoiceWorkflow', () => {
  test('renders authoritative partial settlement and operational controls', () => {
    const html = renderToStaticMarkup(
      <InvoiceWorkflow
        aggregate={fixture()}
        client={client}
        idempotencySeed="test-seed-1234"
      />,
    );
    expect(html).toContain('Partiellement payée');
    expect(html).toContain('799,99');
    expect(html).toContain('Comptabilisation bloquée');
    expect(html).toContain('Enregistrer un encaissement');
    expect(html).toContain('Contre-passer');
    expect(html).toContain('Créer un avoir');
    expect(html).not.toContain('Marquer payée');
  });

  test('keeps draft editing explicit and announces issue blockers', () => {
    const incomplete = { ...client, ice: undefined, address: undefined };
    const html = renderToStaticMarkup(
      <InvoiceWorkflow
        aggregate={fixture('brouillon')}
        client={incomplete}
        idempotencySeed="test-seed-1234"
      />,
    );
    expect(html).toContain('Référence attribuée à l’émission');
    expect(html).toContain('ICE du client professionnel manquant');
    expect(html).toContain('Adresse du client manquante');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Modifier le brouillon');
  });
});
