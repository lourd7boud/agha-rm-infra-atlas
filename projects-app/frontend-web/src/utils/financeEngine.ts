/**
 * ============================================================
 * 🔒 FINANCE ENGINE - المرجع الوحيد للحسابات المالية
 * ============================================================
 * 
 * ⚠️ EXCEL COMPLIANCE - قواعد صارمة لا تقبل النقاش:
 * 
 * 1️⃣ الميتري (METRE):
 *    - Total Partiel يُحسب بدقة كاملة ثم يُخزن مقرباً (ROUND_HALF_UP, 2)
 *    - هذه القيمة المخزنة هي المرجع الوحيد
 * 
 * 2️⃣ الديكونت (Lignes):
 *    - Quantité = القيمة المخزنة من الميتري (مثل 74.38)
 *    - Montant HT = Quantité × Prix (بدون تقريب!)
 * 
 * 3️⃣ Total HT:
 *    - internal: مجموع القيم الحقيقية (full precision)
 *    - display: ROUND(internal, 2)
 * 
 * 4️⃣ TVA:
 *    - internal: TOTAL_HT_INTERNAL × 0.20
 *    - display: TRUNC(internal, 2)
 * 
 * 5️⃣ TTC:
 *    - internal: TOTAL_HT_INTERNAL + TVA_INTERNAL
 *    - display: TRUNC(internal, 2)
 * 
 * 6️⃣ RECAP:
 *    - يستخدم القيم الداخلية (internal) وليس المعروضة (display)
 * 
 * ============================================================
 */

import Decimal from 'decimal.js';

// Re-export Decimal for external use
export { Decimal };

// ============================================================
// CONFIGURATION
// ============================================================

Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 9,
});

// ============================================================
// TYPES - بنية القيم الداخلية والمعروضة
// ============================================================

/**
 * قيمة مالية مع فصل بين الداخلي والمعروض
 */
export interface FinancialValue {
  internal: Decimal;  // القيمة الداخلية الدقيقة (للحسابات)
  display: number;    // القيمة المعروضة (للواجهة)
}

export interface LigneDecompte {
  prixNo: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  quantiteRealisee: number;  // ⚠️ هذه القيمة مخزنة مقربة من الميتري
  prixUnitaireHT: number;
}

export interface CalculatedLigne extends LigneDecompte {
  montantHT: number;         // للعرض فقط
  montantHTInternal?: Decimal; // للحسابات (optional للتوافق)
}

export interface DecompteResult {
  lignes: CalculatedLigne[];
  totalHT: number;
  montantTVA: number;
  totalTTC: number;
  // القيم الداخلية
  _internals?: {
    totalHTInternal: Decimal;
    tvaInternal: Decimal;
    ttcInternal: Decimal;
  };
  _meta: {
    calculatedAt: string;
    engine: 'financeEngine.ts';
    version: '2.0.0';
  };
}

export interface RecapInput {
  totalTTC: number;
  totalTTCInternal?: Decimal;  // ⚠️ القيمة الداخلية (الأفضل)
  tauxRetenue: number;
  decomptesPrecedents: number;
  depensesExercicesAnterieurs: number;
  isDecompteDernier: boolean;
}

export interface RecapResult {
  travauxTermines: number;
  travauxNonTermines: number;
  approvisionnements: number;
  totalAvantRetenue: number;
  retenueGarantie: number;
  resteAPayer: number;
  totalADeduire: number;
  montantAcompte: number;
  _meta: {
    calculatedAt: string;
    engine: 'financeEngine.ts';
    version: '2.0.0';
  };
}

// ============================================================
// CORE FUNCTIONS
// ============================================================

/**
 * تحويل قيمة إلى Decimal بشكل آمن
 */
export const toDecimal = (value: number | string | Decimal | null | undefined): Decimal => {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0);
  }
  if (value instanceof Decimal) {
    return value;
  }
  try {
    return new Decimal(value);
  } catch {
    console.warn('[FinanceEngine] Invalid value:', value);
    return new Decimal(0);
  }
};

/**
 * تقريب عادي لرقمين (ROUND_HALF_UP)
 * مثل Excel: =ROUND(x, 2)
 */
export const round2 = (value: Decimal): Decimal => {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
};

/**
 * قطع لرقمين (ROUND_DOWN) - بدون تقريب
 * مثل Excel: =TRUNC(x, 2)
 */
