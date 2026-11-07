import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPatch } from '@/lib/api';
import { updateFiche } from './actions';

const redirectError = new Error('NEXT_REDIRECT');

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  }),
}));
vi.mock('@/lib/next-redirect', () => ({
  isRedirectError: vi.fn((error: unknown) => error === redirectError),
}));
vi.mock('@/lib/api', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  AtlasApiError: class extends Error {
    constructor(
      _path: string,
      public status: number,
    ) {
      super('upstream error');
    }
  },
}));
vi.mock('@/lib/btp', () => ({ apiPut: vi.fn(), apiUpload: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiPatch).mockResolvedValue({});
});

describe('project fiche updates', () => {
  it('sends a cleared optional text field instead of omitting the update', async () => {
    const formData = new FormData();
    formData.set('projectId', 'project-id');
    formData.set('reference', '25/2026/1HYAE/DPA/TA');
    formData.set('objet', '   ');
    formData.set('assistanceTechnique', '   ');

    await expect(updateFiche(formData)).rejects.toBe(redirectError);

    expect(apiPatch).toHaveBeenCalledWith('/btp/projects/project-id', expect.any(Object));
    const sent = vi.mocked(apiPatch).mock.calls[0]?.[1];
    const serialized = JSON.parse(JSON.stringify(sent)) as Record<string, unknown>;
    expect(serialized).toMatchObject({
      assistanceTechnique: '',
      annee: '',
      buyerName: '',
      cb: '',
      chapitre: '',
      cnss: '',
      commune: '',
      ligneBudgetaire: '',
      maitreOeuvre: '',
      modePassation: '',
      objet: '',
      patente: '',
      programme: '',
      projetLibelle: '',
      rc: '',
      societe: '',
    });
  });
});
