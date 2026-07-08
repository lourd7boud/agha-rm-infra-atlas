/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🧮 PriceRevisionEngine - محرك مراجعة الأثمنة (Révision des Prix)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📌 الغرض: حساب مراجعة الأثمنة في الصفقات العمومية المغربية
 * 📌 المرجع: Excel هو المرجع الوحيد - أي فرق يُعتبر Bug
 * 📌 الحالة: Phase 1 - معزول تماماً، لا يؤثر على أي حساب موجود
 * 
 * 🔒 EXCEL COMPLIANCE:
 *    - Coefficient du mois: ROUND(x, 4)
 *    - Coefficient appliqué: ROUND(x, 4)
 *    - Montant de révision: TRUNC(x, 2)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Decimal from 'decimal.js';

// ═══════════════════════════════════════════════════════════════════════════
// 📊 TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مؤشرات الشهر (Index mensuels)
 */
export interface MonthIndexes {
  At: number;   // Index des salaires
  Cs: number;   // Index du ciment
  Mc1: number;  // Index des matériaux de construction
  S: number;    // Index du carburant
  [key: string]: number; // للمؤشرات الإضافية
}

/**
 * مؤشرات الأساس (Index de base / Époque de base)
 */
export interface BaseIndexes {
  At0: number;
  Cs0: number;
  Mc10: number;
  S0: number;
  [key: string]: number;
}

/**
 * صيغة المراجعة (Formule de révision)
 */
export interface RevisionFormula {
  /** الجزء الثابت (مثل 0.15) */
  fixed: number;
  /** أوزان المؤشرات */
  weights: {
    At: number;   // مثل 0.20
    Cs: number;   // مثل 0.25
    Mc1: number;  // مثل 0.25
    S: number;    // مثل 0.15
    [key: string]: number;
  };
}

/**
 * تفاصيل شهر في فترة الديكونت
 */
export interface MonthDetail {
  /** الشهر (YYYY-MM) */
  month: string;
  /** عدد الأيام في هذا الشهر ضمن الفترة */
  days: number;
  /** معامل الشهر */
  coefficient: number;
  /** المساهمة في المعامل الموزون (days × coefficient) */
  contribution: number;
}

/**
 * نتيجة حساب المعامل مع القيم الداخلية والعرض
 */
export interface CoefficientResult {
  /** القيمة الداخلية (Decimal دقيقة) */
  internal: Decimal;
  /** القيمة للعرض (مطابقة Excel) */
  display: number;
}

/**
 * نتيجة حساب المعامل الموزون للفترة
 */
export interface WeightedCoefficientResult {
  /** القيمة الداخلية */
  internal: Decimal;
  /** القيمة للعرض */
  display: number;
  /** مجموع الأيام */
  totalDays: number;
  /** تفاصيل كل شهر */
  details: MonthDetail[];
}

/**
 * نتيجة حساب مبلغ المراجعة
 */
export interface RevisionAmountResult {
  /** القيمة الداخلية */
  internal: Decimal;
  /** القيمة للعرض (TRUNC 2 خانات) */
  display: number;
}

/**
 * نتيجة كاملة لمراجعة ديكونت
 */
export interface DecomptRevisionResult {
  /** فترة الديكونت */
  periodStart: Date;
  periodEnd: Date;
  /** المبلغ للمراجعة (HT) */
  montantAReviser: number;
  /** المعامل المطبق */
  coefficientApplique: CoefficientResult;
  /** مبلغ المراجعة */
  montantRevision: RevisionAmountResult;
  /** تفاصيل الحساب */
  calculationDetails: WeightedCoefficientResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تحويل إلى Decimal بأمان
 */
export function toDecimal(value: number | string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value || 0);
}

/**
 * ROUND لعدد معين من الخانات العشرية
 * @param value القيمة
 * @param decimals عدد الخانات (default: 4 للمعاملات)
 */
