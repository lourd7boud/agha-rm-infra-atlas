import { describe, expect, test } from 'vitest';
import type { TenderRecord } from '../tender/tender.repository';
import type { CompetitorBidRecord } from '../intel/intel.repository';
import type { RebateBenchmarks } from '../intel/rebate.domain';
import {
  buildExpertKnowledge,
  summarizeParticipation,
} from './expert-knowledge.domain';

const NOW = new Date('2026-07-02T12:00:00Z');

function tender(overrides: Partial<TenderRecord>): TenderRecord {
  return {
    id: overrides.id ?? 't-1',
    reference: overrides.reference ?? 'AO 1/2026',
    buyerName: overrides.buyerName ?? 'COMMUNE DE TEST',
    procedure: overrides.procedure ?? 'AOO',
    objet: overrides.objet ?? "Travaux de construction d'un réservoir",
    deadlineAt: overrides.deadlineAt ?? new Date('2026-08-01T10:00:00Z'),
    pipelineState: overrides.pipelineState ?? 'detected',
    qualification: null,
    raw: overrides.raw ?? null,
    createdAt: NOW,
    updatedAt: NOW,
    ...(overrides.estimationMad !== undefined
      ? { estimationMad: overrides.estimationMad }
      : {}),
    ...(overrides.cautionProvisoireMad !== undefined
      ? { cautionProvisoireMad: overrides.cautionProvisoireMad }
      : {}),
  } as TenderRecord;
}

function bid(overrides: Partial<CompetitorBidRecord>): CompetitorBidRecord {
  return {
    id: overrides.id ?? 'b-1',
    competitorId: overrides.competitorId ?? 'c-1',
    reference: overrides.reference ?? 'AO 1/2026',
    buyerName: overrides.buyerName ?? 'COMMUNE DE TEST',
    bidderName: overrides.bidderName ?? 'STE ALPHA SARL',
    isWinner: overrides.isWinner ?? false,
    createdAt: NOW,
    ...(overrides.amountMad !== undefined ? { amountMad: overrides.amountMad } : {}),
    ...(overrides.estimationMad !== undefined
      ? { estimationMad: overrides.estimationMad }
      : {}),
  } as CompetitorBidRecord;
}

describe('summarizeParticipation', () => {
  test('counts distinct bidders per consultation and averages them', () => {
    const bids = [
      bid({ id: 'b1', reference: 'AO 1/2026', competitorId: 'c1' }),
      bid({ id: 'b2', reference: 'AO 1/2026', competitorId: 'c2' }),
      bid({ id: 'b3', reference: 'AO 1/2026', competitorId: 'c3', isWinner: true, amountMad: 900_000 }),
      bid({ id: 'b4', reference: 'AO 2/2026', competitorId: 'c1', isWinner: true, amountMad: 500_000 }),
    ];
    const summary = summarizeParticipation(bids);
    expect(summary.resultsObserved).toBe(4);
    expect(summary.tendersWithResults).toBe(2);
    // AO 1 has 3 bidders, AO 2 has 1 → avg 2.
    expect(summary.avgBiddersPerTender).toBe(2);
  });

  test('groups participation per buyer despite name-case drift', () => {
    const bids = [
      bid({ id: 'b1', reference: 'AO 1/2026', buyerName: 'ONEE Branche Eau', competitorId: 'c1' }),
      bid({ id: 'b2', reference: 'AO 1/2026', buyerName: 'ONEE Branche Eau', competitorId: 'c2' }),
      bid({ id: 'b3', reference: 'AO 2/2026', buyerName: 'onee branche eau', competitorId: 'c1' }),
    ];
    const summary = summarizeParticipation(bids);
    expect(summary.byBuyer).toHaveLength(1);
    expect(summary.byBuyer[0]!.tendersObserved).toBe(2);
    expect(summary.byBuyer[0]!.avgBidders).toBe(1.5);
  });

  test('aggregates competitor wins and won amounts', () => {
    const bids = [
      bid({ id: 'b1', reference: 'AO 1/2026', competitorId: 'c9', bidderName: 'STE GAMMA', isWinner: true, amountMad: 1_000_000 }),
      bid({ id: 'b2', reference: 'AO 2/2026', competitorId: 'c9', bidderName: 'STE GAMMA', isWinner: true, amountMad: 500_000.4 }),
      bid({ id: 'b3', reference: 'AO 3/2026', competitorId: 'c9', bidderName: 'STE GAMMA', isWinner: false }),
      bid({ id: 'b4', reference: 'AO 3/2026', competitorId: 'c2', bidderName: 'STE BETA' }),
    ];
    const summary = summarizeParticipation(bids);
    const gamma = summary.topCompetitors[0]!;
    expect(gamma.name).toBe('STE GAMMA');
    expect(gamma.wins).toBe(2);
    expect(gamma.participations).toBe(3);
    expect(gamma.totalWonMad).toBe(1_500_000);
  });

  test('returns null average before any result is observed', () => {
    const summary = summarizeParticipation([]);
    expect(summary.avgBiddersPerTender).toBeNull();
    expect(summary.tendersWithResults).toBe(0);
  });

  test('excludes the unknown-buyer placeholder from byBuyer (still counts globally)', () => {
    const bids = [
      bid({ id: 'b1', reference: 'AO 1/2026', buyerName: 'Acheteur non précisé', competitorId: 'c1' }),
      bid({ id: 'b2', reference: 'AO 2/2026', buyerName: 'COMMUNE DE TEST', competitorId: 'c1' }),
    ];
    const summary = summarizeParticipation(bids);
    expect(summary.byBuyer).toHaveLength(1);
    expect(summary.byBuyer[0]!.buyerName).toBe('COMMUNE DE TEST');
    // The placeholder consultation still feeds the global average.
    expect(summary.tendersWithResults).toBe(2);
  });

  test('duplicate rows for the same (reference, bidder) do not inflate participations', () => {
    const bids = [
      bid({ id: 'b1', reference: 'AO 1/2026', competitorId: 'c1', bidderName: 'STE ALPHA' }),
      bid({ id: 'b2', reference: 'AO 1/2026', competitorId: 'c1', bidderName: 'STE ALPHA' }),
      bid({ id: 'b3', reference: 'AO 2/2026', competitorId: 'c1', bidderName: 'STE ALPHA' }),
    ];
    const summary = summarizeParticipation(bids);
    expect(summary.topCompetitors[0]!.participations).toBe(2);
  });
});

