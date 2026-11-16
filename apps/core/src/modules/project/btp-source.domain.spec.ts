import { describe, expect, test } from 'vitest';
import { buildBtpProjectSource } from './btp-source.domain';
import type { TenderRecord } from '../tender/tender.repository';

const tender: TenderRecord = {
  id: '2d69bdc6-89d3-48ee-9f2e-38e3535aa1c1', reference: 'AO/2026',
  buyerName: 'Commune A', objet: 'Travaux voirie', procedure: 'AOO',
  deadlineAt: new Date('2026-11-14T23:30:00Z'), pipelineState: 'detected',
  qualification: null, createdAt: new Date(), updatedAt: new Date(),
  estimationMad: 999999, location: 'Boudnib', raw: null,
};

describe('BTP project source', () => {
  test('keeps the source version across watcher and extraction timestamp churn', () => {
    const extraction = { model: 'test', extractedAt: '2026-11-14T10:00:00Z', sourceFiles: ['CPS.pdf'],
      bpu: [{ designation: 'Béton', unite: 'm3', quantite: 10, prixUnitaireMad: 100 }] };
    const original = buildBtpProjectSource({ ...tender, raw: { dossierExtraction: extraction } });
    const refreshed = buildBtpProjectSource({ ...tender, updatedAt: new Date('2026-11-15T12:00:00Z'),
      raw: { dossierExtractAttempt: { at: '2026-11-15' }, dossierExtraction: { ...extraction,
        model: 'other-reader', extractedAt: '2026-11-15T12:00:00Z' } } });
    expect(original.sourceVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshed.sourceVersion).toBe(original.sourceVersion);
    expect(refreshed.sourceUpdatedAt).not.toBe(original.sourceUpdatedAt);
    expect(refreshed.extractedAt).not.toBe(original.extractedAt);
  });

  test('changes version when a reviewed fact, BPU value or source file identity changes', () => {
    const extraction = { model: 'test', extractedAt: '2026-11-14T10:00:00Z', sourceFiles: ['CPS.pdf'],
      bpu: [{ designation: 'Béton', unite: 'm3', quantite: 10, prixUnitaireMad: 100 }] };
    const baseline = { ...tender, raw: { dossierExtraction: extraction } };
    const version = buildBtpProjectSource(baseline).sourceVersion;
    for (const changed of [
      { ...baseline, reference: 'AO/2027' },
      { ...baseline, buyerName: 'Autre commune' },
      { ...baseline, deadlineAt: new Date('2027-01-01') },
      { ...baseline, raw: { dossierExtraction: { ...extraction, delaiExecutionMois: 4 } } },
      { ...baseline, raw: { dossierExtraction: { ...extraction, retenueGarantiePct: 5 } } },
      { ...baseline, raw: { dossierExtraction: { ...extraction, sourceFiles: ['CPS corrigé.pdf'] } } },
      { ...baseline, raw: { dossierExtraction: { ...extraction,
        bpu: [{ ...extraction.bpu[0], prixUnitaireMad: 200 }] } } },
    ]) expect(buildBtpProjectSource(changed).sourceVersion).not.toBe(version);
  });

  test('reuses factual identity and Moroccan deposit date without inventing a contract amount or opening date', () => {
    const source = buildBtpProjectSource(tender);
    expect(source).toMatchObject({ tenderId: tender.id, reference: 'AO/2026', buyerName: 'Commune A', commune: 'Boudnib', dateLimite: '2026-11-15', bpu: [] });
    expect(source).not.toHaveProperty('montantMarcheMad');
    expect(source).not.toHaveProperty('dateOuverture');
    expect(source).not.toHaveProperty('baseDate');
  });

  test('imports only the active validated extraction and preserves missing BPU values', () => {
    const source = buildBtpProjectSource({ ...tender, raw: { dossierExtraction: {
      model: 'test', extractedAt: '2026-11-14T10:00:00Z', sourceFiles: ['CPS.pdf'],
      delaiExecutionMois: 3, cautionDefinitivePct: 3, retenueGarantiePct: 7,
      bpu: [{ designation: 'Terrassement', unite: 'm3', quantite: 20, prixUnitaireMad: null },
        { designation: 'Béton', unite: null, quantite: null, prixUnitaireMad: 0 }],
    } } });
    expect(source.delaiMois).toBe(3);
    expect(source.bpu[0]).toEqual({ numero: 1, designation: 'Terrassement', unite: 'm3', quantite: 20, prixUnitaire: null });
    expect(source.bpu[1]).toMatchObject({ numero: 2, unite: null, quantite: null, prixUnitaire: null });
    expect(source.sourceFiles).toEqual(['CPS.pdf']);
  });

  test('never resurrects quarantined extraction or accepts mismatched portal detail', () => {
    const source = buildBtpProjectSource({ ...tender, raw: { dossierExtraction: null,
      previousDossierExtraction: { delaiExecutionMois: 3, bpu: [{ designation: 'OLD' }] } } });
    expect(source.bpu).toEqual([]);
    expect(source.delaiMois).toBeNull();
    expect(() => buildBtpProjectSource({ ...tender,
      sourceUrl: 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=123&orgAcronyme=a',
      raw: { detail: { url: 'https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=456&orgAcronyme=a' } },
    })).toThrow(/identité/i);
  });
});