export const trunc2 = (value: Decimal): Decimal => {
  return value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
};

/**
 * تحويل Decimal إلى number للعرض
 */
export const toNumber = (value: Decimal): number => {
  return value.toNumber();
};

// ============================================================
// METRE FUNCTIONS - حسابات الميتري
// ============================================================

/**
 * حساب Partiel من القياسات
 * الصيغة: Nbre × Longueur × Largeur × Profondeur
 * ⚠️ يُخزن مقرباً ROUND_HALF_UP لرقمين
 */
export const calculatePartiel = (
  nbre: number,
  longueur: number,
  largeur: number,
  profondeur: number
): number => {
  const n = toDecimal(nbre);
  const l = toDecimal(longueur);
  const w = toDecimal(largeur);
  const p = toDecimal(profondeur);
  
  // حساب بدقة كاملة
  const partielExact = n.times(l).times(w).times(p);
  
  // تقريب للتخزين
  const partielRounded = round2(partielExact);
  
  return toNumber(partielRounded);
};

/**
 * حساب Total Partiel للميتري
 * مجموع كل الـ partiels
 * ⚠️ يُخزن مقرباً ROUND_HALF_UP لرقمين
 */
export const calculateTotalPartiel = (partiels: number[]): number => {
  const sum = partiels.reduce((acc, p) => acc.plus(toDecimal(p)), new Decimal(0));
  return toNumber(round2(sum));
};

// ============================================================
// DECOMPTE FUNCTIONS - حسابات الديكونت
// ============================================================

/**
 * حساب مبلغ HT لسطر واحد - Internal
 * الصيغة: quantiteRealisee × prixUnitaireHT
 * ⚠️ يُرجع القيمة الداخلية (بدون تقريب!)
 */
export const calculateMontantHTInternal = (
  quantiteRealisee: number,
  prixUnitaireHT: number
): Decimal => {
  const qty = toDecimal(quantiteRealisee);
  const prix = toDecimal(prixUnitaireHT);
  
  // الضرب بدقة كاملة - بدون أي تقريب!
  return qty.times(prix);
};

/**
 * حساب مبلغ HT لسطر واحد (للعرض)
 * 🔒 EXCEL: يعرض مقرباً لكن يحسب بالقيمة الداخلية
 */
export const calculateMontantHT = (
  quantiteRealisee: number,
  prixUnitaireHT: number
): number => {
  const internal = calculateMontantHTInternal(quantiteRealisee, prixUnitaireHT);
  return toNumber(round2(internal));  // للعرض فقط
};

/**
 * حساب مجموع HT لكل السطور مع Internal
 * 🔒 EXCEL: يجمع القيم الداخلية (بدون تقريب) ثم يعرض مقرباً
 */
export const calculateTotalHTWithInternal = (
  lignes: { quantiteRealisee: number; prixUnitaireHT: number }[]
): { internal: Decimal; display: number } => {
  let internal = new Decimal(0);
  
  for (const ligne of lignes) {
    // 🔒 EXCEL: نجمع القيم الداخلية بدقة كاملة
    const montantInternal = calculateMontantHTInternal(
      ligne.quantiteRealisee,
      ligne.prixUnitaireHT
    );
    internal = internal.plus(montantInternal);
  }
  
  return {
    internal,  // القيمة الداخلية للحسابات
    display: toNumber(round2(internal))  // للعرض فقط
  };
};

/**
 * للتوافق مع الكود القديم
 */
export const calculateTotalHT = (lignes: CalculatedLigne[]): number => {
  const result = calculateTotalHTWithInternal(lignes);
  return result.display;
};

/**
 * حساب TVA مع Internal
 */
export const calculateTVAWithInternal = (
  totalHTInternal: Decimal,
  tauxTVA: number
): { internal: Decimal; display: number } => {
  const taux = toDecimal(tauxTVA).dividedBy(100);
  const internal = totalHTInternal.times(taux);
  
  return {
    internal,
    display: toNumber(trunc2(internal))  // ⚠️ TRUNC
  };
};

/**
 * للتوافق مع الكود القديم
 */
export const calculateTVA = (totalHT: number, tauxTVA: number): number => {
  const result = calculateTVAWithInternal(toDecimal(totalHT), tauxTVA);
  return result.display;
};

