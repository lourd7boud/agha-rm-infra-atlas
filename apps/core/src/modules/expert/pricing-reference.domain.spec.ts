import { describe, expect, test } from 'vitest';
import {
  buildPriceBook,
  buildReferenceHints,
  matchPriceBook,
  MIN_MATCH_SCORE,
  normalizeUnit,
  resolveReferencePrices,
  summarizeBasis,
  tokenizeDesignation,
  tokenSimilarity,
  type ReferenceBpuLine,
} from './pricing-reference.domain';

describe('tokenizeDesignation', () => {
  test('strips accents, stop-words and short noise, keeps discriminating tokens', () => {
    const tokens = tokenizeDesignation('Fourniture et pose de Conduite en PVC DN200');
    // "fourniture", "pose", "en", "de" are stop-words; the material + diameter stay.
    expect(tokens).toContain('conduite');
    expect(tokens).toContain('pvc');
    expect(tokens).toContain('dn200');
    expect(tokens).not.toContain('de');
    expect(tokens).not.toContain('fourniture');
  });

  test('de-duplicates repeated tokens', () => {
    const tokens = tokenizeDesignation('Béton béton BÉTON');
    expect(tokens).toEqual(['beton']);
  });
});

describe('normalizeUnit', () => {
  test('folds formatting so equal units compare equal', () => {
    expect(normalizeUnit('m³')).toBe('m3');
    expect(normalizeUnit('M 3')).toBe('m3');
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit('  ')).toBeNull();
  });
});

describe('tokenSimilarity', () => {
  test('identical token sets score 1, disjoint score 0', () => {
    expect(tokenSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(tokenSimilarity(['a'], ['b'])).toBe(0);
    expect(tokenSimilarity([], ['a'])).toBe(0);
  });
});

describe('matchPriceBook', () => {
  const refs: ReferenceBpuLine[] = [
    { designation: 'Conduite en PVC DN200', unite: 'ml', prixUnitaireMad: 120 },
    { designation: 'Conduite PVC DN200 série 1', unite: 'ml', prixUnitaireMad: 130 },
    { designation: 'Terrassement en masse', unite: 'm3', prixUnitaireMad: 40 },
  ];
  const book = buildPriceBook(refs);

  test('matches a near-identical line to the median of its matches', () => {
    const match = matchPriceBook('Conduite PVC DN200', 'ml', book);
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    // Median of {120, 130} = 125.
    expect(match!.prixUnitaireMad).toBe(125);
  });

  test('returns null when nothing clears the similarity bar', () => {
    expect(matchPriceBook('Peinture vinylique intérieure', 'm2', book)).toBeNull();
  });

  test('drops references with no usable price when building the book', () => {
    const dirty = buildPriceBook([
      { designation: 'X', prixUnitaireMad: 0 },
      { designation: 'de la', prixUnitaireMad: 10 }, // pure stop-words → no tokens
      { designation: 'Gravette 15/25', prixUnitaireMad: 90 },
    ]);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]!.prixUnitaireMad).toBe(90);
  });
});

describe('resolveReferencePrices', () => {
  const book = buildPriceBook([
    { designation: 'Terrassement en masse', unite: 'm3', prixUnitaireMad: 45 },
  ]);

  test('prefers the DCE price, then the price book, then leaves the rest to IA', () => {
    const resolved = resolveReferencePrices({
      dcePrices: [200, null, null],
      designations: [
        'Conduite PVC DN110',
        'Terrassement en masse pour fouilles',
        'Prestation totalement inédite XYZ',
      ],
      unites: ['ml', 'm3', 'ff'],
      priceBook: book,
    });

    expect(resolved[0]).toMatchObject({ prixUnitaireMad: 200, source: 'dce', score: 1 });
    expect(resolved[1]!.source).toBe('historique');
    expect(resolved[1]!.prixUnitaireMad).toBe(45);
    expect(resolved[2]).toMatchObject({ prixUnitaireMad: null, source: 'aucune' });
  });

  test('ignores a non-positive DCE price and falls through', () => {
    const resolved = resolveReferencePrices({
      dcePrices: [0],
      designations: ['Terrassement en masse'],
      unites: ['m3'],
      priceBook: book,
    });
    expect(resolved[0]!.source).toBe('historique');
  });
});

describe('summarizeBasis', () => {
  test('tallies each source', () => {
    const basis = summarizeBasis([
      { prixUnitaireMad: 1, source: 'dce', score: 1 },
      { prixUnitaireMad: 2, source: 'historique', score: 0.8 },
      { prixUnitaireMad: 3, source: 'ia', score: 0 },
      { prixUnitaireMad: null, source: 'aucune', score: 0 },
      { prixUnitaireMad: 4, source: 'dce', score: 1 },
    ]);
    expect(basis).toEqual({ dce: 2, historique: 1, ia: 1, aucune: 1 });
  });
});

describe('buildReferenceHints', () => {
  test('lists resolved reference prices, capped, skips IA/unpriced lines', () => {
    const hints = buildReferenceHints(
      ['Ligne A', 'Ligne B', 'Ligne C', 'Ligne D'],
      [
        { prixUnitaireMad: 100, source: 'dce', score: 1 },
        { prixUnitaireMad: 55, source: 'historique', score: 0.7 },
        { prixUnitaireMad: 999, source: 'ia', score: 0 },
        { prixUnitaireMad: null, source: 'aucune', score: 0 },
      ],
      10,
    );
    expect(hints).toContain('"Ligne A" ≈ 100 MAD (estimatif DCE)');
    expect(hints).toContain('"Ligne B" ≈ 55 MAD (référence marché)');
    expect(hints).not.toContain('Ligne C');
    expect(hints).not.toContain('Ligne D');
  });

  test('honours the maxHints cap', () => {
    const hints = buildReferenceHints(
      ['A', 'B'],
      [
        { prixUnitaireMad: 1, source: 'dce', score: 1 },
        { prixUnitaireMad: 2, source: 'dce', score: 1 },
      ],
      1,
    );
    expect(hints.split('\n')).toHaveLength(1);
  });
});
