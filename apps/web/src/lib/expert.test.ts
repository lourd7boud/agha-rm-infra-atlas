import { describe, expect, test } from 'vitest';
import { buildExpertSearchQuery } from './expert';

describe('buildExpertSearchQuery', () => {
  test('scopes the expert picker to active (en_cours) consultations only', () => {
    // The expert prepares a SUBMISSION — you can only bid on a consultation whose
    // deadline is still open, and a closed tender's DCE retrait link is expired so
    // extraction would fail anyway. Without this scope the picker orders by
    // created_at DESC (DB insertion time) and the deep-archive backfill surfaces
    // old closed tenders ahead of the current ones.
    const qs = buildExpertSearchQuery('boudnib');
    expect(qs.get('lifecycle')).toBe('en_cours');
  });

  test('sorts by soonest deadline first (most urgent to prepare)', () => {
    const qs = buildExpertSearchQuery('boudnib');
    expect(qs.get('sort')).toBe('deadline');
    expect(qs.get('dir')).toBe('asc');
  });

  test('forwards the trimmed query and a bounded limit', () => {
    const qs = buildExpertSearchQuery('  ORMVA  ', 8);
    expect(qs.get('q')).toBe('ORMVA');
    expect(qs.get('limit')).toBe('8');
  });

  test('defaults the limit to 8 rows', () => {
    const qs = buildExpertSearchQuery('forage');
    expect(qs.get('limit')).toBe('8');
  });
});