export function round(value: Decimal | number, decimals: number = 4): number {
  const d = toDecimal(value);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * TRUNC لعدد معين من الخانات العشرية
 * @param value القيمة
 * @param decimals عدد الخانات (default: 2 للمبالغ)
 */
export function trunc(value: Decimal | number, decimals: number = 2): number {
  const d = toDecimal(value);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toNumber();
}

/**
 * حساب عدد الأيام في شهر معين
 */
export function getDaysInMonth(year: number, month: number): number {
  // month is 1-indexed (1 = January)
  return new Date(year, month, 0).getDate();
}

/**
 * تحويل تاريخ إلى مفتاح الشهر (YYYY-MM)
 */
export function dateToMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * حساب عدد الأيام في شهر معين ضمن فترة محددة
 */
export function getDaysInMonthForPeriod(
  monthKey: string,
  periodStart: Date,
  periodEnd: Date
): number {
  const [year, month] = monthKey.split('-').map(Number);
  
  // أول يوم في الشهر
  const monthStart = new Date(year, month - 1, 1);
  // آخر يوم في الشهر
  const monthEnd = new Date(year, month, 0);
  
  // حساب التقاطع بين الشهر والفترة
  const effectiveStart = periodStart > monthStart ? periodStart : monthStart;
  const effectiveEnd = periodEnd < monthEnd ? periodEnd : monthEnd;
  
  // إذا لم يكن هناك تقاطع
  if (effectiveStart > effectiveEnd) {
    return 0;
  }
  
  // حساب عدد الأيام (نضيف 1 لأن الحدود inclusive)
  const days = Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  return days;
}

/**
 * الحصول على قائمة الأشهر في فترة معينة
 */
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
// 🧮 CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * حساب معامل الشهر (Coefficient du mois)
 * 
 * الصيغة:
 * C = [fixed + Σ(weight_i × (Index_i / Index_i0))] - 1
 * 
 * مثال (الصيغة المعتادة):
 * C = [0.15 + 0.2(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.15(S/S0)] - 1
 * 
 * @param monthIndexes مؤشرات الشهر الحالي
 * @param baseIndexes مؤشرات الأساس (Époque de base)
 * @param formula صيغة المراجعة
 * @returns المعامل (internal + display)
 */
export function calculateMonthCoefficient(
  monthIndexes: MonthIndexes,
  baseIndexes: BaseIndexes,
  formula: RevisionFormula
): CoefficientResult {
  // البدء بالجزء الثابت
  let sum = toDecimal(formula.fixed);
  
  // حساب كل مكون
  // At
  if (formula.weights.At && baseIndexes.At0) {
    const ratio = toDecimal(monthIndexes.At).dividedBy(toDecimal(baseIndexes.At0));
    sum = sum.plus(toDecimal(formula.weights.At).times(ratio));
  }
  
  // Cs
  if (formula.weights.Cs && baseIndexes.Cs0) {
    const ratio = toDecimal(monthIndexes.Cs).dividedBy(toDecimal(baseIndexes.Cs0));
    sum = sum.plus(toDecimal(formula.weights.Cs).times(ratio));
  }
  
  // Mc1
  if (formula.weights.Mc1 && baseIndexes.Mc10) {
    const ratio = toDecimal(monthIndexes.Mc1).dividedBy(toDecimal(baseIndexes.Mc10));
    sum = sum.plus(toDecimal(formula.weights.Mc1).times(ratio));
  }
  
  // S
  if (formula.weights.S && baseIndexes.S0) {
    const ratio = toDecimal(monthIndexes.S).dividedBy(toDecimal(baseIndexes.S0));
    sum = sum.plus(toDecimal(formula.weights.S).times(ratio));
  }
  
  // طرح 1 للحصول على المعامل
  const coefficient = sum.minus(1);
  
  return {
    internal: coefficient,
    display: round(coefficient, 4) // ROUND 4 خانات مثل Excel
  };
}

/**
 * حساب المعامل الموزون للفترة (Coefficient appliqué)
 * 
 * المعامل الموزون = Σ(أيام_الشهر × معامل_الشهر) / مجموع_الأيام
 * 
 * @param periodStart بداية الفترة
 * @param periodEnd نهاية الفترة
 * @param monthlyCoefficients معاملات الأشهر (Map<monthKey, coefficient>)
 * @returns المعامل الموزون مع التفاصيل
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
  
  // حساب المعامل الموزون
  const weightedCoefficient = totalDays > 0 
    ? weightedSum.dividedBy(totalDays)
    : toDecimal(0);
  
  return {
    internal: weightedCoefficient,
    display: round(weightedCoefficient, 4), // ROUND 4 خانات مثل Excel
    totalDays,
    details
  };
}

/**
 * حساب مبلغ المراجعة (Montant de la révision des prix)
 * 
 * Montant de la révision = Montant à réviser × Coefficient appliqué
 * 
 * @param montantAReviser المبلغ للمراجعة (HT)
 * @param coefficientApplique المعامل المطبق
 * @returns مبلغ المراجعة
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
    display: trunc(revision, 2) // TRUNC 2 خانات مثل Excel
  };
}

/**
 * حساب كامل لمراجعة ديكونت
 * 
 * @param montantAReviser المبلغ للمراجعة (HT للفترة)
 * @param periodStart بداية الفترة
 * @param periodEnd نهاية الفترة
 * @param baseIndexes مؤشرات الأساس
 * @param monthlyIndexes مؤشرات الأشهر (Map<monthKey, MonthIndexes>)
 * @param formula صيغة المراجعة
 * @returns نتيجة كاملة
 */
export function calculateDecomptRevision(
  montantAReviser: number,
  periodStart: Date,
  periodEnd: Date,
  baseIndexes: BaseIndexes,
  monthlyIndexes: Map<string, MonthIndexes>,
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
    calculationDetails: weightedResult
  };
}

/**
 * حساب المجموع التراكمي لمراجعات عدة ديكونتات
 * 
 * @param revisions نتائج مراجعات الديكونتات
 * @returns المجموع (TRUNC 2 خانات)
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
// 📦 DEFAULT FORMULA (الصيغة المعتادة في المغرب)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الصيغة المعتادة للمراجعة في صفقات BTP
 * P = P0 × [0.15 + 0.2(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.15(S/S0)]
 */
export const DEFAULT_BTP_FORMULA: RevisionFormula = {
  fixed: 0.15,
  weights: {
    At: 0.20,
    Cs: 0.25,
    Mc1: 0.25,
    S: 0.15
  }
};

/**
 * صيغة بديلة (من الملف المرفق)
 * P = P0 × [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.1(S/S0)]
 */
export const FORMULA_VARIANT_1: RevisionFormula = {
  fixed: 0.15,
  weights: {
    At: 0.25,
    Cs: 0.25,
    Mc1: 0.25,
    S: 0.10
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * التحقق من صحة الصيغة (مجموع الأوزان = 1 - fixed)
 */
export function validateFormula(formula: RevisionFormula): boolean {
  const weightsSum = Object.values(formula.weights).reduce((sum, w) => sum + w, 0);
  const total = formula.fixed + weightsSum;
  // يجب أن يكون المجموع = 1 (مع هامش صغير للأخطاء العائمة)
  return Math.abs(total - 1) < 0.0001;
}

/**
 * التحقق من توفر جميع المؤشرات المطلوبة
 */
export function validateIndexes(
  indexes: MonthIndexes,
  formula: RevisionFormula
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  for (const key of Object.keys(formula.weights)) {
    if (indexes[key] === undefined || indexes[key] === null) {
      missing.push(key);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 LOG للتحقق من التطابق مع Excel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * طباعة تفاصيل الحساب للمقارنة مع Excel
 */
export function logCalculationDetails(result: DecomptRevisionResult): void {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 PRICE REVISION CALCULATION DETAILS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📅 Period: ${result.periodStart.toISOString().split('T')[0]} → ${result.periodEnd.toISOString().split('T')[0]}`);
  console.log(`💰 Montant à réviser: ${result.montantAReviser.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('📆 Monthly Details:');
  for (const detail of result.calculationDetails.details) {
    console.log(`   ${detail.month}: ${detail.days} days × ${detail.coefficient.toFixed(4)} = ${detail.contribution.toFixed(6)}`);
  }
  console.log('───────────────────────────────────────────────────────────');
  console.log(`📊 Total Days: ${result.calculationDetails.totalDays}`);
  console.log(`📈 Coefficient appliqué (internal): ${result.coefficientApplique.internal.toString()}`);
  console.log(`📈 Coefficient appliqué (display): ${result.coefficientApplique.display.toFixed(4)}`);
  console.log(`💵 Montant révision (internal): ${result.montantRevision.internal.toString()}`);
  console.log(`💵 Montant révision (display): ${result.montantRevision.display.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════');
}
