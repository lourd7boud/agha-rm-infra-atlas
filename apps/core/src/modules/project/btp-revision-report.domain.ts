import { toDecimal } from './btp-finance.domain';
import {
  calculateMonthCoefficient,
  truncTo,
  type IndexValues,
  type PublishedIndexes,
  type RevisionFormulaSpec,
  type RevisionMonth,
  type RevisionPeriod,
  type RevisionTrace,
} from './btp-revision.domain';

export interface RevisionReportInputRow {
  decompteId: string;
  numero: number;
  isDernier: boolean;
  dateDecompte: string | null;
  statut: string;
  cumulative: number;
  trace: RevisionTrace | null;
  period?: RevisionPeriod | null;
  origin?: 'recorded' | 'reconstituted' | 'draft';
  warnings?: string[];
}

export interface RevisionReportInput {
  project: { reference: string; name: string; objet?: string | null; ordreServiceDate?: string | null };
  mode: 'each_decompte' | 'final_only';
  cutoff: string;
  baseDate: string | null;
  formula: RevisionFormulaSpec | null;
  basePublication: PublishedIndexes | null;
  baseIndexes?: IndexValues;
  rows: RevisionReportInputRow[];
}

export interface RevisionReportCoefficientMonth {
  month: string;
  values: IndexValues;
  ratios: IndexValues;
  coefficient: number | null;
  publication: PublishedIndexes | null;
  statementNumeros: number[];
}

export interface RevisionReportCoefficientGroup {
  id: string;
  label: string;
  formula: string;
  baseDate: string | null;
  baseValues: IndexValues;
  basePublication: PublishedIndexes | null;
  indices: string[];
  manualBaseIndices?: string[];
  months: RevisionReportCoefficientMonth[];
}

export interface RevisionReportRow {
  decompteId: string;
  numero: number;
  isDernier: boolean;
  dateDecompte: string | null;
  statut: string;
  origin: 'recorded' | 'reconstituted' | 'draft';
  cutoff: string;
  start: string | null;
  end: string | null;
  totalDays: number | null;
  ht: number | null;
  appliedCoefficient: number | null;
  amount: number | null;
  postedCumulative: number;
  basePublication: PublishedIndexes | null;
  months: RevisionMonth[];
  issues: string[];
  warnings: string[];
}

export interface RevisionReport {
  project: RevisionReportInput['project'];
  mode: RevisionReportInput['mode'];
  cutoff: string;
  baseDate: string | null;
  formula: RevisionFormulaSpec | null;
  coefficientGroups: RevisionReportCoefficientGroup[];
  rows: RevisionReportRow[];
  warnings: string[];
  summary: {
    calculatedTotal: number | null;
    availableTotal: number;
    postedTotal: number;
    balance: number | null;
    pendingCount: number;
    final: boolean;
  };
}

function daysBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function rowFromInput(row: RevisionReportInputRow, cutoff: string): RevisionReportRow {
  const period = row.period ?? row.trace?.period;
  const months = period?.months ?? [];
  const weighted = months.reduce((total, month) =>
    total.plus(toDecimal(month.coefficient ?? 0).times(month.ht)), toDecimal(0));
  const coefficientAvailable = !!period?.ht && months.length > 0 && months.every((month) => month.coefficient !== null || month.ht === 0);
  return {
    decompteId: row.decompteId,
    numero: row.numero,
    isDernier: row.isDernier,
    dateDecompte: row.dateDecompte,
    statut: row.statut,
    origin: row.origin ?? (row.trace ? 'recorded' : 'draft'),
    cutoff: row.origin === 'reconstituted' ? cutoff : row.trace?.cutoff ?? cutoff,
    start: period?.start ?? null,
    end: period?.end ?? null,
    totalDays: daysBetween(period?.start ?? null, period?.end ?? null),
    ht: period?.ht ?? null,
    appliedCoefficient: coefficientAvailable ? truncTo(weighted.dividedBy(period!.ht), 4) : null,
    amount: period?.amount ?? null,
    postedCumulative: row.cumulative,
    basePublication: row.trace?.basePublication ?? null,
    months,
    issues: [...new Set([
      ...period?.issues ?? [],
      ...months.flatMap((month) => month.missing.map((missing) => `Indices en attente pour ${missing}.`)),
    ])],
    warnings: [...new Set([
      ...row.warnings ?? [],
      ...months.flatMap((month) => month.contractPublication
        ? [`Borne du délai contractuel · ${month.contractPublication.source ?? 'Source à vérifier'} · ${month.contractPublication.publishedOn ?? 'Date de publication à vérifier'}.`]
        : []),
    ])],
  };
}

