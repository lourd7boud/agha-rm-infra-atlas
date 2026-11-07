import type { BidWorkspaceState } from '@atlas/contracts';

export type BidActionTone = 'positive' | 'neutral' | 'primary';

export interface BidWorkspaceAction {
  to: BidWorkspaceState;
  label: string;
  tone: BidActionTone;
}

export const BID_STATE_META: Record<
  BidWorkspaceState,
  { label: string; description: string }
> = {
  evaluating: { label: 'Évaluation', description: 'Analyse de l’opportunité en cours' },
  go: { label: 'GO validé', description: 'Participation décidée' },
  no_go: { label: 'NO-GO', description: 'Opportunité classée sans participation' },
  assembling: { label: 'Assemblage', description: 'Constitution des pièces et de l’offre' },
  review: { label: 'Contrôle', description: 'Relecture et vérification de conformité' },
  frozen: { label: 'Dossier gelé', description: 'Version définitive verrouillée' },
  awaiting_signature: { label: 'À signer', description: 'En attente du signataire autorisé' },
  signing: { label: 'Signature en cours', description: 'Opération locale sur le certificat' },
  signed: { label: 'Signé', description: 'Intégrité et signatures vérifiées' },
  ready_to_submit: { label: 'Prêt à déposer', description: 'Tous les contrôles sont au vert' },
  submitting: { label: 'Dépôt en cours', description: 'Transmission sécurisée à la plateforme' },
  submitted: { label: 'Déposé', description: 'Reçu officiel vérifié et conservé' },
  withdrawal_pending: { label: 'Retrait à confirmer', description: 'Retrait légal en attente' },
  withdrawn: { label: 'Retiré', description: 'Retrait confirmé par la plateforme' },
  opened: { label: 'Plis ouverts', description: 'Résultat de la commission attendu' },
  won: { label: 'Attributaire', description: 'Offre retenue officiellement' },
  lost: { label: 'Non retenu', description: 'Classement officiel enregistré' },
  rejected: { label: 'Écarté', description: 'Motif officiel de rejet enregistré' },
  cancelled: { label: 'Participation annulée', description: 'Workflow arrêté avant dépôt' },
  guarantee_release_eligible: {
    label: 'Garantie libérable',
    description: 'Éligibilité établie par une preuve officielle',
  },
  closed: { label: 'Clôturé', description: 'Dossier de participation archivé' },
};

const PROGRESS: Record<BidWorkspaceState, number> = {
  evaluating: 0,
  go: 10,
  no_go: 0,
  assembling: 25,
  review: 38,
  frozen: 50,
  awaiting_signature: 58,
  signing: 66,
  signed: 75,
  ready_to_submit: 86,
  submitting: 94,
  submitted: 100,
  withdrawal_pending: 100,
  withdrawn: 100,
  opened: 100,
  won: 100,
  lost: 100,
  rejected: 100,
  cancelled: 0,
  guarantee_release_eligible: 100,
  closed: 100,
};

const SAFE_ACTIONS: Partial<Record<BidWorkspaceState, readonly BidWorkspaceAction[]>> = {
  evaluating: [
    { to: 'go', label: 'Valider GO', tone: 'positive' },
    { to: 'no_go', label: 'Classer NO-GO', tone: 'neutral' },
  ],
  go: [{ to: 'assembling', label: 'Lancer la préparation', tone: 'primary' }],
  assembling: [{ to: 'review', label: 'Passer au contrôle', tone: 'primary' }],
  review: [{ to: 'assembling', label: 'Corriger le dossier', tone: 'neutral' }],
};

export function bidProgressPercent(state: BidWorkspaceState): number {
  return PROGRESS[state];
}

/**
 * Only foundation-safe actions are shown here. Freeze, signature, submission,
 * withdrawal and guarantee release are specialized commands with evidence and
 * therefore can never be synthesized as generic UI transitions.
 */
export function safeBidActions(state: BidWorkspaceState): readonly BidWorkspaceAction[] {
  return SAFE_ACTIONS[state] ?? [];
}
