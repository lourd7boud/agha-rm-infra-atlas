import type { DocumentKind, PipelineState, ValidityStatus } from '@atlas/contracts';

export const PIPELINE_LABELS: Record<PipelineState, { label: string; classes: string }> = {
  detected: { label: 'Détecté', classes: 'bg-sky-100 text-sky-800' },
  parsed: { label: 'Analysé', classes: 'bg-sky-100 text-sky-800' },
  qualified: { label: 'Qualifié', classes: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Écarté', classes: 'bg-slate-200 text-slate-600' },
  go_decided: { label: 'GO décidé', classes: 'bg-emerald-200 text-emerald-900' },
  no_go: { label: 'No-Go', classes: 'bg-slate-200 text-slate-600' },
  preparing: { label: 'En préparation', classes: 'bg-amber-100 text-amber-900' },
  submitted: { label: 'Soumis', classes: 'bg-violet-100 text-violet-800' },
  opened: { label: 'Plis ouverts', classes: 'bg-violet-100 text-violet-800' },
  won: { label: 'Gagné', classes: 'bg-yellow-100 text-yellow-900' },
  lost: { label: 'Perdu', classes: 'bg-rose-100 text-rose-800' },
  cancelled: { label: 'Annulé', classes: 'bg-slate-200 text-slate-500' },
};

export const STATUS_BADGES: Record<ValidityStatus, { label: string; classes: string }> = {
  valid: { label: 'Valide', classes: 'bg-emerald-100 text-emerald-800' },
  expiring: { label: 'Expire bientôt', classes: 'bg-amber-100 text-amber-900' },
  expired: { label: 'Expiré', classes: 'bg-rose-100 text-rose-800' },
  no_expiry: { label: 'Sans échéance', classes: 'bg-slate-100 text-slate-600' },
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

/** Urgency semantics of the deadline wall: red ≤ 7 days, amber ≤ 15. */
export function urgencyClasses(daysLeft: number): string {
  if (daysLeft <= 7) return 'bg-rose-600 text-white';
  if (daysLeft <= 15) return 'bg-amber-500 text-white';
  return 'bg-slate-700 text-white';
}
