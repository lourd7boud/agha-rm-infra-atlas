import { describe, expect, test } from 'vitest';
import {
  computeProjectPhysicalProgress,
  normalizeTaskPatch,
  summarizeTaskStatuses,
  TASK_STATUSES,
  type TaskProgress,
} from './task.domain';

describe('computeProjectPhysicalProgress', () => {
  test('returns 0 for an empty task list', () => {
    // Arrange
    const tasks: TaskProgress[] = [];

    // Act
    const progress = computeProjectPhysicalProgress(tasks);

    // Assert
    expect(progress).toBe(0);
  });

  test('averages per-task progress percentages', () => {
    // Arrange
    const tasks: TaskProgress[] = [
      { progressPct: 100, status: 'termine' },
      { progressPct: 50, status: 'en_cours' },
      { progressPct: 0, status: 'a_faire' },
    ];

    // Act
    const progress = computeProjectPhysicalProgress(tasks);

    // Assert — (100 + 50 + 0) / 3 = 50
    expect(progress).toBe(50);
  });

  test('rounds the average to two decimals', () => {
    // Arrange — (10 + 10 + 0) / 3 = 20 / 3 = 6.666…
    const tasks: TaskProgress[] = [
      { progressPct: 10, status: 'en_cours' },
      { progressPct: 10, status: 'en_cours' },
      { progressPct: 0, status: 'a_faire' },
    ];

    // Act
    const progress = computeProjectPhysicalProgress(tasks);

    // Assert — 20 / 3 = 6.666… → 6.67
    expect(progress).toBe(6.67);
  });
});

describe('summarizeTaskStatuses', () => {
  test('counts tasks per status', () => {
    // Arrange
    const tasks: TaskProgress[] = [
      { progressPct: 0, status: 'a_faire' },
      { progressPct: 0, status: 'a_faire' },
      { progressPct: 50, status: 'en_cours' },
      { progressPct: 100, status: 'termine' },
      { progressPct: 30, status: 'bloque' },
    ];

    // Act
    const summary = summarizeTaskStatuses(tasks);

    // Assert
    expect(summary).toEqual({
      a_faire: 2,
      en_cours: 1,
      termine: 1,
      bloque: 1,
    });
  });

  test('returns all-zero counts for an empty list', () => {
    // Arrange
    const tasks: TaskProgress[] = [];

    // Act
    const summary = summarizeTaskStatuses(tasks);

    // Assert
    expect(summary).toEqual({
      a_faire: 0,
      en_cours: 0,
      termine: 0,
      bloque: 0,
    });
  });
});

describe('normalizeTaskPatch', () => {
  test('forces progress to 100 when status becomes termine', () => {
    // Arrange
    const patch = { status: 'termine' as const, progressPct: 40 };

    // Act
    const normalized = normalizeTaskPatch(patch);

    // Assert
    expect(normalized.progressPct).toBe(100);
    expect(normalized.status).toBe('termine');
  });

  test('forces progress to 0 when status becomes a_faire', () => {
    // Arrange
    const patch = { status: 'a_faire' as const, progressPct: 75 };

    // Act
    const normalized = normalizeTaskPatch(patch);

    // Assert
    expect(normalized.progressPct).toBe(0);
  });

  test('leaves progress untouched for en_cours / bloque', () => {
    // Arrange
    const patch = { status: 'en_cours' as const, progressPct: 65 };

    // Act
    const normalized = normalizeTaskPatch(patch);

    // Assert
    expect(normalized.progressPct).toBe(65);
    expect(normalized.status).toBe('en_cours');
  });

  test('returns a new object (no mutation of the input)', () => {
    // Arrange
    const patch = { label: 'Terrassement', progressPct: 20 };

    // Act
    const normalized = normalizeTaskPatch(patch);

    // Assert
    expect(normalized).not.toBe(patch);
    expect(normalized).toEqual(patch);
  });
});

describe('TASK_STATUSES', () => {
  test('enumerates the four chantier task states', () => {
    // Arrange / Act / Assert
    expect(TASK_STATUSES).toEqual(['a_faire', 'en_cours', 'termine', 'bloque']);
  });
});
