import { describe, expect, it } from 'vitest';
import { assertBidTransition, legalBidTargets } from './bid.domain';

describe('bid workspace lifecycle', () => {
  it('exposes only the deliberate decision targets while evaluating', () => {
    expect(legalBidTargets('evaluating')).toEqual(['go', 'no_go', 'cancelled']);
  });

  it('keeps package freezing behind its evidence-producing command', () => {
    expect(() => assertBidTransition('review', 'assembling')).not.toThrow();
    expect(legalBidTargets('review')).toEqual(['assembling', 'cancelled']);
    expect(() => assertBidTransition('review', 'frozen')).toThrow(
      'Specialized command required for bid workspace transition: review → frozen',
    );
  });

  it('rejects backward transitions that are not explicit recovery paths', () => {
    expect(() => assertBidTransition('go', 'evaluating')).toThrow(
      'Illegal bid workspace transition: go → evaluating',
    );
  });

  it('never exposes submitted as a generic transition target', () => {
    expect(legalBidTargets('submitting')).toEqual([]);
    expect(() => assertBidTransition('submitting', 'submitted')).toThrow(
      'Official receipt is required to mark a bid as submitted',
    );
  });

  it('keeps signatures, portal actions and official outcomes behind specialized commands', () => {
    expect(legalBidTargets('frozen')).toEqual([]);
    expect(legalBidTargets('awaiting_signature')).toEqual([]);
    expect(legalBidTargets('signed')).toEqual([]);
    expect(legalBidTargets('ready_to_submit')).toEqual([]);
    expect(legalBidTargets('submitted')).toEqual([]);
    expect(legalBidTargets('opened')).toEqual([]);

    expect(() => assertBidTransition('opened', 'won')).toThrow(
      'Specialized command required for bid workspace transition: opened → won',
    );
  });

  it('keeps terminal states closed to generic transitions', () => {
    expect(legalBidTargets('closed')).toEqual([]);
    expect(legalBidTargets('no_go')).toEqual([]);
    expect(legalBidTargets('withdrawn')).toEqual([]);
  });
});
