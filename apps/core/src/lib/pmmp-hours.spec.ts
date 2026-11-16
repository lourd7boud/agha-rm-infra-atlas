import { expect, test } from 'vitest';
import { nextPmmpOpening, isPmmpUrl } from './pmmp-hours';

test.each([
  ['2026-11-11T23:59:59Z', null],
  ['2026-11-12T00:00:00Z', '2026-11-12T07:30:00.000Z'],
  ['2026-11-12T07:29:59Z', '2026-11-12T07:30:00.000Z'],
  ['2026-11-12T07:30:00Z', null],
])('recognizes official opening hours at %s', (instant, reopening) => {
  expect(nextPmmpOpening(new Date(instant))?.toISOString() ?? null).toBe(reopening);
});

test('only the official portal host is identified', () => {
  expect(isPmmpUrl('https://www.marchespublics.gov.ma/?page=search')).toBe(true);
  expect(isPmmpUrl('https://marchespublics.gov.ma.example.org/')).toBe(false);
  expect(isPmmpUrl('not a URL')).toBe(false);
});
