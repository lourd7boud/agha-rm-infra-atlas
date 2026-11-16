import { Decimal, round2, toDecimal } from './btp-finance.domain';
import { computeLignePartiel, type MetreLigne } from './btp-metre.domain';
import { revisionDate } from './btp-revision.domain';

interface DatedTerrainSource {
  metreId: string | null;
  ligneId: string;
  date: Date;
  quantite: string;
}

/** Only use execution dates when the linked evidence covers the incremental HT exactly. */
export function allocateRevisionFromTerrain({ start, end, amount, prix, metres, sources }: {
  start: Date | null;
  end: Date | null;
  amount: number;
  prix: ReadonlyMap<string, number>;
  metres: { id: string; bordereauLigneId: string; unite: string | null; totalPartiel: string; lignes: MetreLigne[] }[];
  sources: ReadonlyMap<string, DatedTerrainSource>;
}): Record<string, number> | undefined {
  if (!start || !end || start > end || amount <= 0 || !sources.size) return undefined;
  const startKey = revisionDate(start);
  const endKey = revisionDate(end);
  const monthAmounts = new Map<string, Decimal>();
  const usedSourceIds = new Set<string>();

  for (const metre of metres) {
    const unitPrice = prix.get(metre.bordereauLigneId);
    let quantity = new Decimal(0);
    for (const line of metre.lignes) {
      const measured = computeLignePartiel(metre.unite ?? '', line);
      if (measured === 0) continue;
      const id = line.id.startsWith('terrain-') ? line.id.slice('terrain-'.length) : '';
      const source = sources.get(id);
      if (!source || usedSourceIds.has(id) || unitPrice == null || source.metreId !== metre.id ||
          source.ligneId !== metre.bordereauLigneId || !toDecimal(source.quantite).eq(measured)) return undefined;
      const day = revisionDate(source.date);
      if (day < startKey || day > endKey) return undefined;
      usedSourceIds.add(id);
      quantity = quantity.plus(measured);
      const month = day.slice(0, 7);
      monthAmounts.set(month, (monthAmounts.get(month) ?? new Decimal(0)).plus(toDecimal(measured).times(unitPrice)));
    }
    if (!quantity.eq(metre.totalPartiel)) return undefined;
  }

  let cumulative = new Decimal(0);
  let previous = new Decimal(0);
  const monthlyHt: Record<string, number> = {};
  for (let month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); month <= end; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const key = revisionDate(month).slice(0, 7);
    cumulative = cumulative.plus(monthAmounts.get(key) ?? 0);
    const rounded = round2(cumulative);
    monthlyHt[key] = rounded.minus(previous).toNumber();
    previous = rounded;
  }

  return previous.eq(amount) ? monthlyHt : undefined;
}
