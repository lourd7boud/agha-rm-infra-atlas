import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPatch, apiPost } = vi.hoisted(() => ({ apiPatch: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api', () => ({
  apiPatch, apiPost, apiGet: vi.fn(), apiDelete: vi.fn(),
  AtlasApiError: class extends Error { constructor(_path: string, public status: number) { super('API refused'); } },
}));
vi.mock('@/lib/btp', () => ({ apiPut: vi.fn(), apiUpload: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
import { AtlasApiError } from '@/lib/api';
import { transitionAvenant, updateAvenant } from '../actions';

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    projectId: 'project', avenantMode: 'bordereau', objet: 'Terrassement', reference: 'AV-02',
    impactDateEffet: '2026-05-02', impactTauxTva: '20', quantityLine: 'line', oldQuantity: '18.5',
    newQuantity: '12', observations: 'Pièce déjà vérifiée',
  })) data.set(key, value);
  return data;
}

describe('amendment correction actions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('patches the existing draft with its recorded baseline instead of creating another amendment', async () => {
    apiPatch.mockResolvedValue({});
    await expect(updateAvenant('avenant', {}, form())).rejects.toThrow('redirect');
    expect(apiPatch).toHaveBeenCalledWith('/btp/projects/project/avenants/avenant', expect.objectContaining({
      observations: 'Pièce déjà vérifiée',
      bordereauImpact: expect.objectContaining({ quantities: [{ ligneId: 'line', ancienneQuantite: 18.5, nouvelleQuantite: 12 }] }),
    }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('returns an inline error when the draft has concurrently been submitted', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiPatch.mockRejectedValue(new AtlasApiError('test', 409));
    try {
      expect(await updateAvenant('avenant', {}, form())).toEqual({ error: expect.stringContaining('état du marché a changé') });
      expect(apiPost).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('reopens a rejected amendment through a distinct transition before any edit', async () => {
    apiPost.mockResolvedValue({});
    const data = new FormData();
    data.set('projectId', 'project'); data.set('avenantId', 'avenant'); data.set('to', 'brouillon');
    await expect(transitionAvenant(data)).rejects.toThrow('redirect');
    expect(apiPost).toHaveBeenCalledWith('/btp/projects/project/avenants/avenant/transition', { to: 'brouillon', dateApprobation: undefined });
    expect(apiPatch).not.toHaveBeenCalled();
  });
});
