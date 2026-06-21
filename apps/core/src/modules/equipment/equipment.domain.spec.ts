import { describe, expect, test } from 'vitest';
import {
  assertAssign,
  assertReturn,
  assertSetStatus,
  canAssign,
  canReturn,
  EquipmentTransitionError,
} from './equipment.domain';

describe('canAssign', () => {
  test('a disponible machine can be assigned', () => {
    // Arrange + Act + Assert
    expect(canAssign('disponible')).toBe(true);
  });

  test('an assignee machine cannot be re-assigned', () => {
    // Arrange + Act + Assert
    expect(canAssign('assignee')).toBe(false);
  });

  test('a hors_service machine cannot be assigned', () => {
    // Arrange + Act + Assert
    expect(canAssign('hors_service')).toBe(false);
  });
});

describe('canReturn', () => {
  test('an assignee machine can be returned', () => {
    // Arrange + Act + Assert
    expect(canReturn('assignee')).toBe(true);
  });

  test('a disponible machine cannot be returned', () => {
    // Arrange + Act + Assert
    expect(canReturn('disponible')).toBe(false);
  });

  test('a hors_service machine cannot be returned', () => {
    // Arrange + Act + Assert
    expect(canReturn('hors_service')).toBe(false);
  });
});

describe('assertAssign', () => {
  test('passes silently for a disponible machine', () => {
    // Arrange + Act + Assert
    expect(() => assertAssign('disponible')).not.toThrow();
  });

  test('blocks assigning an already-assigned machine', () => {
    // Arrange + Act + Assert
    expect(() => assertAssign('assignee')).toThrow(EquipmentTransitionError);
  });

  test('blocks assigning a hors_service machine', () => {
    // Arrange + Act + Assert
    expect(() => assertAssign('hors_service')).toThrow(EquipmentTransitionError);
  });
});

describe('assertReturn', () => {
  test('passes silently for an assignee machine', () => {
    // Arrange + Act + Assert
    expect(() => assertReturn('assignee')).not.toThrow();
  });

  test('blocks returning a disponible machine', () => {
    // Arrange + Act + Assert
    expect(() => assertReturn('disponible')).toThrow(EquipmentTransitionError);
  });

  test('blocks returning a hors_service machine', () => {
    // Arrange + Act + Assert
    expect(() => assertReturn('hors_service')).toThrow(EquipmentTransitionError);
  });
});

describe('assertSetStatus', () => {
  test('allows hors_service from disponible', () => {
    // Arrange + Act + Assert
    expect(() => assertSetStatus('disponible', 'hors_service')).not.toThrow();
  });

  test('allows disponible back from hors_service', () => {
    // Arrange + Act + Assert
    expect(() => assertSetStatus('hors_service', 'disponible')).not.toThrow();
  });

  test('blocks hors_service while assignee (return first)', () => {
    // Arrange + Act + Assert
    expect(() => assertSetStatus('assignee', 'hors_service')).toThrow(
      EquipmentTransitionError,
    );
  });

  test('blocks disponible from assignee (return frees it instead)', () => {
    // Arrange + Act + Assert
    expect(() => assertSetStatus('assignee', 'disponible')).toThrow(
      EquipmentTransitionError,
    );
  });

  test('never sets assignee manually', () => {
    // Arrange + Act + Assert
    expect(() => assertSetStatus('disponible', 'assignee')).toThrow(
      EquipmentTransitionError,
    );
  });
});
