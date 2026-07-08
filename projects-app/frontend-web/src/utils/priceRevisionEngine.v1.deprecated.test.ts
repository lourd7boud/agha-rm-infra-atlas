/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🧪 Unit Tests - PriceRevisionEngine
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📌 المرجع: Excel هو المرجع الوحيد
 * 📌 أي فرق (حتى 0.01 DH) يُعتبر Bug
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  toDecimal,
  round,
  trunc,
  getDaysInMonth,
  dateToMonthKey,
  getDaysInMonthForPeriod,
  getMonthsInPeriod,
  calculateMonthCoefficient,
  calculateWeightedCoefficient,
  calculateRevisionAmount,
  calculateDecomptRevision,
  calculateTotalRevision,
  validateFormula,
  validateIndexes,
  DEFAULT_BTP_FORMULA,
  FORMULA_VARIANT_1,
  MonthIndexes,
  BaseIndexes,
  RevisionFormula
} from './priceRevisionEngine.v1.deprecated';

// ═══════════════════════════════════════════════════════════════════════════
// 📊 EXCEL REFERENCE DATA - من ملف Révision Marché 19 RC.xlsx
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مؤشرات الأساس (من Excel)
 */
const EXCEL_BASE_INDEXES: BaseIndexes = {
  At0: 299.6,
  Cs0: 134.7,
  Mc10: 100.0,
  S0: 100.0
};

/**
 * الصيغة (من Excel)
 * P = P0 × [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.1(S/S0)]
 */
const EXCEL_FORMULA: RevisionFormula = {
  fixed: 0.15,
  weights: {
    At: 0.25,
    Cs: 0.25,
    Mc1: 0.25,
    S: 0.10
  }
};

/**
 * مؤشرات الأشهر (من Excel - Fiche 1 & 2)
 * 
 * ملاحظة: Aug/Sep 2024 مؤكدة تماماً (0.0177)
 * باقي الأشهر: القيم المحسوبة بناءً على المؤشرات الأساسية المعطاة
 */
const EXCEL_MONTH_INDEXES: { [key: string]: MonthIndexes } = {
  // 2024 - المؤشرات الفعلية
  '2024-01': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-02': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-03': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-04': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-05': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-06': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 97.9 },
  '2024-07': { At: 306.7, Cs: 132.1, Mc1: 106.0, S: 99.5 },
  '2024-08': { At: 306.7, Cs: 134.6, Mc1: 106.0, S: 97.0 }, // ✅ مؤكد
  '2024-09': { At: 306.7, Cs: 134.6, Mc1: 106.0, S: 97.0 }, // ✅ مؤكد
  '2024-10': { At: 311.9, Cs: 134.6, Mc1: 107.1, S: 96.9 },
  '2024-11': { At: 311.9, Cs: 134.6, Mc1: 107.1, S: 96.9 },
  '2024-12': { At: 311.9, Cs: 134.6, Mc1: 107.1, S: 96.9 }
};