describe('buildExpertKnowledge', () => {
  const benchmarks: RebateBenchmarks = {
    overall: { count: 12, medianPct: 14, p25Pct: 8, p75Pct: 19, meanPct: 13.5 },
    byBuyer: [
      { buyerName: 'COMMUNE DE TEST', count: 6, medianPct: 12, p25Pct: 9, p75Pct: 15, meanPct: 12 },
    ],
    bySegment: [],
    sampled: 12,
    rejected: 1,
  };

  test('summarises the market, competition and rebate memory', () => {
    const tenders = [
      tender({ id: 't1', reference: 'AO 1/2026', estimationMad: 1_000_000, cautionProvisoireMad: 20_000 }),
      tender({ id: 't2', reference: 'AO 2/2026', deadlineAt: new Date('2026-01-01T10:00:00Z') }),
      tender({
        id: 't3',
        reference: 'AO 3/2026',
        buyerName: 'ONEE',
        objet: 'Fourniture de compteurs',
        raw: {
          dossierExtraction: {
            model: 'test',
            extractedAt: NOW.toISOString(),
            bpu: [{ designation: 'Compteur DN15' }],
          },
        },
      }),
    ];
    const knowledge = buildExpertKnowledge({
      tenders,
      bids: [bid({ id: 'b1' })],
      benchmarks,
      now: NOW,
    });

    expect(knowledge.marche.tendersTotal).toBe(3);
    expect(knowledge.marche.tendersActive).toBe(2); // t2 deadline is past
    expect(knowledge.marche.buyersTotal).toBe(2);
    expect(knowledge.marche.withBudget).toBe(1);
    expect(knowledge.marche.withCaution).toBe(1);
    expect(knowledge.marche.withBpu).toBe(1);
    expect(knowledge.marche.categories.map((c) => c.key)).toContain('Travaux');
    expect(knowledge.concurrence.resultsObserved).toBe(1);
    expect(knowledge.rabais.sampled).toBe(12);
    expect(knowledge.rabais.topBuyers[0]!.buyerName).toBe('COMMUNE DE TEST');
    expect(knowledge.topAcheteurs[0]!.tenderCount).toBe(2);
    expect(knowledge.generatedAt).toBe(NOW.toISOString());
  });

  test('degrades cleanly with no benchmarks and no bids', () => {
    const knowledge = buildExpertKnowledge({
      tenders: [tender({})],
      bids: [],
      benchmarks: null,
      now: NOW,
    });
    expect(knowledge.rabais.sampled).toBe(0);
    expect(knowledge.rabais.overall).toBeNull();
    expect(knowledge.concurrence.avgBiddersPerTender).toBeNull();
  });
});
