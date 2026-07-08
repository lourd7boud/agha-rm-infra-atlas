/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🧮 PriceRevisionEngine v2 - Generic & Data-Driven
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📌 الغرض: حساب مراجعة الأثمنة في الصفقات العمومية
 * 📌 المبدأ: Generic - لا يفترض أسماء أو عدد المؤشرات
 * 📌 التصميم: Data-driven - كل شيء يأتي من قاعدة البيانات
 * 
 * 🔒 EXCEL COMPLIANCE:
 *    - Coefficient: TRUNC(x, 4) - القطع وليس التقريب
 *    - Montant révision: TRUNC(x, 2)
 *    - مطابق لـ: =TRUNC((0.15+0.2*(At/At0)+0.25*(Cs/Cs0)+...)-1, 4)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Decimal from 'decimal.js';

// ═══════════════════════════════════════════════════════════════════════════
// 📊 GENERIC TYPES - لا أسماء ثابتة
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مؤشرات شهر - ديناميكية تماماً
 * المفتاح = اسم المؤشر (أي اسم)
 * القيمة = قيمة المؤشر
 * 
 * مثال 1: { "At": 306.7, "Cs": 134.6, "Mc1": 106.0, "S": 97.0 }
 * مثال 2: { "Salaires": 120.5, "Ciment": 98.3, "Acier": 115.2 }
 * مثال 3: { "INS_A": 105, "INS_B": 110, "INS_C": 95, "INS_D": 102, "INS_E": 108 }
 */
export type IndexValues = Record<string, number>;

/**
 * صيغة المراجعة - ديناميكية تماماً
 */
export interface RevisionFormula {
  /** معرف الصيغة */
  id?: number | string;
  /** اسم الصيغة */
  name: string;
  /** وصف الصيغة */
  description?: string;
  /** الجزء الثابت (مثل 0.15) */
  fixedPart: number;
  /**
   * أوزان المؤشرات (coefficients)
   * المفتاح = اسم المؤشر
   * القيمة = الوزن
   * 
   * مثال: { "At": 0.25, "Cs": 0.25, "Mc1": 0.25, "S": 0.10 }
   */
  weights: Record<string, number>;
}

/**
 * مؤشرات الأساس (Époque de base) - ديناميكية
 * نفس بنية IndexValues
 */
export type BaseIndexes = IndexValues;

/**
 * مؤشرات شهر مع تاريخ
 */
export interface MonthlyIndexRecord {
  /** تاريخ الشهر (أول يوم) */
  monthDate: Date;
  /** مفتاح الشهر YYYY-MM */
  monthKey: string;
  /** قيم المؤشرات */
  indexes: IndexValues;
  /** مصدر البيانات */
  source?: string;
}

/**
 * إعدادات المراجعة للمشروع
 */
export interface ProjectRevisionConfig {
  /** معرف المشروع */
  projectId: string;
  /** الصيغة المستخدمة */
  formula: RevisionFormula;
  /** مؤشرات الأساس */
  baseIndexes: BaseIndexes;
  /** تاريخ الأساس */
  baseDate?: Date;
  /** هل المراجعة مفعّلة */
  isEnabled: boolean;
  /** ملاحظات */
  notes?: string;
}

/**
 * تفاصيل شهر في فترة الديكونت
 */
export interface MonthDetail {
  month: string;
  days: number;
  coefficient: number;
  contribution: number;
  /** تفاصيل حساب المعامل */
  calculationBreakdown?: {
    fixedPart: number;
    indexContributions: Record<string, {
      weight: number;
      currentValue: number;
      baseValue: number;
      ratio: number;
      contribution: number;
    }>;
    sum: number;
    coefficient: number;
  };
}

/**
 * نتيجة حساب المعامل
 */
export interface CoefficientResult {
  internal: Decimal;
  display: number;
  /** تفاصيل الحساب للتدقيق */
  breakdown?: {
    fixedPart: number;
    indexContributions: Record<string, {
      weight: number;
      currentValue: number;
      baseValue: number;
      ratio: number;
      contribution: number;
    }>;
    sum: number;
  };
}

