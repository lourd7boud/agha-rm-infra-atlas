// Charges sociales marocaines — cotisations CNSS/AMO/TFP (taux au 01/01/2026)
// et barème IR salaires 2026 (LF2025, réduction charges de famille LF2026).
// DAMANCOM : déclaration nominative (DNS/BDS) ET paiement avant le 10 du mois
// suivant la période de paie ; majorations dès le 11 (3 % puis 0,5 %/mois).
import { round2, toDecimal } from './compta-fiscal.domain';

/** Plafond mensuel CNSS des prestations sociales (DH / salarié). */
export const PLAFOND_CNSS = 6_000;

/** Taux de cotisation au 01/01/2026 (% de l'assiette). */
export const TAUX_COTISATIONS = {
  /** Allocations familiales — patronal, déplafonné. */
  allocationsFamiliales: { patronal: 6.4, salarial: 0, plafonne: false },
  /** Prestations sociales court terme — plafonné 6 000 DH. */
  prestationsCourtTerme: { patronal: 1.05, salarial: 0.52, plafonne: true },
  /** Prestations sociales long terme — plafonné 6 000 DH. */
  prestationsLongTerme: { patronal: 7.93, salarial: 3.96, plafonne: true },
  /** AMO de base — déplafonné. */
  amo: { patronal: 2.26, salarial: 2.26, plafonne: false },
  /** Participation AMO — patronal, déplafonné (due même avec assurance privée). */
  participationAmo: { patronal: 1.85, salarial: 0, plafonne: false },
  /** Taxe de formation professionnelle — patronal, déplafonné. */
  formationProfessionnelle: { patronal: 1.6, salarial: 0, plafonne: false },
} as const;

export interface CotisationsResult {
  partSalariale: number;
  partPatronale: number;
  total: number;
  detail: Record<string, { patronal: number; salarial: number }>;
}

/**
 * Cotisations d'un mois : `masseSalariale` = total brut, `massePlafonnee` =
 * Σ min(brut, 6 000) par salarié (fournie par la paie ; à défaut estimée par
 * min(masse, effectif × 6 000)).
 */
export function computeCotisations(params: {
  masseSalariale: number;
  massePlafonnee: number;
}): CotisationsResult {
  const detail: Record<string, { patronal: number; salarial: number }> = {};
  let partSalariale = toDecimal(0);
  let partPatronale = toDecimal(0);
  for (const [rubrique, taux] of Object.entries(TAUX_COTISATIONS)) {
    const assiette = taux.plafonne ? params.massePlafonnee : params.masseSalariale;
    const patronal = round2(toDecimal(assiette).times(taux.patronal).dividedBy(100));
    const salarial = round2(toDecimal(assiette).times(taux.salarial).dividedBy(100));
    detail[rubrique] = { patronal, salarial };
    partPatronale = partPatronale.plus(patronal);
    partSalariale = partSalariale.plus(salarial);
  }
  return {
    partSalariale: round2(partSalariale),
    partPatronale: round2(partPatronale),
    total: round2(partSalariale.plus(partPatronale)),
    detail,
  };
}

/** Échéance DAMANCOM du mois de paie 'YYYY-MM' : le 10 du mois suivant. */
export function cnssEcheance(periodeKey: string): Date {
  const [anneeStr = '0', moisStr = '1'] = periodeKey.split('-');
  const annee = Number(anneeStr);
  const mois = Number(moisStr); // 1-12
  return mois === 12 ? new Date(annee + 1, 0, 10) : new Date(annee, mois, 10);
}

// ── IR salaires — barème mensuel 2026 (LF2025) ───────────────────────────────

interface TrancheIr {
  plafondMensuel: number;
  taux: number;
  sommeADeduire: number;
}

/** Tranches mensuelles : RNI × taux − somme à déduire. */
export const BAREME_IR_MENSUEL_2026: readonly TrancheIr[] = [
  { plafondMensuel: 3_333.33, taux: 0, sommeADeduire: 0 },
  { plafondMensuel: 5_000, taux: 10, sommeADeduire: 333.33 },
  { plafondMensuel: 6_666.67, taux: 20, sommeADeduire: 833.33 },
  { plafondMensuel: 8_333.33, taux: 30, sommeADeduire: 1_500 },
  { plafondMensuel: 15_000, taux: 34, sommeADeduire: 1_833.33 },
  { plafondMensuel: Number.POSITIVE_INFINITY, taux: 37, sommeADeduire: 2_283.33 },
];

/** Frais professionnels : 35 % jusqu'à 6 500 DH/mois de brut imposable, sinon
 *  25 % plafonnés à 2 916,67 DH/mois (35 000 DH/an). */
export function fraisProfessionnelsMensuels(brutImposable: number): number {
  if (brutImposable <= 6_500) {
    return round2(toDecimal(brutImposable).times(35).dividedBy(100));
  }
  return Math.min(round2(toDecimal(brutImposable).times(25).dividedBy(100)), 2_916.67);
}

/** Réduction mensuelle pour charges de famille (LF2026: 50 DH × max 6). */
export function chargesFamilleMensuelles(personnes: number): number {
  return Math.min(Math.max(personnes, 0), 6) * 50;
}

/**
 * IR mensuel estimatif d'un salaire brut : brut − CNSS salariales (parts
 * plafonnées/déplafonnées) − frais professionnels = RNI ; IR = RNI × taux −
 * somme à déduire − charges de famille (plancher 0). Estimation de paie —
 * la déclaration réelle reste celle du logiciel de paie / du comptable.
 */
export function computeIrMensuel(params: {
  brutMensuel: number;
  personnesACharge?: number;
}): { rni: number; ir: number; cotisationsSalariales: number } {
  const plafonnee = Math.min(params.brutMensuel, PLAFOND_CNSS);
  const { partSalariale } = computeCotisations({
    masseSalariale: params.brutMensuel,
    massePlafonnee: plafonnee,
  });
  const rni = round2(
    toDecimal(params.brutMensuel)
      .minus(partSalariale)
      .minus(fraisProfessionnelsMensuels(params.brutMensuel)),
  );
  const tranche =
    BAREME_IR_MENSUEL_2026.find((t) => rni <= t.plafondMensuel) ??
    BAREME_IR_MENSUEL_2026[BAREME_IR_MENSUEL_2026.length - 1]!;
  const irBrut = toDecimal(rni).times(tranche.taux).dividedBy(100).minus(tranche.sommeADeduire);
  const ir = Math.max(
    round2(irBrut.minus(chargesFamilleMensuelles(params.personnesACharge ?? 0))),
    0,
  );
  return { rni, ir, cotisationsSalariales: partSalariale };
}