/**
 * حساب TTC مع Internal
 * 🔒 EXCEL: TTC_Internal = HT_Internal + TVA_Display (TRUNC)
 * 🔒 EXCEL: TTC_Display = ROUND(TTC_Internal, 2) وليس TRUNC!
 */
export const calculateTTCWithInternal = (
  totalHTInternal: Decimal,
  tvaDisplay: Decimal  // ⚠️ نستقبل TVA المقطوعة وليس الداخلية
): { internal: Decimal; display: number } => {
  // 🔒 EXCEL: TTC = HT_Internal + TVA_Display
  const internal = totalHTInternal.plus(tvaDisplay);
  
  return {
    internal,
    display: toNumber(round2(internal))  // 🔒 EXCEL: ROUND for TTC display!
  };
};

/**
 * للتوافق مع الكود القديم
 */
export const calculateTTC = (totalHT: number, montantTVA: number): number => {
  const result = calculateTTCWithInternal(toDecimal(totalHT), toDecimal(montantTVA));
  return result.display;
};

// ============================================================
// MAIN DECOMPTE CALCULATION
// ============================================================

/**
 * حساب الديكونت الكامل مع القيم الداخلية
 */
export const calculateDecompteWithInternals = (
  lignes: LigneDecompte[],
  tauxTVA: number = 20
): DecompteResult => {
  // 1. حساب montantHT لكل سطر (مع الاحتفاظ بالقيمة الداخلية)
  const calculatedLignes: CalculatedLigne[] = lignes.map(ligne => {
    const montantHTInternal = calculateMontantHTInternal(
      ligne.quantiteRealisee,
      ligne.prixUnitaireHT
    );
    return {
      ...ligne,
      montantHTInternal,
      montantHT: toNumber(round2(montantHTInternal))
    };
  });

  // 2. حساب Total HT (internal + display)
  const totalHT = calculateTotalHTWithInternal(calculatedLignes);

  // 3. حساب TVA (يستخدم totalHT.internal)
  const montantTVA = calculateTVAWithInternal(totalHT.internal, tauxTVA);

  // 4. حساب TTC (يستخدم القيم الداخلية)
  const totalTTC = calculateTTCWithInternal(totalHT.internal, montantTVA.internal);

  console.log('[FINANCE ENGINE v2] Calcul avec internals:', {
    totalHT_internal: totalHT.internal.toString(),
    totalHT_display: totalHT.display,
    tva_internal: montantTVA.internal.toString(),
    tva_display: montantTVA.display,
    ttc_internal: totalTTC.internal.toString(),
    ttc_display: totalTTC.display
  });

  return {
    lignes: calculatedLignes,
    totalHT: totalHT.display,
    montantTVA: montantTVA.display,
    totalTTC: totalTTC.display,
    _internals: {
      totalHTInternal: totalHT.internal,
      tvaInternal: montantTVA.internal,
      ttcInternal: totalTTC.internal
    },
    _meta: {
      calculatedAt: new Date().toISOString(),
      engine: 'financeEngine.ts',
      version: '2.0.0',
    },
  };
};

/**
 * للتوافق مع الكود القديم
 */
export const calculateDecompte = (
  lignes: LigneDecompte[],
  tauxTVA: number = 20
) => {
  return calculateDecompteWithInternals(lignes, tauxTVA);
};

// ============================================================
// RECAP CALCULATION
// ============================================================

/**
 * حساب الريكاب (Récapitulatif) - طريقة Excel
 * ⚠️ يستخدم القيمة الداخلية لـ TTC
 */
