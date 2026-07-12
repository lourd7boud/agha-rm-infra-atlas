import { describe, expect, test } from 'vitest';
import { buildCompanyLegalMarkdown } from './company-legal.service';
import type { ProfilRecord } from '../compta/compta.repository';
import type { LegalDocumentRecord } from '../compta/compta-registres.repository';

const profil = {
  id: 'p1',
  raisonSociale: 'AGHA RM INFRA',
  formeJuridique: 'SARL AU',
  capitalSocial: 100_000,
  registreCommerce: '20823',
  identifiantFiscal: '73070479',
  ice: '003939552000065',
  taxeProfessionnelle: '19280379',
  cnssAffiliation: '6984871',
  adresse: 'Centre Boudnib',
  ville: 'Errachidia',
  gerant: 'AGHARMINE ABDERRAHIM',
} as unknown as ProfilRecord;

const doc = (over: Partial<LegalDocumentRecord>): LegalDocumentRecord =>
  ({
    id: 'd1',
    type: 'Attestation CNSS',
    titre: 'Attestation CNSS 6984871',
    annee: 2026,
    dateEmission: new Date('2026-05-26'),
    dateExpiration: null,
    storageKey: 'k',
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    fileSize: 1000,
    note: null,
    createdAt: new Date('2026-05-26'),
    ...over,
  }) as LegalDocumentRecord;

describe('buildCompanyLegalMarkdown', () => {
  test('renders the legal identity + each document WITH full content (not titles)', () => {
    const md = buildCompanyLegalMarkdown(
      profil,
      [{ record: doc({}), text: 'Le salarié est à jour de ses cotisations CNSS au 26/05/2026.' }],
      new Date('2026-07-12'),
    );
    expect(md).toContain('IDENTITÉ LÉGALE');
    expect(md).toContain('AGHA RM INFRA (SARL AU)');
    expect(md).toContain('Registre de commerce (RC): 20823');
    expect(md).toContain('Identifiant fiscal (IF): 73070479');
    expect(md).toContain('ICE: 003939552000065');
    expect(md).toContain('Affiliation CNSS: 6984871');
    expect(md).toContain('Gérant: AGHARMINE ABDERRAHIM');
    expect(md).toContain('## Attestation CNSS 6984871');
    expect(md).toContain('à jour de ses cotisations CNSS'); // FULL content
  });

  test('flags an expired document', () => {
    const md = buildCompanyLegalMarkdown(
      profil,
      [{ record: doc({ dateExpiration: new Date('2026-01-01') }), text: 'x' }],
      new Date('2026-07-12'),
    );
    expect(md).toContain('[EXPIRÉ]');
  });

  test('marks a non-textual (scanned) document instead of dropping it', () => {
    const md = buildCompanyLegalMarkdown(
      profil,
      [{ record: doc({ titre: 'CIN gérant', type: 'Autre document' }), text: '' }],
      new Date('2026-07-12'),
    );
    expect(md).toContain('## CIN gérant');
    expect(md).toContain('contenu non textuel');
  });
});
