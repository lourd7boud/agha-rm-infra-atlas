import { describe, expect, test } from 'vitest';
import type { TenderItem } from './tenders';
import { buildTenderDecision } from './tender-decision';

const tender = {
  id: '1', reference: '01/2027', objet: 'Travaux de construction de conduites et ouvrages hydrauliques',
  buyerName: 'Commune X', category: 'Travaux', location: 'KENITRA',
  deadlineAt: '2026-11-12T10:00:00Z', lifecycleStatus: 'en_cours',
} as TenderItem;
const now = new Date('2026-11-09T12:00:00Z');

describe('tender decision brief', () => {
  test('does not mark architectural design as a confirmed construction-business fit', () => {
    expect(buildTenderDecision({ ...tender, procedure: 'consultation_architecturale', objet: 'Conception architecturale et suivi des travaux d’aménagement' }, now).fit).toBe('check');
  });
  test('surfaces business fit and missing evidence without declaring eligibility', () => {
    const brief = buildTenderDecision(tender, now);
    expect(brief.fit).toBe('relevant');
    expect(brief.urgent).toBe(true);
    expect(brief.missing).toContain('Estimation');
    expect(brief.missing).toContain('Caution provisoire');
    expect(brief.missing).toContain('Conditions de participation');
    expect(brief.decision).toBe('verify');
  });

  test('preserves a published zero caution and shows site visit before the deadline', () => {
    const brief = buildTenderDecision({ ...tender, estimationMad: 1000000, cautionProvisoireMad: 0,
      portalDetail: { qualifications: 'Classe 4', visites: [{ date: '10/11/2026 10:00', adresse: 'Commune X' }] },
      dossierExtractedAt: '2026-11-09T10:00:00Z', hasBpu: true,
    }, now);
    expect(brief.missing).not.toContain('Caution provisoire');
    expect(brief.visits[0]?.date).toBe('10/11/2026 10:00');
    expect(brief.decision).toBe('review');
    expect(brief.checks.find((c) => c.key === 'caution')?.source).toBe('catalogue');
  });

  test('highlights the earlier prospectus deadline independently of bid urgency', () => {
    const brief = buildTenderDecision({
      ...tender, deadlineAt: '2026-11-24T11:00:00Z',
      portalDetail: { prospectus: '23/11/2026 16:30' },
    }, new Date('2026-11-21T10:00:00Z'));
    expect(brief.urgent).toBe(false);
    expect(brief.prospectus).toEqual({
      published: '23/11/2026 16:30', deadline: new Date('2026-11-23T16:30:00Z'), status: 'urgent',
    });
    expect(brief.nextActions[0]).toContain('prospectus');
  });

  test('requires inspecting a public complement even when the base dossier is complete', () => {
    const brief = buildTenderDecision({ ...tender, estimationMad: 1000000, cautionProvisoireMad: 0,
      portalDetail: { qualifications: 'Classe 4' }, dossierExtractedAt: '2026-11-09T10:00:00Z', hasBpu: true,
      samirReview: { documents: { state: 'available', currentRevision: 'unverified',
        complement: { state: 'listed', observedAt: now.toISOString() } } } as TenderItem['samirReview'],
    }, now);
    expect(brief.decision).toBe('verify');
    expect(brief.nextActions[0]).toContain('complément');
  });

  test('requires verification after the prospectus date even when the bid is still open', () => {
    const brief = buildTenderDecision({
      ...tender, deadlineAt: '2026-11-24T11:00:00Z',
      estimationMad: 1000000, cautionProvisoireMad: 0,
      portalDetail: { qualifications: 'Classe 4', prospectus: '23/11/2026 16:30' },
      dossierExtractedAt: '2026-11-22T10:00:00Z', hasBpu: true,
    }, new Date('2026-11-23T17:00:00Z'));
    expect(brief.prospectus?.status).toBe('elapsed');
    expect(brief.decision).toBe('verify');
  });

  test('treats elapsed deadlines as closed even if the cached lifecycle says open', () => {
    expect(buildTenderDecision({ ...tender, deadlineAt: '2026-11-08T10:00:00Z' }, now).decision).toBe('closed');
  });

  test.each([
    ['2026-11-12T10:00:00Z', 'Dim 08 Nov 2026 10:00', 'en_cours'],
    ['2026-11-08T10:00:00Z', 'Jeu 12 Nov 2026 10:00', 'cloture'],
  ] as const)('requires source verification when only one of the two dates has elapsed', (deadlineAt, portalDetailDeadline, lifecycleStatus) => {
    const brief = buildTenderDecision({ ...tender, deadlineAt, portalDetailDeadline, lifecycleStatus,
      estimationMad: 1000000, cautionProvisoireMad: 0, portalDetail: { qualifications: 'Classe 4' },
      dossierExtractedAt: '2026-11-09T10:00:00Z', hasBpu: true }, now);
    expect(brief.decision).toBe('verify');
    expect(brief.nextActions).toEqual(['Vérifier l’échéance auprès du portail avant de décider ou de planifier le dépôt.']);
  });

  test('does not mistake a dash for participation conditions or AI content for verified DCE', () => {
    const brief = buildTenderDecision({ ...tender, aiResume: 'Tout est conforme',
      portalDetail: { qualifications: '-', agrements: '-' }, qualifications: [],
    }, now);
    expect(brief.missing).toContain('Conditions de participation');
    expect(brief.checks.find((c) => c.key === 'dossier')?.verified).toBe(false);
  });
  test.each(['champsvide', 'champ vide', 'néant', 'n/a', 'Non renseigné'])('does not count the placeholder %s as verified requirements', (value) => {
    expect(buildTenderDecision({ ...tender, portalDetail: { qualifications: value } }, now).missing).toContain('Conditions de participation');
  });
});
