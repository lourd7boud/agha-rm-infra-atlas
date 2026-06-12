import { describe, expect, test } from 'vitest';
import { AGHA_PROFILE } from './company-profile';
import { normalizeFr, qualify, type QualifierInput } from './qualifier.domain';

const TODAY = new Date('2026-06-11T00:00:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

const baseTender: QualifierInput = {
  reference: 'AO 99/2026/TEST',
  procedure: 'AOO',
  objet: "Travaux d'aménagement hydro-agricole — réseau d'irrigation localisée",
  estimationMad: 4_500_000,
  cautionProvisoireMad: 45_000,
  deadlineAt: days(30),
};

describe('normalizeFr', () => {
  test('strips accents and lowercases', () => {
    expect(normalizeFr('Génie Civil — Aménagement')).toBe('genie civil — amenagement');
  });
});

describe('qualify', () => {
  test('qualifies an in-domain AOO with affordable caution and runway', () => {
    const result = qualify(baseTender, AGHA_PROFILE, TODAY);
    expect(result.verdict).toBe('qualified');
    expect(result.rules.every((rule) => rule.pass)).toBe(true);
  });

  test('rejects concours procedures (études out of scope)', () => {
    const result = qualify({ ...baseTender, procedure: 'concours' }, AGHA_PROFILE, TODAY);
    expect(result.verdict).toBe('rejected');
    expect(result.rules.find((r) => r.rule === 'procedure')?.pass).toBe(false);
  });

  test('rejects caution above treasury capacity', () => {
    const result = qualify(
      { ...baseTender, cautionProvisoireMad: 250_000 },
      AGHA_PROFILE,
      TODAY,
    );
    expect(result.verdict).toBe('rejected');
    expect(result.rules.find((r) => r.rule === 'caution')?.pass).toBe(false);
  });

  test('rejects estimation above classification ceiling', () => {
    const result = qualify(
      { ...baseTender, estimationMad: 25_000_000 },
      AGHA_PROFILE,
      TODAY,
    );
    expect(result.verdict).toBe('rejected');
    expect(result.rules.find((r) => r.rule === 'estimation')?.pass).toBe(false);
  });

  test('rejects when the deadline runway is infeasible', () => {
    const result = qualify({ ...baseTender, deadlineAt: days(1) }, AGHA_PROFILE, TODAY);
    expect(result.verdict).toBe('rejected');
    expect(result.rules.find((r) => r.rule === 'delai')?.pass).toBe(false);
  });

  test('rejects objets outside company domains', () => {
    const result = qualify(
      { ...baseTender, objet: 'Fourniture de mobilier de bureau pour la commune' },
      AGHA_PROFILE,
      TODAY,
    );
    expect(result.verdict).toBe('rejected');
    expect(result.rules.find((r) => r.rule === 'domaine')?.pass).toBe(false);
  });

  test('missing published amounts pass with a verification flag, never reject', () => {
    const result = qualify(
      { ...baseTender, estimationMad: undefined, cautionProvisoireMad: undefined },
      AGHA_PROFILE,
      TODAY,
    );
    expect(result.verdict).toBe('qualified');
    expect(result.rules.find((r) => r.rule === 'caution')?.detail).toContain('à vérifier');
    expect(result.rules.find((r) => r.rule === 'estimation')?.detail).toContain('à vérifier');
  });
});
