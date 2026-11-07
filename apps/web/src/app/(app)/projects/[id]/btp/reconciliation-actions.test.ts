import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPatch, AtlasApiError } from '@/lib/api';
import { dailyIdentity } from './daily-actions';
import { reconcileExpense } from './reconciliation-actions';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./daily-actions', () => ({ dailyIdentity: vi.fn() }));
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  AtlasApiError: class extends Error {
    constructor(
      _path: string,
      public status: number,
    ) {
      super('upstream error');
    }
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dailyIdentity).mockResolvedValue({
    accountScope: 'account-a',
    canReview: true,
  });
});
describe('expense reconciliation office actions', () => {
  it('denies field accounts without sending financial writes', async () => {
    vi.mocked(dailyIdentity).mockResolvedValue({
      accountScope: 'account-a',
      canReview: false,
    });
    expect(
      await reconcileExpense('project', 'expense', 'account-a', {
        expectedVersion: 0,
        treatment: 'non_cost',
        note: 'Décision bureau',
      }),
    ).toMatchObject({ ok: false });
    expect(apiPatch).not.toHaveBeenCalled();
  });
  it('rejects account switches and incomplete linked references', async () => {
    expect(
      await reconcileExpense('project', 'expense', 'other-account', {
        expectedVersion: 0,
        treatment: 'standalone',
        note: 'Transport',
      }),
    ).toMatchObject({ ok: false });
    expect(
      await reconcileExpense('project', 'expense', 'account-a', {
        expectedVersion: 0,
        treatment: 'linked_resource',
        note: 'Doublon',
      }),
    ).toMatchObject({ ok: false });
    expect(apiPatch).not.toHaveBeenCalled();
  });
  it('passes the audited project-scoped decision without inventing a resource value', async () => {
    const input = {
      expectedVersion: 0,
      treatment: 'linked_resource' as const,
      resourceKind: 'materiel' as const,
      resourceId: 'resource-id',
      note: 'Carburant déjà valorisé',
    };
    vi.mocked(apiPatch).mockResolvedValue({ expenseId: 'expense' });
    expect(
      await reconcileExpense('project', 'expense', 'account-a', input),
    ).toMatchObject({ ok: true });
    expect(apiPatch).toHaveBeenCalledWith(
      '/btp/projects/project/terrain/depenses/expense/rapprocher',
      input,
    );
    expect(input.note).toBe('Carburant déjà valorisé');
  });
  it('returns an actionable refusal and leaves caller selections intact', async () => {
    const input = {
      expectedVersion: 0,
      treatment: 'linked_resource' as const,
      resourceKind: 'materiel' as const,
      resourceId: 'resource-id',
      note: 'Montants différents',
    };
    vi.mocked(apiPatch).mockRejectedValue(new AtlasApiError('/expense', 400));
    const result = await reconcileExpense(
      'project',
      'expense',
      'account-a',
      input,
    );
    expect(result).toMatchObject({ ok: false });
    expect('message' in result && result.message).toContain('20 caractères');
    expect(input.resourceId).toBe('resource-id');
  });
  it('returns the concurrent financial decision without overwriting caller input', async () => {
    const input = {
      expectedVersion: 1,
      treatment: 'standalone' as const,
      note: 'Nouvelle justification',
    };
    const current = { expenseId: 'expense', version: 2, treatment: 'non_cost' };
    vi.mocked(apiPatch).mockRejectedValue(new AtlasApiError('/expense', 409));
    vi.mocked(apiGet).mockResolvedValue([current]);
    expect(
      await reconcileExpense('project', 'expense', 'account-a', input),
    ).toMatchObject({ ok: false, code: 'conflict', current });
    expect(input.expectedVersion).toBe(1);
    expect(input.note).toBe('Nouvelle justification');
    expect(apiPatch).toHaveBeenCalledTimes(1);
  });
});
