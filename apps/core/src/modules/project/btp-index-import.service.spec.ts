import { describe, expect, it } from 'vitest';
import { discoverIndexSources, applyIndexImportSchema } from './btp-index-import.service';
import { discoverMonthlyBulletins, validateMonthlyBulletin, shouldApplyMonthlyIndex } from './btp-index-sync.domain';
import { selectPublishedIndexes } from './btp-revision.domain';

describe('automatic ministry index sync', () => {
  it('finds dated monthly publications without using the order of links on the page', () => {
    const sources = discoverIndexSources(`<a href="/Ingenierie/Documents/Bareme-juillet-2026.pdf">DERNIER BARÈME</a>
      <a href="/Ingenierie/Documents/Bareme-Rectifie-Juil-Aout.pdf">Rectificatif</a>
      <a href="/Ingenierie/Documents/Bareme-f%C3%A9vrier-.2026.pdf">Février</a>
      <a href="/Ingenierie/Documents/Bareme-juillet-2026.pdf">Juillet</a>`);
    expect(discoverMonthlyBulletins(sources).map(({ month }) => month)).toEqual(['2026-02', '2026-07']);
  });

  const covers = [
    { num: 2, text: 'N° DATRP/32/986\nPOUR LES MOIS JUILLET 2026* AOÛT 2026** ET SEPEMBRE 2026**' },
    { num: 6, text: 'N° DATRP/32/986 bis\nJUILLET 2026* AOÛT 2026** ET SEPTEMBRE 2026**' },
  ];
  const sourceDate = 'Wed, 04 Nov 2026 14:36:01 GMT';
  const observedAt = new Date('2026-11-16T12:00:00Z');

  it('authorizes the dated publication and the two provisional months using both title pages', () => {
    expect(validateMonthlyBulletin('2026-07', covers, sourceDate, observedAt)).toMatchObject({
      reference: 'DATRP/32/986', publishedOn: '2026-11-04',
      months: [
        { month: '2026-07', status: 'definitif' }, { month: '2026-08', status: 'provisoire' },
        { month: '2026-09', status: 'provisoire' },
      ],
    });
  });

  it('rejects a mismatched month, contradictory titles or an implausible server date', () => {
    expect(() => validateMonthlyBulletin('2026-06', covers, sourceDate, observedAt)).toThrow();
    expect(() => validateMonthlyBulletin('2026-07', [...covers.slice(0, 1), { ...covers[1]!, text: covers[1]!.text.replace('AOÛT 2026**', 'AOÛT 2026*') }], sourceDate, observedAt)).toThrow();
    expect(() => validateMonthlyBulletin('2026-07', covers, 'Thu, 01 Jan 1970 00:00:00 GMT', observedAt)).toThrow();
  });

  it('requires both signed tables to resolve a one-year typo in the global cover', () => {
    const march = [
      { num: 2, text: 'DATRP/32/982 MARS 2026* AVRIL 2026** MAI 2026**' },
      { num: 6, text: 'DATRP/32/982 bis MARS 2025* AVRIL 2026** MAI 2026**' },
    ];
    expect(() => validateMonthlyBulletin('2026-03', march, sourceDate, observedAt)).toThrow();
    expect(validateMonthlyBulletin('2026-03', march, sourceDate, observedAt,
      ['mars-26 avr-26 mai-26', 'mars-26 avr-26 mai-26']).months[0]).toEqual({ month: '2026-03', status: 'definitif' });
  });

  it('promotes provisional values and refuses expired or regressive publications', () => {
    const current = { status: 'provisoire', publishedOn: '2026-10-02' };
    expect(shouldApplyMonthlyIndex(current, { status: 'definitif', publishedOn: '2026-10-28' })).toBe(true);
    expect(shouldApplyMonthlyIndex(current, { status: 'definitif', publishedOn: '2026-09-28' })).toBe(false);
    expect(shouldApplyMonthlyIndex({ status: 'definitif', publishedOn: null }, { status: 'provisoire', publishedOn: '2026-10-28' })).toBe(false);
    expect(shouldApplyMonthlyIndex(current, current)).toBe(false);
    expect(shouldApplyMonthlyIndex({ ...current, source: 'DATRP/32/987' },
      { ...current, publishedOn: '2026-10-03', source: 'DATRP/32/986' })).toBe(false);
  });

  it('uses the newest eligible provisional bulletin in calculations after an older file is reuploaded', () => {
    const newer = { values: { TEST: 210 }, status: 'provisoire', source: 'DATRP/32/986', publishedOn: '2026-11-04' };
    const reuploaded = { values: { TEST: 200 }, status: 'provisoire', source: 'DATRP/32/985', publishedOn: '2026-11-05' };
    expect(selectPublishedIndexes(new Map([['2026-08', [newer, reuploaded]]]), '2026-08', ['TEST'],
      '2026-11-06', true)).toEqual(newer);
  });
});

describe('official index import boundary', () => {
  it('discovers ministry bulletins and excludes legal, external and malformed links', () => {
    const sources = discoverIndexSources(`<a href="/Ingenierie/Documents/Bareme-juillet-2026.pdf">Juillet</a>
      <a href="/Ingenierie/Documents/Bareme-juillet-2026.pdf">Juillet</a>
      <a href="https://evil.test/Bareme.pdf">Outside</a><a href="https://user@www.equipement.gov.ma/Bareme.pdf">Credentials</a>
      <a href="/Reglementation/Arrete.pdf">Arrêté</a><a href="javascript:alert(1)">Ignore</a>`);
    expect(sources).toEqual([{ url: 'https://www.equipement.gov.ma/Ingenierie/Documents/Bareme-juillet-2026.pdf', label: 'Juillet' }]);
  });

  it('requires explicit publication evidence and unique reviewed months', () => {
    const request = { reference: 'Bulletin 1', publishedOn: '2026-11-04', publicationEvidence: 'Bordereau de diffusion p. 1',
      months: [{ month: '2026-07', status: 'definitif', indexValues: { TEST: 150 } }] };
    expect(applyIndexImportSchema.safeParse(request).success).toBe(true);
    expect(applyIndexImportSchema.safeParse({ ...request, publicationEvidence: '' }).success).toBe(false);
    expect(applyIndexImportSchema.safeParse({ ...request, months: [...request.months, ...request.months] }).success).toBe(false);
    expect(applyIndexImportSchema.safeParse({ ...request, publishedOn: '2026-02-30' }).success).toBe(false);
  });
});
