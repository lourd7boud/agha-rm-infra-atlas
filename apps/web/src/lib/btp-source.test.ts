import { describe, expect, test } from 'vitest';
import { reviewedSourceBordereau, type BtpProjectSource } from './btp-source';

const source = { bpu: [{ numero: 1, designation: 'Béton', unite: 'm3', quantite: 10, prixUnitaire: null }] } as BtpProjectSource;

describe('reviewed source BPU', () => {
  test('does not submit a BPU when reuse was not chosen', () => {
    expect(reviewedSourceBordereau(new FormData(), source)).toBeUndefined();
  });
  test('rejects missing prices instead of silently converting to zero', () => {
    const form = new FormData();
    form.set('reuseBpu', 'on');
    form.set('bpu:1:unite', 'm3');
    form.set('bpu:1:quantite', '10');
    expect(() => reviewedSourceBordereau(form, source)).toThrow(/incomplet/);
    form.set('bpu:1:prixUnitaire', '');
    expect(() => reviewedSourceBordereau(form, source)).toThrow(/incomplet/);
    form.set('bpu:1:prixUnitaire', '-1');
    expect(() => reviewedSourceBordereau(form, source)).toThrow(/invalide/);
  });
  test('accepts a deliberately reviewed zero or decimal price', () => {
    const form = new FormData();
    form.set('reuseBpu', 'on');
    form.set('bpu:1:unite', 'm3');
    form.set('bpu:1:quantite', '10');
    form.set('bpu:1:prixUnitaire', '0');
    expect(reviewedSourceBordereau(form, source)?.lignes[0].prixUnitaire).toBe(0);
    form.set('bpu:1:prixUnitaire', '123,45');
    expect(reviewedSourceBordereau(form, source)?.lignes[0].prixUnitaire).toBe(123.45);
  });
});