export const calculateRecap = (input: RecapInput): RecapResult => {
  const {
    totalTTC,
    totalTTCInternal,
    tauxRetenue,
    decomptesPrecedents,
    depensesExercicesAnterieurs,
    isDecompteDernier,
  } = input;

  // استخدم القيمة الداخلية إن وجدت، وإلا القيمة العادية
  const ttcInternal = totalTTCInternal || toDecimal(totalTTC);
  
  const taux = toDecimal(tauxRetenue).dividedBy(100);
  const precedents = toDecimal(decomptesPrecedents);
  const anterieurs = toDecimal(depensesExercicesAnterieurs);

  // Travaux selon type de décompte
  let travauxTermines: Decimal;
  let travauxNonTermines: Decimal;
  
  if (isDecompteDernier) {
    travauxTermines = ttcInternal;
    travauxNonTermines = new Decimal(0);
  } else {
    travauxTermines = new Decimal(0);
    travauxNonTermines = ttcInternal;
  }

  const approvisionnements = new Decimal(0);
  const totalAvantRetenue = ttcInternal;

  // Retenue de garantie (بدون تقريب وسيط)
  const retenueGarantie = totalAvantRetenue.times(taux);
  
  // Restes = TOTAUX - Retenue
  const restes = totalAvantRetenue.minus(retenueGarantie);
  
  // Reste à payer = Restes - Exercices antérieurs
  const resteAPayer = restes.minus(anterieurs);
  
  // Total à déduire
  const totalADeduire = anterieurs.plus(precedents);
  
  // Montant de l'acompte - التقريب فقط هنا!
  const montantAcompteExact = resteAPayer.minus(precedents);
  const montantAcompte = round2(montantAcompteExact);
  
  console.log('[RECAP v2] Calcul avec internal TTC:', {
    ttcInternal: ttcInternal.toString(),
    retenueGarantie: retenueGarantie.toString(),
    restes: restes.toString(),
    resteAPayer: resteAPayer.toString(),
    precedents: precedents.toString(),
    montantAcompteExact: montantAcompteExact.toString(),
    montantAcompteFinal: montantAcompte.toString()
  });

  return {
    travauxTermines: toNumber(round2(travauxTermines)),
    travauxNonTermines: toNumber(round2(travauxNonTermines)),
    approvisionnements: toNumber(round2(approvisionnements)),
    totalAvantRetenue: toNumber(round2(totalAvantRetenue)),
    retenueGarantie: toNumber(round2(retenueGarantie)),
    resteAPayer: toNumber(round2(restes)),
    totalADeduire: toNumber(round2(totalADeduire)),
    montantAcompte: toNumber(montantAcompte),
    _meta: {
      calculatedAt: new Date().toISOString(),
      engine: 'financeEngine.ts',
      version: '2.0.0',
    },
  };
};

// ============================================================
// FORMATTING
// ============================================================

/**
 * تنسيق المبلغ للعرض
 */
