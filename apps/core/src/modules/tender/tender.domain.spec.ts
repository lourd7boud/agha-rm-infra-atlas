import { describe, expect, test } from 'vitest';
import {
  buildBackPlan,
  canTransition,
  transition,
  TransitionError,
} from './tender.domain';

const TODAY = new Date('2026-06-11T00:00:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

describe('pipeline transitions', () => {
  test('follows the happy path detected → won', () => {
    const path = [
      'detected',
      'parsed',
      'qualified',
      'go_decided',
      'preparing',
      'submitted',
      'opened',
      'won',
    ] as const;
    path.slice(1).forEach((to, i) => {
      expect(transition(path[i]!, to)).toBe(to);
    });
  });

  test('throws TransitionError on illegal jumps', () => {
    expect(() => transition('detected', 'won')).toThrow(TransitionError);
    expect(() => transition('parsed', 'submitted')).toThrow(TransitionError);
  });

  test('allows human override of an agent rejection (gate G0)', () => {
    expect(canTransition('rejected', 'qualified')).toBe(true);
  });

  test('terminal states allow no further transitions', () => {
    expect(canTransition('won', 'cancelled')).toBe(false);
    expect(canTransition('lost', 'qualified')).toBe(false);
  });
});

describe('buildBackPlan', () => {
  test('places G1 at J-18 with a standard 30-day runway', () => {
    const plan = buildBackPlan(days(30), TODAY);
    expect(plan.feasible).toBe(true);
    expect(plan.compressed).toBe(false);
    const g1 = plan.milestones.find((m) => m.code === 'go_decision');
    expect(g1?.dueAt.getTime()).toBe(days(12).getTime());
    const submission = plan.milestones.find((m) => m.code === 'submission');
    expect(submission?.dueAt.getTime()).toBe(days(29).getTime());
  });

  test('compresses proportionally on short runways, keeping order and bounds', () => {
    const plan = buildBackPlan(days(10), TODAY);
    expect(plan.feasible).toBe(true);
    expect(plan.compressed).toBe(true);
    const times = plan.milestones.map((m) => m.dueAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]!).toBeGreaterThanOrEqual(TODAY.getTime());
    expect(times[times.length - 1]!).toBeLessThan(days(10).getTime());
  });

  test('declares plans infeasible under the minimum runway', () => {
    expect(buildBackPlan(days(2), TODAY).feasible).toBe(false);
    expect(buildBackPlan(days(-1), TODAY).feasible).toBe(false);
    expect(buildBackPlan(days(2), TODAY).milestones).toEqual([]);
  });
});
