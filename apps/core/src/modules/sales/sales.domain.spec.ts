import { describe, expect, test } from 'vitest';
import { computeDocTotals, lineTotal, type DocLine } from './sales.domain';

describe('lineTotal', () => {
  test('multiplies quantity by unit price', () => {
    // Arrange
    const line: DocLine = { quantity: 3, unitPriceMad: 250 };

    // Act
    const total = lineTotal(line);

    // Assert
    expect(total).toBe(750);
  });

  test('rounds the product to 2 decimals', () => {
    // Arrange
    const line: DocLine = { quantity: 2.5, unitPriceMad: 33.333 };

    // Act
    const total = lineTotal(line);

    // Assert
    expect(total).toBe(83.33);
  });
});

describe('computeDocTotals', () => {
  test('sums line totals into HT and applies TVA for TTC', () => {
    // Arrange
    const lines: DocLine[] = [
      { quantity: 2, unitPriceMad: 100 },
      { quantity: 1, unitPriceMad: 50 },
    ];

    // Act
    const totals = computeDocTotals(lines, 20);

    // Assert
    expect(totals.totalHtMad).toBe(250);
    expect(totals.tvaMad).toBe(50);
    expect(totals.totalTtcMad).toBe(300);
  });

  test('a single line drives all three totals', () => {
    // Arrange
    const lines: DocLine[] = [{ quantity: 4, unitPriceMad: 125 }];

    // Act
    const totals = computeDocTotals(lines, 20);

    // Assert
    expect(totals.totalHtMad).toBe(500);
    expect(totals.tvaMad).toBe(100);
    expect(totals.totalTtcMad).toBe(600);
  });

  test('0% TVA leaves HT equal to TTC', () => {
    // Arrange
    const lines: DocLine[] = [
      { quantity: 10, unitPriceMad: 12.5 },
      { quantity: 1, unitPriceMad: 75 },
    ];

    // Act
    const totals = computeDocTotals(lines, 0);

    // Assert
    expect(totals.totalHtMad).toBe(200);
    expect(totals.tvaMad).toBe(0);
    expect(totals.totalTtcMad).toBe(200);
  });

  test('an empty document totals to zero', () => {
    // Arrange
    const lines: DocLine[] = [];

    // Act
    const totals = computeDocTotals(lines, 20);

    // Assert
    expect(totals).toEqual({ totalHtMad: 0, tvaMad: 0, totalTtcMad: 0 });
  });

  test('rounds TVA to centimes', () => {
    // Arrange
    const lines: DocLine[] = [{ quantity: 1, unitPriceMad: 99.99 }];

    // Act
    const totals = computeDocTotals(lines, 20);

    // Assert
    expect(totals.totalHtMad).toBe(99.99);
    expect(totals.tvaMad).toBe(20);
    expect(totals.totalTtcMad).toBe(119.99);
  });
});
