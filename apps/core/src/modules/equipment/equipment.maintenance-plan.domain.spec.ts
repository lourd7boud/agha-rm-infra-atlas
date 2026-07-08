import { describe, expect, test } from 'vitest';
import {
  MAINTENANCE_DAYS_WARN,
  MAINTENANCE_TRIGGER_TYPES,
  maintenancePlanDue,
} from './equipment.maintenance.domain';

const TODAY = new Date('2026-07-08T00:00:00Z');

describe('maintenancePlanDue — meter trigger', () => {
  const base = {
    triggerType: 'meter' as const,
    intervalMeter: 250,
    lastServiceMeter: 1000,
  };

  test('is "a_jour" while the current meter is well below the next due', () => {
    const r = maintenancePlanDue(base, 1100, TODAY);
    expect(r.status).toBe('a_jour');
    expect(r.nextDueMeter).toBe(1250);
    expect(r.remainingMeter).toBe(150);
  });

  test('is "bientot" once the current meter is within the warning band', () => {
    // warn band = 10% of 250 = 25; remaining 20 → bientot
    const r = maintenancePlanDue(base, 1230, TODAY);
    expect(r.status).toBe('bientot');
    expect(r.remainingMeter).toBe(20);
  });

  test('is "en_retard" once the current meter reaches/passes the next due', () => {
    const r = maintenancePlanDue(base, 1300, TODAY);
    expect(r.status).toBe('en_retard');
    expect(r.remainingMeter).toBe(-50);
  });

  test('is "a_jour" with a null remaining when the machine has no reading yet', () => {
    const r = maintenancePlanDue(base, null, TODAY);
    expect(r.status).toBe('a_jour');
    expect(r.remainingMeter).toBeNull();
    expect(r.nextDueMeter).toBe(1250);
  });
});

describe('maintenancePlanDue — time trigger', () => {
  test('is "a_jour" when the next service date is far off', () => {
    const r = maintenancePlanDue(
      {
        triggerType: 'temps',
        intervalDays: 90,
        lastServiceDate: new Date('2026-06-01'),
      },
      null,
      TODAY,
    );
    expect(r.status).toBe('a_jour');
    expect(r.nextDueDate).toEqual(new Date('2026-08-30'));
    expect(r.remainingDays).toBe(53);
  });

  test('is "bientot" within the day-warning window', () => {
    const r = maintenancePlanDue(
      {
        triggerType: 'temps',
        intervalDays: 30,
        lastServiceDate: new Date('2026-06-15'),
      },
      null,
      TODAY,
    );
    expect(r.status).toBe('bientot');
    expect(r.remainingDays).toBe(7);
  });

  test('is "en_retard" once the next service date is past', () => {
    const r = maintenancePlanDue(
      {
        triggerType: 'temps',
        intervalDays: 30,
        lastServiceDate: new Date('2026-05-01'),
      },
      null,
      TODAY,
    );
    expect(r.status).toBe('en_retard');
    expect(r.remainingDays).toBeLessThan(0);
  });

  test('is "a_jour" with a null next date when never serviced', () => {
    const r = maintenancePlanDue(
      { triggerType: 'temps', intervalDays: 30 },
      null,
      TODAY,
    );
    expect(r.status).toBe('a_jour');
    expect(r.nextDueDate).toBeNull();
  });
});

describe('maintenance plan constants', () => {
  test('trigger types are meter and temps', () => {
    expect(MAINTENANCE_TRIGGER_TYPES).toEqual(['meter', 'temps']);
  });

  test('the day-warning window is a positive number of days', () => {
    expect(MAINTENANCE_DAYS_WARN).toBeGreaterThan(0);
  });
});