/**
 * نتيجة حساب المعامل الموزون
 */
export interface WeightedCoefficientResult {
  internal: Decimal;
  display: number;
  totalDays: number;
  details: MonthDetail[];
}

/**
 * نتيجة حساب مبلغ المراجعة
 */
export interface RevisionAmountResult {
  internal: Decimal;
  display: number;
}

/**
 * نتيجة كاملة لمراجعة ديكونت
 */
export interface DecomptRevisionResult {
  periodStart: Date;
  periodEnd: Date;
  montantAReviser: number;
  coefficientApplique: CoefficientResult;
  montantRevision: RevisionAmountResult;
  calculationDetails: WeightedCoefficientResult;
  /** الصيغة المستخدمة */
  formulaUsed: RevisionFormula;
  /** مؤشرات الأساس المستخدمة */
  baseIndexesUsed: BaseIndexes;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function toDecimal(value: number | string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value || 0);
}

export function round(value: Decimal | number, decimals: number = 4): number {
  const d = toDecimal(value);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
}

export function trunc(value: Decimal | number, decimals: number = 2): number {
  const d = toDecimal(value);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toNumber();
}

export function dateToMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

export function monthKeyToDate(monthKey: string): Date {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function getDaysInMonthForPeriod(
  monthKey: string,
  periodStart: Date,
  periodEnd: Date
): number {
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  
  const effectiveStart = periodStart > monthStart ? periodStart : monthStart;
  const effectiveEnd = periodEnd < monthEnd ? periodEnd : monthEnd;
  
  if (effectiveStart > effectiveEnd) return 0;
  
  return Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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

// ═══════════════════════════════════════════════════════════════════════════
// 🧮 GENERIC CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * حساب معامل الشهر - Generic
 * 
 * الصيغة العامة:
 * C = [fixedPart + Σ(weight_i × (currentIndex_i / baseIndex_i))] - 1
 * 
 * يعمل مع أي عدد من المؤشرات وأي أسماء
 * 
 * @param currentIndexes مؤشرات الشهر الحالي
 * @param baseIndexes مؤشرات الأساس
 * @param formula الصيغة
 * @param includeBreakdown تضمين تفاصيل الحساب
 */
export function calculateMonthCoefficient(
  currentIndexes: IndexValues,
  baseIndexes: BaseIndexes,
  formula: RevisionFormula,
  includeBreakdown: boolean = false
): CoefficientResult {
  // البدء بالجزء الثابت
  let sum = toDecimal(formula.fixedPart);
  
  // تفاصيل الحساب (اختياري)
  const breakdown: CoefficientResult['breakdown'] = includeBreakdown ? {
    fixedPart: formula.fixedPart,
    indexContributions: {},
    sum: 0
  } : undefined;
  
  // حساب مساهمة كل مؤشر بشكل ديناميكي
  // 🔧 مطابق لـ Excel: TRUNC على كل نسبة أولاً، ثم الضرب في الوزن
  for (const [indexName, weight] of Object.entries(formula.weights)) {
    const currentValue = currentIndexes[indexName];
    const baseValue = baseIndexes[indexName];
    
    // تخطي إذا لم يتوفر المؤشر
    if (currentValue === undefined || currentValue === null ||
        baseValue === undefined || baseValue === null || baseValue === 0) {
      continue;
    }
    
    // حساب النسبة
    const ratioRaw = toDecimal(currentValue).dividedBy(toDecimal(baseValue));
    
    // 🔧 TRUNC على النسبة أولاً (4 أرقام) - مطابق لـ Excel
    // Excel: =TRUNC(At/At0, 4)
    const ratioTruncated = trunc(ratioRaw, 4);
    
    // ثم الضرب في الوزن
    const contribution = toDecimal(weight).times(toDecimal(ratioTruncated));
    sum = sum.plus(contribution);
    
    // تسجيل التفاصيل
    if (breakdown) {
      breakdown.indexContributions[indexName] = {
        weight,
        currentValue,
        baseValue,
        ratio: ratioTruncated, // النسبة بعد القطع
        contribution: contribution.toNumber()
      };
    }
  }
  
  // طرح 1 للحصول على المعامل
  const coefficient = sum.minus(1);
  
  if (breakdown) {
    breakdown.sum = sum.toNumber();
  }
  
  // 🔧 TRUNC (القطع) وليس ROUND - مطابق لـ Excel
  return {
    internal: coefficient,
    display: trunc(coefficient, 4),
    breakdown
  };
}

/**
 * حساب المعامل الموزون للفترة - Generic
 */
export function calculateWeightedCoefficient(
  periodStart: Date,
  periodEnd: Date,
  monthlyCoefficients: Map<string, number>
): WeightedCoefficientResult {
  const months = getMonthsInPeriod(periodStart, periodEnd);
  const details: MonthDetail[] = [];
  
  let totalDays = 0;
  let weightedSum = toDecimal(0);
  
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
        contribution: contribution.toNumber()
      });
    }
  }
  
  const weightedCoefficient = totalDays > 0 
    ? weightedSum.dividedBy(totalDays)
    : toDecimal(0);
  
  // 🔧 TRUNC (القطع) وليس ROUND - مطابق لـ Excel
  return {
    internal: weightedCoefficient,
    display: trunc(weightedCoefficient, 4),
    totalDays,
    details
  };
}

