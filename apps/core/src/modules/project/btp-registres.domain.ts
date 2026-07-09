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
  dateArret: string; // ISO date
  dateReprise?: string | null;
  motif?: string | null;
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

function diffDays(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

function addMonthsFractional(base: Date, months: number): Date {
  const whole = Math.trunc(months);
  const fraction = months - whole;
  const result = new Date(base);
  result.setMonth(result.getMonth() + whole);
  // Source app used integer months; fractional délais map to 30-day months.
  return fraction ? addDays(result, Math.round(fraction * 30)) : result;
}

/** DelaisPage.calculateDelaiInfo — OSC + délai (mois×30) + arrêts. */
export function computeDelaiInfo(params: {
  ordreServiceDate: Date | null;
  delaiMois: number | null;
  arrets: ArretTravaux[];
  receptionProvisoire: Date | null;
  receptionDefinitive: Date | null;
  today?: Date;
}): DelaiInfo {
  const { ordreServiceDate, delaiMois, arrets, receptionProvisoire, receptionDefinitive } = params;
  const today = params.today ?? new Date();

  let joursArret = 0;
  let enArret = false;
  for (const arret of arrets ?? []) {
    if (!arret?.dateArret) continue;
    if (arret.dateReprise) {
      joursArret += Math.max(0, diffDays(new Date(arret.dateReprise), new Date(arret.dateArret)));
    } else {
      enArret = true;
    }
  }

  if (!ordreServiceDate || !delaiMois) {
    return {
      delaiJours: delaiMois ? Math.round(delaiMois * 30) : 0,
      joursArret,
      delaiTotal: (delaiMois ? Math.round(delaiMois * 30) : 0) + joursArret,
      dateFinInitiale: null,
      dateFinEffective: null,
      joursEcoules: 0,
      joursRestants: 0,
      pourcentage: 0,
      status: 'unknown',
      enArret,
    };
  }

  const delaiJours = Math.round(delaiMois * 30);
  const dateFinInitiale = addMonthsFractional(ordreServiceDate, delaiMois);
  const dateFinEffective = addDays(dateFinInitiale, joursArret);
  const joursEcoules = diffDays(today, ordreServiceDate);
  const joursRestants = diffDays(dateFinEffective, today);
  const delaiTotal = delaiJours + joursArret;
  const pourcentage =
    delaiTotal > 0 ? Math.min(100, Math.max(0, (joursEcoules / delaiTotal) * 100)) : 0;

  let status: DelaiStatus = 'normal';
  if (receptionProvisoire || receptionDefinitive) status = 'completed';
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
