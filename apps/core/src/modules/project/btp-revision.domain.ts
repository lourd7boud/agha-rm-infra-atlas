// Révision des prix. Legacy Excel helpers precede the monthly settlement
// workflow implementing the calculation and publication rules of 3-302-15.
import { Decimal, toDecimal } from './btp-finance.domain';
import { compareOfficialIndexReferences } from './btp-index-sync.domain';

export type IndexValues = Record<string, number>;
export type RevisionPostingMode = 'each_decompte' | 'final_only';

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
  precision: 'variation' | 'coefficient' = 'variation',
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
  const coefficient = precision === 'coefficient'
    ? sum.toDecimalPlaces(4, Decimal.ROUND_DOWN).minus(1)
    : sum.minus(1);
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
  const weights = Object.values(formula.weights);
  const total = weights.reduce((sum, weight) => sum.plus(weight), toDecimal(formula.fixedPart));
  return {
    valid: formula.fixedPart >= 0.15 && formula.fixedPart <= 1 &&
      truncTo(formula.fixedPart, 4) === formula.fixedPart &&
      weights.length > 0 && weights.every((weight) => weight > 0 && weight <= 1) && total.eq(1),
    total: total.toNumber(),
  };
}

export interface PublishedIndexes {
  values: IndexValues;
  status: string;
  source: string | null;
  publishedOn: string | null;
}

export type RevisionPublications = Map<string, PublishedIndexes | PublishedIndexes[]>;

export interface RevisionMonth {
  month: string;
  days: number;
  ht: number;
  coefficient: number | null;
  amount: number | null;
  publication: PublishedIndexes | null;
  breakdown: CoefficientResult['breakdown'] | null;
  missing: string[];
  contractCoefficient?: number;
  contractPublication?: PublishedIndexes;
  priceBasis?: { label: string; date: string | null; formula: string | null; publication: PublishedIndexes | null; method: 'monthly' | 'calendar'; allocationSource?: 'attachements' };
}

export interface RevisionPeriod {
  amount: number | null;
  ht: number;
  start: string | null;
  end: string | null;
  method: 'monthly' | 'calendar';
  allocationSource?: 'attachements';
  months: RevisionMonth[];
  issues: string[];
}

export interface RevisionTrace {
  version: 1;
  cutoff: string;
  basePublication: PublishedIndexes | null;
  period: RevisionPeriod;
  recognized: { numero: number; period: RevisionPeriod }[];
  cumulative: number;
  movement: number;
  status: 'pending' | 'calculated';
  postingMode?: RevisionPostingMode;
  calculatedCumulative?: number | null;
  availableCumulative?: number;
  deferred?: boolean;
  pendingPeriods: { numero: number; period: RevisionPeriod }[];
}

export function readRevisionTrace(value: unknown): RevisionTrace | null {
  return value && typeof value === 'object' && 'version' in value && value.version === 1
    ? value as RevisionTrace : null;
}

export function revisionDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function revisionDayAfter(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}

/** Effective OS date when specified, otherwise the day after OS notification. */
export function chantierStart(project: { executionStartDate?: Date | null; ordreServiceDate: Date | null }): Date | null {
  return project.executionStartDate ?? (project.ordreServiceDate ? revisionDayAfter(project.ordreServiceDate) : null);
}

export function usableIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function selectPublishedIndexes(
  publications: RevisionPublications,
  month: string,
  codes: string[],
  cutoff: string,
  allowProvisional: boolean,
  allowUndated = false,
): PublishedIndexes | null {
  const entry = publications.get(month);
  const candidates = Array.isArray(entry) ? entry : entry ? [entry] : [];
  return candidates.filter((row) =>
    row.source?.trim() && (row.publishedOn ? row.publishedOn <= cutoff : allowUndated) &&
    (row.status === 'definitif' || (allowProvisional && row.status === 'provisoire')) &&
    codes.every((code) => usableIndex(row.values[code])),
  ).sort((a, b) =>
    Number(!!b.publishedOn) - Number(!!a.publishedOn) ||
    Number(b.status === 'definitif') - Number(a.status === 'definitif') ||
    compareOfficialIndexReferences(b.source, a.source) ||
    (b.publishedOn ?? '').localeCompare(a.publishedOn ?? ''),
  )[0] ?? null;
}

