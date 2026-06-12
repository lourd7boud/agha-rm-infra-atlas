import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseMadAmount, parseResultDate, parseResultsPage } from './intel.parser';

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/modules/intel/fixtures/pmmp-resultats.html'),
  'utf8',
);

describe('parseMadAmount', () => {
  test('parses Moroccan thousand-dot decimal-comma notation', () => {
    expect(parseMadAmount('7.842.300,50')).toBe(7_842_300.5);
    expect(parseMadAmount('12.150.000,00')).toBe(12_150_000);
  });

  test('rejects non-numeric content', () => {
    expect(parseMadAmount('selon bordereau')).toBeNull();
    expect(parseMadAmount('')).toBeNull();
  });
});

describe('parseResultDate', () => {
  test('parses DD/MM/YYYY to UTC', () => {
    expect(parseResultDate('12/05/2026')?.toISOString()).toBe(
      '2026-05-12T00:00:00.000Z',
    );
  });

  test('rejects other formats', () => {
    expect(parseResultDate('2026-05-12')).toBeNull();
  });
});

describe('parseResultsPage', () => {
  test('extracts winners with amounts from the fixture', () => {
    const { results, skippedRows } = parseResultsPage(FIXTURE, 'https://example.ma/');

    expect(results).toHaveLength(3);
    expect(skippedRows).toBe(1);

    const first = results[0]!;
    expect(first.reference).toBe('AO 102/2025/ORMVAH');
    expect(first.bidderName).toBe('SOTRAVHYD SARL');
    expect(first.amountMad).toBe(7_842_300.5);
    expect(first.isWinner).toBe(true);
    expect(first.resultDate?.toISOString()).toBe('2026-05-12T00:00:00.000Z');
  });

  test('returns empty on pages without the results table', () => {
    const outcome = parseResultsPage('<html><body>rien</body></html>', 'x://y');
    expect(outcome.results).toEqual([]);
  });
});