export const formatMontant = (value: number | null | undefined): string => {
  const num = toDecimal(value);
  return num.toNumber().toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * تنسيق الكمية للعرض
 */
export const formatQuantite = (value: number | null | undefined): string => {
  const num = toDecimal(value);
  return num.toNumber().toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * تنسيق النسبة المئوية
 */
export const formatPercent = (value: number | null | undefined): string => {
  const num = toDecimal(value);
  return `${num.toNumber()}%`;
};

// ============================================================
// VALIDATION
// ============================================================

/**
 * مقارنة نتيجتين للتحقق من التطابق مع Excel
 */
export const validateAgainstExcel = (
  calculated: { totalHT: number; tva: number; ttc: number },
  excel: { totalHT: number; tva: number; ttc: number },
  tolerance: number = 0.01
): { valid: boolean; differences: string[] } => {
  const differences: string[] = [];
  
  if (Math.abs(calculated.totalHT - excel.totalHT) > tolerance) {
    differences.push(`Total HT: ${calculated.totalHT} vs Excel ${excel.totalHT}`);
  }
  if (Math.abs(calculated.tva - excel.tva) > tolerance) {
    differences.push(`TVA: ${calculated.tva} vs Excel ${excel.tva}`);
  }
  if (Math.abs(calculated.ttc - excel.ttc) > tolerance) {
    differences.push(`TTC: ${calculated.ttc} vs Excel ${excel.ttc}`);
  }
  
  return {
    valid: differences.length === 0,
    differences
  };
};

/**
 * Debug: afficher tous les calculs intermédiaires
 */
export const debugCalculation = (
  lignes: LigneDecompte[],
  tauxTVA: number = 20
): void => {
  console.log('='.repeat(60));
  console.log('🔍 DEBUG FINANCE ENGINE v2');
  console.log('='.repeat(60));
  
  const result = calculateDecompteWithInternals(lignes, tauxTVA);
  
  console.log('\n📊 LIGNES:');
  result.lignes.forEach((l, i) => {
    console.log(`  [${i + 1}] ${l.designation}`);
    console.log(`      Qté: ${l.quantiteRealisee} × PU: ${l.prixUnitaireHT}`);
    console.log(`      HT Internal: ${l.montantHTInternal?.toString() || 'N/A'}`);
    console.log(`      HT Display: ${l.montantHT}`);
  });
  
  console.log('\n💰 TOTAUX:');
  console.log(`  Total HT Internal: ${result._internals?.totalHTInternal.toString()}`);
  console.log(`  Total HT Display: ${result.totalHT}`);
  console.log(`  TVA Internal: ${result._internals?.tvaInternal.toString()}`);
  console.log(`  TVA Display: ${result.montantTVA}`);
  console.log(`  TTC Internal: ${result._internals?.ttcInternal.toString()}`);
  console.log(`  TTC Display: ${result.totalTTC}`);
  
  console.log('='.repeat(60));
};

// ============================================================
// 📊 RÉVISION DES PRIX - Phase 3
// ============================================================
// ⚠️ EXCEL COMPLIANCE:
// - Montant à réviser = HT de la période (non cumulatif)
// - Coefficient = calculé par priceRevisionEngine
// - Montant révision = TRUNC(Montant × Coefficient, 2)
// ============================================================

/**
 * Structure pour le calcul de révision
 */
export interface RevisionInput {
  /** HT de la période (non cumulatif) - la base à réviser */
  montantHTInternal: Decimal;
  /** Coefficient de révision (ex: 0.0177) */
  coefficient: number;
}

export interface RevisionResult {
  /** Montant de la révision (display) */
  montantRevision: number;
  /** Montant de la révision (internal) */
  montantRevisionInternal: Decimal;
  /** Nouveau Total HT après révision (display) */
  nouveauTotalHT: number;
  /** Nouveau Total HT après révision (internal) */
  nouveauTotalHTInternal: Decimal;
}

/**
 * 🔒 EXCEL: Calcule le montant de la révision des prix
 * 
 * Formule: Montant Révision = TRUNC(HT × Coefficient, 2)
 * 
 * @param input - Montant HT et coefficient
 * @returns Montant de révision et nouveau total HT
 */
export const calculateRevisionAmount = (input: RevisionInput): RevisionResult => {
  const { montantHTInternal, coefficient } = input;
  
  // 🔒 EXCEL: Calcul avec précision complète
  const coef = toDecimal(coefficient);
  const montantRevisionInternal = montantHTInternal.times(coef);
  
  // 🔒 EXCEL: TRUNC pour l'affichage
  const montantRevision = toNumber(trunc2(montantRevisionInternal));
  
  // Nouveau Total HT = HT + Révision (avec internal)
  const nouveauTotalHTInternal = montantHTInternal.plus(montantRevisionInternal);
  const nouveauTotalHT = toNumber(round2(nouveauTotalHTInternal));
  
  console.log('[REVISION] Calcul:', {
    montantHT: montantHTInternal.toString(),
    coefficient: coef.toString(),
    revisionInternal: montantRevisionInternal.toString(),
    revisionDisplay: montantRevision,
    nouveauTotalInternal: nouveauTotalHTInternal.toString(),
    nouveauTotalDisplay: nouveauTotalHT,
  });
  
  return {
    montantRevision,
    montantRevisionInternal,
    nouveauTotalHT,
    nouveauTotalHTInternal,
  };
};

/**
 * 🔒 EXCEL: Calcule TVA et TTC après révision
 * 
 * @param nouveauTotalHTInternal - Total HT après révision (internal)
 * @param tauxTVA - Taux de TVA (ex: 20)
 */
export const calculateTVATTCAfterRevision = (
  nouveauTotalHTInternal: Decimal,
  tauxTVA: number = 20
): {
  montantTVA: number;
  tvaInternal: Decimal;
  totalTTC: number;
  ttcInternal: Decimal;
} => {
  // 🔒 EXCEL: TVA = TRUNC(Nouveau HT × taux%, 2)
  const tvaResult = calculateTVAWithInternal(nouveauTotalHTInternal, tauxTVA);
  
  // 🔒 EXCEL: TTC = Nouveau HT + TVA_Display
  const ttcResult = calculateTTCWithInternal(
    nouveauTotalHTInternal, 
    toDecimal(tvaResult.display)
  );
  
  return {
    montantTVA: tvaResult.display,
    tvaInternal: tvaResult.internal,
    totalTTC: ttcResult.display,
    ttcInternal: ttcResult.internal,
  };
};
