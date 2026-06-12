import { describe, expect, test } from 'vitest';
import type { ReadinessReport } from '../vault/validity';
import { buildDigest, renderDigestFr, type DigestTenderInput } from './digest.domain';

const TODAY = new Date('2026-06-12T07:30:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

const READY: ReadinessReport = {
  score: 100,
  ready: true,
  missing: [],
  expired: [],
  expiring: [],
};

function tender(overrides: Partial<DigestTenderInput>): DigestTenderInput {
  return {
    reference: 'AO 1/2026/X',
    buyerName: 'Commune X',
    objet: 'Travaux divers',
    pipelineState: 'qualified',
    deadlineAt: days(20),
    raw: null,
    ...overrides,
  };
}

describe('buildDigest', () => {
  test('sorts the wall by urgency and flags critical deadlines', () => {
    const digest = buildDigest(
      [
        tender({ reference: 'LOIN', deadlineAt: days(30) }),
        tender({ reference: 'CRITIQUE', deadlineAt: days(5) }),
        tender({ reference: 'ORANGE', deadlineAt: days(12) }),
      ],
      READY,
      TODAY,
    );

    expect(digest.wall.map((e) => e.reference)).toEqual(['CRITIQUE', 'ORANGE', 'LOIN']);
    expect(digest.urgent.map((e) => e.reference)).toEqual(['CRITIQUE', 'ORANGE']);
    expect(digest.wall[0]?.urgency).toBe('rouge');
    expect(digest.counts.urgents).toBe(2);
  });

  test('excludes closed pipeline states from the wall', () => {
    const digest = buildDigest(
      [
        tender({ reference: 'ACTIF' }),
        tender({ reference: 'PERDU', pipelineState: 'lost' }),
        tender({ reference: 'ECARTE', pipelineState: 'rejected' }),
      ],
      READY,
      TODAY,
    );
    expect(digest.wall.map((e) => e.reference)).toEqual(['ACTIF']);
  });

  test('lists qualified tenders as pending G1 decisions', () => {
    const digest = buildDigest(
      [
        tender({ reference: 'EN-ATTENTE', pipelineState: 'qualified' }),
        tender({ reference: 'DECIDE', pipelineState: 'go_decided' }),
      ],
      READY,
      TODAY,
    );
    expect(digest.pendingG1).toEqual(['EN-ATTENTE']);
    expect(digest.counts.enAttenteG1).toBe(1);
  });
});

describe('renderDigestFr', () => {
  test('renders critical sections and vault status in French', () => {
    const digest = buildDigest(
      [tender({ reference: 'AO 9/2026/ORMVAT', deadlineAt: days(3) })],
      {
        score: 83,
        ready: false,
        missing: ['attestation_fiscale'],
        expired: [],
        expiring: ['attestation_cnss'],
      },
      TODAY,
    );
    const text = renderDigestFr(digest);

    expect(text).toContain('Brief du 2026-06-12');
    expect(text).toContain('ÉCHÉANCES CRITIQUES');
    expect(text).toContain('J-3  AO 9/2026/ORMVAT');
    expect(text).toContain('DOSSIER INCOMPLET');
    expect(text).toContain('Manquants: Attestation fiscale');
    expect(text).toContain('À renouveler: Attestation CNSS');
  });
});
