// BTP finance engine — faithful port of the source app's financeEngine.ts and
// of the LIVE récap semantics (MetrePage.saveDecompteAfterMetre +
// PeriodeDecomptePage.getRecapCalculations). The source app carried three
// near-duplicate implementations of these rules; this file is the single one.
//
// Excel-compliance rules (non negotiable, verified against the source):
//   • ligne montant HT     : internal = quantité × prix (full precision),
//                            display = ROUND(internal, 2)
//   • total HT             : Σ internals, display ROUND 2
//   • révision (dernier)   : TRUNC(HT_internal × coefficient, 2), added to HT
//   • TVA                  : TRUNC(HT_effectif_internal × taux/100, 2)
//   • TTC                  : ROUND(HT_effectif_internal + TVA_display, 2)
//   • retenue de garantie  : MIN(TRUNC(TTC_internal × taux/100, 2),
//                                TRUNC(marché_TTC × 7%, 2))
//   • montant de l'acompte : ROUND(TTC_int − retenue − dépenses exercices
//                            antérieurs − décomptes précédents, 2)
import Decimal from 'decimal.js';

Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 9,
});

export { Decimal };

export const TVA_RATE_DEFAULT = 20;
export const RETENUE_TAUX_DEFAULT = 10; // % of the cumulative TTC
export const RETENUE_CAP_RATE = 0.07; // 7% of the whole marché TTC (CCAG-T art. 40)

