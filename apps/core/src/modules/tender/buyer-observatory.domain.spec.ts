import { describe, expect, it } from 'vitest';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { inferSegment } from './inventory.domain';
import {
  buildBuyerProfile,
  buildBuyerProfiles,
  buildMarketContext,
} from './buyer-observatory.domain';
import type { TenderRecord } from './tender.repository';

function tender(p: Partial<TenderRecord> & { buyerName: string; objet: string }): TenderRecord {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    reference: p.reference ?? 'REF',
    buyerName: p.buyerName,
    procedure: (p.procedure ?? 'AOO') as TenderProcedure,
    objet: p.objet,
    estimationMad: p.estimationMad,
    cautionProvisoireMad: p.cautionProvisoireMad,
    deadlineAt: p.deadlineAt ?? new Date('2026-07-01T09:00:00Z'),
    sourceUrl: p.sourceUrl,
    pipelineState: (p.pipelineState ?? 'detected') as PipelineState,
    qualification: p.qualification ?? null,
    raw: p.raw ?? null,
    createdAt: p.createdAt ?? new Date('2026-06-01T00:00:00Z'),
    updatedAt: p.updatedAt ?? new Date('2026-06-01T00:00:00Z'),
  };
}

describe('inferSegment', () => {
  it('classifies ouvrage families from the objet', () => {
    expect(inferSegment("Travaux d'irrigation du périmètre de Boudnib")).toBe('irrigation');
    expect(inferSegment("Construction d'une station d'épuration des eaux usées")).toBe('assainissement');
    expect(inferSegment('Adduction en eau potable AEP de douars')).toBe('eau_potable');
    expect(inferSegment('Acquisition de matériel informatique')).toBe('fourniture');
    expect(inferSegment('Forage et équipement de puits')).toBe('forage');
  });

  it('falls back to autre when nothing matches', () => {
    expect(inferSegment('Prestation indéterminée xyz')).toBe('autre');
  });

  it('does not match a short keyword inside a longer word', () => {
    // "route" must not fire on "déroutement"; objet has no real segment word.
    expect(inferSegment('Gestion du déroutement administratif')).toBe('autre');
  });
});

describe('buildBuyerProfiles', () => {
  const tenders: TenderRecord[] = [
    tender({ buyerName: 'ORMVA du Souss Massa', objet: "Travaux d'irrigation", estimationMad: 2_000_000, pipelineState: 'detected' }),
    tender({ buyerName: 'ORMVA du Souss Massa', objet: 'Adduction eau potable AEP', estimationMad: 1_000_000, procedure: 'AOR', pipelineState: 'won' }),
    tender({ buyerName: 'Commune de Berkane', objet: 'Voirie et chaussée urbaine', pipelineState: 'detected' }),
  ];

  it('returns one profile per buyer, busiest first', () => {
    const profiles = buildBuyerProfiles(tenders);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.buyerName).toBe('ORMVA du Souss Massa');
    expect(profiles[0]?.tenderCount).toBe(2);
  });

  it('aggregates region, segments, procedures and estimation average', () => {
    const [ormva] = buildBuyerProfiles(tenders);
    expect(ormva?.region).toBe('Souss-Massa');
    expect(ormva?.withEstimationCount).toBe(2);
    expect(ormva?.avgEstimationMad).toBe(1_500_000);
    expect(ormva?.procedures.map((p) => p.key)).toEqual(
      expect.arrayContaining(['AOO', 'AOR']),
    );
    expect(ormva?.topSegments.map((s) => s.key)).toEqual(
      expect.arrayContaining(['irrigation', 'eau_potable']),
    );
  });

  it('counts active (non-terminal) tenders separately', () => {
    const [ormva] = buildBuyerProfiles(tenders);
    expect(ormva?.tenderCount).toBe(2);
    expect(ormva?.activeCount).toBe(1); // one is 'won' (terminal)
  });

  it('leaves avgEstimation null when no estimation is known', () => {
    const [berkane] = buildBuyerProfiles([tenders[2]!]);
    expect(berkane?.avgEstimationMad).toBeNull();
    expect(berkane?.withEstimationCount).toBe(0);
    expect(berkane?.topSegments[0]?.key).toBe('routes');
  });
});

describe('buildBuyerProfile', () => {
  it('returns one buyer by exact name, or null', () => {
    const tenders = [tender({ buyerName: 'Commune X', objet: 'Forage de puits' })];
    expect(buildBuyerProfile(tenders, 'Commune X')?.tenderCount).toBe(1);
    expect(buildBuyerProfile(tenders, 'Inconnue')).toBeNull();
  });
});

describe('buildMarketContext', () => {
  it('gives the Strategist the segment + the buyer demand profile', () => {
    const history = [
      tender({ buyerName: 'ORMVA du Souss Massa', objet: "Travaux d'irrigation", estimationMad: 2_000_000 }),
      tender({ buyerName: 'ORMVA du Souss Massa', objet: 'Adduction eau potable' }),
    ];
    const subject = tender({ buyerName: 'ORMVA du Souss Massa', objet: "Réseau d'irrigation Souss" });
    const ctx = buildMarketContext(subject, history);
    expect(ctx.segment).toBe('irrigation');
    expect(ctx.profilAcheteur?.region).toBe('Souss-Massa');
    expect(ctx.profilAcheteur?.nbAppelsObserves).toBe(2);
  });

  it('returns a null buyer profile for an unseen acheteur', () => {
    const ctx = buildMarketContext(
      { buyerName: 'Nouveau Maître', objet: 'Forage de puits' },
      [],
    );
    expect(ctx.profilAcheteur).toBeNull();
    expect(ctx.segment).toBe('forage');
  });
});
