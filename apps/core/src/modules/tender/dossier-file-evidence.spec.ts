import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  inspectDossierFile,
  type DossierPdfParser,
  type DossierPdfText,
} from './dossier-file-evidence';

const bytes = new TextEncoder().encode('%PDF-1.7\nselected cached bytes');
const now = new Date('2026-11-12T22:00:00Z');
const text = 'Conditions de participation publiées dans le règlement de consultation.';

function parser(result: DossierPdfText | Error) {
  return {
    getText: result instanceof Error
      ? vi.fn(async () => { throw result; })
      : vi.fn(async () => result),
    destroy: vi.fn(async () => {}),
  };
}

describe('selected DCE file evidence', () => {
  it('reports a scanned PDF distinctly from a parsing failure', async () => {
    const pdf = parser({ total: 2, pages: [{ num: 1, text: '' }, { num: 2, text: '  -- 2 of 2 --  ' }] });
    const evidence = await inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf, now: () => now });
    expect(evidence).toMatchObject({
      filename: 'RC.pdf', state: 'needs_ocr', coverage: 'complete',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length, checkedAt: now.toISOString(), totalPages: 2, pagesInspected: 2,
      pages: [{ num: 1, characterCount: 0, snippet: '' }, { num: 2, characterCount: 0, snippet: '' }],
    });
    expect(pdf.getText).toHaveBeenCalledWith({ first: 5 });
    expect(pdf.destroy).toHaveBeenCalledOnce();

    const corrupt = parser(new Error('password or internal parser details'));
    const failed = await inspectDossierFile(bytes, 'CPS.pdf', { createParser: () => corrupt, now: () => now });
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'pdf_parse_failed', coverage: 'none', pagesInspected: 0 });
    expect(JSON.stringify(failed)).not.toContain('internal parser details');
    expect(corrupt.destroy).toHaveBeenCalledOnce();
  });

  it('reports a partial mixed-text sample with actual page numbers and bounded source snippets', async () => {
    const pdf = parser({
      total: 40,
      pages: [
        { num: 1, text: text.repeat(20) }, { num: 2, text: '' },
        { num: 3, text }, { num: 4, text }, { num: 5, text },
      ],
    });
    const evidence = await inspectDossierFile(bytes, 'CPS.pdf', { createParser: () => pdf, now: () => now });
    expect(evidence).toMatchObject({ state: 'mixed', coverage: 'partial', totalPages: 40, pagesInspected: 5 });
    expect(evidence.pages[0]).toMatchObject({ num: 1, characterCount: text.repeat(20).length });
    expect(evidence.pages[0]?.snippet).toHaveLength(300);
    expect(evidence.pages[1]?.snippet).toBe('');
    expect(evidence.pages[2]?.snippet).toBe(text);
  });

  it('marks readable sampled pages separately from complete document coverage', async () => {
    const pdf = parser({ total: 1, pages: [{ num: 1, text }] });
    const evidence = await inspectDossierFile(bytes, 'RC.PDF', { createParser: () => pdf });
    expect(evidence).toMatchObject({ state: 'digital_text', coverage: 'complete', totalPages: 1, pagesInspected: 1 });
  });

  it('bounds text processing and explicitly marks a capped page character count', async () => {
    const pdf = parser({ total: 1, pages: [{ num: 1, text: 'a'.repeat(200_000) }] });
    const evidence = await inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf });
    expect(evidence.pages[0]).toMatchObject({ characterCount: 100_000, textTruncated: true });
    expect(evidence.pages[0]?.snippet).toHaveLength(300);
  });

  it('copies input before parsing so worker transfer cannot detach caller bytes', async () => {
    const original = bytes.slice();
    let passed: Uint8Array | undefined;
    const createParser = (data: Uint8Array): DossierPdfParser => {
      passed = data;
      const buffer = data.buffer;
      if (!(buffer instanceof ArrayBuffer)) throw new Error('Expected a transferable copy');
      structuredClone(buffer, { transfer: [buffer] });
      return parser({ total: 1, pages: [{ num: 1, text }] });
    };
    await inspectDossierFile(original, 'RC.pdf', { createParser });
    expect(passed === original).toBe(false);
    expect(original).toEqual(bytes);
  });

  it('does not parse unsupported formats or oversized selected files', async () => {
    const createParser = vi.fn(() => parser({ total: 1, pages: [{ num: 1, text }] }));
    expect(await inspectDossierFile(bytes, 'BPU.xlsx', { createParser })).toMatchObject({
      state: 'unsupported', failureCode: 'unsupported_file_type', coverage: 'none',
    });
    expect(await inspectDossierFile(new Uint8Array(16 * 1024 * 1024 + 1), 'CPS.pdf', { createParser }))
      .toMatchObject({ state: 'failed', failureCode: 'file_too_large', coverage: 'none' });
    expect(createParser).not.toHaveBeenCalled();
  });

  it('does not label incomplete or duplicate parser pages as a complete review', async () => {
    const pdf = parser({ total: 2, pages: [{ num: 1, text }, { num: 1, text }] });
    expect(await inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf }))
      .toMatchObject({ state: 'failed', failureCode: 'invalid_pdf_page_result', coverage: 'none' });
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it('releases a timed-out inspection even when parsing and destroy both hang', async () => {
    vi.useFakeTimers();
    try {
      const pdf = {
        getText: vi.fn(() => new Promise<DossierPdfText>(() => {})),
        destroy: vi.fn(() => new Promise<void>(() => {})),
      };
      const pending = inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf, timeoutMs: 20 });
      await vi.advanceTimersByTimeAsync(41);
      expect(await pending).toMatchObject({
        state: 'failed', coverage: 'none', failureCode: 'pdf_parse_timeout', pagesInspected: 0,
      });
      expect(pdf.destroy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys an aborted parser immediately and handles its late rejection', async () => {
    const controller = new AbortController();
    let rejectParse!: (error: Error) => void;
    const pdf = {
      getText: vi.fn(() => new Promise<DossierPdfText>((_resolve, reject) => { rejectParse = reject; })),
      destroy: vi.fn(async () => {}),
    };
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ state: 'failed', coverage: 'none', failureCode: 'inspection_aborted' });
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    rejectParse(new Error('late parser rejection'));
    await Promise.resolve();
  });

  it('does not start parsing a request that was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const createParser = vi.fn(() => parser({ total: 1, pages: [{ num: 1, text }] }));
    expect(await inspectDossierFile(bytes, 'RC.pdf', { createParser, signal: controller.signal }))
      .toMatchObject({ state: 'failed', coverage: 'none', failureCode: 'inspection_aborted' });
    expect(createParser).not.toHaveBeenCalled();
  });

  it('bounds destroy after abort and handles a cleanup rejection after release', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let rejectDestroy!: (error: Error) => void;
      const pdf = {
        getText: vi.fn(() => new Promise<DossierPdfText>(() => {})),
        destroy: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectDestroy = reject; })),
      };
      const pending = inspectDossierFile(bytes, 'RC.pdf', {
        createParser: () => pdf, signal: controller.signal, timeoutMs: 20,
      });
      await Promise.resolve();
      controller.abort();
      await vi.advanceTimersByTimeAsync(21);
      expect(await pending).toMatchObject({ failureCode: 'inspection_aborted', coverage: 'none' });
      expect(pdf.destroy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      rejectDestroy(new Error('late cleanup rejection'));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys again when a timed-out parser finishes loading after early cleanup', async () => {
    vi.useFakeTimers();
    try {
      let resolveLoad!: (result: DossierPdfText) => void;
      let documentLoaded = false;
      const destroyedDocuments: boolean[] = [];
      const pdf = {
        getText: vi.fn(async () => {
          const result = await new Promise<DossierPdfText>((resolve) => { resolveLoad = resolve; });
          documentLoaded = true;
          return result;
        }),
        destroy: vi.fn(async () => { destroyedDocuments.push(documentLoaded); }),
      };
      const pending = inspectDossierFile(bytes, 'RC.pdf', { createParser: () => pdf, timeoutMs: 20 });
      await vi.advanceTimersByTimeAsync(21);
      expect(await pending).toMatchObject({ failureCode: 'pdf_parse_timeout' });
      expect(destroyedDocuments).toEqual([false]);
      resolveLoad({ total: 1, pages: [{ num: 1, text }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(destroyedDocuments).toEqual([false, true]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
