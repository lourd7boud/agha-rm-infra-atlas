import { describe, expect, test } from 'vitest';
import {
  WORKING_DAYS_PER_MONTH,
  computeAssignmentDues,
  computeProjectLabor,
  effectiveDailyRate,
  type AssignmentWithDays,
} from './labor.domain';

describe('effectiveDailyRate', () => {
  test('returns the amount as-is for a daily rate', () => {
    // Arrange / Act
    const rate = effectiveDailyRate('jour', 350);

    // Assert
    expect(rate).toBe(350);
  });

  test('divides a monthly rate by the working-days convention', () => {
    // Arrange — 7800 MAD / month over 26 jours ouvrables.
    // Act
    const rate = effectiveDailyRate('mois', 7800);

    // Assert
    expect(rate).toBe(7800 / WORKING_DAYS_PER_MONTH);
    expect(rate).toBe(300);
  });

  test('returns 0 when the rate amount is missing', () => {
    // Arrange / Act / Assert
    expect(effectiveDailyRate('jour', null)).toBe(0);
    expect(effectiveDailyRate('jour', 0)).toBe(0);
    expect(effectiveDailyRate(null, 350)).toBe(0);
  });
});

describe('computeAssignmentDues', () => {
  test('multiplies total days by the daily rate', () => {
    // Arrange / Act
    const dues = computeAssignmentDues({
      rateType: 'jour',
      rateAmountMad: 350,
      totalDays: 20,
    });

    // Assert
    expect(dues).toBe(7000);
  });

  test('handles half-days against a monthly rate', () => {
    // Arrange — 7800/26 = 300 daily, 10.5 days worked.
    // Act
    const dues = computeAssignmentDues({
      rateType: 'mois',
      rateAmountMad: 7800,
      totalDays: 10.5,
    });

    // Assert
    expect(dues).toBe(3150);
  });

  test('yields 0 dues when the rate is missing', () => {
    // Arrange / Act
    const dues = computeAssignmentDues({ totalDays: 15 });

    // Assert
    expect(dues).toBe(0);
  });
});

describe('computeProjectLabor', () => {
  test('rolls up per-worker dues plus the project grand totals', () => {
    // Arrange — a jour worker, a mois worker, and one with no rate set.
    const assignments: AssignmentWithDays[] = [
      {
        employeeId: 'emp-1',
        fullName: 'Mohamed',
        metier: 'maçon',
        rateType: 'jour',
        rateAmountMad: 350,
        totalDays: 20,
      },
      {
        employeeId: 'emp-2',
        fullName: 'Youssef',
        metier: 'chef de chantier',
        rateType: 'mois',
        rateAmountMad: 7800,
        totalDays: 26,
      },
      {
        employeeId: 'emp-3',
        fullName: 'Said',
        metier: 'manœuvre',
        totalDays: 5,
      },
    ];

    // Act
    const labor = computeProjectLabor(assignments);

    // Assert — 7000 + 7800 + 0 dues; 51 days; rate-less worker still listed.
    expect(labor.lines).toHaveLength(3);
    expect(labor.lines[0]?.duesMad).toBe(7000);
    expect(labor.lines[1]?.duesMad).toBe(7800);
    expect(labor.lines[2]?.duesMad).toBe(0);
    expect(labor.totalDays).toBe(51);
    expect(labor.totalDuesMad).toBe(14_800);
  });

  test('returns empty totals for no assignments', () => {
    // Arrange / Act
    const labor = computeProjectLabor([]);

    // Assert
    expect(labor.lines).toEqual([]);
    expect(labor.totalDays).toBe(0);
    expect(labor.totalDuesMad).toBe(0);
  });
});
