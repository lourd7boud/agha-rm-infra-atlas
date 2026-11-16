import { beforeEach, expect, test, vi } from 'vitest';
import { DossierService } from './dossier.service';
import { checkDossierRevision } from './dossier-revision-check';
vi.mock('./dossier-revision-check', async importOriginal => ({
  ...await importOriginal<typeof import('./dossier-revision-check')>(), checkDossierRevision: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
const id = '11111111-1111-4111-8111-111111111111';
const sourceUrl = 'https://www.marchespublics.gov.ma/?page=entreprise.EntrepriseDetailsConsultation&refConsultation=123&orgAcronyme=abc';

test('first in-viewer download uses the guarded source path without reacquiring its own gate', async () => {
  let raw: Record<string, unknown> | null = null;
  const tenders = { findById: async () => ({ id, sourceUrl, raw }) };
  const storage = { presignedGetUrl: vi.fn(async () => 'http://saved-archive.test/file.zip') };
  vi.mocked(checkDossierRevision).mockImplementation(async (_id, deps) => {
    expect(await deps.commit(async () => 42)).toBe(42);
    raw = { dossier: { objectKey: `dossiers/${id}.zip`, filename: 'DAO.zip', sizeBytes: 100, downloadedAt: '2026-11-13T20:00:00Z' } };
    return { state: 'downloaded' } as never;
  });
  const service = new DossierService(tenders as never, storage as never);
  const signal = new AbortController().signal;
  expect(await service.ensureDossier(id, signal)).toMatchObject({ filename: 'DAO.zip', cached: false });
  expect(checkDossierRevision).toHaveBeenCalledWith(id, expect.objectContaining({ tenders, storage }), signal);
});

test('a closed or blocked source never produces a cached download link', async () => {
  vi.mocked(checkDossierRevision).mockResolvedValue({ state: 'unavailable', reason: 'scheduled_closure' } as never);
  const presignedGetUrl = vi.fn();
  const service = new DossierService({ findById: async () => ({ id, sourceUrl, raw: null }) } as never, { presignedGetUrl } as never);
  await expect(service.ensureDossier(id)).rejects.toThrow('DCE officiel indisponible');
  expect(presignedGetUrl).not.toHaveBeenCalled();
});
