import { describe, expect, it } from 'vitest';
import { parseIndexBulletin } from './btp-index-bulletin.domain';

const cover = { num: 2, text: `N° DATRP/32/986
BAREME D'INDEXATION VALABLE
POUR LES MOIS JUILLET 2026* AOÛT 2026** ET SEPTEMBRE 2026**
04 NOV 2026` };
const table = { num: 7, text: `INDEX H T BASE JANVIER 1987
                         juil-26    août-26     sept-26
Terrassements              TRI      231,2      238,4      240,0
Route                     TR3      245,9      252,6      254,0
                        TR3bis     257,2      263,2      264,4
Prix sans symbole                   1 006,4    1 005,0    1 007,0` };

describe('official index bulletin table proposals', () => {
  it('maps columns and their individual status without treating the stamp as publication', () => {
    const result = parseIndexBulletin([cover, table]);
    expect(result).toMatchObject({ reference: 'DATRP/32/986', documentDate: '2026-11-04' });
    expect(result.months.map(({ month, status, values }) => [month, status, values.TR3])).toEqual([
      ['2026-07', 'definitif', 245.9], ['2026-08', 'provisoire', 252.6], ['2026-09', 'provisoire', 254],
    ]);
    expect(result.months[0]?.evidence[0]).toMatchObject({ code: 'TR3', value: 245.9, page: 7 });
    expect(result.months[0]?.values).not.toHaveProperty('TRI');
    expect(result).not.toHaveProperty('publishedOn');
  });

  it('omits conflicting duplicates instead of silently selecting either printed value', () => {
    const result = parseIndexBulletin([cover, table, { num: 8, text: 'juil-26 août-26 sept-26\nTR3 111,1 252,6 254,0' }]);
    expect(result.months[0]?.values).not.toHaveProperty('TR3');
    expect(result.issues.join(' ')).toContain('contradictoires');
  });

  it('keeps unknown statuses open and does not take a legal reference date as the document stamp', () => {
    const result = parseIndexBulletin([{ ...cover, text: 'Arrêté du 27 novembre 2015, applicable depuis 2016' }, table]);
    expect(result.months.every(({ status }) => status === null)).toBe(true);
    expect(result.documentDate).toBeNull();
  });

  it('preserves a value with grouped thousands and refuses zero values', () => {
    const result = parseIndexBulletin([cover, { num: 3, text: 'juil-26 août-26 sept-26\n  At 1 213,4 0,0 1 182,6' }]);
    expect(result.months[0]?.values.At).toBe(1213.4);
    expect(result.months.find(({ month }) => month === '2026-08')?.values.At).toBeUndefined();
  });

  it('keeps declared empty months available for manual review and excludes a separate tax table', () => {
    const result = parseIndexBulletin([cover, { num: 3, text: 'INDEX APPLICABLES AUX MARCHES\nJuillet 2026\nAt 100,5' },
      { num: 4, text: 'TAXES SYMBOLE\nJuillet 2026\nTf 20%' }]);
    expect(result.months).toHaveLength(3);
    expect(result.months[0]?.values).toEqual({ At: 100.5 });
    expect(result.months[1]?.values).toEqual({});
  });
});
