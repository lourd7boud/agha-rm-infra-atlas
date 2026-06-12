import { describe, expect, test } from 'vitest';
import { BID_REQUIRED_KINDS } from '../vault/validity';
import {
  buildComplianceChecklist,
  type ComplianceTenderInput,
} from './compliance.domain';

const TODAY = new Date('2026-06-12T00:00:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

const FULL_VAULT = BID_REQUIRED_KINDS.map((kind) => ({
  kind,
  expiresAt: days(120),
}));

const BASE_TENDER: ComplianceTenderInput = {
  reference: 'AO 23/2026/DRETLH',
  cautionProvisoireMad: 90_000,
  raw: {
    extraction: {
      qualificationsRequises: ['Secteur B', 'Classe 3'],
      visiteDesLieux: '10 juillet 2026 à 10h',
    },
  },
};

describe('buildComplianceChecklist', () => {
  test('full vault and known caution produce a ready checklist', () => {
    const checklist = buildComplianceChecklist(BASE_TENDER, FULL_VAULT, TODAY);

    expect(checklist.ready).toBe(true);
    expect(checklist.counts.ok).toBe(BID_REQUIRED_KINDS.length);
    expect(checklist.counts.manquant).toBe(0);
  });

  test('missing vault document blocks readiness', () => {
    const withoutFiscale = FULL_VAULT.filter(
      (doc) => doc.kind !== 'attestation_fiscale',
    );
    const checklist = buildComplianceChecklist(BASE_TENDER, withoutFiscale, TODAY);

    expect(checklist.ready).toBe(false);
    const item = checklist.items.find((i) => i.code === 'vault:attestation_fiscale');
    expect(item?.status).toBe('manquant');
    expect(item?.detail).toContain('Absent');
  });

  test('expired vault document blocks readiness', () => {
    const withExpiredFiscale = [
      ...FULL_VAULT.filter((doc) => doc.kind !== 'attestation_fiscale'),
      { kind: 'attestation_fiscale' as const, expiresAt: days(-1) },
    ];
    const checklist = buildComplianceChecklist(
      BASE_TENDER,
      withExpiredFiscale,
      TODAY,
    );

    expect(checklist.ready).toBe(false);
    const item = checklist.items.find((i) => i.code === 'vault:attestation_fiscale');
    expect(item?.status).toBe('manquant');
    expect(item?.detail).toContain('expir');
  });

  test('expiring document stays usable but flags renewal', () => {
    const withExpiringCnss = [
      ...FULL_VAULT.filter((doc) => doc.kind !== 'attestation_cnss'),
      { kind: 'attestation_cnss' as const, expiresAt: days(10) },
    ];
    const checklist = buildComplianceChecklist(BASE_TENDER, withExpiringCnss, TODAY);

    expect(checklist.ready).toBe(true);
    expect(
      checklist.items.find((i) => i.code === 'vault:attestation_cnss')?.status,
    ).toBe('a_renouveler');
  });

  test('known caution amount becomes a bank action with the amount', () => {
    const checklist = buildComplianceChecklist(BASE_TENDER, FULL_VAULT, TODAY);
    const caution = checklist.items.find((i) => i.code === 'caution_provisoire');

    expect(caution?.status).toBe('a_faire');
    expect(caution?.label).toContain('90');
  });

  test('unknown caution becomes a DCE verification', () => {
    const checklist = buildComplianceChecklist(
      { ...BASE_TENDER, cautionProvisoireMad: undefined },
      FULL_VAULT,
      TODAY,
    );
    expect(
      checklist.items.find((i) => i.code === 'caution_provisoire')?.status,
    ).toBe('a_verifier');
  });

  test('extraction-driven items appear: qualifications and visite des lieux', () => {
    const checklist = buildComplianceChecklist(BASE_TENDER, FULL_VAULT, TODAY);

    expect(
      checklist.items.find((i) => i.code === 'qualification:Secteur B')?.status,
    ).toBe('a_verifier');
    expect(checklist.items.find((i) => i.code === 'visite_lieux')?.label).toContain(
      '10 juillet 2026',
    );
  });

  test('tender without extraction still yields the base checklist', () => {
    const checklist = buildComplianceChecklist(
      { reference: 'AO X', raw: null },
      FULL_VAULT,
      TODAY,
    );
    expect(checklist.items.some((i) => i.code === 'declaration_honneur')).toBe(true);
    expect(checklist.items.some((i) => i.code.startsWith('qualification:'))).toBe(
      false,
    );
  });
});