/**
 * حساب مبلغ المراجعة
 */
export function calculateRevisionAmount(
  montantAReviser: number,
  coefficientApplique: Decimal | number
): RevisionAmountResult {
  const montant = toDecimal(montantAReviser);
  const coef = toDecimal(coefficientApplique);
  const revision = montant.times(coef);
  
  return {
    internal: revision,
    display: trunc(revision, 2)
  };
}

/**
 * حساب كامل لمراجعة ديكونت - Generic
 */
export function calculateDecomptRevision(
  montantAReviser: number,
  periodStart: Date,
  periodEnd: Date,
  baseIndexes: BaseIndexes,
  monthlyIndexes: Map<string, IndexValues>,
  formula: RevisionFormula
): DecomptRevisionResult {
  // 1. حساب معامل كل شهر
  const monthlyCoefficients = new Map<string, number>();
  const months = getMonthsInPeriod(periodStart, periodEnd);
  
  for (const monthKey of months) {
    const indexes = monthlyIndexes.get(monthKey);
    if (indexes) {
      const coef = calculateMonthCoefficient(indexes, baseIndexes, formula);
      monthlyCoefficients.set(monthKey, coef.display);
    }
  }
  
  // 2. حساب المعامل الموزون
  const weightedResult = calculateWeightedCoefficient(
    periodStart,
    periodEnd,
    monthlyCoefficients
  );
  
  // 3. حساب مبلغ المراجعة
  const revisionResult = calculateRevisionAmount(
    montantAReviser,
    weightedResult.internal
  );
  
  return {
    periodStart,
    periodEnd,
    montantAReviser,
    coefficientApplique: {
      internal: weightedResult.internal,
      display: weightedResult.display
    },
    montantRevision: revisionResult,
    calculationDetails: weightedResult,
    formulaUsed: formula,
    baseIndexesUsed: baseIndexes
  };
}

/**
 * حساب المجموع التراكمي
 */
