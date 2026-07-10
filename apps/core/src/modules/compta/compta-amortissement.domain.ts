// Amortissement linéaire (mode fiscal marocain usuel) — prorata temporis au
// MOIS de mise en service : première annuité = valeur × taux × mois restants
// ÷ 12 (mois de mise en service inclus), dernière annuité = solde résiduel.
// Taux usuels admis : constructions 4-5 %, matériel et outillage 10-15 %,
// matériel de transport 20-25 %, mobilier 10 %, matériel informatique 20-33 %.
import Decimal from 'decimal.js';
import { round2, toDecimal } from './compta-fiscal.domain';

export interface ImmobilisationInput {
  valeurHt: number;
  /** Taux linéaire annuel en % (20 ⇒ 5 ans). */
  tauxAmortissement: number;
  dateMiseEnService: Date;
}

export interface AnnuiteAmortissement {
  annee: number;
  dotation: number;
  cumul: number;
  /** Valeur nette comptable en fin d'année. */
  vnc: number;
}

/** Plan d'amortissement complet (jusqu'à VNC nulle). */
export function planAmortissement(immo: ImmobilisationInput): AnnuiteAmortissement[] {
  const valeur = toDecimal(immo.valeurHt);
  if (valeur.lessThanOrEqualTo(0) || immo.tauxAmortissement <= 0) return [];
  const annuitePleine = valeur.times(immo.tauxAmortissement).dividedBy(100);
  const anneeMiseEnService = immo.dateMiseEnService.getFullYear();
  // Mois de mise en service inclus : mise en service en mars ⇒ 10/12.
  const moisRestants = 12 - immo.dateMiseEnService.getMonth();

  const plan: AnnuiteAmortissement[] = [];
  let cumul = toDecimal(0);
  let annee = anneeMiseEnService;
  // Garde-fou : un taux de 1 % s'étale sur ~101 ans, on borne à 120 lignes.
  for (let i = 0; i < 120; i += 1) {
    const restant = valeur.minus(cumul);
    if (restant.lessThanOrEqualTo(0.004)) break;
    const theorique =
      annee === anneeMiseEnService
        ? annuitePleine.times(moisRestants).dividedBy(12)
        : annuitePleine;
    const dotation = Decimal.min(theorique, restant);
    cumul = cumul.plus(dotation);
    plan.push({
      annee,
      dotation: round2(dotation),
      cumul: round2(cumul),
      vnc: round2(valeur.minus(cumul)),
    });
    annee += 1;
  }
  return plan;
}

/** Dotation d'un exercice donné (0 hors plan). */
export function dotationExercice(immo: ImmobilisationInput, annee: number): number {
  return planAmortissement(immo).find((a) => a.annee === annee)?.dotation ?? 0;
}

/** Cumul des amortissements et VNC à la fin d'un exercice. */
export function situationFinExercice(
  immo: ImmobilisationInput,
  annee: number,
): { cumul: number; vnc: number } {
  const plan = planAmortissement(immo);
  const ligne = [...plan].reverse().find((a) => a.annee <= annee);
  if (!ligne) return { cumul: 0, vnc: round2(toDecimal(immo.valeurHt)) };
  return { cumul: ligne.cumul, vnc: ligne.vnc };
}
