import { describe, expect, test } from 'vitest';
import type { PricingRunView } from '@/lib/bdc';
import {
  initialPricingAgentState,
  canApplyPricingRun,
  pricingAgentReducer,
  pricingPollInterval,
  selectLineEvidence,
} from './BdcPricingAgentPanel.state';

function run(status: PricingRunView['status']): PricingRunView {
  return {
    id: 'run-1',
    avisId: 'avis-1',
    status,
    stage: status === 'completed' ? 'brouillon_enregistre' : 'recherche_marche',
    progressPct: status === 'completed' ? 100 : 40,
    requestedMarkupPct: 15,
    calibrationVersion: 'baseline-v1',
    warnings: [],
    error: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:01:00.000Z',
    decisions: [
      {
        idx: 2,
        estimatedCostHt: 100,
        proposedUnitPriceHt: 120,
        rangeLowHt: 115,
        rangeHighHt: 130,
        markupPct: 20,
        confidence: 'moyenne',
        method: 'marche_pondere',
        sourceIds: ['evidence-1'],
        explanation: 'Médiane de marché vérifiée',
        warnings: [],
        manualPriceLocked: false,
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        designation: 'Peinture intérieure',
        sourceType: 'web',
        sourceRef: 'bricoma.ma — Peinture',
        sourceUrl: 'https://bricoma.ma/peinture',
        observedAt: '2026-07-20T00:00:00.000Z',
        unit: 'u',
        unitPriceHtMad: 100,
        verified: false,
        reliability: 0.6,
      },
    ],
  };
}

describe('BDC pricing agent panel state', () => {
  test('tracks queued, running and completed runs without losing the audit trail', () => {
    const queued = pricingAgentReducer(initialPricingAgentState, {
      type: 'run_received',
      run: run('queued'),
    });
    const running = pricingAgentReducer(queued, {
      type: 'run_received',
      run: run('running'),
    });
    const completed = pricingAgentReducer(running, {
      type: 'run_received',
      run: run('completed'),
    });
    expect(running.run?.progressPct).toBe(40);
    expect(completed.run?.evidence).toHaveLength(1);
    expect(completed.error).toBeNull();
  });

  test('polls every two seconds only while queued or running', () => {
    expect(pricingPollInterval('queued')).toBe(2_000);
    expect(pricingPollInterval('running')).toBe(2_000);
    expect(pricingPollInterval('completed')).toBeNull();
    expect(pricingPollInterval('failed')).toBeNull();
    expect(pricingPollInterval('cancelled')).toBeNull();
    expect(canApplyPricingRun(run('running'))).toBe(false);
    expect(canApplyPricingRun(run('completed'))).toBe(true);
  });

  test('selects only evidence referenced by the expanded line', () => {
    expect(selectLineEvidence(run('completed'), 2)).toEqual([
      expect.objectContaining({ id: 'evidence-1', sourceUrl: expect.any(String) }),
    ]);
    expect(selectLineEvidence(run('completed'), 1)).toEqual([]);
  });

  test('supports an evidence drawer, errors, retry and clean reset', () => {
    const opened = pricingAgentReducer(initialPricingAgentState, {
      type: 'toggle_evidence',
      lineIdx: 2,
    });
    expect(opened.expandedLineIdx).toBe(2);
    expect(
      pricingAgentReducer(opened, { type: 'toggle_evidence', lineIdx: 2 })
        .expandedLineIdx,
    ).toBeNull();
    const failed = pricingAgentReducer(opened, {
      type: 'failed',
      message: 'Agent indisponible',
    });
    expect(failed.error).toBe('Agent indisponible');
    expect(pricingAgentReducer(failed, { type: 'reset' })).toEqual(
      initialPricingAgentState,
    );
  });
});
