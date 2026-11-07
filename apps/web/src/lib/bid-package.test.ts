import { describe, expect, it } from 'vitest';
import { packageChecklist } from './bid-package';

describe('packageChecklist', () => {
  it('counts only mandatory requirements in freeze readiness', () => {
    const result = packageChecklist(
      [
        { id: 'a', code: 'rc', required: true },
        { id: 'b', code: 'bpu', required: true },
        { id: 'c', code: 'memoire', required: false },
      ],
      [{ requirementId: 'a' }],
    );
    expect(result).toEqual({
      required: 2,
      satisfied: 1,
      missingCodes: ['bpu'],
      complete: false,
    });
  });

  it('is complete when every mandatory requirement has a snapshot', () => {
    expect(
      packageChecklist(
        [{ id: 'a', code: 'rc', required: true }],
        [{ requirementId: 'a' }],
      ).complete,
    ).toBe(true);
  });
});
