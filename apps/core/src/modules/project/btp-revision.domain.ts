// Révision des prix engine — faithful port of the source app's generic,
// data-driven priceRevisionEngine.v2.ts.
//
// Excel compliance (verified against the source):
//   • ratio per index      : TRUNC(current/base, 4)
//   • month coefficient    : TRUNC(fixedPart + Σ weight·ratio − 1, 4)
//   • weighted coefficient : TRUNC(Σ(days×monthCoef) / totalDays, 4)
//   • montant révision     : TRUNC(montantAReviser × coefficient, 2)
// Application rule (source-app specific): the révision is APPLIED only on the
// décompte flagged "et dernier", on its cumulative HT, with the coefficient
// weighted per month across the période span.
import { Decimal, toDecimal } from './btp-finance.domain';

export type IndexValues = Record<string, number>;

export interface RevisionFormulaSpec {
  id?: string;
  name: string;
  description?: string | null;
  fixedPart: number;
  weights: Record<string, number>;
}

export function truncTo(value: Decimal | number, decimals: number): number {
  return toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toNumber();
}

export function dateToMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyToDate(monthKey: string): Date {
  const [year = 1970, month = 1] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function getMonthsInPeriod(periodStart: Date, periodEnd: Date): string[] {
  const months: string[] = [];
  const current = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
  const end = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  while (current <= end) {
    months.push(dateToMonthKey(current));
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

export function getDaysInMonthForPeriod(
  monthKey: string,
  periodStart: Date,
  periodEnd: Date,
): number {
  const [year = 1970, month = 1] = monthKey.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const effectiveStart = periodStart > monthStart ? periodStart : monthStart;
  const effectiveEnd = periodEnd < monthEnd ? periodEnd : monthEnd;
  if (effectiveStart > effectiveEnd) return 0;
  return (
    Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
}

export interface IndexContribution {
  weight: number;
  currentValue: number;
  baseValue: number;
  ratio: number;
  contribution: number;
}

export interface CoefficientResult {
  display: number;
  breakdown: {
    fixedPart: number;
    indexContributions: Record<string, IndexContribution>;
    sum: number;
  };
}

/** C = TRUNC([fixedPart + Σ wᵢ·TRUNC(Iᵢ/Iᵢ0, 4)] − 1, 4). */
export function calculateMonthCoefficient(
  currentIndexes: IndexValues,
  baseIndexes: IndexValues,
  formula: RevisionFormulaSpec,
): CoefficientResult {
  let sum = toDecimal(formula.fixedPart);
  const indexContributions: Record<string, IndexContribution> = {};
  for (const [indexName, weight] of Object.entries(formula.weights)) {
    const currentValue = currentIndexes[indexName];
    const baseValue = baseIndexes[indexName];
    if (
      currentValue === undefined ||
      currentValue === null ||
      baseValue === undefined ||
      baseValue === null ||
      baseValue === 0
    ) {
      continue;
    }
    const ratio = truncTo(toDecimal(currentValue).dividedBy(toDecimal(baseValue)), 4);
    const contribution = toDecimal(weight).times(ratio);
    sum = sum.plus(contribution);
    indexContributions[indexName] = {
      weight,
      currentValue,
      baseValue,
      ratio,
      contribution: contribution.toNumber(),
    };
  }
  const coefficient = sum.minus(1);
  return {
    display: truncTo(coefficient, 4),
    breakdown: { fixedPart: formula.fixedPart, indexContributions, sum: sum.toNumber() },
  };
}

export interface MonthDetail {
  month: string;
  days: number;
  coefficient: number;
  contribution: number;
  missingIndexes?: boolean;
}

export interface WeightedCoefficientResult {
  display: number;
  totalDays: number;
  details: MonthDetail[];
}

/** Day-weighted coefficient across the période span. */
export function calculateWeightedCoefficient(
  periodStart: Date,
  periodEnd: Date,
  monthlyCoefficients: Map<string, number>,
): WeightedCoefficientResult {
  const months = getMonthsInPeriod(periodStart, periodEnd);
  const details: MonthDetail[] = [];
  let totalDays = 0;
  let weightedSum = new Decimal(0);
  for (const monthKey of months) {
    const days = getDaysInMonthForPeriod(monthKey, periodStart, periodEnd);
    const coefficient = monthlyCoefficients.get(monthKey) ?? 0;
    if (days > 0) {
      const contribution = toDecimal(days).times(toDecimal(coefficient));
      weightedSum = weightedSum.plus(contribution);
      totalDays += days;
      details.push({
        month: monthKey,
        days,
        coefficient,
        contribution: contribution.toNumber(),
        missingIndexes: !monthlyCoefficients.has(monthKey),
      });
    }
  }
  const weighted = totalDays > 0 ? weightedSum.dividedBy(totalDays) : new Decimal(0);
  return { display: truncTo(weighted, 4), totalDays, details };
}

export interface DecompteRevisionResult {
  montantAReviser: number;
  coefficient: number;
  montantRevision: number;
  totalDays: number;
  details: MonthDetail[];
  missingMonths: string[];
}

/**
 * Full révision computation for one décompte's période: month coefficients
 * from the monthly index table, day-weighted across the span, then
 * TRUNC(montant × coefficient, 2).
 */
export function calculateDecompteRevision(params: {
  montantAReviser: number;
  periodStart: Date;
  periodEnd: Date;
  baseIndexes: IndexValues;
  monthlyIndexes: Map<string, IndexValues>;
  formula: RevisionFormulaSpec;
}): DecompteRevisionResult {
  const { montantAReviser, periodStart, periodEnd, baseIndexes, monthlyIndexes, formula } = params;
  const monthlyCoefficients = new Map<string, number>();
  const missingMonths: string[] = [];
  for (const monthKey of getMonthsInPeriod(periodStart, periodEnd)) {
    const indexes = monthlyIndexes.get(monthKey);
    if (indexes) {
      monthlyCoefficients.set(
        monthKey,
        calculateMonthCoefficient(indexes, baseIndexes, formula).display,
      );
    } else {
      missingMonths.push(monthKey);
    }
  }
  const weighted = calculateWeightedCoefficient(periodStart, periodEnd, monthlyCoefficients);
  const montantRevision = truncTo(toDecimal(montantAReviser).times(weighted.display), 2);
  return {
    montantAReviser,
    coefficient: weighted.display,
    montantRevision,
    totalDays: weighted.totalDays,
    details: weighted.details,
    missingMonths,
  };
}

/** Σ fixedPart + weights must equal 1.0000 (±0.0001). */
export function validateFormula(formula: RevisionFormulaSpec): {
  valid: boolean;
  total: number;
} {
  const weightsSum = Object.values(formula.weights).reduce((sum, w) => sum + w, 0);
  const total = formula.fixedPart + weightsSum;
  return { valid: Math.abs(total - 1) < 0.0001, total };
}