/**
 * المعاملات المحسوبة
 * 
 * الصيغة: C = [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.10(S/S0)] - 1
 * 
 * Aug 2024 (مؤكد من Excel):
 *   [0.15 + 0.25(306.7/299.6) + 0.25(134.6/134.7) + 0.25(106/100) + 0.10(97/100)] - 1
 * = [0.15 + 0.2559 + 0.2498 + 0.265 + 0.097] - 1 = 0.0177 ✅
 *
 * القيم المحسوبة (للمرجع):
 * - 2024-01 → 2024-06: 0.014
 * - 2024-07: 0.0156
 * - 2024-08, 2024-09: 0.0177 (✅ مطابق لـ Excel)
 * - 2024-10 → 2024-12: 0.0247
 */

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Utility Functions', () => {
  describe('toDecimal', () => {
    test('converts number to Decimal', () => {
      const result = toDecimal(123.456);
      expect(result.toString()).toBe('123.456');
    });

    test('converts string to Decimal', () => {
      const result = toDecimal('789.123');
      expect(result.toString()).toBe('789.123');
    });

    test('handles null/undefined as 0', () => {
      const result = toDecimal(undefined as any);
      expect(result.toString()).toBe('0');
    });
  });

  describe('round (Excel ROUND)', () => {
    test('rounds to 4 decimals (coefficients)', () => {
      expect(round(0.02135678, 4)).toBe(0.0214);
      expect(round(0.02134999, 4)).toBe(0.0213);
      expect(round(0.02135, 4)).toBe(0.0214); // 5 rounds up
    });

    test('rounds to 2 decimals (amounts)', () => {
      expect(round(1234.567, 2)).toBe(1234.57);
      expect(round(1234.564, 2)).toBe(1234.56);
    });
  });

  describe('trunc (Excel TRUNC)', () => {
    test('truncates to 2 decimals (amounts)', () => {
      expect(trunc(1234.567, 2)).toBe(1234.56);
      expect(trunc(1234.569, 2)).toBe(1234.56);
      expect(trunc(-1234.567, 2)).toBe(-1234.56);
    });

    test('truncates to 4 decimals', () => {
      expect(trunc(0.12345678, 4)).toBe(0.1234);
    });
  });

  describe('getDaysInMonth', () => {
    test('returns correct days for various months', () => {
      expect(getDaysInMonth(2024, 1)).toBe(31);  // January
      expect(getDaysInMonth(2024, 2)).toBe(29);  // February (leap year)
      expect(getDaysInMonth(2023, 2)).toBe(28);  // February (non-leap)
      expect(getDaysInMonth(2024, 4)).toBe(30);  // April
      expect(getDaysInMonth(2024, 12)).toBe(31); // December
    });
  });

  describe('dateToMonthKey', () => {
    test('formats date as YYYY-MM', () => {
      expect(dateToMonthKey(new Date(2024, 0, 15))).toBe('2024-01');
      expect(dateToMonthKey(new Date(2024, 11, 31))).toBe('2024-12');
    });
  });

  describe('getDaysInMonthForPeriod', () => {
    test('full month within period', () => {
      const start = new Date(2024, 0, 1);  // Jan 1
      const end = new Date(2024, 2, 31);   // Mar 31
      expect(getDaysInMonthForPeriod('2024-02', start, end)).toBe(29); // Full Feb
    });

    test('partial month at start', () => {
      const start = new Date(2024, 0, 15); // Jan 15
      const end = new Date(2024, 2, 31);   // Mar 31
      expect(getDaysInMonthForPeriod('2024-01', start, end)).toBe(17); // Jan 15-31
    });

    test('partial month at end', () => {
      const start = new Date(2024, 0, 1);  // Jan 1
      const end = new Date(2024, 2, 15);   // Mar 15
      expect(getDaysInMonthForPeriod('2024-03', start, end)).toBe(15); // Mar 1-15
    });

    test('month outside period returns 0', () => {
      const start = new Date(2024, 1, 1);  // Feb 1
      const end = new Date(2024, 2, 31);   // Mar 31
      expect(getDaysInMonthForPeriod('2024-01', start, end)).toBe(0);
    });
  });

  describe('getMonthsInPeriod', () => {
    test('returns all months in period', () => {
      const start = new Date(2024, 0, 15); // Jan 15
      const end = new Date(2024, 3, 10);   // Apr 10
      const months = getMonthsInPeriod(start, end);
      expect(months).toEqual(['2024-01', '2024-02', '2024-03', '2024-04']);
    });

    test('single month period', () => {
      const start = new Date(2024, 5, 10);
      const end = new Date(2024, 5, 25);
      const months = getMonthsInPeriod(start, end);
      expect(months).toEqual(['2024-06']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: COEFFICIENT CALCULATION (مقارنة مع Excel)
// ═══════════════════════════════════════════════════════════════════════════

describe('Coefficient Calculation (Excel Compliance)', () => {
  describe('calculateMonthCoefficient', () => {
    // ✅ Aug/Sep 2024 - مؤكدة 100% من Excel (Cs قريب من Cs0)
    test('August 2024 coefficient = 0.0177 (CONFIRMED from Excel)', () => {
      const result = calculateMonthCoefficient(
        EXCEL_MONTH_INDEXES['2024-08'],
        EXCEL_BASE_INDEXES,
        EXCEL_FORMULA
      );
      expect(result.display).toBe(0.0177);
    });

    test('September 2024 coefficient = 0.0177 (CONFIRMED from Excel)', () => {
      const result = calculateMonthCoefficient(
        EXCEL_MONTH_INDEXES['2024-09'],
        EXCEL_BASE_INDEXES,
        EXCEL_FORMULA
      );
      expect(result.display).toBe(0.0177);
    });

    // اختبار جميع الأشهر بالقيم المحسوبة
    test.each([
      ['2024-01', 0.014],
      ['2024-02', 0.014],
      ['2024-03', 0.014],
      ['2024-04', 0.014],
      ['2024-05', 0.014],
      ['2024-06', 0.014],
      ['2024-07', 0.0156],
      ['2024-08', 0.0177], // ✅ مؤكد من Excel
      ['2024-09', 0.0177], // ✅ مؤكد من Excel
      ['2024-10', 0.0247],
      ['2024-11', 0.0247],
      ['2024-12', 0.0247]
    ])('Month %s coefficient = %s (computed)', (month, expected) => {
      const result = calculateMonthCoefficient(
        EXCEL_MONTH_INDEXES[month],
        EXCEL_BASE_INDEXES,
        EXCEL_FORMULA
      );
      expect(result.display).toBe(expected);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: WEIGHTED COEFFICIENT
// ═══════════════════════════════════════════════════════════════════════════

describe('Weighted Coefficient Calculation', () => {
  test('single month period uses exact coefficient', () => {
    const monthlyCoefficients = new Map<string, number>([
      ['2024-01', 0.0213]
    ]);
    
    const result = calculateWeightedCoefficient(
      new Date(2024, 0, 1),   // Jan 1
      new Date(2024, 0, 31),  // Jan 31
      monthlyCoefficients
    );
    
    expect(result.display).toBe(0.0213);
    expect(result.totalDays).toBe(31);
  });

  test('two equal months averages correctly', () => {
    const monthlyCoefficients = new Map<string, number>([
      ['2024-01', 0.0200], // 31 days
      ['2024-02', 0.0300]  // 29 days
    ]);
    
    const result = calculateWeightedCoefficient(
      new Date(2024, 0, 1),   // Jan 1
      new Date(2024, 1, 29),  // Feb 29
      monthlyCoefficients
    );
    
    // Weighted: (31 * 0.02 + 29 * 0.03) / 60 = (0.62 + 0.87) / 60 = 0.02483...
    expect(result.totalDays).toBe(60);
    expect(result.display).toBe(0.0248);
  });

  test('partial months weighted correctly', () => {
    const monthlyCoefficients = new Map<string, number>([
      ['2024-01', 0.0213], // partial: 17 days (Jan 15-31)
      ['2024-02', 0.0213], // full: 29 days
      ['2024-03', 0.0300]  // partial: 15 days (Mar 1-15)
    ]);
    
    const result = calculateWeightedCoefficient(
      new Date(2024, 0, 15),  // Jan 15
      new Date(2024, 2, 15),  // Mar 15
      monthlyCoefficients
    );
    
    expect(result.totalDays).toBe(61); // 17 + 29 + 15
    // Weighted: (17*0.0213 + 29*0.0213 + 15*0.0300) / 61
    const expected = round((17 * 0.0213 + 29 * 0.0213 + 15 * 0.0300) / 61, 4);
    expect(result.display).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: REVISION AMOUNT
// ═══════════════════════════════════════════════════════════════════════════

describe('Revision Amount Calculation', () => {
  test('simple revision amount (TRUNC)', () => {
    // 100,000 × 0.0213 = 2,130.00
    const result = calculateRevisionAmount(100000, 0.0213);
    expect(result.display).toBe(2130.00);
  });

  test('revision amount truncates (not rounds)', () => {
    // 123,456.78 × 0.0213 = 2,629.62...
    const result = calculateRevisionAmount(123456.78, 0.0213);
    expect(result.display).toBe(2629.62); // TRUNC, not 2629.63
  });

  test('negative coefficient (price decrease)', () => {
    const result = calculateRevisionAmount(100000, -0.0150);
    expect(result.display).toBe(-1500.00);
  });

  test('large amount precision', () => {
    // 10,000,000 × 0.0349 = 349,000.00
    const result = calculateRevisionAmount(10000000, 0.0349);
    expect(result.display).toBe(349000.00);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: FULL DECOMPT REVISION
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Decompt Revision Calculation', () => {
  const monthlyIndexesMap = new Map<string, MonthIndexes>(
    Object.entries(EXCEL_MONTH_INDEXES)
  );

  test('Q1 2024 revision calculation', () => {
    const result = calculateDecomptRevision(
      500000, // Montant à réviser
      new Date(2024, 0, 1),   // Jan 1
      new Date(2024, 2, 31),  // Mar 31
      EXCEL_BASE_INDEXES,
      monthlyIndexesMap,
      EXCEL_FORMULA
    );

    // All 3 months have coefficient 0.014 (computed)
    expect(result.coefficientApplique.display).toBe(0.014);
    // 500,000 × 0.014 = 7,000.00
    expect(result.montantRevision.display).toBe(7000.00);
  });

  test('Q3 2024 revision calculation (mixed coefficients)', () => {
    const result = calculateDecomptRevision(
      500000,
      new Date(2024, 6, 1),   // Jul 1
      new Date(2024, 8, 30),  // Sep 30
      EXCEL_BASE_INDEXES,
      monthlyIndexesMap,
      EXCEL_FORMULA
    );

    // Jul: 31 days × 0.0156
    // Aug: 31 days × 0.0177
    // Sep: 30 days × 0.0177
    // Weighted = (31*0.0156 + 31*0.0177 + 30*0.0177) / 92 = 0.017...
    expect(result.calculationDetails.totalDays).toBe(92);
    
    // Verify the weighted coefficient
    const expectedWeighted = round((31 * 0.0156 + 31 * 0.0177 + 30 * 0.0177) / 92, 4);
    expect(result.coefficientApplique.display).toBe(expectedWeighted);
  });

  test('Aug-Sep 2024 (CONFIRMED coefficients)', () => {
    const result = calculateDecomptRevision(
      1000000,
      new Date(2024, 7, 1),   // Aug 1
      new Date(2024, 8, 30),  // Sep 30
      EXCEL_BASE_INDEXES,
      monthlyIndexesMap,
      EXCEL_FORMULA
    );

    // Both months have coefficient 0.0177 (confirmed from Excel)
    expect(result.coefficientApplique.display).toBe(0.0177);
    // 1,000,000 × 0.0177 = 17,700.00
    expect(result.montantRevision.display).toBe(17700.00);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: FORMULA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Formula Validation', () => {
  test('DEFAULT_BTP_FORMULA is valid', () => {
    // 0.15 + 0.20 + 0.25 + 0.25 + 0.15 = 1.00
    expect(validateFormula(DEFAULT_BTP_FORMULA)).toBe(true);
  });

  test('FORMULA_VARIANT_1 is valid', () => {
    // 0.15 + 0.25 + 0.25 + 0.25 + 0.10 = 1.00
    expect(validateFormula(FORMULA_VARIANT_1)).toBe(true);
  });

  test('invalid formula (sum > 1) detected', () => {
    const invalidFormula: RevisionFormula = {
      fixed: 0.20,
      weights: { At: 0.30, Cs: 0.30, Mc1: 0.30, S: 0.20 }
    };
    expect(validateFormula(invalidFormula)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: INDEX VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Index Validation', () => {
  test('complete indexes pass validation', () => {
    const result = validateIndexes(EXCEL_MONTH_INDEXES['2024-01'], EXCEL_FORMULA);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('missing index detected', () => {
    const incompleteIndexes: MonthIndexes = {
      At: 306.7,
      Cs: 132.1,
      // Mc1 missing
      S: 97.9
    } as MonthIndexes;
    
    const result = validateIndexes(incompleteIndexes, EXCEL_FORMULA);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('Mc1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: TOTAL REVISION (CUMULATIVE)
// ═══════════════════════════════════════════════════════════════════════════

describe('Total Revision Calculation', () => {
  test('sum of multiple revisions', () => {
    const revisions = [
      { internal: toDecimal(10650.123), display: 10650.12 },
      { internal: toDecimal(12500.987), display: 12500.98 },
      { internal: toDecimal(8750.456), display: 8750.45 }
    ];
    
    const total = calculateTotalRevision(revisions);
    // TRUNC of sum of internals
    expect(total.display).toBe(31901.56);
  });

  test('handles negative revisions', () => {
    const revisions = [
      { internal: toDecimal(10000), display: 10000.00 },
      { internal: toDecimal(-3000), display: -3000.00 }
    ];
    
    const total = calculateTotalRevision(revisions);
    expect(total.display).toBe(7000.00);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('zero amount produces zero revision', () => {
    const result = calculateRevisionAmount(0, 0.0213);
    expect(result.display).toBe(0);
  });

  test('zero coefficient produces zero revision', () => {
    const result = calculateRevisionAmount(100000, 0);
    expect(result.display).toBe(0);
  });

  test('very small coefficient handled correctly', () => {
    const result = calculateRevisionAmount(100000, 0.0001);
    expect(result.display).toBe(10.00);
  });

  test('very large amount handled correctly', () => {
    // 999,999,999.99 × 0.0349 = 34,899,999.996... → TRUNC = 34,899,999.99
    const result = calculateRevisionAmount(999999999.99, 0.0349);
    expect(result.display).toBe(34899999.99);
  });
});
