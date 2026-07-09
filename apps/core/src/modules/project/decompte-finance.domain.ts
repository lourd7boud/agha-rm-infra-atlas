// Line-item décompte finance engine — ported from the BTP app's Excel-compliant
// `financeEngine.ts` (decimal.js). Rounding rules are load-bearing and must match
// the reference exactly:
//   - montant HT per line   = quantité × prix unitaire (full precision internal)
//   - Total HT (display)    = ROUND(Σ internal, 2)      [ROUND_HALF_UP]
//   - TVA (display)         = TRUNC(Total_HT_internal × taux, 2)  [ROUND_DOWN]
//   - TTC (display)         = ROUND(Total_HT_internal + TVA_display, 2)
//   - Récap uses the internal TTC; retenue de garantie = TTC × taux; the acompte
//     of the décompte = ROUND((TTC − retenue − exercices antérieurs) − précédents, 2)
// This is a pure module (no I/O) — the service persists the returned figures.
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toDec(value: number | string | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}
const round2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const trunc2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_DOWN);

export interface DecompteLigneInput {
  prixNo?: string | number;
  designation?: string;
  unite?: string;
  quantiteBordereau?: number;
  quantiteRealisee: number;
  prixUnitaireHT: number;
}

export interface DecompteLigneComputed extends DecompteLigneInput {
  montantHT: number;
}

export interface DecompteTotals {
  lignes: DecompteLigneComputed[];
  totalHtMad: number;
  montantTvaMad: number;
  totalTtcMad: number;
}

/** Compute the per-line montant HT and the HT/TVA/TTC totals for a décompte. */
export function computeDecompteTotals(
  lignes: readonly DecompteLigneInput[],
  tauxTva = 20,
): DecompteTotals {
  let totalHtInternal = new Decimal(0);
  const computed: DecompteLigneComputed[] = lignes.map((l) => {
    const montantInternal = toDec(l.quantiteRealisee).times(toDec(l.prixUnitaireHT));
    totalHtInternal = totalHtInternal.plus(montantInternal);
    return { ...l, montantHT: round2(montantInternal).toNumber() };
  });
  const tvaDisplay = trunc2(totalHtInternal.times(toDec(tauxTva).dividedBy(100)));
  const ttcInternal = totalHtInternal.plus(tvaDisplay);
  return {
    lignes: computed,
    totalHtMad: round2(totalHtInternal).toNumber(),
    montantTvaMad: tvaDisplay.toNumber(),
    totalTtcMad: round2(ttcInternal).toNumber(),
  };
}

export interface RecapInput {
  /** Cumulative TTC of the work done to date (this décompte's total). */
  totalTtcMad: number;
  tauxRetenue: number;
  /** Sum of previous décomptes already paid (the cumulative previous). */
  decomptesPrecedents: number;
  depensesExercicesAnterieurs: number;
}

export interface RecapResult {
  retenueGarantieMad: number;
  /** Amount attributable to this period = cumulative TTC − previous. */
  montantActuelMad: number;
  /** Acompte / net à payer for this décompte. */
  netAPayerMad: number;
}

/** Retenue de garantie + acompte (net à payer) of a décompte, Excel-compliant. */
export function computeRecap(input: RecapInput): RecapResult {
  const ttc = toDec(input.totalTtcMad);
  const taux = toDec(input.tauxRetenue).dividedBy(100);
  const precedents = toDec(input.decomptesPrecedents);
  const anterieurs = toDec(input.depensesExercicesAnterieurs);

  const retenueGarantie = ttc.times(taux);
  const restes = ttc.minus(retenueGarantie);
  const resteAPayer = restes.minus(anterieurs);
  const acompte = resteAPayer.minus(precedents);

  return {
    retenueGarantieMad: round2(retenueGarantie).toNumber(),
    montantActuelMad: round2(ttc.minus(precedents)).toNumber(),
    netAPayerMad: round2(acompte).toNumber(),
  };
}
