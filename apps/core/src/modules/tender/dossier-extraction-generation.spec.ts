import { Readable } from 'node:stream';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { DossierExtractionService } from './dossier-extraction.service';
import { InMemoryTenderRepository } from './tender.repository';
import { FakeLlmClient } from '../brain/llm.client';
import { downloadAnonymousDossierForExtraction } from './dossier-revision-check';

vi.mock('./pdf-ocr', () => ({ pdfParseExtract: async (bytes: Uint8Array) => strFromU8(bytes) }));
vi.mock('./dossier-revision-check', () => ({
  downloadAnonymousDossierForExtraction: vi.fn(async () => { throw new Error('Unexpected portal acquisition in unit test'); }),
}));
beforeEach(() => { vi.mocked(downloadAnonymousDossierForExtraction).mockClear(); });

const oldDossier = { objectKey: 'dossiers/source.zip', filename: 'DAO.zip', sizeBytes: 100, downloadedAt: '2026-11-10T10:00:00Z' };
const newDossier = { ...oldDossier, downloadedAt: '2026-11-13T10:00:00Z' };
const archive = zipSync({ 'RC.pdf': strToU8('Estimation 379104 MAD, caution 7000 MAD. '.repeat(30)) });

async function seed(repo: InMemoryTenderRepository) {
  const row = await repo.create({ reference: 'TEST/2026', buyerName: 'Test', procedure: 'AOO', objet: 'Travaux',
    deadlineAt: new Date('2030-01-01T10:00:00Z'), sourceUrl: 'https://www.marchespublics.gov.ma/?refConsultation=123&orgAcronyme=x' });
  await repo.updateEnrichment(row.id, {}, { dossier: oldDossier });
  return (await repo.findById(row.id))!;
}

function heldLlm() {
  const llm = new FakeLlmClient([]);
  let release!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((resolve, no) => { release = resolve; reject = no; });
  const complete = vi.spyOn(llm, 'complete').mockImplementation(async () => {
    await pending;
    return { text: JSON.stringify({ estimationMad: 379104, cautionProvisoireMad: 7000,
      qualifications: [{ secteur: 'old', qualification: 'OLD', classe: '1' }],
      bpu: [{ designation: 'old clause', quantite: 1, unite: 'U', prixUnitaireMad: 1200 }] }),
    model: 'fake', inputTokens: 1, outputTokens: 1 };
  });
  return { llm, complete, release, reject };
}

describe('DCE extraction generation', () => {
  test('an unchanged cached generation still accepts extraction and a failed attempt marker', async () => {
    const repo = new InMemoryTenderRepository();
    const tender = await seed(repo);
    const held = heldLlm();
    const storage = { getObject: async () => ({ body: Readable.from([archive]) }) };
    const service = new DossierExtractionService(repo, held.llm, storage as never);
    const extracting = service.extractTender(tender.id);
    await vi.waitFor(() => expect(held.complete).toHaveBeenCalledOnce());
    held.release();
    expect((await extracting).extracted).toBe(true);
    const saved = await repo.findById(tender.id);
    expect(saved?.estimationMad).toBe(379104);
    expect(saved?.hasBpu).toBe(true);
    const failed = new DossierExtractionService(repo, new FakeLlmClient([]), storage as never);
    expect((await failed.extractBatch(1, { force: true })).failed).toBe(1);
    expect((await repo.findById(tender.id))?.raw?.dossierExtractAttempt).toEqual({ at: expect.any(String) });
  });

  test('an extraction-only cache miss retains immutable provenance without overwriting canonical bytes', async () => {
    const repo = new InMemoryTenderRepository();
    const tender = await repo.create({ reference: 'NEW/2026', buyerName: 'Test', procedure: 'AOO', objet: 'Travaux',
      deadlineAt: new Date('2030-01-01T10:00:00Z'), sourceUrl: 'https://www.marchespublics.gov.ma/?refConsultation=123&orgAcronyme=x' });
    vi.mocked(downloadAnonymousDossierForExtraction).mockResolvedValueOnce({ filename: 'DAO.zip', bytes: Buffer.from(archive), mime: 'application/zip', sizeBytes: archive.length });
    const put = vi.fn();
    const held = heldLlm();
    const service = new DossierExtractionService(repo, held.llm, { put } as never);
    const extracting = service.extractTender(tender.id).then(() => null, error => error as Error);
    await vi.waitFor(() => expect(held.complete).toHaveBeenCalledOnce());
    expect(put).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^dossiers/${tender.id}/revisions/[a-f0-9]{64}\\.zip$`)), expect.any(Buffer), 'application/zip');
    expect((await repo.findById(tender.id))?.raw?.dossier).toBeUndefined();
    await repo.updateEnrichment(tender.id, {}, { dossier: newDossier, dossierExtraction: null });
    held.release();
    expect((await extracting)?.message).toMatch(/DCE.*chang/i);
    expect((await repo.findById(tender.id))?.raw?.dossier).toEqual(newDossier);
    expect((await repo.findById(tender.id))?.raw?.dossierExtraction).toBeNull();
  });

  test('an old extraction cannot restore clauses or amounts after a changed revision activates', async () => {
    const repo = new InMemoryTenderRepository();
    const tender = await seed(repo);
    const held = heldLlm();
    const service = new DossierExtractionService(repo, held.llm, { getObject: async () => ({ body: Readable.from([archive]) }) } as never);
    const extracting = service.extractTender(tender.id).then(() => null, error => error as Error);
    await vi.waitFor(() => expect(held.complete).toHaveBeenCalledOnce());
    await repo.updateEnrichment(tender.id, {}, { dossier: newDossier, dossierExtraction: null, dossierText: null, dossierMarkdown: null });
    held.release();
    expect((await extracting)?.message).toMatch(/DCE.*chang/i);
    const after = await repo.findById(tender.id);
    expect(after?.raw?.dossierExtraction).toBeNull();
    expect(after?.raw?.dossierText).toBeNull();
    expect(after?.estimationMad).toBeUndefined();
    expect(after?.cautionProvisoireMad).toBeUndefined();
    expect(after?.hasBpu).toBe(false);
    expect(downloadAnonymousDossierForExtraction).not.toHaveBeenCalled();
  });

  test('a failed old batch cannot stamp a retry cooldown on the new revision', async () => {
    const repo = new InMemoryTenderRepository();
    const tender = await seed(repo);
    const held = heldLlm();
    const service = new DossierExtractionService(repo, held.llm, { getObject: async () => ({ body: Readable.from([archive]) }) } as never);
    const batching = service.extractBatch(1);
    await vi.waitFor(() => expect(held.complete).toHaveBeenCalledOnce());
    await repo.updateEnrichment(tender.id, {}, { dossier: newDossier });
    held.reject(new Error('old extraction failed'));
    expect((await batching).failed).toBe(1);
    expect((await repo.findById(tender.id))?.raw?.dossierExtractAttempt).toBeUndefined();
  });
});
