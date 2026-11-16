import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPut, redirect } = vi.hoisted(() => ({ apiPut: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiPatch: vi.fn(), apiPost: vi.fn(), apiGet: vi.fn(), apiDelete: vi.fn(), AtlasApiError: class extends Error {} }));
vi.mock('@/lib/btp', () => ({ apiPut, apiUpload: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));
import { saveRevisionConfig } from '../actions';

describe('one-time CPS formula configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPut.mockResolvedValue({});
    redirect.mockImplementation(() => { throw new Error('redirect'); });
  });

  it('converts percentages exactly and preserves the inherited dates and indices', async () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({
      projectId: 'market', formulaMode: 'inline', 'formula-fixed': '16.67',
      'formula-code': 'TEST', 'formula-weight': '83.33',
    })) data.set(key, value);
    await expect(saveRevisionConfig(data)).rejects.toThrow('redirect');
    expect(apiPut).toHaveBeenCalledWith('/btp/projects/market/revision/config', {
      formula: { fixedPart: 0.1667, weights: { TEST: 0.8333 } },
    });
    expect(redirect).toHaveBeenCalledWith('/projects/market?section=admin&tab=revision&saved=1');
  });

  it('links a selected formula without submitting hidden empty overrides', async () => {
    const data = new FormData();
    data.set('projectId', 'market');
    data.set('formulaId', 'formula');
    data.set('postingMode', 'final_only');
    await expect(saveRevisionConfig(data)).rejects.toThrow('redirect');
    expect(apiPut).toHaveBeenCalledWith('/btp/projects/market/revision/config', { formulaId: 'formula', postingMode: 'final_only' });
  });

  it('returns to the registry without saving unrelated unsaved formula or date changes', async () => {
    const data = new FormData();
    data.set('projectId', 'market');
    data.set('revisionAction', 'registry-base');
    data.set('formulaMode', 'inline');
    data.set('baseDate', '2026-04-01');
    data.set('postingMode', 'final_only');
    data.set('save-base-indexes', 'yes');
    data.set('base-index:S', '45');
    await expect(saveRevisionConfig(data)).rejects.toThrow('redirect');
    expect(apiPut).toHaveBeenCalledWith('/btp/projects/market/revision/config', { baseIndexes: {} });
  });
});
