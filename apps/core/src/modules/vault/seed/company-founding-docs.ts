import type { DocumentKind } from '@atlas/contracts';

/**
 * Founding administrative file of AGHA RM INFRA SARLAU (constituted May 2026).
 *
 * This is the company's own identity dossier — the reusable papers a tender's
 * "dossier administratif" draws from. It is the seed of the coffre-fort:
 * importing it tells us, per project, which pieces are already on hand and
 * which still have to be obtained (attestations de régularité, qualification…).
 *
 * Classification rule (kept deliberately honest so the readiness score is not
 * inflated): a document is tagged with a *bid-required* DocumentKind only when
 * it IS that exact piece. Identity/registration papers that merely support a
 * requirement (CNSS affiliation vs. attestation de régularité, enregistrement
 * de l'acte vs. statuts signés) stay under `autre` with an explanatory note —
 * so `computeReadiness` keeps reporting the real requirement as "à fournir".
 *
 * Sensitive access codes (SIMPL, codes de vérification DGI) are intentionally
 * NOT recorded here — only public business identifiers (RC, ICE, IF, CNSS).
 */
export interface FoundingDocumentSeed {
  /** Case-insensitive substring matched against the source PDF filename. */
  readonly filePattern: string;
  readonly kind: DocumentKind;
  readonly label: string;
  readonly reference: string;
  /** ISO calendar date (YYYY-MM-DD) the piece was issued/edited. */
  readonly issuedAt?: string;
  /** ISO calendar date the piece stops being valid, when it expires at all. */
  readonly expiresAt?: string;
  readonly notes: string;
}

export const COMPANY_FOUNDING_DOCS: readonly FoundingDocumentSeed[] = [
  {
    filePattern: 'RCDC',
    kind: 'registre_commerce',
    label: "Registre de commerce — Certificat d'immatriculation",
    reference: 'RC 20823 — Errachidia',
    issuedAt: '2026-05-25',
    notes:
      'Tribunal de 1re instance d\'Errachidia. Dépôt des actes N°481 et déclaration ' +
      'd\'immatriculation N°626 du 25/05/2026 ; immatriculation analytique N°20823.',
  },
  {
    filePattern: 'BODC',
    kind: 'autre',
    label: 'Extrait du registre de commerce (Modèle J)',
    reference: 'RC 20823 — extrait N°5928',
    issuedAt: '2026-06-10',
    notes:
      'Extrait « modèle J » du 10/06/2026 : capital 100 000 DH, gérance, ' +
      'activité travaux de construction. Complète le certificat d\'immatriculation.',
  },
  {
    filePattern: 'demande-3211578',
    kind: 'autre',
    label: 'Certificat négatif (OMPIC)',
    reference: 'CN 3211578',
    issuedAt: '2026-03-30',
    expiresAt: '2026-06-28',
    notes:
      'Dénomination « AGHA RM INFRA » ; ICE 003939552000065 ; bénéficiaire ' +
      'AGHARMINE Abderrahim (Tribunal d\'Errachidia). Pièce à durée de vie limitée.',
  },
  {
    filePattern: 'BNIF',
    kind: 'autre',
    label: "Bulletin de notification de l'identifiant fiscal",
    reference: 'IF 73070479',
    issuedAt: '2026-05-25',
    notes:
      'Identifiant fiscal (IR / IS / TVA) 73070479 ; identifiant de la taxe ' +
      'professionnelle 19280379. Domicile fiscal : Boudnib (Errachidia).',
  },
  {
    filePattern: 'AITP',
    kind: 'autre',
    label: "Attestation d'inscription à la taxe professionnelle",
    reference: 'TP 19280379',
    issuedAt: '2026-05-25',
    notes:
      'Attestation N°16000/2026/1374, commune de Boudnib. Activité principale : ' +
      '« travaux divers ou constructions (entrepreneur de) ».',
  },
  {
    filePattern: 'BCNS',
    kind: 'autre',
    label: "Notification d'affiliation CNSS",
    reference: 'CNSS 6984871',
    issuedAt: '2026-05-26',
    notes:
      'Affiliation CNSS N°6984871 (26/05/2026). N.B. ceci est la notification ' +
      'd\'affiliation, PAS l\'attestation de régularité CNSS exigée au dossier ' +
      'administratif — celle-ci reste à fournir par projet.',
  },
  {
    filePattern: 'STEN',
    kind: 'autre',
    label: "Attestation d'enregistrement — acte de constitution",
    reference: 'Enregistrement 2026000480761011',
    issuedAt: '2026-05-25',
    notes:
      'Enregistrement de l\'acte SSP de constitution de la société (acte du ' +
      '07/05/2026, capital ≤ 500 000, droits gratuits). N.B. les statuts signés ' +
      'eux-mêmes restent la pièce « statuts » à joindre.',
  },
  {
    filePattern: 'CB ET ATTESTATION',
    kind: 'autre',
    label: 'Attestation bancaire (RIB) & enregistrement du bail',
    reference: 'Enregistrement bail 2026000436061011',
    issuedAt: '2026-05-12',
    notes:
      'Contient l\'attestation bancaire (RIB) et l\'attestation d\'enregistrement ' +
      'du bail du local (enregistré le 12/05/2026, droits 220 DH).',
  },
] as const;
