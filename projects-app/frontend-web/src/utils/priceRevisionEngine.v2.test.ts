/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🧪 Unit Tests - PriceRevisionEngine v2 (Generic)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 📌 يختبر أن المحرك يعمل مع أي عدد وأسماء مؤشرات
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, test, expect } from 'vitest';
import {
  round,
  trunc,
  dateToMonthKey,
  monthKeyToDate,
  calculateMonthCoefficient,
  calculateRevisionAmount,
  calculateDecomptRevision,
  validateFormula,
  validateIndexes,
  getRequiredIndexNames,
  SAMPLE_FORMULAS,
  RevisionFormula,
  IndexValues,
  BaseIndexes
} from './priceRevisionEngine.v2';

// ═══════════════════════════════════════════════════════════════════════════
// 📊 TEST DATA - صيغ مختلفة
// ═══════════════════════════════════════════════════════════════════════════

/**
 * صيغة 1: 4 مؤشرات (من Excel الأصلي)
 */
const FORMULA_4_INDEXES: RevisionFormula = {
  name: 'Test Formula 4 Index',
  fixedPart: 0.15,
  weights: {
    At: 0.25,
    Cs: 0.25,
    Mc1: 0.25,
    S: 0.10
  }
};

const BASE_4_INDEXES: BaseIndexes = {
  At: 299.6,
  Cs: 134.7,
  Mc1: 100.0,
  S: 100.0
};

const MONTH_4_INDEXES: IndexValues = {
  At: 306.7,
  Cs: 134.6,
  Mc1: 106.0,
  S: 97.0
};

/**
 * صيغة 2: 3 مؤشرات بأسماء مختلفة
 */
const FORMULA_3_INDEXES: RevisionFormula = {
  name: 'Test Formula 3 Index',
  fixedPart: 0.20,
  weights: {
    Salaires: 0.35,
    Materiaux: 0.30,
    Energie: 0.15
  }
};

const BASE_3_INDEXES: BaseIndexes = {
  Salaires: 100.0,
  Materiaux: 100.0,
  Energie: 100.0
};

const MONTH_3_INDEXES: IndexValues = {
  Salaires: 105.0,
  Materiaux: 108.0,
  Energie: 112.0
};

/**
 * صيغة 3: 6 مؤشرات
 */
const FORMULA_6_INDEXES: RevisionFormula = {
  name: 'Test Formula 6 Index',
  fixedPart: 0.10,
  weights: {
    Index_A: 0.20,
    Index_B: 0.15,
    Index_C: 0.15,
    Index_D: 0.15,
    Index_E: 0.10,
    Index_F: 0.15
  }
};

const BASE_6_INDEXES: BaseIndexes = {
  Index_A: 100,
  Index_B: 100,
  Index_C: 100,
  Index_D: 100,
  Index_E: 100,
  Index_F: 100
};

