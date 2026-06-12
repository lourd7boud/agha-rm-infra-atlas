/**
 * Décompte provisoire engine (construction ops) — pure CCAG-T arithmetic.
 *
 * RECORDED ASSUMPTIONS (v1, surfaced so the finance reviewer can challenge
 * them; verify the exact CCAG-T articles before first real décompte):
 * - retenue de garantie: 10% of each period's works
 * - retenue ceiling: 7% of the montant du marché
 * - v1 caps the cumulative at the contract amount (avenants come later)
 */

export const TAUX_RETENUE_PCT = 10;
export const PLAFOND_RETENUE_PCT = 7;

export interface DecompteInput {
  montantMarcheMad: number;
  /** New cumulative amount of works done (TTC). */
  montantCumuleMad: number;
  previousCumuleMad: number;
  /** Retenue already withheld across previous situations. */
  previousRetenueCumuleMad: number;
}

export interface Decompte {
  montantPeriodeMad: number;
  retenueGarantieMad: number;
  netAPayerMad: number;
  avancementPct: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function buildDecompte(input: DecompteInput): Decompte {
  if (!Number.isFinite(input.montantMarcheMad) || input.montantMarcheMad <= 0) {
    throw new Error('Montant du marché invalide');
  }
  if (input.montantCumuleMad < input.previousCumuleMad) {
    throw new Error(
      `Le cumul ne peut pas régresser (${input.montantCumuleMad} < ${input.previousCumuleMad})`,
    );
  }
  if (input.montantCumuleMad > input.montantMarcheMad) {
    throw new Error(
      'Le cumul dépasse le montant du marché — passer par un avenant',
    );
  }

  const montantPeriodeMad = round2(
    input.montantCumuleMad - input.previousCumuleMad,
  );

  const plafondMad = (input.montantMarcheMad * PLAFOND_RETENUE_PCT) / 100;
  const retenueTheorique = (montantPeriodeMad * TAUX_RETENUE_PCT) / 100;
  const margeRestante = Math.max(
    0,
    plafondMad - input.previousRetenueCumuleMad,
  );
  const retenueGarantieMad = round2(Math.min(retenueTheorique, margeRestante));

  return {
    montantPeriodeMad,
    retenueGarantieMad,
    netAPayerMad: round2(montantPeriodeMad - retenueGarantieMad),
    avancementPct: round2(
      (input.montantCumuleMad / input.montantMarcheMad) * 100,
    ),
  };
}
