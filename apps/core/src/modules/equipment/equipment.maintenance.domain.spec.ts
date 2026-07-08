import { describe, expect, test } from 'vitest';
import {
  assertWorkOrderTransition,
  currentMeterValue,
  documentExpiryStatus,
  EQUIPMENT_DOCUMENT_TYPES,
  METER_UNITS,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  WorkOrderTransitionError,
} from './equipment.maintenance.domain';

const TODAY = new Date('2026-07-08T00:00:00Z');

describe('documentExpiryStatus', () => {
  test('returns "permanent" when the document has no expiry date', () => {
    expect(documentExpiryStatus(undefined, TODAY)).toBe('permanent');
  });

  test('returns "expire" when the expiry date is in the past', () => {
    expect(documentExpiryStatus(new Date('2026-07-07T00:00:00Z'), TODAY)).toBe(
      'expire',
    );
  });

  test('returns "expire_bientot" when expiry falls inside the 30-day window', () => {
    expect(documentExpiryStatus(new Date('2026-07-20T00:00:00Z'), TODAY)).toBe(
      'expire_bientot',
    );
  });

  test('treats an expiry that is exactly today as "expire_bientot"', () => {
    expect(documentExpiryStatus(new Date('2026-07-08T00:00:00Z'), TODAY)).toBe(
      'expire_bientot',
    );
  });

  test('returns "valide" when expiry is beyond the warning window', () => {
    expect(documentExpiryStatus(new Date('2026-12-31T00:00:00Z'), TODAY)).toBe(
      'valide',
    );
  });
});

describe('currentMeterValue', () => {
  test('returns null when there are no readings', () => {
    expect(currentMeterValue([])).toBeNull();
  });

  test('returns the value of the latest reading by reading date', () => {
    const readings = [
      {
        value: 1200,
        readingDate: new Date('2026-05-01'),
        createdAt: new Date('2026-05-01'),
      },
      {
        value: 1500,
        readingDate: new Date('2026-07-01'),
        createdAt: new Date('2026-07-01'),
      },
      {
        value: 1350,
        readingDate: new Date('2026-06-01'),
        createdAt: new Date('2026-06-01'),
      },
    ];
    expect(currentMeterValue(readings)).toBe(1500);
  });

  test('breaks a same-date tie by created order — the latest entry wins', () => {
    const readings = [
      {
        value: 800,
        readingDate: new Date('2026-07-01'),
        createdAt: new Date('2026-07-01T08:00:00Z'),
      },
      {
        value: 810,
        readingDate: new Date('2026-07-01'),
        createdAt: new Date('2026-07-01T18:00:00Z'),
      },
    ];
    expect(currentMeterValue(readings)).toBe(810);
  });
});

describe('assertWorkOrderTransition', () => {
  test('allows ouvert → en_cours', () => {
    expect(() => assertWorkOrderTransition('ouvert', 'en_cours')).not.toThrow();
  });

  test('allows en_cours → clos', () => {
    expect(() => assertWorkOrderTransition('en_cours', 'clos')).not.toThrow();
  });

  test('rejects reopening a closed work order', () => {
    expect(() => assertWorkOrderTransition('clos', 'en_cours')).toThrow(
      WorkOrderTransitionError,
    );
  });

  test('rejects a no-op transition to the same status', () => {
    expect(() => assertWorkOrderTransition('ouvert', 'ouvert')).toThrow(
      WorkOrderTransitionError,
    );
  });
});

describe('domain constants', () => {
  test('document types include the Moroccan compliance set', () => {
    expect(EQUIPMENT_DOCUMENT_TYPES).toContain('assurance');
    expect(EQUIPMENT_DOCUMENT_TYPES).toContain('carte_grise');
    expect(EQUIPMENT_DOCUMENT_TYPES).toContain('controle_technique');
  });

  test('meter units are heures and km', () => {
    expect(METER_UNITS).toEqual(['heures', 'km']);
  });

  test('work-order types and statuses expose the lifecycle vocabulary', () => {
    expect(WORK_ORDER_TYPES).toEqual(['preventif', 'correctif']);
    expect(WORK_ORDER_STATUSES).toEqual(['ouvert', 'en_cours', 'clos']);
  });
});