export function calculateTotalRevision(
  revisions: RevisionAmountResult[]
): RevisionAmountResult {
  let total = toDecimal(0);
  for (const rev of revisions) {
    total = total.plus(rev.internal);
  }
  return {
    internal: total,
    display: trunc(total, 2)
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * التحقق من صحة الصيغة (مجموع الأوزان + الثابت = 1)
 */
export function validateFormula(formula: RevisionFormula): {
  valid: boolean;
  total: number;
  message?: string;
} {
  const weightsSum = Object.values(formula.weights).reduce((sum, w) => sum + w, 0);
  const total = formula.fixedPart + weightsSum;
  const valid = Math.abs(total - 1) < 0.0001;
  
  return {
    valid,
    total,
    message: valid ? undefined : `مجموع الصيغة = ${total.toFixed(4)} (يجب أن يكون 1.0000)`
  };
}

/**
 * التحقق من توفر جميع المؤشرات المطلوبة
 */
export function validateIndexes(
  indexes: IndexValues,
  formula: RevisionFormula
): {
  valid: boolean;
  missing: string[];
  message?: string;
} {
  const missing: string[] = [];
  
  for (const indexName of Object.keys(formula.weights)) {
    if (indexes[indexName] === undefined || indexes[indexName] === null) {
      missing.push(indexName);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
    message: missing.length > 0 ? `مؤشرات ناقصة: ${missing.join(', ')}` : undefined
  };
}

/**
 * الحصول على قائمة المؤشرات المطلوبة من الصيغة
 */
export function getRequiredIndexNames(formula: RevisionFormula): string[] {
  return Object.keys(formula.weights);
}

// ═══════════════════════════════════════════════════════════════════════════
// 📦 SAMPLE FORMULAS (أمثلة - ليست ثابتة)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * أمثلة على صيغ مختلفة (للاختبار فقط)
 */
export const SAMPLE_FORMULAS = {
  /**
   * صيغة BTP معتادة - 4 مؤشرات
   */
  btpStandard: {
    name: 'Formule BTP Standard',
    description: 'P = P0 × [0.15 + 0.20(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.15(S/S0)]',
    fixedPart: 0.15,
    weights: {
      At: 0.20,
      Cs: 0.25,
      Mc1: 0.25,
      S: 0.15
    }
  } as RevisionFormula,

  /**
   * صيغة مع 3 مؤشرات فقط
   */
  threeIndexes: {
    name: 'Formule 3 Index',
    description: 'صيغة بسيطة بـ 3 مؤشرات',
    fixedPart: 0.20,
    weights: {
      Salaires: 0.35,
      Materiaux: 0.30,
      Energie: 0.15
    }
  } as RevisionFormula,

  /**
   * صيغة مع 6 مؤشرات
   */
  sixIndexes: {
    name: 'Formule 6 Index',
    description: 'صيغة موسعة بـ 6 مؤشرات',
    fixedPart: 0.10,
    weights: {
      INS_Salaires: 0.20,
      INS_Ciment: 0.15,
      INS_Acier: 0.15,
      INS_Bois: 0.15,
      INS_Carburant: 0.10,
      INS_Transport: 0.15
    }
  } as RevisionFormula,

  /**
   * صيغة Variante (من Excel)
   */
  variant1: {
    name: 'Formule Variante 1',
    description: 'P = P0 × [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.10(S/S0)]',
    fixedPart: 0.15,
    weights: {
      At: 0.25,
      Cs: 0.25,
      Mc1: 0.25,
      S: 0.10
    }
  } as RevisionFormula
};

// ═══════════════════════════════════════════════════════════════════════════
// 📊 DEBUG & LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * طباعة تفاصيل الحساب للتدقيق
 */
export function logCalculationDetails(
  result: DecomptRevisionResult,
  verbose: boolean = false
): void {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 PRICE REVISION CALCULATION (Generic Engine v2)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📝 Formula: ${result.formulaUsed.name}`);
  console.log(`📝 Indexes: ${Object.keys(result.formulaUsed.weights).join(', ')}`);
  console.log(`📅 Period: ${result.periodStart.toISOString().split('T')[0]} → ${result.periodEnd.toISOString().split('T')[0]}`);
  console.log(`💰 Montant à réviser: ${result.montantAReviser.toLocaleString('fr-FR')}`);
  console.log('───────────────────────────────────────────────────────────');
  
  if (verbose) {
    console.log('📆 Monthly Details:');
    for (const detail of result.calculationDetails.details) {
      console.log(`   ${detail.month}: ${detail.days} days × ${detail.coefficient.toFixed(4)} = ${detail.contribution.toFixed(6)}`);
    }
    console.log('───────────────────────────────────────────────────────────');
  }
  
  console.log(`📊 Total Days: ${result.calculationDetails.totalDays}`);
  console.log(`📈 Coefficient: ${result.coefficientApplique.display.toFixed(4)}`);
  console.log(`💵 Montant révision: ${result.montantRevision.display.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════');
}
