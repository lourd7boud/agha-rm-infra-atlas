/**
 * BPU price-filling engine — turns the extracted (blank) bordereau des prix
 * into a fully-priced proposal. The LLM only suggests RELATIVE unit prices;
 * every published number is produced deterministically here:
 *
 *   target = estimation administrative × (1 − rabais/100)
 *   every proposed unit price is scaled so Σ(prix × quantité) lands on the
 *   target (± rounding), then the residual is absorbed by the largest line.
 *
 * So the proposal is always coherent with the recommended rabais and can never
 * hallucinate a total. Without an estimation the LLM prices are surfaced
 * unscaled and clearly flagged as uncalibrated.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Minimum publishable unit price — a scaled price can never hit zero. */
const MIN_UNIT_PRICE_MAD = 0.01;

export interface BpuLineInput {
  section?: string | null;
  designation: string;
  quantite?: number | null;
  unite?: string | null;
}

export interface BpuPricedLine {
  section: string | null;
  designation: string;
  quantite: number;
  unite: string | null;
  prixUnitaireMad: number;
  montantMad: number;
}

export type BpuMethod =
  | 'calibre_estimation'
  | 'prix_ia_non_calibres'
  | 'repartition_uniforme';

export interface BpuProposal {
  lines: BpuPricedLine[];
  totalMad: number;
  estimationMad: number | null;
  rabaisPct: number | null;
  targetTotalMad: number | null;
  methode: BpuMethod;
  avertissements: string[];
}

export interface BpuProposalOptions {
  estimationMad?: number | null;
  rabaisPct?: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Builds the deterministic proposal from the DCE lines and the LLM's suggested
 * unit prices (aligned by index; null = the model had no basis for that line).
 *
 * Throws when the lines are empty or when there is neither an estimation nor a
 * single usable suggested price (no honest basis to price on).
 */
export function buildBpuProposal(
  lines: readonly BpuLineInput[],
  proposedUnitPrices: ReadonlyArray<number | null>,
  opts: BpuProposalOptions = {},
): BpuProposal {
  if (lines.length === 0) {
    throw new Error('BPU vide — aucune ligne à chiffrer');
  }

  const avertissements: string[] = [];
  const estimation =
    typeof opts.estimationMad === 'number' &&
    Number.isFinite(opts.estimationMad) &&
    opts.estimationMad > 0
      ? opts.estimationMad
      : null;
  const rabais =
    typeof opts.rabaisPct === 'number' &&
    Number.isFinite(opts.rabaisPct) &&
    opts.rabaisPct > -100 &&
    opts.rabaisPct < 100
      ? round2(opts.rabaisPct)
      : null;

  const quantities = lines.map((line) => {
    const q = line.quantite;
    return typeof q === 'number' && Number.isFinite(q) && q > 0 ? q : 1;
  });

  const usable = proposedUnitPrices.map((p) =>
    typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null,
  );
  const provided = usable.filter((p): p is number => p !== null);

  const target =
    estimation !== null
      ? round2(estimation * (1 - (rabais ?? 0) / 100))
      : null;

  let methode: BpuMethod;
  let unitPrices: number[];

  if (provided.length === 0) {
    if (target === null) {
      throw new Error(
        'Aucune base de prix — ni estimation administrative ni prix IA utilisables',
      );
    }
    // Uniform fallback: same unit price everywhere, transparent and flagged.
    const totalQty = quantities.reduce((sum, q) => sum + q, 0);
    const uniform = Math.max(MIN_UNIT_PRICE_MAD, target / totalQty);
    unitPrices = quantities.map(() => uniform);
    methode = 'repartition_uniforme';
    avertissements.push(
      'Prix unitaires répartis uniformément (aucune proposition IA utilisable) — à revoir ligne par ligne.',
    );
  } else {
    if (provided.length < usable.length) {
      const fallback = median(provided);
      unitPrices = usable.map((p) => p ?? fallback);
      avertissements.push(
        `${usable.length - provided.length} ligne(s) sans proposition IA — prix médian appliqué, à vérifier.`,
      );
    } else {
      unitPrices = usable.map((p) => p as number);
    }
    methode = target !== null ? 'calibre_estimation' : 'prix_ia_non_calibres';
    if (target === null) {
      avertissements.push(
        'Estimation administrative inconnue — prix IA non calibrés sur un montant cible.',
      );
    }
  }

  if (target !== null) {
    const rawTotal = unitPrices.reduce(
      (sum, price, i) => sum + price * (quantities[i] as number),
      0,
    );
    const factor = rawTotal > 0 ? target / rawTotal : 1;
    unitPrices = unitPrices.map((price) =>
      Math.max(MIN_UNIT_PRICE_MAD, round2(price * factor)),
    );
  }

  let priced: BpuPricedLine[] = lines.map((line, i) => {
    const quantite = quantities[i] as number;
    const prixUnitaireMad = round2(unitPrices[i] as number);
    return {
      section: line.section ?? null,
      designation: line.designation,
      quantite,
      unite: line.unite ?? null,
      prixUnitaireMad,
      montantMad: round2(prixUnitaireMad * quantite),
    };
  });

  if (target !== null) {
    // Absorb the rounding residual on the largest line so the total lands on
    // the target to the dirham (unit price stays 2-decimal, so a sub-dirham
    // residue can remain on high-quantity lines — surfaced below).
    const total = round2(priced.reduce((sum, l) => sum + l.montantMad, 0));
    const residual = round2(target - total);
    if (residual !== 0) {
      const largestIndex = priced.reduce(
        (best, line, i) =>
          line.montantMad > (priced[best] as BpuPricedLine).montantMad ? i : best,
        0,
      );
      const largest = priced[largestIndex] as BpuPricedLine;
      const adjustedUnit = round2(
        largest.prixUnitaireMad + residual / largest.quantite,
      );
      if (adjustedUnit >= MIN_UNIT_PRICE_MAD) {
        priced = priced.map((line, i) =>
          i === largestIndex
            ? {
                ...line,
                prixUnitaireMad: adjustedUnit,
                montantMad: round2(adjustedUnit * line.quantite),
              }
            : line,
        );
      }
    }
  }

  const totalMad = round2(priced.reduce((sum, l) => sum + l.montantMad, 0));
  if (target !== null && Math.abs(totalMad - target) > 1) {
    avertissements.push(
      `Écart d'arrondi de ${round2(Math.abs(totalMad - target))} MAD entre le total et le montant cible.`,
    );
  }

  return {
    lines: priced,
    totalMad,
    estimationMad: estimation,
    rabaisPct: rabais,
    targetTotalMad: target,
    methode,
    avertissements,
  };
}
