// Registres du marché — pure rules: délais (DelaisPage formulas), pénalités
// (CCAG-T art. 60), and the ODS / avenant / pénalité / caution status machines
// ported from the source app's controllers and panels.
import { round2, toDecimal, toNumber } from './btp-finance.domain';

export class BtpTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BtpTransitionError';
  }
}

// ─── Délais ──────────────────────────────────────────────────────────────────

export interface ArretTravaux {
  id?: string;
  sourceOdsId?: string;
  repriseOdsId?: string;
  dateArret: string; // ISO date
  dateReprise?: string | null;
  motif?: string | null;
}

export function withStopIds(stops: ArretTravaux[]): ArretTravaux[] {
  const usedIds = new Set(stops.map((stop) => stop.id));
  let nextIndex = 0;
  return stops.map((stop) => {
    if (stop.id) return stop;
    let id: string;
    do {
      id = `legacy-stop-${nextIndex++}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return { ...stop, id };
  });
}

export type DelaiStatus = 'completed' | 'overdue' | 'critical' | 'warning' | 'normal' | 'unknown';

export interface DelaiInfo {
  delaiJours: number;
  joursArret: number;
  delaiTotal: number;
  dateFinInitiale: Date | null;
  dateFinEffective: Date | null;
  joursEcoules: number;
  joursRestants: number;
  pourcentage: number;
  status: DelaiStatus;
  enArret: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function diffDays(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

function addMonthsFractional(base: Date, months: number): Date {
  const whole = Math.trunc(months);
  const fraction = months - whole;
  const targetMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + whole, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(base.getUTCDate(), lastDay)));
  // Preserve the legacy 30-day conversion only for explicitly fractional months.
  return fraction ? addDays(result, Math.round(fraction * 30)) : result;
}

/** UTC calendar months from the effective start, plus the union of total stops.
 * No holiday adjustment is possible without an authoritative working-day calendar.
 */
export function computeDelaiInfo(params: {
  ordreServiceDate: Date | null;
  executionStartDate?: Date | null;
  delaiMois: number | null;
  extraDelaiMois?: number;
  arrets: ArretTravaux[];
  receptionProvisoire: Date | null;
  receptionDefinitive: Date | null;
  today?: Date;
}): DelaiInfo {
  const { ordreServiceDate, delaiMois, arrets, receptionProvisoire, receptionDefinitive } = params;
  const today = utcDay(params.today ?? new Date());
  const executionStart = params.executionStartDate
    ? utcDay(params.executionStartDate)
    : ordreServiceDate ? addDays(utcDay(ordreServiceDate), 1) : null;

  let enArret = false;
  const intervals: { start: number; end: number }[] = [];
  for (const arret of arrets ?? []) {
    if (!arret?.dateArret) continue;
    const start = utcDay(new Date(arret.dateArret)).getTime();
    const end = arret.dateReprise ? utcDay(new Date(arret.dateReprise)).getTime() : Infinity;
    if (!Number.isFinite(start) || !(end > start)) continue;
    if (start <= today.getTime() && today.getTime() < end) enArret = true;
    if (end === Infinity && start > today.getTime()) continue;
    const effectiveStart = Math.max(start, executionStart?.getTime() ?? start);
    if (end > effectiveStart) intervals.push({ start: effectiveStart, end });
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const totalMonths = (delaiMois ?? 0) + (params.extraDelaiMois ?? 0);

  if (!executionStart || !Number.isFinite(executionStart.getTime()) || !delaiMois || !Number.isFinite(totalMonths) || totalMonths <= 0) {
    const joursArret = merged.reduce((days, interval) => days + (Number.isFinite(interval.end)
      ? (interval.end - interval.start) / DAY_MS : 0), 0);
    return {
      delaiJours: 0,
      joursArret,
      delaiTotal: joursArret,
      dateFinInitiale: null,
      dateFinEffective: null,
      joursEcoules: 0,
      joursRestants: 0,
      pourcentage: 0,
      status: 'unknown',
      enArret,
    };
  }

  const dateFinInitiale = addMonthsFractional(executionStart, delaiMois);
  const dateFinProlongee = addMonthsFractional(executionStart, totalMonths);
  const delaiJours = diffDays(dateFinProlongee, executionStart);
  let joursArret = 0;
  let contractualEnd = dateFinProlongee.getTime();
  for (const interval of merged) {
    if (interval.start > contractualEnd) break;
    if (interval.end === Infinity) {
      contractualEnd = Infinity;
      break;
    }
    const duration = interval.end - interval.start;
    joursArret += duration / DAY_MS;
    contractualEnd += duration;
  }
  const dateFinEffective = Number.isFinite(contractualEnd) ? new Date(contractualEnd) : null;
  const joursEcoules = diffDays(today, executionStart);
  const joursRestants = dateFinEffective ? diffDays(dateFinEffective, today) : 0;
  const delaiTotal = delaiJours + joursArret;
  const pourcentage =
    delaiTotal > 0 ? Math.min(100, Math.max(0, (joursEcoules / delaiTotal) * 100)) : 0;

  let status: DelaiStatus = 'normal';
  if (receptionProvisoire || receptionDefinitive) status = 'completed';
  else if (!dateFinEffective) status = 'unknown';
  else if (joursRestants < 0) status = 'overdue';
  else if (joursRestants <= 15) status = 'critical';
  else if (joursRestants <= 30) status = 'warning';

  return {
    delaiJours,
    joursArret,
    delaiTotal,
    dateFinInitiale,
    dateFinEffective,
    joursEcoules,
    joursRestants,
    pourcentage,
    status,
    enArret,
  };
}

// ─── Pénalités (CCAG-T art. 60) ──────────────────────────────────────────────

export interface PenaliteComputation {
  montantPenalite: number;
  montantPlafond: number;
  montantApplique: number;
}

/** montant = base × taux × jours, plafond = base × plafond%, appliqué = MIN. */
export function computePenalite(params: {
  baseCalcul: number;
  taux: number;
  nombreJours: number;
  plafondPourcentage: number;
}): PenaliteComputation {
  const base = toDecimal(params.baseCalcul);
  const montant = base.times(toDecimal(params.taux)).times(toDecimal(params.nombreJours));
  const plafond = base.times(toDecimal(params.plafondPourcentage).dividedBy(100));
  const applique = montant.greaterThan(plafond) ? plafond : montant;
  return {
    montantPenalite: toNumber(round2(montant)),
    montantPlafond: toNumber(round2(plafond)),
    montantApplique: toNumber(round2(applique)),
  };
}

// ─── Status machines ─────────────────────────────────────────────────────────

export const ODS_TYPES = [
  'commencement',
  'arret',
  'reprise',
  'modification',
  'travaux_supplementaires',
  'prolongation',
  'reception_provisoire',
  'reception_definitive',
  'mise_en_demeure',
  'autre',
] as const;

export type OdsStatut =
  | 'brouillon'
  | 'emis'
  | 'notifie'
  | 'accuse'
  | 'execute'
  | 'cloture'
  | 'annule';

export type OdsAction = 'emit' | 'notify' | 'acknowledge' | 'execute' | 'close' | 'cancel';

const ODS_TRANSITIONS: Record<OdsAction, { from: OdsStatut[]; to: OdsStatut }> = {
  emit: { from: ['brouillon'], to: 'emis' },
  notify: { from: ['emis'], to: 'notifie' },
  acknowledge: { from: ['notifie'], to: 'accuse' },
  execute: { from: ['accuse'], to: 'execute' },
  close: { from: ['execute'], to: 'cloture' },
  cancel: { from: ['brouillon', 'emis', 'notifie', 'accuse', 'execute'], to: 'annule' },
};

export function assertOdsTransition(current: string, action: OdsAction): OdsStatut {
  const rule = ODS_TRANSITIONS[action];
  if (!rule) throw new BtpTransitionError(`Action ODS inconnue: ${action}`);
  if (!rule.from.includes(current as OdsStatut)) {
    throw new BtpTransitionError(`ODS ${current}: action "${action}" impossible`);
  }
  return rule.to;
}

export type AvenantStatut = 'brouillon' | 'en_attente' | 'approuve' | 'rejete' | 'annule';

const AVENANT_TRANSITIONS: Record<string, AvenantStatut[]> = {
  brouillon: ['en_attente', 'annule'],
  en_attente: ['approuve', 'rejete', 'annule'],
  approuve: [],
  rejete: ['brouillon'],
  annule: [],
};

export function assertAvenantTransition(current: string, next: string): AvenantStatut {
  const allowed = AVENANT_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next as AvenantStatut)) {
    throw new BtpTransitionError(`Avenant ${current} → ${next}: transition impossible`);
  }
  return next as AvenantStatut;
}

export type PenaliteStatut =
  | 'calculee'
  | 'notifiee'
  | 'contestee'
  | 'appliquee'
  | 'annulee'
  | 'remise';

const PENALITE_TRANSITIONS: Record<string, PenaliteStatut[]> = {
  calculee: ['notifiee', 'remise', 'annulee'],
  notifiee: ['appliquee', 'contestee', 'remise', 'annulee'],
  contestee: ['appliquee', 'remise', 'annulee'],
  appliquee: [],
  annulee: [],
  remise: [],
};

export function assertPenaliteTransition(current: string, next: string): PenaliteStatut {
  const allowed = PENALITE_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next as PenaliteStatut)) {
    throw new BtpTransitionError(`Pénalité ${current} → ${next}: transition impossible`);
  }
  return next as PenaliteStatut;
}

export type CautionStatut = 'en_attente' | 'active' | 'expiree' | 'liberee' | 'saisie' | 'annulee';

const CAUTION_TRANSITIONS: Record<string, CautionStatut[]> = {
  en_attente: ['active', 'annulee'],
  active: ['expiree', 'liberee', 'saisie', 'annulee'],
  expiree: ['liberee', 'annulee'],
  liberee: [],
  saisie: [],
  annulee: [],
};

export function assertCautionTransition(current: string, next: string): CautionStatut {
  const allowed = CAUTION_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next as CautionStatut)) {
    throw new BtpTransitionError(`Caution ${current} → ${next}: transition impossible`);
  }
  return next as CautionStatut;
}

export type DecompteStatut = 'draft' | 'submitted' | 'validated' | 'paid';

const DECOMPTE_TRANSITIONS: Record<string, DecompteStatut[]> = {
  draft: ['submitted', 'validated'],
  submitted: ['validated', 'draft'],
  validated: ['paid', 'draft'],
  paid: [],
};

export function assertDecompteTransition(current: string, next: string): DecompteStatut {
  const allowed = DECOMPTE_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next as DecompteStatut)) {
    throw new BtpTransitionError(`Décompte ${current} → ${next}: transition impossible`);
  }
  return next as DecompteStatut;
}