/** Arrêté 3-302-15, art. 8, 12, 14, 18. Calendar dates are UTC date-only. */
export function calculateRevisionPeriod(input: {
  formula: RevisionFormulaSpec | null;
  baseIndexes: IndexValues;
  monthlyIndexes: RevisionPublications;
  start: Date | null;
  end: Date | null;
  amount: number;
  cutoff: string;
  allowProvisional: boolean;
  allowUndatedIndexes?: boolean;
  monthlyHt?: Record<string, number>;
  allocationSource?: 'attachements';
  contractDeadline?: Date | null;
  issues?: string[];
}): RevisionPeriod {
  const { start, end, formula, baseIndexes, monthlyIndexes, monthlyHt, contractDeadline } = input;
  const issues = [...(input.issues ?? [])];
  const result: RevisionPeriod = {
    amount: null, ht: input.amount, start: start && revisionDate(start), end: end && revisionDate(end),
    method: monthlyHt ? 'monthly' : 'calendar', months: [], issues,
    ...(input.allocationSource ? { allocationSource: input.allocationSource } : {}),
  };
  if (input.amount === 0 && !monthlyHt) return { ...result, amount: issues.length ? null : 0 };
  if (!start || !end || start > end) issues.push('Dates réelles d’exécution à vérifier.');
  if (!formula || !validateFormula(formula).valid) issues.push('Formule du CPS à vérifier.');
  const codes = Object.keys(formula?.weights ?? {});
  const missingBase = codes.filter((code) => !usableIndex(baseIndexes[code]));
  if (missingBase.length) issues.push(`Indices de base manquants · ${missingBase.join(', ')}.`);
  if (issues.length || !start || !end || !formula) return result;

  const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const totalDays = days(start, end);
  const segments: { month: string; days: number; late: boolean }[] = [];
  for (let from = start; from <= end;) {
    const month = revisionDate(from).slice(0, 7);
    const monthEnd = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    const late = !!contractDeadline && month > revisionDate(contractDeadline).slice(0, 7);
    const to = new Date(Math.min(end.getTime(), monthEnd.getTime()));
    segments.push({ month, days: days(from, to), late });
    from = revisionDayAfter(to);
  }

  if (monthlyHt && (
    Object.entries(monthlyHt).some(([month, value]) =>
      !Number.isFinite(value) || !segments.some((segment) => segment.month === month)) ||
    segments.some(({ month }) => !Object.hasOwn(monthlyHt, month)) ||
    !Object.values(monthlyHt).reduce((sum, value) => sum.plus(value), new Decimal(0)).eq(input.amount)
  )) {
    issues.push('La ventilation mensuelle doit couvrir le HT de la période.');
    return result;
  }
  let allocated = new Decimal(0);
  let elapsedDays = 0;
  let revision = new Decimal(0);
  const publicationFor = (month: string) =>
    selectPublishedIndexes(monthlyIndexes, month, codes, input.cutoff, input.allowProvisional, input.allowUndatedIndexes);
  result.months = segments.map((segment) => {
    const { month, late } = segment;
    elapsedDays += segment.days;
    const ht = monthlyHt ? toDecimal(monthlyHt[month]) :
      toDecimal(input.amount).times(elapsedDays).dividedBy(totalDays).toDecimalPlaces(2).minus(allocated);
    allocated = allocated.plus(ht);
    if (ht.isZero()) return {
      month, days: segment.days, ht: 0, coefficient: null, amount: 0, publication: null,
      breakdown: null, missing: [],
    };
    const publication = publicationFor(month);
    const contractMonth = late && contractDeadline ? revisionDate(contractDeadline).slice(0, 7) : null;
    const contract = contractMonth ? publicationFor(contractMonth) : null;
    const missing: string[] = [];
    if (!publication) missing.push(month);
    if (contractMonth && !contract && contractMonth !== month) missing.push(contractMonth);
    const computed = publication && calculateMonthCoefficient(publication.values, baseIndexes, formula, 'coefficient');
    const contractCoefficient = contract
      ? calculateMonthCoefficient(contract.values, baseIndexes, formula, 'coefficient').display : undefined;
    const coefficient = computed && missing.length === 0
      ? Math.min(computed.display, contractCoefficient ?? Infinity) : null;
    const amount = coefficient === null ? null : truncTo(ht.times(coefficient), 2);
    if (amount !== null) revision = revision.plus(amount);
    return {
      month, days: segment.days, ht: ht.toNumber(), coefficient, amount, publication,
      breakdown: computed?.breakdown ?? null, missing, contractCoefficient,
      ...(contract ? { contractPublication: contract } : {}),
    };
  });
  if (result.months.every((month) => month.amount !== null)) result.amount = revision.toNumber();
  return result;
}

export function settleRevision(
  periods: RevisionPeriod[],
  prior: number,
  final: boolean,
  options: { postingMode?: RevisionPostingMode; isLast?: boolean } = {},
) {
  const pending = periods.some((period) => period.amount === null);
  const available = periods.reduce((sum, period) => sum.plus(period.amount ?? 0), new Decimal(0));
  const deferred = options.postingMode === 'final_only' && !options.isLast;
  const cumulative = deferred || (final && pending) ? toDecimal(prior) : available;
  return {
    cumulative: cumulative.toNumber(),
    movement: cumulative.minus(prior).toNumber(),
    postingMode: options.postingMode ?? 'each_decompte',
    calculatedCumulative: pending ? null : available.toNumber(),
    availableCumulative: available.toNumber(),
    deferred,
    status: pending ? 'pending' as const : 'calculated' as const,
  };
}
