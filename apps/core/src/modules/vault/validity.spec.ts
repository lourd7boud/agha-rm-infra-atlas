import { describe, expect, test } from 'vitest';
import {
  BID_REQUIRED_KINDS,
  computeReadiness,
  computeStatus,
  dueAlerts,
} from './validity';

const TODAY = new Date('2026-06-11T00:00:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

describe('computeStatus', () => {
  test('returns no_expiry when document has no expiry date', () => {
    expect(computeStatus('statuts', null, TODAY)).toBe('no_expiry');
  });

  test('returns expired the day after expiry', () => {
    expect(computeStatus('attestation_fiscale', days(-1), TODAY)).toBe('expired');
  });

  test('returns expiring on the expiry day itself', () => {
    expect(computeStatus('attestation_fiscale', days(0), TODAY)).toBe('expiring');
  });

  test('returns expiring at the widest ladder threshold (60d for fiscale)', () => {
    expect(computeStatus('attestation_fiscale', days(60), TODAY)).toBe('expiring');
  });

  test('returns valid beyond the widest threshold', () => {
    expect(computeStatus('attestation_fiscale', days(61), TODAY)).toBe('valid');
  });

  test('falls back to the default ladder for unlisted kinds', () => {
    expect(computeStatus('registre_commerce', days(30), TODAY)).toBe('expiring');
    expect(computeStatus('registre_commerce', days(31), TODAY)).toBe('valid');
  });
});

describe('dueAlerts', () => {
  test('returns only the thresholds already crossed', () => {
    expect(dueAlerts('attestation_fiscale', days(13), TODAY)).toEqual([60, 30, 14]);
  });

  test('returns empty array for expired documents', () => {
    expect(dueAlerts('attestation_fiscale', days(-2), TODAY)).toEqual([]);
  });

  test('returns empty array when no expiry date exists', () => {
    expect(dueAlerts('statuts', null, TODAY)).toEqual([]);
  });
});

describe('computeReadiness', () => {
  const fullValidSet = BID_REQUIRED_KINDS.map((kind) => ({
    kind,
    expiresAt: days(120),
  }));

  test('scores 100 and ready when every required document is valid', () => {
    const report = computeReadiness(fullValidSet, TODAY);
    expect(report.score).toBe(100);
    expect(report.ready).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.expired).toEqual([]);
  });

  test('flags missing kinds and blocks readiness', () => {
    const withoutFiscale = fullValidSet.filter(
      (doc) => doc.kind !== 'attestation_fiscale',
    );
    const report = computeReadiness(withoutFiscale, TODAY);
    expect(report.ready).toBe(false);
    expect(report.missing).toEqual(['attestation_fiscale']);
    expect(report.score).toBe(83);
  });

  test('expired document blocks readiness even when present', () => {
    const withExpiredFiscale = [
      ...fullValidSet.filter((doc) => doc.kind !== 'attestation_fiscale'),
      { kind: 'attestation_fiscale' as const, expiresAt: days(-1) },
    ];
    const report = computeReadiness(withExpiredFiscale, TODAY);
    expect(report.ready).toBe(false);
    expect(report.expired).toEqual(['attestation_fiscale']);
  });

  test('expiring document stays usable today but is reported', () => {
    const withExpiringFiscale = [
      ...fullValidSet.filter((doc) => doc.kind !== 'attestation_fiscale'),
      { kind: 'attestation_fiscale' as const, expiresAt: days(10) },
    ];
    const report = computeReadiness(withExpiringFiscale, TODAY);
    expect(report.ready).toBe(true);
    expect(report.score).toBe(100);
    expect(report.expiring).toEqual(['attestation_fiscale']);
  });

  test('best document wins when duplicates exist for a kind', () => {
    const withRenewedFiscale = [
      ...fullValidSet,
      { kind: 'attestation_fiscale' as const, expiresAt: days(-30) },
    ];
    const report = computeReadiness(withRenewedFiscale, TODAY);
    expect(report.ready).toBe(true);
    expect(report.expired).toEqual([]);
  });
});
