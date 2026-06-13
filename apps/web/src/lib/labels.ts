import type {
  DocumentKind,
  PipelineState,
  TenderProcedure,
  ValidityStatus,
} from '@atlas/contracts';

export const PROCEDURE_LABELS: Record<TenderProcedure, string> = {
  AOO: "Appel d'offres ouvert",
  AOR: "Appel d'offres restreint",
  concours: 'Concours',
  negocie: 'Marché négocié',
  bons_de_commande: 'Bons de commande',
};

/** Procedure chip tones — open tenders (our core business) read warm ochre. */
export const PROCEDURE_TONES: Record<TenderProcedure, string> = {
  AOO: 'bg-ochre-soft text-ochre-deep',
  AOR: 'bg-clay-soft text-clay',
  concours: 'bg-teal-soft text-teal',
  negocie: 'bg-emerald-soft text-emerald',
  bons_de_commande: 'bg-sand text-muted',
};

export const PIPELINE_LABELS: Record<PipelineState, { label: string; classes: string }> = {
  detected: { label: 'Détecté', classes: 'bg-sand text-muted' },
  parsed: { label: 'Analysé', classes: 'bg-sand text-muted' },
  qualified: { label: 'Qualifié', classes: 'bg-emerald-soft text-emerald' },
  rejected: { label: 'Écarté', classes: 'bg-sand text-faint' },
  go_decided: { label: 'GO décidé', classes: 'bg-emerald-soft text-emerald' },
  no_go: { label: 'No-Go', classes: 'bg-sand text-faint' },
  preparing: { label: 'En préparation', classes: 'bg-ochre-soft text-ochre-deep' },
  submitted: { label: 'Soumis', classes: 'bg-teal-soft text-teal' },
  opened: { label: 'Plis ouverts', classes: 'bg-teal-soft text-teal' },
  won: { label: 'Gagné', classes: 'bg-emerald text-paper' },
  lost: { label: 'Perdu', classes: 'bg-clay-soft text-clay' },
  cancelled: { label: 'Annulé', classes: 'bg-sand text-faint' },
};

export const STATUS_BADGES: Record<ValidityStatus, { label: string; classes: string }> = {
  valid: { label: 'Valide', classes: 'bg-emerald-soft text-emerald' },
  expiring: { label: 'Expire bientôt', classes: 'bg-ochre-soft text-ochre-deep' },
  expired: { label: 'Expiré', classes: 'bg-clay-soft text-clay' },
  no_expiry: { label: 'Sans échéance', classes: 'bg-sand text-muted' },
};

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  attestation_fiscale: 'Attestation fiscale (DGI)',
  attestation_cnss: 'Attestation CNSS',
  qualification_classification: 'Certificat de qualification & classification',
  registre_commerce: 'Registre de commerce',
  statuts: 'Statuts',
  pouvoirs_signataire: 'Pouvoirs du signataire',
  assurance_rc: 'Assurance responsabilité civile',
  assurance_decennale: 'Assurance décennale',
  assurance_at: 'Assurance accidents du travail',
  reference_bonne_execution: 'Attestation de bonne exécution',
  cv_diplome: 'CV / Diplôme',
  materiel_justificatif: 'Justificatif matériel',
  autre: 'Autre document',
};

/** Urgency semantics of the deadline wall: clay ≤ 7 days, ochre ≤ 15. */
export function urgencyClasses(daysLeft: number): string {
  if (daysLeft <= 7) return 'bg-clay text-paper';
  if (daysLeft <= 15) return 'bg-ochre text-paper';
  return 'bg-ink text-paper';
}