function coefficientGroups(input: RevisionReportInput, rows: RevisionReportRow[]) {
  const groups = new Map<string, RevisionReportCoefficientGroup>();
  const monthKeys = new Map<string, Map<string, RevisionReportCoefficientMonth>>();
  for (const row of rows) {
    for (const month of row.months) {
      const contributions = month.breakdown?.indexContributions ?? {};
      const fallbackFormula = !month.priceBasis || month.priceBasis.formula === input.formula?.name ? input.formula : null;
      const indices = Object.keys(month.breakdown ? contributions : fallbackFormula?.weights ?? {});
      const baseDate = month.priceBasis?.date ?? input.baseDate;
      const basePublication = month.priceBasis?.publication ?? row.basePublication ?? input.basePublication;
      const availableBase = { ...basePublication?.values, ...(!month.priceBasis ? input.baseIndexes : {}) };
      const baseValues = Object.fromEntries(indices.flatMap((code) => {
        const value = contributions[code]?.baseValue ?? availableBase[code];
        return value == null ? [] : [[code, value]];
      }));
      const manualBaseIndices = indices.filter((code) => input.baseIndexes?.[code] != null
        && input.baseIndexes[code] === baseValues[code] && basePublication?.values[code] !== baseValues[code]);
      const fixedPart = month.breakdown?.fixedPart ?? fallbackFormula?.fixedPart;
      const weights = Object.fromEntries(indices.map((code) => [code, contributions[code]?.weight ?? fallbackFormula!.weights[code]!]));
      const label = month.priceBasis?.label ?? 'Prix du marché';
      const signature = [...indices].sort().map((code) => [code, weights[code], baseValues[code]]);
      const key = JSON.stringify([label, baseDate, fixedPart, signature]);
      let group = groups.get(key);
      if (!group) {
        const terms = indices.map((code) => `${weights[code]} × (${code}/${code}0)`);
        group = {
          id: `base-${groups.size + 1}`, label, baseDate, baseValues, basePublication, indices, manualBaseIndices,
          formula: fixedPart == null ? 'Formule du CPS à renseigner'
            : `C = ${fixedPart}${terms.length ? ` + ${terms.join(' + ')}` : ''} − 1`,
          months: [],
        };
        groups.set(key, group);
        monthKeys.set(key, new Map());
      }
      const values = Object.fromEntries(indices.flatMap((code) => {
        const value = contributions[code]?.currentValue;
        return value == null ? [] : [[code, value]];
      }));
      const ratios = Object.fromEntries(indices.flatMap((code) => {
        const value = contributions[code]?.ratio;
        return value == null ? [] : [[code, value]];
      }));
      const coefficient = month.breakdown && fixedPart != null
        ? calculateMonthCoefficient(values, baseValues, { name: label, fixedPart, weights }, 'coefficient').display : null;
      const monthKey = JSON.stringify([month.month, values, ratios, coefficient, month.publication]);
      const knownMonths = monthKeys.get(key)!;
      const existing = knownMonths.get(monthKey);
      if (existing) {
        if (!existing.statementNumeros.includes(row.numero)) existing.statementNumeros.push(row.numero);
      } else {
        const value = { month: month.month, values, ratios, coefficient,
          publication: month.publication, statementNumeros: [row.numero] };
        knownMonths.set(monthKey, value);
        group.months.push(value);
      }
    }
  }
  return [...groups.values()];
}

/** Projects the engine's recorded or reconstructed results into the two report tables. */
export function buildRevisionReport(input: RevisionReportInput): RevisionReport {
  const rows = [...input.rows].sort((a, b) => a.numero - b.numero).map((row) => rowFromInput(row, input.cutoff));
  const available = rows.reduce((total, row) => total.plus(row.amount ?? 0), toDecimal(0));
  const pendingCount = rows.filter((row) => row.amount === null).length;
  const calculatedTotal = pendingCount > 0 || rows.length === 0 ? null : available.toNumber();
  const postedTotal = rows.at(-1)?.postedCumulative ?? 0;
  const groups = coefficientGroups(input, rows);
  const warnings = [...new Set([
    ...rows.flatMap((row) => row.warnings),
    ...groups.flatMap((group) => group.manualBaseIndices?.length
      ? [`Indices de base saisis manuellement · ${group.manualBaseIndices.map((code) => `${code} ${group.baseValues[code]} (registre ${group.basePublication?.values[code] ?? 'à vérifier'})`).join(', ')}.`]
      : []),
  ])];
  if (rows.some((row) => row.origin === 'reconstituted')) {
    warnings.unshift('Reconstitution des périodes historiques à vérifier avant régularisation.');
  }
  return {
    project: input.project, mode: input.mode, cutoff: input.cutoff, baseDate: input.baseDate, formula: input.formula,
    coefficientGroups: groups, rows, warnings,
    summary: {
      calculatedTotal, availableTotal: available.toNumber(), postedTotal,
      balance: calculatedTotal == null ? null : toDecimal(calculatedTotal).minus(postedTotal).toNumber(),
      pendingCount, final: rows.at(-1)?.isDernier ?? false,
    },
  };
}
