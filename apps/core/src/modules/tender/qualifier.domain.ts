import type { TenderProcedure } from '@atlas/contracts';
import { buildBackPlan } from './tender.domain';

export interface CompanyProfile {
  /** Procedures the company bids on. */
  procedures: readonly TenderProcedure[];
  /** Max caution provisoire the treasury can immobilize per bid (MAD). */
  maxCautionMad: number;
  /** Ceiling on tender estimation given current classification (MAD). */
  maxEstimationMad: number;
  /** Unaccented lowercase keywords describing our activity domains. */
  domainKeywords: readonly string[];
}

export interface QualifierInput {
  reference: string;
  procedure: TenderProcedure;
  objet: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: Date;
}

export interface RuleOutcome {
  rule: string;
  pass: boolean;
  detail: string;
}

export interface QualificationResult {
  verdict: 'qualified' | 'rejected';
  checkedAt: string;
  rules: readonly RuleOutcome[];
}

/** Accent-insensitive lowercase normalization for French text matching. */
export function normalizeFr(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function checkProcedure(input: QualifierInput, profile: CompanyProfile): RuleOutcome {
  const pass = profile.procedures.includes(input.procedure);
  return {
    rule: 'procedure',
    pass,
    detail: pass
      ? `Procédure ${input.procedure} dans le périmètre`
      : `Procédure ${input.procedure} hors périmètre de l'entreprise`,
  };
}

function checkCaution(input: QualifierInput, profile: CompanyProfile): RuleOutcome {
  if (input.cautionProvisoireMad === undefined) {
    return {
      rule: 'caution',
      pass: true,
      detail: 'Caution provisoire non publiée — à vérifier au DCE',
    };
  }
  const pass = input.cautionProvisoireMad <= profile.maxCautionMad;
  return {
    rule: 'caution',
    pass,
    detail: pass
      ? `Caution ${input.cautionProvisoireMad.toLocaleString('fr-MA')} MAD supportable`
      : `Caution ${input.cautionProvisoireMad.toLocaleString('fr-MA')} MAD au-delà de la capacité (${profile.maxCautionMad.toLocaleString('fr-MA')} MAD)`,
  };
}

function checkEstimation(input: QualifierInput, profile: CompanyProfile): RuleOutcome {
  if (input.estimationMad === undefined) {
    return {
      rule: 'estimation',
      pass: true,
      detail: 'Estimation non publiée — à vérifier au DCE',
    };
  }
  const pass = input.estimationMad <= profile.maxEstimationMad;
  return {
    rule: 'estimation',
    pass,
    detail: pass
      ? `Estimation ${input.estimationMad.toLocaleString('fr-MA')} MAD dans le plafond de classification`
      : `Estimation ${input.estimationMad.toLocaleString('fr-MA')} MAD au-delà du plafond (${profile.maxEstimationMad.toLocaleString('fr-MA')} MAD)`,
  };
}

function checkRunway(input: QualifierInput, today: Date): RuleOutcome {
  const plan = buildBackPlan(input.deadlineAt, today);
  return {
    rule: 'delai',
    pass: plan.feasible,
    detail: plan.feasible
      ? `${plan.daysAvailable} jours de préparation disponibles${plan.compressed ? ' (planning compressé)' : ''}`
      : `Délai insuffisant (${plan.daysAvailable} jours) pour préparer un dossier conforme`,
  };
}

function checkDomain(input: QualifierInput, profile: CompanyProfile): RuleOutcome {
  const objet = normalizeFr(input.objet);
  const matched = profile.domainKeywords.filter((keyword) => objet.includes(keyword));
  const pass = matched.length > 0;
  return {
    rule: 'domaine',
    pass,
    detail: pass
      ? `Objet aligné avec nos métiers (${matched.slice(0, 3).join(', ')})`
      : "Objet hors des métiers de l'entreprise",
  };
}

/**
 * Eliminatory qualification (agent A3): every rule must pass.
 * Missing published data never rejects — it flags verification work instead.
 */
export function qualify(
  input: QualifierInput,
  profile: CompanyProfile,
  today: Date,
): QualificationResult {
  const rules: readonly RuleOutcome[] = [
    checkProcedure(input, profile),
    checkCaution(input, profile),
    checkEstimation(input, profile),
    checkRunway(input, today),
    checkDomain(input, profile),
  ];
  return {
    verdict: rules.every((rule) => rule.pass) ? 'qualified' : 'rejected',
    checkedAt: today.toISOString(),
    rules,
  };
}
