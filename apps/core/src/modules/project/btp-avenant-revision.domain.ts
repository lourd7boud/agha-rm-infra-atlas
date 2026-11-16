import { Decimal, round2, toDecimal, type BordereauLigne } from './btp-finance.domain';
import {
  calculateRevisionPeriod, revisionDate, selectPublishedIndexes,
  type IndexValues, type PublishedIndexes, type RevisionFormulaSpec, type RevisionPeriod,
} from './btp-revision.domain';

export interface AvenantRevisionGroup {
  label: string;
  lineIds: string[];
  start: Date | null;
  baseDate: string | null;
  formuleId: string | null;
  formuleSnapshot?: RevisionFormulaSpec;
  amount: number;
  monthlyHt?: Record<string, number>;
  allocationSource?: 'attachements';
}

/** Price the quantities measured in this period. Signed estimated quantities never enter this calculation. */
export function splitAvenantRevisionGroups(
  lines: BordereauLigne[], delta: ReadonlyMap<string, number>, start: Date | null, periodAmount: number,
): { groups: AvenantRevisionGroup[]; reconciled: boolean } | undefined {
  const groups = new Map<string, AvenantRevisionGroup & { raw: Decimal }>();
  let hasAvenant = false;
  for (const line of lines) {
    const id = line.id ?? String(line.numero);
    const ht = toDecimal(delta.get(id) ?? 0).times(line.prixUnitaire);
    if (ht.isZero()) continue;
    const { avenant } = line;
    if (avenant) hasAvenant = true;
    const key = avenant ? JSON.stringify([avenant.id, avenant.baseDate, avenant.formuleId]) : 'initial';
    let group = groups.get(key);
    if (!group) {
      const due = avenant ? new Date(`${avenant.dateEffet}T00:00:00Z`) : null;
      group = {
        label: avenant ? `${avenant.reference || `Avenant n°${avenant.numero}`} · ${avenant.baseDate ? 'prix négociés' : 'base du marché'}` : 'Marché initial',
        lineIds: [], start: start && due && due > start ? due : start,
        baseDate: avenant?.baseDate ?? null, formuleId: avenant?.formuleId ?? null, amount: 0, raw: new Decimal(0),
        ...(avenant?.formuleSnapshot ? { formuleSnapshot: avenant.formuleSnapshot } : {}),
      };
      groups.set(key, group);
    }
    group.lineIds.push(id);
    group.raw = group.raw.plus(ht);
  }
  if (!hasAvenant) return undefined;
  const entries = [...groups.values()];
  let cumulative = new Decimal(0);
  let allocated = new Decimal(0);
  const result = entries.map(({ raw, ...group }, index) => {
    cumulative = cumulative.plus(raw);
    const target = index === entries.length - 1 ? toDecimal(periodAmount) : round2(cumulative);
    const amount = target.minus(allocated).toNumber();
    allocated = target;
    return { ...group, amount };
  });
  return { groups: result, reconciled: round2(cumulative).minus(periodAmount).abs().lte('0.01') };
}

export function calculateAvenantRevisionPeriod(input: {
  groups: AvenantRevisionGroup[];
  start: Date | null;
  end: Date | null;
  amount: number;
  issues: string[];
  baseDate: Date | null;
  baseOverrides: IndexValues;
  formula: RevisionFormulaSpec | null;
  formulas: ReadonlyMap<string, RevisionFormulaSpec>;
  monthlyIndexes: Map<string, PublishedIndexes[]>;
  cutoff: string;
  allowProvisional: boolean;
  allowUndatedIndexes?: boolean;
  contractDeadline: Date | null;
  limitedIndexes: boolean;
}): RevisionPeriod {
  const { start, end, amount, monthlyIndexes, cutoff } = input;
  const output: RevisionPeriod = {
    start: start && revisionDate(start), end: end && revisionDate(end), ht: amount,
    amount: null, method: 'calendar', months: [], issues: [...input.issues],
  };
  if (output.issues.length) return output;

  let total = new Decimal(0);
  let pending = false;
  for (const group of input.groups) {
    const formula = group.formuleSnapshot ?? (group.formuleId ? input.formulas.get(group.formuleId) ?? null : input.formula);
    const date = group.baseDate ?? (input.baseDate && revisionDate(input.baseDate));
    const codes = Object.keys(formula?.weights ?? {});
    const publication = date ? selectPublishedIndexes(monthlyIndexes, date.slice(0, 7), codes, cutoff, false, input.allowUndatedIndexes) : null;
    const overrides = group.baseDate ? {} : input.baseOverrides;
    const issues = date ? [] : ['Date contractuelle de référence manquante.'];
    if (input.limitedIndexes && codes.length > 5) issues.push('Maximum cinq indices pour un marché jusqu’à 1 000 000 MAD.');
    const result = calculateRevisionPeriod({
      start: group.start, end, amount: group.amount, formula, monthlyIndexes, cutoff,
      allowProvisional: input.allowProvisional, contractDeadline: input.contractDeadline,
      allowUndatedIndexes: input.allowUndatedIndexes,
      baseIndexes: { ...publication?.values, ...overrides }, monthlyHt: group.monthlyHt, issues,
    });
    pending ||= result.amount === null;
    total = total.plus(result.amount ?? 0);
    output.issues.push(...result.issues.map((issue) => `${group.label} · ${issue}`));
    output.months.push(...result.months.map((month) => ({
      ...month, priceBasis: { label: group.label, date, formula: formula?.name ?? null, publication, method: result.method,
        ...(group.allocationSource ? { allocationSource: group.allocationSource } : {}) },
    })));
  }
  output.amount = pending ? null : total.toNumber();
  if (input.groups.every((group) => group.monthlyHt)) output.method = 'monthly';
  return output;
}