const MONTH_6_INDEXES: IndexValues = {
  Index_A: 110,
  Index_B: 105,
  Index_C: 102,
  Index_D: 108,
  Index_E: 95,
  Index_F: 103
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: GENERIC ENGINE - صيغ مختلفة
// ═══════════════════════════════════════════════════════════════════════════

describe('Generic Engine - Multiple Formulas', () => {
  
  describe('4 Index Formula (Excel Compatible)', () => {
    test('coefficient calculation matches Excel', () => {
      const result = calculateMonthCoefficient(
        MONTH_4_INDEXES,
        BASE_4_INDEXES,
        FORMULA_4_INDEXES
      );
      // Aug 2024 from Excel = 0.0177
      expect(result.display).toBe(0.0177);
    });

    test('validates formula correctly', () => {
      const validation = validateFormula(FORMULA_4_INDEXES);
      expect(validation.valid).toBe(true);
      expect(validation.total).toBeCloseTo(1.0, 4);
    });

    test('identifies required indexes', () => {
      const required = getRequiredIndexNames(FORMULA_4_INDEXES);
      expect(required).toEqual(['At', 'Cs', 'Mc1', 'S']);
    });
  });

  describe('3 Index Formula (Custom Names)', () => {
    test('coefficient calculation works with 3 indexes', () => {
      const result = calculateMonthCoefficient(
        MONTH_3_INDEXES,
        BASE_3_INDEXES,
        FORMULA_3_INDEXES
      );
      // C = [0.20 + 0.35(105/100) + 0.30(108/100) + 0.15(112/100)] - 1
      // C = [0.20 + 0.3675 + 0.324 + 0.168] - 1 = 1.0595 - 1 = 0.0595
      expect(result.display).toBe(0.0595);
    });

    test('validates formula correctly', () => {
      const validation = validateFormula(FORMULA_3_INDEXES);
      expect(validation.valid).toBe(true);
    });

    test('identifies required indexes', () => {
      const required = getRequiredIndexNames(FORMULA_3_INDEXES);
      expect(required).toEqual(['Salaires', 'Materiaux', 'Energie']);
    });

    test('detects missing indexes', () => {
      const incompleteIndexes = {
        Salaires: 105.0,
        Materiaux: 108.0
        // Energie missing
      };
      const validation = validateIndexes(incompleteIndexes, FORMULA_3_INDEXES);
      expect(validation.valid).toBe(false);
      expect(validation.missing).toContain('Energie');
    });
  });

  describe('6 Index Formula', () => {
    test('coefficient calculation works with 6 indexes', () => {
      const result = calculateMonthCoefficient(
        MONTH_6_INDEXES,
        BASE_6_INDEXES,
        FORMULA_6_INDEXES
      );
      // C = [0.10 + 0.20(1.10) + 0.15(1.05) + 0.15(1.02) + 0.15(1.08) + 0.10(0.95) + 0.15(1.03)] - 1
      // C = [0.10 + 0.22 + 0.1575 + 0.153 + 0.162 + 0.095 + 0.1545] - 1 = 1.042 - 1 = 0.042
      expect(result.display).toBe(0.042);
    });

    test('validates formula correctly', () => {
      const validation = validateFormula(FORMULA_6_INDEXES);
      expect(validation.valid).toBe(true);
    });

    test('identifies all 6 required indexes', () => {
      const required = getRequiredIndexNames(FORMULA_6_INDEXES);
      expect(required).toHaveLength(6);
      expect(required).toContain('Index_A');
      expect(required).toContain('Index_F');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: CALCULATION BREAKDOWN
// ═══════════════════════════════════════════════════════════════════════════

describe('Calculation Breakdown (Audit Trail)', () => {
  test('provides detailed breakdown when requested', () => {
    const result = calculateMonthCoefficient(
      MONTH_4_INDEXES,
      BASE_4_INDEXES,
      FORMULA_4_INDEXES,
      true // includeBreakdown
    );

    expect(result.breakdown).toBeDefined();
    expect(result.breakdown!.fixedPart).toBe(0.15);
    expect(result.breakdown!.indexContributions).toHaveProperty('At');
    expect(result.breakdown!.indexContributions).toHaveProperty('Cs');
    expect(result.breakdown!.indexContributions).toHaveProperty('Mc1');
    expect(result.breakdown!.indexContributions).toHaveProperty('S');
  });

  test('breakdown shows correct ratios', () => {
    const result = calculateMonthCoefficient(
      MONTH_4_INDEXES,
      BASE_4_INDEXES,
      FORMULA_4_INDEXES,
      true
    );

    const atContrib = result.breakdown!.indexContributions['At'];
    expect(atContrib.currentValue).toBe(306.7);
    expect(atContrib.baseValue).toBe(299.6);
    expect(atContrib.ratio).toBeCloseTo(1.0237, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: FORMULA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Formula Validation', () => {
  test('valid formula (sum = 1)', () => {
    const validation = validateFormula(SAMPLE_FORMULAS.btpStandard);
    expect(validation.valid).toBe(true);
  });

  test('invalid formula (sum > 1)', () => {
    const invalidFormula: RevisionFormula = {
      name: 'Invalid',
      fixedPart: 0.20,
      weights: { A: 0.50, B: 0.50 } // 0.20 + 0.50 + 0.50 = 1.20
    };
    const validation = validateFormula(invalidFormula);
    expect(validation.valid).toBe(false);
    expect(validation.total).toBeCloseTo(1.20, 2);
    expect(validation.message).toBeDefined();
  });

  test('invalid formula (sum < 1)', () => {
    const invalidFormula: RevisionFormula = {
      name: 'Invalid',
      fixedPart: 0.10,
      weights: { A: 0.20, B: 0.20 } // 0.10 + 0.20 + 0.20 = 0.50
    };
    const validation = validateFormula(invalidFormula);
    expect(validation.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: REVISION AMOUNT
// ═══════════════════════════════════════════════════════════════════════════

describe('Revision Amount Calculation', () => {
  test('calculates correctly with TRUNC', () => {
    const result = calculateRevisionAmount(100000, 0.0177);
    expect(result.display).toBe(1770.00);
  });

  test('TRUNC not ROUND', () => {
    const result = calculateRevisionAmount(123456.78, 0.0177);
    // 123456.78 × 0.0177 = 2185.18...
    expect(result.display).toBe(2185.18);
  });

  test('handles negative coefficient', () => {
    const result = calculateRevisionAmount(100000, -0.0200);
    expect(result.display).toBe(-2000.00);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: FULL DECOMPT CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Decompt Calculation', () => {
  test('works with 4 index formula', () => {
    const monthlyIndexes = new Map<string, IndexValues>([
      ['2024-08', MONTH_4_INDEXES],
      ['2024-09', MONTH_4_INDEXES]
    ]);

    const result = calculateDecomptRevision(
      1000000,
      new Date(2024, 7, 1),
      new Date(2024, 8, 30),
      BASE_4_INDEXES,
      monthlyIndexes,
      FORMULA_4_INDEXES
    );

    expect(result.coefficientApplique.display).toBe(0.0177);
    expect(result.montantRevision.display).toBe(17700.00);
    expect(result.formulaUsed.name).toBe('Test Formula 4 Index');
  });

  test('works with 3 index formula', () => {
    const monthlyIndexes = new Map<string, IndexValues>([
      ['2024-08', MONTH_3_INDEXES],
      ['2024-09', MONTH_3_INDEXES]
    ]);

    const result = calculateDecomptRevision(
      500000,
      new Date(2024, 7, 1),
      new Date(2024, 8, 30),
      BASE_3_INDEXES,
      monthlyIndexes,
      FORMULA_3_INDEXES
    );

    expect(result.coefficientApplique.display).toBe(0.0595);
    expect(result.montantRevision.display).toBe(29750.00);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: SAMPLE FORMULAS
// ═══════════════════════════════════════════════════════════════════════════

describe('Sample Formulas', () => {
  test('all sample formulas are valid', () => {
    for (const [, formula] of Object.entries(SAMPLE_FORMULAS)) {
      const validation = validateFormula(formula);
      expect(validation.valid).toBe(true);
    }
  });

  test('btpStandard has 4 indexes', () => {
    expect(getRequiredIndexNames(SAMPLE_FORMULAS.btpStandard)).toHaveLength(4);
  });

  test('threeIndexes has 3 indexes', () => {
    expect(getRequiredIndexNames(SAMPLE_FORMULAS.threeIndexes)).toHaveLength(3);
  });

  test('sixIndexes has 6 indexes', () => {
    expect(getRequiredIndexNames(SAMPLE_FORMULAS.sixIndexes)).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Utility Functions', () => {
  test('round to 4 decimals', () => {
    expect(round(0.01775, 4)).toBe(0.0178);
    expect(round(0.01774, 4)).toBe(0.0177);
  });

  test('trunc to 2 decimals', () => {
    expect(trunc(1234.569, 2)).toBe(1234.56);
    expect(trunc(1234.561, 2)).toBe(1234.56);
  });

  test('dateToMonthKey', () => {
    expect(dateToMonthKey(new Date(2024, 7, 15))).toBe('2024-08');
  });

  test('monthKeyToDate', () => {
    const date = monthKeyToDate('2024-08');
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(7); // 0-indexed
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🧪 TEST: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('handles missing index gracefully', () => {
    const incompleteIndexes = {
      At: 306.7,
      Cs: 134.6
      // Mc1 and S missing
    };
    
    // Should not throw, just skip missing indexes
    const result = calculateMonthCoefficient(
      incompleteIndexes,
      BASE_4_INDEXES,
      FORMULA_4_INDEXES
    );
    
    // Will have partial coefficient (only At and Cs contribute)
    expect(result.display).toBeDefined();
  });

  test('handles zero base index', () => {
    const zeroBase = {
      At: 0, // Zero base - should be skipped
      Cs: 134.7,
      Mc1: 100,
      S: 100
    };
    
    const result = calculateMonthCoefficient(
      MONTH_4_INDEXES,
      zeroBase,
      FORMULA_4_INDEXES
    );
    
    // Should not throw
    expect(result.display).toBeDefined();
  });

  test('empty formula weights', () => {
    const emptyFormula: RevisionFormula = {
      name: 'Empty',
      fixedPart: 1.0,
      weights: {}
    };
    
    const result = calculateMonthCoefficient(
      MONTH_4_INDEXES,
      BASE_4_INDEXES,
      emptyFormula
    );
    
    // C = 1.0 - 1 = 0
    expect(result.display).toBe(0);
  });
});
