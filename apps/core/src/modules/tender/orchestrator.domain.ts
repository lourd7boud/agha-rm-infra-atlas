import type { PipelineState } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';

/**
 * Chef d'Orchestre — the 12th agent. Deterministic dispatcher: for each
 * active tender it names the next concrete step, who performs it (agent or
 * human gate), and how urgent it is. It never acts on its own — it tells
 * the humans and the other agents where the dossier is stuck.
 */

const SUBMISSION_CRITICAL_DAYS = 3;

export type ActionUrgence = 'normale' | 'haute' | 'critique';

export interface OrchestratorAction {
  code: string;
  label: string;
  /** Which agent or human gate performs the step. */
  acteur: string;
  urgence: ActionUrgence;
}

export interface OrchestratorTender {
  pipelineState: PipelineState;
  estimationMad?: number;
  deadlineAt: Date;
  raw: Record<string, unknown> | null;
  checklistReady: boolean;
}

const TERMINAL_STATES: readonly PipelineState[] = [
  'won',
  'lost',
  'no_go',
  'rejected',
];

export function nextActions(
  tender: OrchestratorTender,
  today: Date,
): OrchestratorAction[] {
  if (TERMINAL_STATES.includes(tender.pipelineState)) return [];

  const daysLeft = daysUntil(tender.deadlineAt, today);
  const deadlineUrgence: ActionUrgence =
    daysLeft <= SUBMISSION_CRITICAL_DAYS
      ? 'critique'
      : daysLeft <= 7
        ? 'haute'
        : 'normale';
  const raw = tender.raw ?? {};
  const actions: OrchestratorAction[] = [];

  if (tender.estimationMad === undefined) {
    actions.push({
      code: 'enrichir',
      label: "Estimation inconnue — coller l'avis/DCE pour extraction",
      acteur: 'A2 Extracteur',
      urgence: deadlineUrgence,
    });
  }

  switch (tender.pipelineState) {
    case 'detected':
    case 'parsed':
      actions.push({
        code: 'qualifier',
        label: 'Passer le filtre éliminatoire',
        acteur: 'A3 Qualificateur',
        urgence: deadlineUrgence,
      });
      break;
    case 'qualified':
      if (raw['g1Brief'] === undefined) {
        actions.push({
          code: 'generer_brief',
          label: 'Générer la note Go/No-Go',
          acteur: 'A4 Stratège',
          urgence: deadlineUrgence,
        });
      } else {
        actions.push({
          code: 'decider_g1',
          label: 'Trancher le Go/No-Go (gate G1)',
          acteur: 'Direction',
          urgence: deadlineUrgence,
        });
      }
      break;
    case 'go_decided':
      if (raw['g2Scenarios'] === undefined) {
        actions.push({
          code: 'chiffrer',
          label: 'Calculer les scénarios de prix',
          acteur: 'B4 Modélisation financière',
          urgence: deadlineUrgence,
        });
      } else {
        actions.push({
          code: 'lancer_preparation',
          label: 'Valider le prix (gate G2) et lancer la préparation',
          acteur: 'Direction',
          urgence: deadlineUrgence,
        });
      }
      break;
    case 'preparing':
      if (raw['bidDraft'] === undefined) {
        actions.push({
          code: 'rediger_note',
          label: 'Générer le squelette de la note méthodologique',
          acteur: 'B2 Rédacteur',
          urgence: deadlineUrgence,
        });
      }
      if (!tender.checklistReady) {
        actions.push({
          code: 'completer_dossier',
          label: 'Compléter les pièces administratives bloquantes',
          acteur: 'B1 Conformité',
          urgence: deadlineUrgence === 'normale' ? 'haute' : deadlineUrgence,
        });
      }
      actions.push({
        code: 'soumettre',
        label: `Déposer le pli (J-${daysLeft})`,
        acteur: 'Division Marchés (gate G3)',
        urgence: deadlineUrgence,
      });
      break;
    case 'submitted':
      actions.push({
        code: 'attendre_ouverture',
        label: "Suivre l'ouverture des plis",
        acteur: 'Division Marchés',
        urgence: 'normale',
      });
      break;
    case 'opened':
      actions.push({
        code: 'saisir_resultat',
        label: 'Saisir le résultat (gagné / perdu)',
        acteur: 'Division Marchés',
        urgence: 'haute',
      });
      break;
    default:
      break;
  }

  return actions;
}
