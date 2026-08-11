import { describe, expect, test } from 'vitest';
import {
  allocateCentsProRata,
  formatMoneyCents,
  parseMoneyCents,
} from './sales-money.domain';

describe('sales money boundary', () => {
  test('parses and formats decimal MAD without binary floating-point drift', () => {
    expect(parseMoneyCents('110.50')).toBe(11_050);
    expect(parseMoneyCents('0.10')).toBe(10);
    expect(parseMoneyCents('0,20')).toBe(20);
    expect(formatMoneyCents(11_050)).toBe('110.50');
    expect(formatMoneyCents(-5)).toBe('-0.05');
  });

  test('rejects ambiguous string precision beyond a centime', () => {
    expect(() => parseMoneyCents('12.345')).toThrow(/deux décimales/i);
    expect(() => parseMoneyCents('1e3')).toThrow(/montant/i);
    expect(() => parseMoneyCents('NaN')).toThrow(/montant/i);
  });

  test('rounds finite numeric boundaries half-up to the nearest centime', () => {
    expect(parseMoneyCents(0.1 + 0.2)).toBe(30);
    expect(parseMoneyCents(10.125)).toBe(1_013);
    expect(() => parseMoneyCents(Number.POSITIVE_INFINITY)).toThrow(/fini/i);
  });

  test('rejects values that cannot remain safe integer centimes', () => {
    expect(() => parseMoneyCents(Number.MAX_SAFE_INTEGER)).toThrow(/limites sûres/i);
    expect(() => formatMoneyCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(/entier sûr/i);
  });
});

describe('allocateCentsProRata', () => {
  test('assigns the residual centimes to the final weighted allocation', () => {
    expect(allocateCentsProRata(10_001, [1, 1, 1])).toEqual([
      3_333, 3_333, 3_335,
    ]);
  });

  test('preserves the exact total for large safe centime values', () => {
    const allocations = allocateCentsProRata(9_000_000_000_001, [2, 3, 5]);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(
      9_000_000_000_001,
    );
  });

  test('never assigns a residual centime to a zero-weight allocation', () => {
    expect(allocateCentsProRata(1, [1, 1, 0])).toEqual([0, 1, 0]);
  });

  test('rejects negative totals, negative weights, and an empty weight sum', () => {
    expect(() => allocateCentsProRata(-1, [1])).toThrow(/positif ou nul/i);
    expect(() => allocateCentsProRata(1, [1, -1])).toThrow(/poids/i);
    expect(() => allocateCentsProRata(1, [0, 0])).toThrow(/strictement positive/i);
  });
});
