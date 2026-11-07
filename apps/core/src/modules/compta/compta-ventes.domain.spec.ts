import { describe, expect, test } from 'vitest';
import {
  buildVenteEcriture,
  VENTE_COMPTE_CLIENT,
  VENTE_COMPTE_PRODUIT,
  VENTE_COMPTE_TVA,
  type VenteSource,
} from './compta-ventes.domain';

function source(partial: Partial<VenteSource> = {}): VenteSource {
  return {
    reference: partial.reference ?? 'FAC-2026-0001',
    clientName: partial.clientName ?? 'OCP SA',
    totalHtMad: partial.totalHtMad ?? 1000,
    totalTtcMad: partial.totalTtcMad ?? 1200,
  };
}

describe('buildVenteEcriture', () => {
  test('maps a standard 20% invoice to D3421 / C71242 / C4455', () => {
    // Act
    const e = buildVenteEcriture(source())!;

    // Assert — three legs, correct accounts and amounts.
    expect(e.journalCode).toBe('VTE');
    expect(e.tvaMad).toBe(200);
    expect(e.lignes).toEqual([
      { compteCode: VENTE_COMPTE_CLIENT, debit: 1200, credit: 0, tiers: 'OCP SA' },
      { compteCode: VENTE_COMPTE_PRODUIT, debit: 0, credit: 1000 },
      { compteCode: VENTE_COMPTE_TVA, debit: 0, credit: 200 },
    ]);
  });

  test('the entry always balances (ΣD = ΣC)', () => {
    // Act
    const e = buildVenteEcriture(source({ totalHtMad: 3333.33, totalTtcMad: 3999.996 }))!;

    // Assert
    const d = e.lignes.reduce((s, l) => s + l.debit, 0);
    const c = e.lignes.reduce((s, l) => s + l.credit, 0);
    expect(d).toBeCloseTo(c, 2);
  });

  test('a 0% invoice omits the TVA leg (HT == TTC)', () => {
    // Act
    const e = buildVenteEcriture(source({ totalHtMad: 15000, totalTtcMad: 15000 }))!;

    // Assert — only client + produit, no 4455.
    expect(e.tvaMad).toBe(0);
    expect(e.lignes).toHaveLength(2);
    expect(e.lignes.some((l) => l.compteCode === VENTE_COMPTE_TVA)).toBe(false);
    expect(e.certaine).toBe(true);
  });

  test('a coherent named-client invoice is `certaine` (auto-validatable)', () => {
    expect(buildVenteEcriture(source())!.certaine).toBe(true);
  });

  test('a blank client name falls back to review (certaine = false)', () => {
    // Assert — still a valid balanced entry, but not auto-validated.
    const e = buildVenteEcriture(source({ clientName: '   ' }))!;
    expect(e.certaine).toBe(false);
    expect(e.lignes[0]?.debit).toBe(1200);
  });

  test('a non-positive TTC does not post (null)', () => {
    expect(buildVenteEcriture(source({ totalHtMad: 0, totalTtcMad: 0 }))).toBeNull();
  });

  test('HT above TTC is incoherent (negative TVA) → null, never posts', () => {
    expect(buildVenteEcriture(source({ totalHtMad: 1300, totalTtcMad: 1200 }))).toBeNull();
  });
});
