import { describe, expect, test } from 'vitest';
import { BID_REQUIRED_KINDS, type ReadinessReport } from '../vault/validity';
import {
  buildAdminFinancialDossier,
  montantEnLettresFr,
} from './dossier-admin.domain';

const NOW = new Date('2026-07-02T12:00:00Z');

describe('montantEnLettresFr', () => {
  test.each([
    [0, 'zéro dirhams'],
    [1, 'un dirham'],
    [21, 'vingt et un dirhams'],
    [71, 'soixante et onze dirhams'],
    [80, 'quatre-vingts dirhams'],
    [81, 'quatre-vingt-un dirhams'],
    [91, 'quatre-vingt-onze dirhams'],
    [100, 'cent dirhams'],
    [200, 'deux cents dirhams'],
    [201, 'deux cent un dirhams'],
    [1000, 'mille dirhams'],
    [1980, 'mille neuf cent quatre-vingts dirhams'],
    [200_000, 'deux cent mille dirhams'],
    [1_000_000, 'un million dirhams'],
    [2_000_000, 'deux millions dirhams'],
  ])('%d → %s', (amount, expected) => {
    expect(montantEnLettresFr(amount as number)).toBe(expected);
  });

  test('spells centimes', () => {
    expect(montantEnLettresFr(1_144_774.88)).toBe(
      'un million cent quarante-quatre mille sept cent soixante-quatorze dirhams et quatre-vingt-huit centimes',
    );
  });

  test('rejects out-of-band amounts', () => {
    expect(() => montantEnLettresFr(-1)).toThrow();
    expect(() => montantEnLettresFr(1e12)).toThrow();
    expect(() => montantEnLettresFr(Number.NaN)).toThrow();
  });
});

describe('buildAdminFinancialDossier', () => {
  const tender = {
    reference: 'AO 7/2026',
    buyerName: 'COMMUNE DE TEST',
    objet: 'Travaux de voirie',
    cautionProvisoireMad: 20_000,
    estimationMad: 1_500_000,
  };

  const readiness: ReadinessReport = {
    score: 33,
    ready: false,
    missing: ['attestation_fiscale', 'attestation_cnss', 'qualification_classification', 'statuts'],
    expired: [],
    expiring: ['registre_commerce'],
  };

  test('maps vault readiness onto the administrative checklist', () => {
    const dossier = buildAdminFinancialDossier({
      tender,
      readiness,
      requiredKinds: BID_REQUIRED_KINDS,
      qualifications: [{ qualification: 'Qualification 5.1', classe: '3' }],
      now: NOW,
    });

    const byCode = new Map(dossier.pieces.map((p) => [p.code, p]));
    expect(byCode.get('attestation_fiscale')!.statut).toBe('a_fournir');
    expect(byCode.get('registre_commerce')!.statut).toBe('disponible');
    expect(byCode.get('registre_commerce')!.note).toContain('Expire bientôt');
    expect(byCode.get('pouvoirs_signataire')!.statut).toBe('disponible');
    expect(dossier.readinessScore).toBe(33);
    expect(dossier.ready).toBe(false);
    expect(dossier.qualificationsRequises).toHaveLength(1);
  });

  test('carries the caution amount into the bank piece note', () => {
    const dossier = buildAdminFinancialDossier({
      tender,
      readiness,
      requiredKinds: BID_REQUIRED_KINDS,
      qualifications: [],
      now: NOW,
    });
    const caution = dossier.pieces.find((p) => p.code === 'caution_provisoire')!;
    expect(caution.note).toContain('20');
    expect(dossier.cautionProvisoireMad).toBe(20_000);
  });

  test('fills the acte d’engagement from the BPU proposal total', () => {
    const dossier = buildAdminFinancialDossier({
      tender,
      readiness,
      requiredKinds: BID_REQUIRED_KINDS,
      qualifications: [],
      proposedTotalMad: 1_350_000,
      now: NOW,
    });
    expect(dossier.acteEngagement.montantMad).toBe(1_350_000);
    expect(dossier.acteEngagement.montantEnLettres).toContain('un million');
    const bordereau = dossier.pieces.find((p) => p.code === 'bordereau_prix')!;
    expect(bordereau.statut).toBe('a_generer');
  });

  test('leaves financial pieces à établir before any BPU proposal', () => {
    const dossier = buildAdminFinancialDossier({
      tender: { ...tender, cautionProvisoireMad: undefined },
      readiness,
      requiredKinds: BID_REQUIRED_KINDS,
      qualifications: [],
      now: NOW,
    });
    expect(dossier.acteEngagement.montantMad).toBeNull();
    expect(dossier.acteEngagement.montantEnLettres).toBeNull();
    const bordereau = dossier.pieces.find((p) => p.code === 'bordereau_prix')!;
    expect(bordereau.statut).toBe('a_etablir');
    const caution = dossier.pieces.find((p) => p.code === 'caution_provisoire')!;
    expect(caution.note).toContain('non publié');
  });
});
