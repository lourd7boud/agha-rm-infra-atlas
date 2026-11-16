import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { InMemoryObjectStorage } from '../vault/storage';
import type { runDossierFileOcr } from '../tender/dossier-file-ocr';
import { BtpIndexImportService, MINISTRY_INDEX_URL, type ApplyIndexImport } from './btp-index-import.service';
import { DrizzleBtpRegistresRepository } from './btp-registres.repository';

vi.mock('./btp-index-bulletin.domain', () => ({
  parseIndexBulletin: (pages: { num: number; text: string }[]) => ({
    reference: pages[0]?.text, documentDate: '2026-10-15', issues: [],
    months: ['2026-01', '2026-02'].map((month) => ({
      month, status: 'definitif', values: { TEST: 125 }, evidence: [{ code: 'TEST', value: 125, page: 1, line: 'TEST 125' }],
    })),
  }),
}));

const url = process.env.BTP_INDEX_IMPORT_DATABASE_URL;
const actor = { sub: 'index-import-test', name: 'Index import test' };
const sourceUrl = 'https://www.equipement.gov.ma/Ingenierie/Documents/Bareme-test.pdf';
const request: ApplyIndexImport = {
  reference: 'Bulletin officiel TEST', publishedOn: '2026-11-04', publicationEvidence: 'Bordereau de diffusion p. 1',
  months: [{ month: '2026-01', status: 'definitif', indexValues: { TEST: 125 } }, { month: '2026-02', status: 'definitif', indexValues: { TEST: 150 } }],
};
const ocrResult = (text = 'Reference OCR') => ({
  coverage: 'complete', pages: [{ num: 1, text }],
}) as Awaited<ReturnType<typeof runDossierFileOcr>>;
const fakeFetch: typeof fetch = vi.fn(async (input) => new Response(String(input) === MINISTRY_INDEX_URL
  ? '<a href="/Ingenierie/Documents/Bareme-test.pdf">Barème test</a>' : '%PDF-TEST',
  { headers: { 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' } }));

describe.skipIf(!url)('index import lifecycle (PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as Db;
  const storage = new InMemoryObjectStorage();
  let service: BtpIndexImportService;
  beforeEach(async () => {
    if (new URL(url!).pathname !== '/atlas_btp_index_import_test') throw new Error('Dedicated disposable import database required');
    await pool.query('TRUNCATE project.project, project.revision_index, project.revision_formula, project.revision_index_import, project.revision_index_audit CASCADE');
    service = new BtpIndexImportService(db, storage, { fetch: fakeFetch, ocr: async () => ocrResult(), now: () => new Date('2026-11-15T10:00:00Z') });
  });
  afterAll(async () => { await pool.end(); });

  async function reviewed() {
    const draft = await service.start(sourceUrl, actor);
    await vi.waitFor(async () => expect((await service.get(draft.id)).status).toBe('review'));
    return draft.id;
  }

  it('persists source evidence and applies one atomic reviewed batch idempotently', async () => {
    const id = await reviewed();
    expect(await service.get(id)).toMatchObject({ documentDate: '2026-10-15', reference: 'Reference OCR',
      sourceLastModified: 'Thu, 01 Jan 1970 00:00:00 GMT', status: 'review', appliedAt: null });
    expect((await service.file(id)).bytes.toString()).toBe('%PDF-TEST');
    const saved = await Promise.all([service.apply(id, request, actor), service.apply(id, request, actor)]);
    expect(saved[1]).toEqual(saved[0]);
    expect((await pool.query('SELECT count(*)::int n FROM project.revision_index')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM project.revision_index_audit')).rows[0].n).toBe(2);
    await expect(service.apply(id, { ...request, reference: 'Changed after apply' }, actor)).rejects.toThrow(/autre contenu/);
    expect((await service.start(sourceUrl, actor)).id).toBe(id);
  });

  it('rolls back all registry writes and the receipt if batch persistence fails', async () => {
    const id = await reviewed();
    vi.spyOn(DrizzleBtpRegistresRepository.prototype, 'upsertIndexMonthsTx').mockImplementationOnce(async (tx) => {
      await tx.execute(sql`INSERT INTO project.revision_index(month_date,index_values) VALUES ('2026-01-01','{"TEST":125}'::jsonb)`);
      throw new Error('simulated failure after first month');
    });
    await expect(service.apply(id, request, actor)).rejects.toThrow(/simulated/);
    expect((await pool.query('SELECT count(*)::int n FROM project.revision_index')).rows[0].n).toBe(0);
    expect((await service.get(id)).status).toBe('review');
  });

  it('uses a new lease on stale retry and discards completion of the superseded extraction', async () => {
    let first!: (result: Awaited<ReturnType<typeof runDossierFileOcr>>) => void;
    let second!: (result: Awaited<ReturnType<typeof runDossierFileOcr>>) => void;
    const ocr = vi.fn<typeof runDossierFileOcr>()
      .mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    service = new BtpIndexImportService(db, storage, { fetch: fakeFetch, ocr });
    const draft = await service.start(sourceUrl, actor);
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(1));
    await service.retry(draft.id);
    expect(ocr).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE project.revision_index_import SET lease_expires_at=now()-interval '1 minute' WHERE id=$1", [draft.id]);
    await service.retry(draft.id);
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2));
    second(ocrResult('Fresh extraction'));
    await vi.waitFor(async () => expect((await service.get(draft.id)).reference).toBe('Fresh extraction'));
    first(ocrResult('Stale extraction'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await service.get(draft.id)).reference).toBe('Fresh extraction');
  });

  it('rejects an unlisted source and a cross-origin redirect before PDF acquisition', async () => {
    await expect(service.start('https://www.equipement.gov.ma/Ingenierie/Documents/Bareme-unlisted.pdf', actor)).rejects.toThrow(/Choisir/);
    const fetchRedirect: typeof fetch = async (input) => String(input) === MINISTRY_INDEX_URL
      ? new Response('<a href="/Ingenierie/Documents/Bareme-test.pdf">Test</a>')
      : new Response(null, { status: 302, headers: { location: 'https://outside.test/Bareme.pdf' } });
    const other = new BtpIndexImportService(db, storage, { fetch: fetchRedirect });
    await expect(other.start(sourceUrl, actor)).rejects.toThrow(/extérieure/);
    expect((await pool.query('SELECT count(*)::int n FROM project.revision_index_import')).rows[0].n).toBe(0);
  });

  it('allows an explicitly reviewed month the OCR missed and preserves it in a correction draft', async () => {
    const id = await reviewed();
    const added = { ...request, months: [{ month: '2026-03', status: 'definitif' as const, indexValues: { TEST: 175 } }] };
    await expect(service.apply(id, added, actor)).resolves.toMatchObject({ status: 'applied', months: ['2026-03'] });
    const clone = await service.review(id, actor);
    expect(clone.months).toContainEqual({ month: '2026-03', status: 'definitif', values: { TEST: 175 }, evidence: [] });
  });

  it('refuses an unlisted ministry redirect target', async () => {
    const fetchRedirect: typeof fetch = async (input) => String(input) === MINISTRY_INDEX_URL
      ? new Response('<a href="/Ingenierie/Documents/Bareme-test.pdf">Test</a>')
      : new Response(null, { status: 302, headers: { location: '/Ingenierie/Documents/Bareme-hidden.pdf' } });
    const other = new BtpIndexImportService(db, storage, { fetch: fetchRedirect });
    await expect(other.start(sourceUrl, actor)).rejects.toThrow(/découvert/);
  });

  it('opens an idempotent review correction retaining the original receipt and source bytes', async () => {
    const id = await reviewed();
    const receipt = await service.apply(id, request, actor);
    const clones = await Promise.all([service.review(id, actor), service.review(id, actor)]);
    expect(clones[0].id).toBe(clones[1].id);
    expect(clones[0]).toMatchObject({ status: 'review', previousImportId: id, appliedAt: null, reference: request.reference });
    expect(clones[0].sha256).toBe((await service.get(id)).sha256);
    expect(await service.apply(id, request, actor)).toEqual(receipt);
    const correction = { ...request, months: request.months.map((month) => ({ ...month, indexValues: { TEST: 175 } })) };
    await service.apply(clones[0].id, correction, actor);
    expect((await service.get(id)).status).toBe('applied');
    expect((await pool.query("SELECT previous_publications FROM project.revision_index WHERE month_date='2026-01-01'")).rows[0].previous_publications[0].values.TEST).toBe(125);
  });

  it('downloads, archives and applies successive monthly bulletins on the same hosting date', async () => {
    let augustPublished = false;
    const july = '/Ingenierie/Documents/Bareme-juillet-2026.pdf';
    const august = '/Ingenierie/Documents/Bareme-aout-2026.pdf';
    const minister: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.toString() === MINISTRY_INDEX_URL) {
        return new Response(`<a href="${july}">Juillet</a>${augustPublished ? `<a href="${august}">Août</a>` : ''}`);
      }
      return new Response(`%PDF-${url.pathname === july ? 'JULY' : 'AUGUST'}`,
        { headers: { 'last-modified': 'Wed, 04 Nov 2026 14:36:01 GMT' } });
    };
    const readOfficial = vi.fn(async (bytes: Buffer) => {
      const isAugust = bytes.toString().endsWith('AUGUST');
      const title = isAugust ? 'AOÛT 2026* SEPTEMBRE 2026** OCTOBRE 2026**' : 'JUILLET 2026* AOÛT 2026** SEPTEMBRE 2026**';
      const ref = isAugust ? '987' : '986';
      return {
        covers: [2, 6].map((num) => ({ num, text: `DATRP/32/${ref}\n${title}` })),
        rows: [{ page: 7, code: 'TR1', values: (isAugust ? [241, 242, 243] : [231, 232, 233]) as [number, number, number] }],
      };
    });
    service = new BtpIndexImportService(db, storage, {
      fetch: minister, readOfficial, ocr: async () => ocrResult(), now: () => new Date('2026-11-16T10:00:00Z'),
    });
    const manual = await service.start(new URL(july, MINISTRY_INDEX_URL).toString(), actor);
    await vi.waitFor(async () => expect((await service.get(manual.id)).status).toBe('review'));
    expect(await service.synchronize()).toEqual([{ month: '2026-07', status: 'applied' }]);
    expect((await service.get(manual.id)).status).toBe('review');
    augustPublished = true;
    await service.synchronize();
    const saved = await pool.query("SELECT month_date::text, status, index_values, previous_publications FROM project.revision_index ORDER BY month_date");
    expect(saved.rows.map((row) => [row.month_date, row.status, row.index_values.TR1])).toEqual([
      ['2026-07-01', 'definitif', 231], ['2026-08-01', 'definitif', 241],
      ['2026-09-01', 'provisoire', 242], ['2026-10-01', 'provisoire', 243],
    ]);
    expect(saved.rows[1].previous_publications[0]).toMatchObject({ status: 'provisoire', values: { TR1: 232 } });
    const archived = (await service.list()).find(({ reference }) => reference === 'DATRP/32/987')!;
    expect((await service.file(archived.id)).bytes.toString()).toBe('%PDF-AUGUST');
    await expect(service.apply(archived.id, request, actor)).rejects.toThrow(/autre mode/);
    await service.synchronize();
    expect(readOfficial).toHaveBeenCalledTimes(2);
    expect((await pool.query('SELECT count(*)::int n FROM project.revision_index_audit')).rows[0].n).toBe(6);

    const registers = new DrizzleBtpRegistresRepository(db);
    await db.transaction((tx) => registers.upsertIndexMonthsTx(tx, [{
      monthDate: new Date('2026-08-01T00:00:00Z'), publishedOn: '2026-10-30', source: 'DATRP/32/985',
      status: 'provisoire', indexValues: { TR1: 228 },
    }], actor, true));
    const late = (await pool.query("SELECT * FROM project.revision_index WHERE month_date='2026-08-01'")).rows[0];
    expect(late.index_values).toEqual({ TR1: 241 });
    expect(late.previous_publications).toContainEqual({
      values: { TR1: 228 }, status: 'provisoire', source: 'DATRP/32/985', publishedOn: '2026-10-30',
    });
  });
});
