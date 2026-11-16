import { describe, expect, it } from 'vitest';
import { parseCodeValues, reviewedIndexImport } from './index-import-data';

function review() {
  const form = new FormData();
  form.set('reference', 'DATRP/2026/05');
  form.set('publishedOn', '2026-05-18');
  form.set('publicationEvidence', 'Avis de publication du ministère, 18 mai 2026.');
  form.set('month:0', '2026-04'); form.set('status:0', 'definitif');
  form.append('code:0', 'At'); form.append('value:0', '306,7');
  form.set('month:1', '2026-05'); form.set('status:1', '');
  form.append('code:1', 'Cs'); form.append('value:1', '');
  return form;
}

describe('reviewed official index month selection', () => {
  it('saves only the operator-selected reviewed months and preserves corrections', () => {
    const form = review();
    form.append('reviewedMonth', '0');
    expect(reviewedIndexImport(form)).toEqual({
      reference: 'DATRP/2026/05', publishedOn: '2026-05-18',
      publicationEvidence: 'Avis de publication du ministère, 18 mai 2026.',
      months: [{ month: '2026-04', status: 'definitif', indexValues: { At: 306.7 } }],
    });
  });

  it('does not consider partial OCR reviewed or guess a missing official status', () => {
    const form = review();
    expect(() => reviewedIndexImport(form)).toThrow(/Sélectionnez au moins un mois/);
    form.append('reviewedMonth', '1');
    expect(() => reviewedIndexImport(form)).toThrow(/statut officiel/);
    form.set('status:1', 'provisoire');
    expect(() => reviewedIndexImport(form)).toThrow(/code et sa valeur/);
  });

  it('requires independent publication evidence instead of using the document or observation date', () => {
    const form = review();
    form.append('reviewedMonth', '0');
    form.delete('publishedOn');
    expect(() => reviewedIndexImport(form)).toThrow(/date de publication/);
    form.set('publishedOn', '2026-05-18');
    form.delete('publicationEvidence');
    expect(() => reviewedIndexImport(form)).toThrow(/pièce/);
  });

  it('rejects duplicate corrected codes or duplicate corrected months', () => {
    const form = review();
    form.append('reviewedMonth', '0'); form.append('code:0', 'At'); form.append('value:0', '307');
    expect(() => reviewedIndexImport(form)).toThrow(/plusieurs fois/);
    const other = review();
    other.append('reviewedMonth', '0'); other.append('reviewedMonth', '1');
    other.set('month:1', '2026-04'); other.set('status:1', 'provisoire'); other.set('value:1', '100');
    expect(() => reviewedIndexImport(other)).toThrow(/Chaque mois/);
  });

  it('keeps manual fixed-only formulas possible while treating a missing index value as unknown', () => {
    expect(parseCodeValues(new FormData(), 'code', 'value', true)).toEqual({});
    expect(() => parseCodeValues(new FormData(), 'code', 'value')).toThrow(/au moins un code/);
    const form = new FormData();
    form.append('code', '__proto__'); form.append('value', '5');
    expect(Object.hasOwn(parseCodeValues(form, 'code', 'value'), '__proto__')).toBe(true);
  });
});
