// Décompte & attachement GENERATION from the métré — the core BTP dynamic.
// Quantities are NEVER typed on the décompte: for each bordereau line, the
// realized quantity is the cumulative sum of métré partiels over every période
// with numéro ≤ the current one. Then montant = quantité × prix, and HT→TVA→TTC
// + récapitulatif follow the Excel rounding rules. The attachement is the same
// cumulative quantities with no prices.
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toDec(v: number | string | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(0);
  }
}
const round2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const trunc2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_DOWN);

export interface BordereauLine {
  /** Stable join key for the line (e.g. the prix N°). */
  key: string;
  prixNo?: string | number;
  designation?: string;
  unite?: string;
  /** Quantité marché (from the bordereau — used for the 7% retenue cap). */
  quantite: number;
  prixUnitaire: number;
}

/** One métré's contribution: its bordereau line + période + its totalPartiel. */
export interface MetreContribution {
  bordereauLigneKey: string;
  periodeNumero: number;
  totalPartiel: number;
}

export interface GenerateDecompteInput {
  bordereau: readonly BordereauLine[];
  metres: readonly MetreContribution[];
  currentPeriodeNumero: number;
  tauxTva: number;
  isDernier: boolean;
  depensesExercicesAnterieurs: number;
  decomptesPrecedents: number;
}

export interface DecompteGeneratedLigne {
  prixNo?: string | number;
  designation?: string;
  unite?: string;
  quantiteRealisee: number;
  prixUnitaireHT: number;
  montantHT: number;
}

export interface DecompteGenerated {
  lignes: DecompteGeneratedLigne[];
  totalHtMad: number;
  montantTvaMad: number;
  totalTtcMad: number;
  retenueGarantieMad: number;
  montantMarcheTtcMad: number;
  netAPayerMad: number;
  travauxTerminesMad: number;
  travauxNonTerminesMad: number;
}

/** Cumulative realized quantity per bordereau line, over périodes ≤ current. */
export function cumulativeQuantities(
  metres: readonly MetreContribution[],
  currentPeriodeNumero: number,
): Map<string, number> {
  const acc = new Map<string, Decimal>();
  for (const m of metres) {
    if (m.periodeNumero > currentPeriodeNumero) continue;
    const prev = acc.get(m.bordereauLigneKey) ?? new Decimal(0);
    acc.set(m.bordereauLigneKey, prev.plus(toDec(m.totalPartiel)));
  }
  const out = new Map<string, number>();
  for (const [k, v] of acc) out.set(k, round2(v).toNumber());
  return out;
}

/** Build the décompte for the current période purely from the métré. */
export function generateDecompteFromMetres(
  input: GenerateDecompteInput,
): DecompteGenerated {
  const cumul = cumulativeQuantities(input.metres, input.currentPeriodeNumero);

  // Line montants — sum internal (full precision), round the total once.
  let totalHtInternal = new Decimal(0);
  const lignes: DecompteGeneratedLigne[] = input.bordereau.map((l) => {
    const q = cumul.get(l.key) ?? 0;
    const montantInternal = toDec(q).times(toDec(l.prixUnitaire));
    totalHtInternal = totalHtInternal.plus(montantInternal);
    return {
      prixNo: l.prixNo,
      designation: l.designation,
      unite: l.unite,
      quantiteRealisee: q,
      prixUnitaireHT: l.prixUnitaire,
      montantHT: round2(montantInternal).toNumber(),
    };
  });

  const tvaDisplay = trunc2(totalHtInternal.times(toDec(input.tauxTva).dividedBy(100)));
  const ttcInternal = totalHtInternal.plus(tvaDisplay);
  const totalTtc = round2(ttcInternal);

  // Retenue de garantie = MIN( TRUNC(TTC × 10%), TRUNC(marché TTC × 7%) ).
  const montantMarcheTtc = input.bordereau.reduce(
    (acc, l) => acc.plus(toDec(l.quantite).times(toDec(l.prixUnitaire)).times(1.2)),
    new Decimal(0),
  );
  const retenue10 = trunc2(ttcInternal.times(0.1));
  const retenue7 = trunc2(montantMarcheTtc.times(0.07));
  const retenueGarantie = retenue10.lessThan(retenue7) ? retenue10 : retenue7;

  const acompte = round2(
    ttcInternal
      .minus(retenueGarantie)
      .minus(toDec(input.depensesExercicesAnterieurs))
      .minus(toDec(input.decomptesPrecedents)),
  );

  return {
    lignes,
    totalHtMad: round2(totalHtInternal).toNumber(),
    montantTvaMad: tvaDisplay.toNumber(),
    totalTtcMad: totalTtc.toNumber(),
    retenueGarantieMad: round2(retenueGarantie).toNumber(),
    montantMarcheTtcMad: round2(montantMarcheTtc).toNumber(),
    netAPayerMad: acompte.toNumber(),
    travauxTerminesMad: input.isDernier ? totalTtc.toNumber() : 0,
    travauxNonTerminesMad: input.isDernier ? 0 : totalTtc.toNumber(),
  };
}

export interface AttachementLigne {
  prixNo?: string | number;
  designation?: string;
  unite?: string;
  quantiteCumulee: number;
}

/** Attachement = cumulative quantities per bordereau line (no prices). */
export function generateAttachement(
  bordereau: readonly BordereauLine[],
  metres: readonly MetreContribution[],
  currentPeriodeNumero: number,
): AttachementLigne[] {
  const cumul = cumulativeQuantities(metres, currentPeriodeNumero);
  return bordereau
    .map((l) => ({
      prixNo: l.prixNo,
      designation: l.designation,
      unite: l.unite,
      quantiteCumulee: cumul.get(l.key) ?? 0,
    }))
    .filter((l) => l.quantiteCumulee > 0);
}
