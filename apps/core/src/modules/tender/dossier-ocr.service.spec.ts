import { beforeEach, expect, test, vi } from 'vitest';
import { DossierService } from './dossier.service';
import { runDossierFileOcr, projectDossierFileOcr, readCachedDossierFileOcr } from './dossier-file-ocr';
import { zipSync, strToU8 } from 'fflate';
import { PDFParse } from 'pdf-parse';

vi.mock('./dossier-file-ocr', () => ({
  runDossierFileOcr: vi.fn(),
  projectDossierFileOcr: vi.fn(),
  readCachedDossierFileOcr: vi.fn(() => null),
}));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readCachedDossierFileOcr).mockReturnValue(null); });

const cachedRaw = { dossier: { objectKey: 'dossiers/test-id.zip', filename: 'DAO.zip', sizeBytes: 100, downloadedAt: '2026-11-10T10:00:00Z' } };

test('all-empty OCR page labels never establish readable source text', async () => {
  const getText = vi.spyOn(PDFParse.prototype, 'getText').mockResolvedValue({ text: '', total: 1, pages: [{ num: 1, text: '' }] } as never);
  const destroy = vi.spyOn(PDFParse.prototype, 'destroy').mockResolvedValue(undefined);
  const zip = zipSync({ 'CPS.pdf': strToU8('%PDF-1.7 invalid') });
  vi.mocked(readCachedDossierFileOcr).mockReturnValue({ state: 'mixed', pages: [{ num: 1, state: 'no_text', text: '', textTruncated: false }] } as never);
  const storage = {
    getObject: async (key: string) => {
      if (key.endsWith('.md')) throw new Error('not cached');
      return { body: (async function* () { yield Buffer.from('{}'); })() };
    },
    presignedGetUrl: async () => 'http://saved-archive.test/DAO.zip', put: vi.fn(),
  };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Buffer.from(zip)));
  const service = new DossierService({ findById: async () => ({ id: 'test-id', raw: cachedRaw }) } as never, storage as never);
  try {
    const markdown = await service.getDossierMarkdown('test-id');
    expect(markdown).toContain('"state":"no_readable_text"');
    expect(markdown).not.toContain('[Page 1');
    expect(runDossierFileOcr).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); getText.mockRestore(); destroy.mockRestore(); }
});

test('an in-flight pre-OCR Markdown build finishes before final invalidation', async () => {
  const zip = zipSync({ 'AVIS.txt': strToU8('source text') });
  let finishBuild!: () => void;
  const blockedBuild = new Promise<void>(resolve => { finishBuild = resolve; });
  const order: string[] = [];
  const put = vi.fn(async (key: string) => {
    if (key.endsWith('.md')) { await blockedBuild; order.push('old-build-saved'); }
    else order.push('ocr-saved');
  });
  const remove = vi.fn(async () => { order.push('derived-cache-deleted'); });
  const service = new DossierService({ findById: async () => ({ id: 'test-id', raw: cachedRaw }) } as never, {
    getObject: async () => { throw new Error('not cached'); },
    presignedGetUrl: async () => 'http://saved-archive.test/DAO.zip', put, delete: remove,
  } as never);
  vi.spyOn(service, 'acquireDossierFile').mockResolvedValue({ file: { bytes: Buffer.from('%PDF-1.7'), filename: 'RC.pdf', mime: 'application/pdf' }, release: vi.fn() });
  vi.mocked(runDossierFileOcr).mockResolvedValue({ state: 'text', pages: [] } as never);
  vi.mocked(projectDossierFileOcr).mockReturnValue({ state: 'text' } as never);
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Buffer.from(zip)));
  try {
    const building = service.getDossierMarkdown('test-id');
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith('dossiers/test-id.md', expect.any(Buffer), expect.any(String)));
    const reading = service.ocrCachedFile('test-id', 'RC.pdf');
    await vi.waitFor(() => expect(order).toContain('ocr-saved'));
    expect(remove).not.toHaveBeenCalled();
    finishBuild();
    await Promise.all([building, reading]);
    expect(order).toEqual(['ocr-saved', 'old-build-saved', 'derived-cache-deleted']);
  } finally { finishBuild(); fetch.mockRestore(); }
});

test('local OCR releases the viewer lease before computing and invalidates derived chat text', async () => {
  const release = vi.fn();
  const put = vi.fn();
  const remove = vi.fn();
  const service = new DossierService({} as never, {
    getObject: async () => { throw new Error('not cached'); }, put, delete: remove,
  } as never);
  vi.spyOn(service, 'acquireDossierFile').mockResolvedValue({
    file: { bytes: Buffer.from('%PDF-1.7'), filename: 'RC.pdf', mime: 'application/pdf' }, release,
  });
  const result = { state: 'text', pages: [{ num: 1, text: 'Texte source' }] };
  vi.mocked(runDossierFileOcr).mockImplementation(async () => {
    expect(release).toHaveBeenCalledOnce();
    return result as never;
  });
  vi.mocked(projectDossierFileOcr).mockReturnValue({ state: 'text', pagesProcessed: 1 } as never);
  const signal = new AbortController().signal;
  expect(await service.ocrCachedFile('test-id', 'RC.pdf', signal)).toEqual({ state: 'text', pagesProcessed: 1 });
  expect(runDossierFileOcr).toHaveBeenCalledWith(expect.any(Buffer), 'RC.pdf', { signal });
  expect(put).toHaveBeenCalledWith(expect.stringMatching(/^dossiers\/test-id\/ocr\/[a-f0-9]{64}-[a-f0-9]{16}\.json$/), expect.any(Buffer), 'application/json');
  expect(remove).toHaveBeenCalledWith('dossiers/test-id.md');
});

test('an absent saved archive cannot initiate local OCR or portal acquisition', async () => {
  const service = new DossierService({ findById: async () => ({ id: 'x', raw: null }) } as never, {} as never);
  await expect(service.ocrCachedFile('x', 'RC.pdf')).rejects.toThrow('Archive DCE absente');
  expect(runDossierFileOcr).not.toHaveBeenCalled();
});
