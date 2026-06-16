import { describe, expect, it } from 'vitest';
import {
  deriveOutcome,
  gapToFirstPct,
  pipelineStateForResult,
  recoveredRebatePct,
} from './outcome.domain';

const NOW = new Date('2026-06-16T00:00:00Z');

describe('recoveredRebatePct (the founding metric)', () => {
  it('computes (estimation − winner)/estimation in %', () => {
    expect(recoveredRebatePct(1_000_000, 820_000)).toBe(18);
  });

  it('is null without a usable estimation', () => {
    expect(recoveredRebatePct(0, 500_000)).toBeNull();
    expect(recoveredRebatePct(undefined, 500_000)).toBeNull();
  });

  it('is null without a winner amount', () => {
    expect(recoveredRebatePct(1_000_000, undefined)).toBeNull();
  });

  it('goes negative when the winning offer exceeds the estimation', () => {
    expect(recoveredRebatePct(800_000, 900_000)).toBe(-12.5);
  });
});

describe('gapToFirstPct', () => {
  it('measures how far above the winner we landed', () => {
    expect(gapToFirstPct(1_000_000, 900_000)).toBe(11.11);
  });

  it('is 0 when our amount equals the winner', () => {
    expect(gapToFirstPct(900_000, 900_000)).toBe(0);
  });

  it('is null when an amount is missing or the winner is non-positive', () => {
    expect(gapToFirstPct(undefined, 900_000)).toBeNull();
    expect(gapToFirstPct(1_000_000, 0)).toBeNull();
  });
});

describe('pipelineStateForResult', () => {
  it('maps won→won and everything else→lost', () => {
    expect(pipelineStateForResult('won')).toBe('won');
    expect(pipelineStateForResult('lost')).toBe('lost');
    expect(pipelineStateForResult('ecarte')).toBe('lost');
  });
});

describe('deriveOutcome', () => {
  it('won: forces rank 1, winner = our amount, gap 0', () => {
    const out = deriveOutcome(
      { result: 'won', montantSoumisMad: 750_000, scenarioChoisi: 'equilibre' },
      NOW,
    );
    expect(out.ourRank).toBe(1);
    expect(out.winnerAmountMad).toBe(750_000);
    expect(out.gapToFirstPct).toBe(0);
  });

  it('lost: computes the gap to first from both amounts', () => {
    const out = deriveOutcome(
      { result: 'lost', montantSoumisMad: 1_000_000, winnerAmountMad: 900_000, ourRank: 3 },
      NOW,
    );
    expect(out.gapToFirstPct).toBe(11.11);
    expect(out.ourRank).toBe(3);
  });

  it('écarté: assumes no rank/winner, keeps the rejection motive', () => {
    const out = deriveOutcome(
      { result: 'ecarte', motifRejet: 'Pièce administrative manquante' },
      NOW,
    );
    expect(out.gapToFirstPct).toBeNull();
    expect(out.ourRank).toBeUndefined();
    expect(out.motifRejet).toBe('Pièce administrative manquante');
  });

  it('defaults decidedAt to now when not provided', () => {
    const out = deriveOutcome({ result: 'lost' }, NOW);
    expect(out.decidedAt).toEqual(NOW);
  });
});
