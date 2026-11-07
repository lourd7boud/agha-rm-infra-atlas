import { describe, expect, it } from 'vitest';
import {
  assertJourneeAction,
  assertJourneeReferences,
} from './btp-journee.domain';
import { terrainJourneePayloadSchema } from '@atlas/contracts';
const payload = () =>
  terrainJourneePayloadSchema.parse({
    date: '2026-10-27',
    zone: 'A',
    summary: 'Travaux',
  });
describe('daily workflow', () => {
  it('requires current version even on transition replay', () =>
    expect(() => assertJourneeAction('reviewed', 3, 2, 'review')).toThrow(
      /version/i,
    ));
  it('allows review replay without rematerialization', () =>
    expect(assertJourneeAction('reviewed', 3, 3, 'review')).toBe('replay'));
  it('requires submission before review and locks reviewed edits', () => {
    expect(() => assertJourneeAction('draft', 1, 1, 'review')).toThrow();
    expect(() => assertJourneeAction('reviewed', 3, 3, 'save')).toThrow();
  });
  it('supports returned correction and resubmission', () => {
    expect(assertJourneeAction('returned', 3, 3, 'save')).toBe('draft');
    expect(assertJourneeAction('returned', 3, 3, 'submit')).toBe('submitted');
  });
  it('rejects absent project and foreign references', () => {
    expect(() =>
      assertJourneeReferences(payload(), {
        projectExists: false,
        assignments: [],
        bpuIds: [],
        photoIds: [],
      }),
    ).toThrow();
    const p = payload();
    p.photoIds = ['00000000-0000-4000-8000-000000000001'];
    expect(() =>
      assertJourneeReferences(p, {
        projectExists: true,
        assignments: [],
        bpuIds: [],
        photoIds: [],
      }),
    ).toThrow();
  });
  it('validates attendance date and rejects duplicate assignments', () => {
    const p = payload();
    const id = '00000000-0000-4000-8000-000000000001';
    p.attendance = [
      { id, assignmentId: id, temporaryName: null, daysWorked: 1, note: null },
    ];
    expect(() =>
      assertJourneeReferences(p, {
        projectExists: true,
        assignments: [{ id, startDate: '2026-11-01', endDate: null }],
        bpuIds: [],
        photoIds: [],
      }),
    ).toThrow();
  });
  it('retains unknown prices and distinguishes receipts', () => {
    const p = payload();
    expect(p.materials).toEqual([]);
    expect(
      terrainJourneePayloadSchema.safeParse({ ...p, date: '2026-02-30' })
        .success,
    ).toBe(false);
  });
});
