import { describe, expect, it } from 'vitest';
import { BID_WORKSPACE_STATES } from '@atlas/contracts';
import {
  BID_STATE_META,
  bidProgressPercent,
  safeBidActions,
} from './bid-workspace';

describe('bid workspace presentation', () => {
  it('defines a French operator label for every persisted state', () => {
    expect(Object.keys(BID_STATE_META).sort()).toEqual(
      [...BID_WORKSPACE_STATES].sort(),
    );
  });

  it('shows preparation progress in lifecycle order', () => {
    expect(bidProgressPercent('evaluating')).toBe(0);
    expect(bidProgressPercent('assembling')).toBeGreaterThan(
      bidProgressPercent('go'),
    );
    expect(bidProgressPercent('submitted')).toBe(100);
  });

  it('offers only safe foundation actions and never claims legal completion', () => {
    const allTargets = BID_WORKSPACE_STATES.flatMap((state) =>
      safeBidActions(state).map((action) => action.to),
    );
    expect(allTargets).not.toContain('submitted');
    expect(allTargets).not.toContain('signed');
    expect(allTargets).not.toContain('frozen');
  });

  it('starts evaluation with explicit GO and NO-GO decisions', () => {
    expect(safeBidActions('evaluating')).toEqual([
      { to: 'go', label: 'Valider GO', tone: 'positive' },
      { to: 'no_go', label: 'Classer NO-GO', tone: 'neutral' },
    ]);
  });
});
