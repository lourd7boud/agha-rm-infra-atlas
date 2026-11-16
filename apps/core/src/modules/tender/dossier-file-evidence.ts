import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 5;
const MAX_SNIPPET_CHARACTERS = 300;
const MAX_PAGE_TEXT_CHARACTERS = 100_000;
const MAX_PARSE_TIME_MS = 20_000;
const MAX_CLEANUP_TIME_MS = 250;
// A page number or short footer alone does not establish a usable text layer.
const MIN_READABLE_PAGE_CHARACTERS = 40;

export interface DossierPdfText {
  total: number;
  pages: Array<{ num: number; text: string }>;
}

export interface DossierPdfParser {
  getText(options: { first: number }): Promise<DossierPdfText>;
  destroy(): Promise<void>;
}

export interface DossierFileEvidence {
  filename: string;
  sha256: string;
  sizeBytes: number;
  checkedAt: string;
  state: 'digital_text' | 'mixed' | 'needs_ocr' | 'unsupported' | 'failed';
  coverage: 'none' | 'partial' | 'complete';
  totalPages: number | null;
  pagesInspected: number;
  // Counts cover at most 100,000 extracted characters per page; truncation is explicit.
  pages: Array<{ num: number; characterCount: number; snippet: string; textTruncated: boolean }>;
  failureCode?: 'file_too_large' | 'unsupported_file_type' | 'pdf_parse_failed' | 'invalid_pdf_page_result'
    | 'pdf_parse_timeout' | 'inspection_aborted';
}

interface EvidenceDependencies {
  createParser?: (data: Uint8Array) => DossierPdfParser;
  now?: () => Date;
  signal?: AbortSignal;
  /** May shorten, but never extend, the 20-second parser deadline. */
  timeoutMs?: number;
}

/**
 * Inspect only the selected, already acquired file. Text states describe the first
 * five pages; coverage describes how much of the document those pages represent.
 * Neither a text layer nor complete sampling establishes document authenticity.
 */
export async function inspectDossierFile(
  bytes: Uint8Array,
  filename: string,
  dependencies: EvidenceDependencies = {},
): Promise<DossierFileEvidence> {
  const evidence: DossierFileEvidence = {
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    state: 'failed',
    coverage: 'none',
    totalPages: null,
    pagesInspected: 0,
    pages: [],
  };
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ...evidence, failureCode: 'file_too_large' };
  }
  if (!/\.pdf$/i.test(filename)) {
    return { ...evidence, state: 'unsupported', failureCode: 'unsupported_file_type' };
  }
  if (dependencies.signal?.aborted) {
    return { ...evidence, failureCode: 'inspection_aborted' };
  }

  let parser: DossierPdfParser | undefined;
  let destruction: Promise<void> | undefined;
  // Attach the rejection handler when destruction starts, including on cancellation.
  const beginDestroy = (): Promise<void> => destruction ??= Promise.resolve()
    .then(() => parser?.destroy()).then(() => undefined, () => undefined);
  const timeoutMs = Number.isFinite(dependencies.timeoutMs)
    ? Math.max(1, Math.min(MAX_PARSE_TIME_MS, dependencies.timeoutMs!)) : MAX_PARSE_TIME_MS;
  let failureCode: 'pdf_parse_timeout' | 'inspection_aborted' | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectInterruption!: (reason: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  const stop = (code: 'pdf_parse_timeout' | 'inspection_aborted'): void => {
    if (failureCode) return;
    failureCode = code;
    void beginDestroy();
    rejectInterruption(new Error(code));
  };
  const abort = (): void => stop('inspection_aborted');
  try {
    // PDF.js can transfer its input buffer to a worker. Preserve the caller's copy.
    const copiedBytes = new Uint8Array(bytes);
    parser = dependencies.createParser?.(copiedBytes) ?? new PDFParse({ data: copiedBytes });
    dependencies.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('pdf_parse_timeout'), timeoutMs);
    if (dependencies.signal?.aborted) abort();
    const parsing = Promise.resolve().then(() => {
      if (failureCode) throw new Error(failureCode);
      return parser!.getText({ first: MAX_PAGES });
    });
    const cleanupAfterInterruption = (): Promise<void> | undefined => {
      // PDFParse.destroy() can be a no-op before its document finishes loading.
      // Retry after late settlement, independently of the first cleanup promise.
      if (failureCode) return parser?.destroy();
      return undefined;
    };
    // This cleanup owns its rejection handler and never extends the caller's lease.
    void parsing.then(cleanupAfterInterruption, cleanupAfterInterruption).catch(() => undefined);
    const result = await Promise.race([parsing, interrupted]);
    const expected = Math.min(result.total, MAX_PAGES);
    if (
      !Number.isSafeInteger(result.total) || result.total <= 0 ||
      !Array.isArray(result.pages) || result.pages.length !== expected ||
      result.pages.some((page, index) => page.num !== index + 1 || typeof page.text !== 'string')
    ) {
      return { ...evidence, failureCode: 'invalid_pdf_page_result' };
    }
    const pages = result.pages.map(({ num, text }) => {
      const textTruncated = text.length > MAX_PAGE_TEXT_CHARACTERS;
      const clean = text.slice(0, MAX_PAGE_TEXT_CHARACTERS)
        .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').replace(/\s+/g, ' ').trim();
      return { num, characterCount: clean.length, snippet: clean.slice(0, MAX_SNIPPET_CHARACTERS), textTruncated };
    });
    const readablePages = pages.filter((page) => page.characterCount >= MIN_READABLE_PAGE_CHARACTERS).length;
    return {
      ...evidence,
      state: readablePages === 0 ? 'needs_ocr' : readablePages === pages.length ? 'digital_text' : 'mixed',
      coverage: result.total === pages.length ? 'complete' : 'partial',
      totalPages: result.total,
      pagesInspected: pages.length,
      pages,
    };
  } catch {
    // Parser messages may contain file contents, passwords or local paths.
    return { ...evidence, failureCode: failureCode ?? 'pdf_parse_failed' };
  } finally {
    clearTimeout(timer);
    dependencies.signal?.removeEventListener('abort', abort);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A broken worker must not hold the selected-file lease indefinitely.
      await Promise.race([
        beginDestroy(),
        new Promise<void>((resolve) => {
          cleanupTimer = setTimeout(resolve, Math.min(timeoutMs, MAX_CLEANUP_TIME_MS));
        }),
      ]);
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
}
