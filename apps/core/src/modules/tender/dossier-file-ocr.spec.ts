import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runDossierFileOcr, projectDossierFileOcr, readCachedDossierFileOcr, type OcrRunner } from './dossier-file-ocr';

const bytes = Buffer.from('%PDF-1.7\noriginal source');
const text = 'Conditions de participation et documents requis pour la consultation.';

function runner(pages: string[], total = pages.length): OcrRunner {
  return vi.fn(async (command, args) => {
    if (command === 'pdfinfo') return { stdout: `Pages: ${total}\n` };
    if (command === 'ocrmypdf') { await writeFile(args[args.length - 1]!, bytes); return { stdout: '' }; }
    return { stdout: pages.join('\f') + '\f' };
  });
}

describe('local saved DCE OCR', () => {
  it('keeps original identity and page boundaries and projects only short snippets', async () => {
    const execute = runner([text.repeat(10), text]);
    const result = await runDossierFileOcr(bytes, 'RC.pdf', { runner: execute, now: () => new Date('2026-11-13T21:00:00Z') });
    expect(result).toMatchObject({ filename: 'RC.pdf', sha256: createHash('sha256').update(bytes).digest('hex'),
      engine: 'local-ocr', totalPages: 2, pagesProcessed: 2, coverage: 'complete', state: 'text' });
    expect(result.pages.map(page => page.num)).toEqual([1, 2]);
    expect(bytes.toString()).toContain('original source');
    expect(execute).toHaveBeenCalledWith('ocrmypdf', expect.arrayContaining(['--pages', '1-2', '--jobs', '1', 'fra+ara']), expect.any(Object));
    const publicResult = projectDossierFileOcr(result);
    expect(publicResult.pages[0]?.snippet).toHaveLength(300);
    expect(publicResult.pages[0]).not.toHaveProperty('text');
    expect(readCachedDossierFileOcr(result, result.sha256, 'RC.pdf')).toEqual(result);
    expect(readCachedDossierFileOcr(result, '0'.repeat(64), 'RC.pdf')).toBeNull();
    expect(readCachedDossierFileOcr(result, result.sha256, 'CPS.pdf')).toBeNull();
  });

  it('retains empty and unprocessed pages without claiming complete reading', async () => {
    const pages = Array.from({ length: 62 }, (_, index) => index === 1 ? '' : text);
    const result = await runDossierFileOcr(bytes, 'CPS.pdf', { runner: runner(pages) });
    expect(result).toMatchObject({ totalPages: 62, pagesProcessed: 60, coverage: 'partial', state: 'mixed' });
    expect(result.pages[1]).toMatchObject({ num: 2, state: 'no_text', text: '' });
    expect(result.pages[60]).toMatchObject({ num: 61, state: 'not_processed', text: '' });
  });

  it('marks capped text as partial and rejects corrupted cached page structure', async () => {
    const result = await runDossierFileOcr(bytes, 'RC.pdf', { runner: runner(['a'.repeat(21_000)]) });
    expect(result.coverage).toBe('partial');
    expect(result.pages[0]).toMatchObject({ textTruncated: true });
    expect(result.pages[0]?.text.length).toBeLessThanOrEqual(20_000);
    expect(readCachedDossierFileOcr({ ...result, coverage: 'complete' }, result.sha256, 'RC.pdf')).toBeNull();
    expect(readCachedDossierFileOcr({ ...result, pages: [{ ...result.pages[0], num: 2 }] }, result.sha256, 'RC.pdf')).toBeNull();
  });

  it('distinguishes command failure and inconsistent page output without leaking internals', async () => {
    const failed = await runDossierFileOcr(bytes, 'RC.pdf', { runner: async () => { throw new Error('private local path'); } });
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'ocr_failed', coverage: 'none' });
    expect(JSON.stringify(failed)).not.toContain('private local path');
    const inconsistent = await runDossierFileOcr(bytes, 'RC.pdf', { runner: runner([text], 2) });
    expect(inconsistent).toMatchObject({ state: 'failed', failureCode: 'invalid_page_result' });
  });

  it('cancels a stalled command and does not start pre-aborted work', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => new Promise<{ stdout: string }>(() => {}));
    const pending = runDossierFileOcr(bytes, 'RC.pdf', { runner: execute, signal: controller.signal });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toMatchObject({ state: 'failed', failureCode: 'ocr_aborted' });
    const unused = vi.fn();
    expect(await runDossierFileOcr(bytes, 'RC.pdf', { runner: unused, signal: controller.signal }))
      .toMatchObject({ state: 'failed', failureCode: 'ocr_aborted' });
    expect(unused).not.toHaveBeenCalled();
  });

  it('bounds the overall deadline even if an injected runner ignores cancellation', async () => {
    const result = await runDossierFileOcr(bytes, 'RC.pdf', { timeoutMs: 10, runner: async () => new Promise(() => {}) });
    expect(result).toMatchObject({ state: 'failed', failureCode: 'ocr_timeout' });
  });

  it('rejects unsupported or oversized files before any commands', async () => {
    const execute = vi.fn();
    expect(await runDossierFileOcr(bytes, 'RC.docx', { runner: execute })).toMatchObject({ failureCode: 'unsupported_file' });
    expect(await runDossierFileOcr(new Uint8Array(25 * 1024 * 1024 + 1), 'RC.pdf', { runner: execute })).toMatchObject({ failureCode: 'file_too_large' });
    expect(execute).not.toHaveBeenCalled();
  });
});
