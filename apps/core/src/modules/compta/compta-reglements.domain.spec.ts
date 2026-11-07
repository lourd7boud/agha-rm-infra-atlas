import { describe, expect, test } from 'vitest';
import { VENTE_COMPTE_CLIENT } from './compta-ventes.domain';
import {
  buildEncaissementEcriture,
  type EncaissementSource,
} from './compta-reglements.domain';

function source(partial: Partial<EncaissementSource> = {}): EncaissementSource {
  return {
    reference: partial.reference ?? 'FAC-2026-0001',
    clientName: partial.clientName ?? 'OCP SA',
    montantTtc: partial.montantTtc ?? 1200,
    tvaMad: partial.tvaMad ?? 200, // 20% invoice: HT 1000 / TTC 1200
    method: partial.method,
  };
}

describe('buildEncaissementEcriture', () => {
  test('a virement: bank 5141 / client 3421 + TVA transfer 4455→4456 (journal BQ)', () => {
    const e = buildEncaissementEcriture(source({ method: 'virement' }))!;
    expect(e.journalCode).toBe('BQ');
    expect(e.lignes).toEqual([
      { compteCode: '5141', debit: 1200, credit: 0 },
      { compteCode: VENTE_COMPTE_CLIENT, debit: 0, credit: 1200, tiers: 'OCP SA' },
      { compteCode: '4455', debit: 200, credit: 0 },
      { compteCode: '4456', debit: 0, credit: 200 },
    ]);
  });

  test('TVA becomes exigible at collection: 4455 debited, 4456 credited (régime encaissement)', () => {
    const e = buildEncaissementEcriture(source())!;
    const tva4455 = e.lignes.find((l) => l.compteCode === '4455');
    const tva4456 = e.lignes.find((l) => l.compteCode === '4456');
    expect(tva4455).toEqual({ compteCode: '4455', debit: 200, credit: 0 });
    expect(tva4456).toEqual({ compteCode: '4456', debit: 0, credit: 200 });
  });

  test('a 0% invoice (no TVA) posts only the cash legs — no 4455/4456 transfer', () => {
    const e = buildEncaissementEcriture(source({ montantTtc: 15000, tvaMad: 0 }))!;
    expect(e.lignes).toHaveLength(2);
    expect(e.lignes.some((l) => l.compteCode === '4455' || l.compteCode === '4456')).toBe(false);
  });

  test('cash (espèce) uses caisse 5161 and journal CAI', () => {
    const e = buildEncaissementEcriture(source({ method: 'espece' }))!;
    expect(e.journalCode).toBe('CAI');
    expect(e.lignes[0]?.compteCode).toBe('5161');
  });

  test('cheque and carte settle through the bank like a virement', () => {
    expect(buildEncaissementEcriture(source({ method: 'cheque' }))!.journalCode).toBe('BQ');
    expect(buildEncaissementEcriture(source({ method: 'carte' }))!.lignes[0]?.compteCode).toBe('5141');
  });

  test('no method defaults to virement (bank)', () => {
    const e = buildEncaissementEcriture(source({ method: undefined }))!;
    expect(e.journalCode).toBe('BQ');
    expect(e.lignes[0]?.compteCode).toBe('5141');
  });

  test('the compound entry balances (ΣD = ΣC); the cash leg equals the TTC', () => {
    const e = buildEncaissementEcriture(source({ montantTtc: 987.65, tvaMad: 164.61 }))!;
    const d = e.lignes.reduce((s, l) => s + l.debit, 0);
    const c = e.lignes.reduce((s, l) => s + l.credit, 0);
    expect(d).toBeCloseTo(c, 2);
    expect(e.lignes[0]?.debit).toBeCloseTo(987.65, 2);
  });

  test('a named client is `certaine` (auto-validatable)', () => {
    expect(buildEncaissementEcriture(source())!.certaine).toBe(true);
  });

  test('a blank client falls back to review (certaine = false)', () => {
    expect(buildEncaissementEcriture(source({ clientName: '  ' }))!.certaine).toBe(false);
  });

  test('a non-positive amount does not post (null)', () => {
    expect(buildEncaissementEcriture(source({ montantTtc: 0 }))).toBeNull();
  });
});
