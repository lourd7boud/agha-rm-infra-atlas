import Decimal from 'decimal.js';

export type MoneyCents = number;

export class SalesMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesMoneyError';
  }
}

function assertSafeCents(value: number, label: string): asserts value is MoneyCents {
  if (!Number.isSafeInteger(value)) {
    throw new SalesMoneyError(`${label} doit être un entier sûr en centimes.`);
  }
}

export function parseMoneyCents(value: string | number): MoneyCents {
  let decimal: Decimal;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SalesMoneyError('Le montant numérique doit être fini.');
    }
    decimal = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } else {
    const normalized = value.trim().replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) {
      throw new SalesMoneyError(
        'Le montant doit être un nombre décimal avec au plus deux décimales.',
      );
    }
    decimal = new Decimal(normalized);
  }

  const cents = decimal.times(100);
  if (!cents.isInteger() || !cents.isFinite()) {
    throw new SalesMoneyError('Le montant ne peut pas être représenté en centimes.');
  }
  const result = cents.toNumber();
  if (!Number.isSafeInteger(result)) {
    throw new SalesMoneyError('Le montant dépasse les limites sûres en centimes.');
  }
  return result;
}

export function formatMoneyCents(value: MoneyCents): string {
  assertSafeCents(value, 'Le montant');
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const dirhams = Math.floor(absolute / 100);
  const centimes = String(absolute % 100).padStart(2, '0');
  return `${sign}${dirhams}.${centimes}`;
}

export function allocateCentsProRata(
  total: MoneyCents,
  weights: readonly MoneyCents[],
): MoneyCents[] {
  assertSafeCents(total, 'Le total');
  if (total < 0) {
    throw new SalesMoneyError('Le total doit être positif ou nul.');
  }
  if (weights.length === 0) {
    throw new SalesMoneyError('La somme des poids doit être strictement positive.');
  }

  let totalWeight = 0n;
  const safeWeights = weights.map((weight) => {
    assertSafeCents(weight, 'Chaque poids');
    if (weight < 0) {
      throw new SalesMoneyError('Chaque poids doit être positif ou nul.');
    }
    totalWeight += BigInt(weight);
    return BigInt(weight);
  });
  if (totalWeight === 0n) {
    throw new SalesMoneyError('La somme des poids doit être strictement positive.');
  }

  const totalBigInt = BigInt(total);
  let residualIndex = safeWeights.length - 1;
  while (safeWeights[residualIndex] === 0n) residualIndex -= 1;
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === residualIndex) {
      return total - allocated;
    }
    if (index > residualIndex) return 0;
    const share = Number((totalBigInt * weight) / totalWeight);
    assertSafeCents(share, 'La quote-part');
    allocated += share;
    assertSafeCents(allocated, 'Le cumul réparti');
    return share;
  });
}
