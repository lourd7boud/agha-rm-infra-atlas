import { describe, expect, it } from 'vitest';
import { COMPANY_FOUNDING_DOCS } from './company-founding-docs';
import {
  BID_REQUIRED_KINDS,
  computeReadiness,
  computeStatus,
  dueAlerts,
  type ReadinessDoc,
} from '../validity';

// Frozen "today" = ATLAS reference date, so the expiry assertions are stable.
const TODAY = new Date('2026-06-15T00:00:00Z');

const asReadinessDocs = (): ReadinessDoc[] =>
  COMPANY_FOUNDING_DOCS.map((doc) => ({
    kind: doc.kind,
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt) : null,
  }));

describe('company founding documents manifest', () => {
  it('describes exactly the 8 founding PDFs with unique references', () => {
    expect(COMPANY_FOUNDING_DOCS).toHaveLength(8);

    const references = COMPANY_FOUNDING_DOCS.map((d) => d.reference);
    expect(new Set(references).size).toBe(references.length);

    for (const doc of COMPANY_FOUNDING_DOCS) {
      expect(doc.filePattern.trim().length).toBeGreaterThan(0);
      expect(doc.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('carries no sensitive access codes in the committed metadata', () => {
    const blob = JSON.stringify(COMPANY_FOUNDING_DOCS).toUpperCase();
    // SIMPL access code and the DGI verification hashes seen on the PDFs.
    expect(blob).not.toContain('RBQKLVQH');
    expect(blob).not.toContain('SIMPL');
  });
});

describe('readiness derived from the founding file', () => {
  it('recognises the registre de commerce as the one bid-required piece on hand', () => {
    const report = computeReadiness(asReadinessDocs(), TODAY);

    expect(report.missing).not.toContain('registre_commerce');
    // A brand-new company: only the RC is a bid-required piece in this bundle.
    expect(report.score).toBe(Math.round((1 / BID_REQUIRED_KINDS.length) * 100));
    expect(report.ready).toBe(false);
  });

  it('still flags the periodic attestations and qualification as "à fournir"', () => {
    const report = computeReadiness(asReadinessDocs(), TODAY);

    // These are the pieces a project must still obtain — the whole point of
    // the vault is to surface them honestly rather than mark CNSS satisfied by
    // a mere affiliation notice or statuts satisfied by an enregistrement.
    expect(report.missing).toEqual(
      expect.arrayContaining([
        'attestation_fiscale',
        'attestation_cnss',
        'qualification_classification',
        'statuts',
        'pouvoirs_signataire',
      ]),
    );
  });

  it('treats the certificat négatif as a time-limited piece nearing expiry', () => {
    const cn = COMPANY_FOUNDING_DOCS.find((d) => d.reference === 'CN 3211578');
    expect(cn?.expiresAt).toBe('2026-06-28');

    const expiresAt = new Date(cn!.expiresAt!);
    expect(computeStatus(cn!.kind, expiresAt, TODAY)).toBe('expiring');
    // 13 days out on the default [30,14,7] ladder → the 30- and 14-day tiers fire.
    expect(dueAlerts(cn!.kind, expiresAt, TODAY)).toContain(14);
  });
});
