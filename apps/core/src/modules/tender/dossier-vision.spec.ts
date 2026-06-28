import { describe, expect, test } from 'vitest';
import { selectVisionPageRanges } from './dossier-vision';

describe('selectVisionPageRanges', () => {
  test('renders every page when the doc fits the budget', () => {
    expect(selectVisionPageRanges(5, 12)).toEqual([[1, 5]]);
    expect(selectVisionPageRanges(12, 12)).toEqual([[1, 12]]);
  });

  test('splits first + last so an end-of-CPS bordereau is captured', () => {
    // 19-page scanned CPS, 8-page budget → first 4 + last 4 (pages 16-19 catch
    // a bordereau near the end — the bug this fixes).
    expect(selectVisionPageRanges(19, 8)).toEqual([
      [1, 4],
      [16, 19],
    ]);
    // 15-page RC, 12-page budget → first 6 + last 6.
    expect(selectVisionPageRanges(15, 12)).toEqual([
      [1, 6],
      [10, 15],
    ]);
  });

  test('degenerate inputs yield no ranges', () => {
    expect(selectVisionPageRanges(0, 12)).toEqual([]);
    expect(selectVisionPageRanges(10, 0)).toEqual([]);
  });

  test('a budget of 1 takes only the first page', () => {
    expect(selectVisionPageRanges(10, 1)).toEqual([[1, 1]]);
  });
});