export function toDecimal(value: number | string | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

/** Excel =ROUND(x, 2). */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Excel =TRUNC(x, 2). */
export function trunc2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export function toNumber(value: Decimal): number {
  return value.toNumber();
}

// ─── Bordereau ───────────────────────────────────────────────────────────────

export interface BordereauLigne {
  id?: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant?: number;
}

export interface BordereauTotaux {
  lignes: Required<BordereauLigne>[];
  montantHt: number;
  montantTva: number;
  montantTtc: number;
}

/** Normalises lignes (montant = quantité × prix) and computes the BPU totals. */
export function computeBordereau(
  lignes: BordereauLigne[],
  tauxTva: number = TVA_RATE_DEFAULT,
): BordereauTotaux {
  let htInternal = new Decimal(0);
  const normalised = lignes.map((ligne, i) => {
    const montantInternal = toDecimal(ligne.quantite).times(toDecimal(ligne.prixUnitaire));
    htInternal = htInternal.plus(montantInternal);
    return {
      id: ligne.id ?? `ligne-${i + 1}`,
      numero: ligne.numero,
      designation: ligne.designation,
      unite: ligne.unite,
      quantite: ligne.quantite,
      prixUnitaire: ligne.prixUnitaire,
      montant: toNumber(round2(montantInternal)),
    };
  });
  const tvaDisplay = trunc2(htInternal.times(toDecimal(tauxTva).dividedBy(100)));
  const ttc = round2(htInternal.plus(tvaDisplay));
  return {
    lignes: normalised,
    montantHt: toNumber(round2(htInternal)),
    montantTva: toNumber(tvaDisplay),
    montantTtc: toNumber(ttc),
  };
}

/**
 * Montant du marché TTC as the source app computes it for the retenue cap:
 * Σ(quantité × prix) × 1.2 at FULL precision (deliberately not the
 * TVA-truncated pipeline — kept identical to the source).
 */
export function computeMarcheTtcInternal(lignes: BordereauLigne[]): Decimal {
  let total = new Decimal(0);
  for (const ligne of lignes) {
    const ht = toDecimal(ligne.quantite).times(toDecimal(ligne.prixUnitaire));
    total = total.plus(ht.times(1 + TVA_RATE_DEFAULT / 100));
  }
  return total;
}

// ─── Décompte ────────────────────────────────────────────────────────────────

export interface DecompteLigne {
  prixNo: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  /** Cumulative realised quantity (Σ partiels of every période ≤ this one). */
  quantiteRealisee: number;
  prixUnitaireHT: number;
  montantHT: number;
  bordereauLigneId: string;
}

export interface PriorDecompteAcompte {
  /** Net acompte (montant de l'acompte) of the prior décompte. */
  montantAcompte: number;
  /** Fiscal year of its période (année de dateDebut). */
  annee: number;
}

export interface DecompteComputationInput {
  bordereauLignes: BordereauLigne[];
  /** bordereauLigneId → cumulative realised quantity. */
  cumulativeQuantites: Map<string, number>;
  tauxTva: number;
  tauxRetenue: number;
  isDernier: boolean;
  /** Net acomptes of every prior (numero <) décompte, with fiscal year. */
  priorAcomptes: PriorDecompteAcompte[];
  /** Fiscal year of the current période (année de dateDebut). */
  anneeCourante: number;
  /** Révision des prix coefficient — applied only on the décompte dernier. */
  revisionCoefficient?: number | null;
}

export interface DecompteComputation {
  lignes: DecompteLigne[];
  totalHt: number;
  revisionMontant: number;
  montantTva: number;
  totalTtc: number;
  depensesAnterieures: number;
  decomptesPrecedents: number;
  retenueGarantie: number;
  montantAcompte: number;
  // Récap display splits.
  travauxTermines: number;
  travauxNonTermines: number;
  resteAPayer: number;
  totalADeduire: number;
}

export function buildBordereauLigneId(bordereauId: string, numero: number): string {
  return `${bordereauId}-ligne-${numero}`;
}

/** The single décompte computation — quantities in, full récapitulatif out. */
export function computeDecompte(input: DecompteComputationInput): DecompteComputation {
  const {
    bordereauLignes,
    cumulativeQuantites,
    tauxTva,
    tauxRetenue,
    isDernier,
    priorAcomptes,
    anneeCourante,
    revisionCoefficient,
  } = input;

  // 1. Lignes: cumulative quantity × unit price, full-precision internals.
  let htInternal = new Decimal(0);
  const lignes: DecompteLigne[] = bordereauLignes.map((ligne) => {
    const ligneId = ligne.id ?? String(ligne.numero);
    const quantiteRealisee = cumulativeQuantites.get(ligneId) ?? 0;
    const montantInternal = toDecimal(quantiteRealisee).times(toDecimal(ligne.prixUnitaire));
    htInternal = htInternal.plus(montantInternal);
    return {
      prixNo: ligne.numero,
      designation: ligne.designation,
      unite: ligne.unite,
      quantiteBordereau: ligne.quantite,
      quantiteRealisee,
      prixUnitaireHT: ligne.prixUnitaire,
      montantHT: toNumber(round2(montantInternal)),
      bordereauLigneId: ligneId,
    };
  });

  // 2. Révision des prix — only on the décompte dernier (source-app rule).
  let effectiveHtInternal = htInternal;
  let revisionMontant = new Decimal(0);
  if (isDernier && revisionCoefficient != null && revisionCoefficient !== 0) {
    const revisionInternal = htInternal.times(toDecimal(revisionCoefficient));
    revisionMontant = trunc2(revisionInternal);
    effectiveHtInternal = htInternal.plus(revisionInternal);
  }

  // 3. TVA (TRUNC) then TTC (ROUND on internal + TVA display).
  const tvaDisplay = trunc2(effectiveHtInternal.times(toDecimal(tauxTva).dividedBy(100)));
  const ttcInternal = effectiveHtInternal.plus(tvaDisplay);
  const totalTtc = round2(ttcInternal);

  // 4. Prior payments split by fiscal year (exercices antérieurs / courant).
  let anterieurs = new Decimal(0);
  let precedents = new Decimal(0);
  for (const prior of priorAcomptes) {
    const montant = toDecimal(prior.montantAcompte);
    if (prior.annee < anneeCourante) anterieurs = anterieurs.plus(montant);
    else precedents = precedents.plus(montant);
  }

  // 5. Retenue de garantie: MIN(TRUNC(TTC×taux), TRUNC(marché TTC×7%)).
  const marcheTtcInternal = computeMarcheTtcInternal(bordereauLignes);
  const retenueTaux = trunc2(ttcInternal.times(toDecimal(tauxRetenue).dividedBy(100)));
  const retenueCap = trunc2(marcheTtcInternal.times(RETENUE_CAP_RATE));
  const retenueGarantie = Decimal.min(retenueTaux, retenueCap);

  // 6. Montant de l'acompte à délivrer.
  const restes = ttcInternal.minus(retenueGarantie);
  const resteAPayer = restes.minus(anterieurs);
  const montantAcompte = round2(resteAPayer.minus(precedents));

  return {
    lignes,
    totalHt: toNumber(round2(htInternal)),
    revisionMontant: toNumber(revisionMontant),
    montantTva: toNumber(tvaDisplay),
    totalTtc: toNumber(totalTtc),
    depensesAnterieures: toNumber(round2(anterieurs)),
    decomptesPrecedents: toNumber(round2(precedents)),
    retenueGarantie: toNumber(retenueGarantie),
    montantAcompte: toNumber(montantAcompte),
    travauxTermines: isDernier ? toNumber(totalTtc) : 0,
    travauxNonTermines: isDernier ? 0 : toNumber(totalTtc),
    resteAPayer: toNumber(round2(restes)),
    totalADeduire: toNumber(round2(anterieurs.plus(precedents))),
  };
}

// ─── Avancement ──────────────────────────────────────────────────────────────

/**
 * Financial progress % — the source app's ProjectsPage formula:
 * dernier décompte's cumulative TTC ÷ marché TTC × 100. The UI caps the bar at
 * 100 and shows the overrun; here we only cap at 999.99 because progress_pct
 * is numeric(5,2) — degenerate data (a tiny test marché with a real décompte)
 * must not overflow the column and fail the whole chain rebuild.
 */
export function computeProgressPct(
  dernierTotalTtc: number,
  bordereauLignes: BordereauLigne[],
): number {
  const marcheTtc = computeMarcheTtcInternal(bordereauLignes);
  if (marcheTtc.isZero()) return 0;
  const pct = toNumber(
    toDecimal(dernierTotalTtc).dividedBy(marcheTtc).times(100).toDecimalPlaces(2),
  );
  return Math.min(Math.max(pct, 0), 999.99);
}
