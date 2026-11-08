import { describe, expect, test } from 'vitest';
import { buildInvoiceLegalDocument } from './legal-document';
import type { ClientRecord, InvoiceRecord } from './sales';

const client: ClientRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Client modifié après émission',
  clientType: 'professionnel',
  ice: 'LIVE-ICE',
  address: 'Adresse actuelle',
  status: 'actif',
  createdAt: '2026-11-07T12:00:00.000Z',
};

function invoice(status: 'brouillon' | 'emise'): InvoiceRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clientId: client.id,
    reference: status === 'emise' ? 'FAC-2026-000001' : null,
    invoiceDate: '2026-11-07',
    status,
    totalHtMad: 1000,
    tvaPct: 20,
    tvaMad: 200,
    totalTtcMad: 1200,
    paymentTerms: '30 jours',
    issuedAt: status === 'emise' ? '2026-11-07T12:00:00.000Z' : undefined,
    legalSnapshot:
      status === 'emise'
        ? {
            legalName: 'AGHA RM INFRA SARL',
            address: 'Siège historique',
            ice: 'SELLER-ICE',
            taxId: 'IF-123',
            tradeRegister: 'RC-123',
            professionalTaxId: 'TP-123',
            client: {
              name: 'Client au jour de l’émission',
              clientType: 'professionnel',
              ice: 'CLIENT-ICE',
              address: 'Adresse historique',
            },
          }
        : undefined,
    version: status === 'emise' ? 2 : 1,
    legacyPaid: false,
    createdAt: '2026-11-07T12:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        designation: 'Travaux de voirie',
        quantity: 1,
        unit: 'forfait',
        unitPriceMad: 1000,
        lineTotalMad: 1000,
        orderIndex: 0,
      },
    ],
  };
}

describe('legal invoice view-model', () => {
  test('uses immutable issue-time seller and client data', () => {
    const document = buildInvoiceLegalDocument(invoice('emise'), client);
    expect(document.blockReasons).toEqual([]);
    expect(document.seller?.legalName).toBe('AGHA RM INFRA SARL');
    expect(document.client.name).toBe('Client au jour de l’émission');
    expect(document.client.address).toBe('Adresse historique');
    expect(document.currency).toBe('MAD');
    expect(document.compatibilityFallback).toBe(false);
  });

  test('marks a draft as non-valid and reports missing issue fields', () => {
    const draft = invoice('brouillon');
    const document = buildInvoiceLegalDocument(draft, {
      ...client,
      ice: undefined,
      address: undefined,
    });
    expect(document.watermark).toBe('BROUILLON — NON VALABLE');
    expect(document.blockReasons.join(' ')).toMatch(/référence/i);
    expect(document.blockReasons.join(' ')).toMatch(/vendeur/i);
    expect(document.blockReasons.join(' ')).toMatch(/adresse du client/i);
    expect(document.blockReasons.join(' ')).toMatch(/ICE du client/i);
  });

  test('marks old seller-only snapshots as a compatibility fallback', () => {
    const legacy = invoice('emise');
    legacy.legalSnapshot = {
      legalName: 'Ancienne société',
      address: 'Ancienne adresse',
      ice: 'OLD-ICE',
      taxId: 'OLD-IF',
      tradeRegister: 'OLD-RC',
    };
    const document = buildInvoiceLegalDocument(legacy, client);
    expect(document.compatibilityFallback).toBe(true);
    expect(document.client.name).toBe(client.name);
  });
});
