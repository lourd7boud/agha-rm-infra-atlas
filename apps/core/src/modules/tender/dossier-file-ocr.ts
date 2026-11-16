import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_PDF_BYTES = 96 * 1024 * 1024;
const MAX_PROCESSED_PAGES = 60;
const MAX_DOCUMENT_PAGES = 2000;
const MAX_PAGE_CHARACTERS = 20_000;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TIME_MS = 240_000;
const MIN_TEXT_CHARACTERS = 40;

type FailureCode = 'unsupported_file' | 'file_too_large' | 'invalid_pdf' | 'invalid_page_result' | 'ocr_failed' | 'ocr_timeout' | 'ocr_aborted';
export interface DossierFileOcrPage {
  num: number;
  state: 'text' | 'no_text' | 'not_processed';
  text: string;
  textTruncated: boolean;
}
export interface DossierFileOcr {
  version: 1;
  engine: 'local-ocr';
  filename: string;
  sha256: string;
  sizeBytes: number;
  checkedAt: string;
  totalPages: number | null;
  pagesProcessed: number;
  /** Complete means every page was attempted and its returned text retained. */
  coverage: 'none' | 'partial' | 'complete';
  state: 'text' | 'mixed' | 'failed';
  pages: DossierFileOcrPage[];
  failureCode?: FailureCode;
}
export type OcrRunner = (
  command: string,
  args: string[],
  options: { signal: AbortSignal; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;
interface OcrOptions {
  signal?: AbortSignal;
  rotatePages?: boolean;
  /** Can shorten but never extend the four-minute ceiling. */
  timeoutMs?: number;
  runner?: OcrRunner;
  now?: () => Date;
}

/** No shell. On Linux, cancellation terminates the entire OCR process group. */
const localRunner: OcrRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32', env: { ...process.env, LC_ALL: 'C' },
  });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  let stopped: Error | undefined;
  let closed = false;
  let exitCode: number | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* Process group may already have exited. */ }
  };
  const cleanup = () => {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  };
  const finish = () => {
    if (!closed || killTimer) return;
    cleanup();
    if (stopped || exitCode !== 0) reject(stopped ?? new Error('OCR command failed'));
    else resolve({ stdout: Buffer.concat(chunks).toString('utf8') });
  };
  const stop = (reason: Error) => {
    if (stopped) return;
    stopped = reason;
    kill('SIGTERM');
    killTimer = setTimeout(() => { kill('SIGKILL'); killTimer = undefined; finish(); }, 200);
    killTimer.unref();
  };
  const abort = () => stop(new Error('OCR command aborted'));
  const timer = setTimeout(() => stop(new Error('OCR command timed out')), options.timeout);
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  child.stdout.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > options.maxBuffer) stop(new Error('OCR output limit exceeded'));
    else chunks.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > options.maxBuffer) stop(new Error('OCR output limit exceeded'));
  });
  child.once('error', () => { stopped ??= new Error('OCR command unavailable'); closed = true; finish(); });
  child.once('close', (code) => { closed = true; exitCode = code; finish(); });
});

function boundedText(text: string, remainingBytes: number): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r/g, '').trim();
  let value = normalized.slice(0, MAX_PAGE_CHARACTERS);
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > remainingBytes) {
    value = encoded.subarray(0, remainingBytes).toString('utf8');
    while (Buffer.byteLength(value, 'utf8') > remainingBytes) value = value.slice(0, -1);
  }
  return { text: value, truncated: value !== normalized };
}

/** Machine OCR of a saved PDF only. It validates neither obligations nor revision. */
export async function runDossierFileOcr(bytes: Uint8Array, filename: string, options: OcrOptions = {}): Promise<DossierFileOcr> {
  const result: DossierFileOcr = {
    version: 1, engine: 'local-ocr', filename, sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength, checkedAt: (options.now?.() ?? new Date()).toISOString(),
    totalPages: null, pagesProcessed: 0, coverage: 'none', state: 'failed', pages: [],
  };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ...result, failureCode: 'file_too_large' };
  if (!filename || Buffer.byteLength(filename) > 1024 || !/\.pdf$/i.test(filename)) return { ...result, failureCode: 'unsupported_file' };
  if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') return { ...result, failureCode: 'invalid_pdf' };
  if (options.signal?.aborted) return { ...result, failureCode: 'ocr_aborted' };
  const controller = new AbortController();
  let failureCode: FailureCode | undefined;
  const abort = () => { failureCode = 'ocr_aborted'; controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(MAX_TIME_MS, options.timeoutMs!)) : MAX_TIME_MS;
  const deadline = Date.now() + timeout;
  const timer = setTimeout(() => { failureCode = 'ocr_timeout'; controller.abort(); }, timeout);
  const execute = options.runner ?? localRunner;
  let directory: string | undefined;
  let activeRun: Promise<{ stdout: string }> | undefined;
  async function command(name: string, args: string[], cap: number) {
    if (controller.signal.aborted) throw new Error('OCR cancelled');
    let stop!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { stop = () => reject(new Error('OCR cancelled')); });
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      activeRun = Promise.resolve().then(() => execute(name, args, {
        signal: controller.signal, timeout: Math.max(1, Math.min(cap, deadline - Date.now())), maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      }));
      return await Promise.race([activeRun, cancelled]);
    } finally { controller.signal.removeEventListener('abort', stop); }
  }
  try {
    directory = await mkdtemp(join(tmpdir(), 'atlas-dce-ocr-'));
    const input = join(directory, 'source.pdf');
    const output = join(directory, 'ocr.pdf');
    await writeFile(input, bytes, { signal: controller.signal });
    const info = await command('pdfinfo', [input], 15_000);
    const count = Number(/^Pages:\s*(\d+)\s*$/m.exec(info.stdout)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DOCUMENT_PAGES) return { ...result, failureCode: 'invalid_page_result' };
    result.totalPages = count;
    result.pages = Array.from({ length: count }, (_, index) => ({ num: index + 1, state: 'not_processed', text: '', textTruncated: false }));
    const processed = Math.min(count, MAX_PROCESSED_PAGES);
    await command('ocrmypdf', [
      '--jobs', '1', '--force-ocr', '--pages', `1-${processed}`, '--skip-big', '30', '--tesseract-timeout', '30',
      ...(options.rotatePages ? ['--rotate-pages'] : []),
      '--output-type', 'pdf', '--optimize', '0', '--quiet', '-l', 'fra+ara', input, output,
    ], MAX_TIME_MS);
    const size = (await stat(output)).size;
    if (!size || size > MAX_OUTPUT_PDF_BYTES) throw new Error('OCR output PDF limit exceeded');
    const extracted = await command('pdftotext', ['-layout', '-enc', 'UTF-8', output, '-'], 30_000);
    const pages = extracted.stdout.split('\f');
    if (pages[pages.length - 1]?.trim() === '') pages.pop();
    if (pages.length !== count) return { ...result, failureCode: 'invalid_page_result' };
    let textBytes = 0;
    for (let index = 0; index < processed; index++) {
      const page = boundedText(pages[index]!, MAX_TEXT_BYTES - textBytes);
      textBytes += Buffer.byteLength(page.text, 'utf8');
      result.pages[index] = { num: index + 1, state: page.text.length >= MIN_TEXT_CHARACTERS ? 'text' : 'no_text', text: page.text, textTruncated: page.truncated };
    }
    result.pagesProcessed = processed;
    result.coverage = processed === count && !result.pages.some(page => page.textTruncated) ? 'complete' : 'partial';
    result.state = result.pages.every(page => page.state === 'text') ? 'text' : 'mixed';
    return result;
  } catch {
    return { ...result, failureCode: failureCode ?? 'ocr_failed' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (controller.signal.aborted && activeRun) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([activeRun.catch(() => undefined), new Promise(resolve => { cleanupTimer = setTimeout(resolve, 250); })]);
      clearTimeout(cleanupTimer);
    }
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export function projectDossierFileOcr(result: DossierFileOcr) {
  return {
    version: result.version, engine: result.engine, filename: result.filename, sha256: result.sha256,
    sizeBytes: result.sizeBytes, checkedAt: result.checkedAt, totalPages: result.totalPages,
    pagesProcessed: result.pagesProcessed, coverage: result.coverage, state: result.state,
    ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    pages: result.pages.map(page => ({ num: page.num, state: page.state, textTruncated: page.textTruncated,
      characterCount: page.text.length, snippet: page.text.slice(0, 300) })),
  };
}

/** Reject stale, malformed or overstated persisted evidence before reuse. */
export function readCachedDossierFileOcr(value: unknown, sha256: string, filename: string): DossierFileOcr | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as DossierFileOcr;
  if (item.version !== 1 || item.engine !== 'local-ocr' || item.filename !== filename || item.sha256 !== sha256 || !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > MAX_FILE_BYTES ||
      typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt)) || Date.parse(item.checkedAt) > Date.now() ||
      !['text', 'mixed', 'failed'].includes(item.state) || !['none', 'partial', 'complete'].includes(item.coverage) ||
      !Array.isArray(item.pages) || item.pages.length > MAX_DOCUMENT_PAGES || !Number.isSafeInteger(item.pagesProcessed) ||
      item.pagesProcessed < 0 || item.pagesProcessed > MAX_PROCESSED_PAGES) return null;
  if (item.totalPages !== null && (!Number.isSafeInteger(item.totalPages) || item.totalPages < 1 || item.totalPages > MAX_DOCUMENT_PAGES)) return null;
  if (item.pages.length !== (item.totalPages ?? 0)) return null;
  let totalBytes = 0;
  for (let index = 0; index < item.pages.length; index++) {
    const page = item.pages[index];
    if (!page || page.num !== index + 1 || !['text', 'no_text', 'not_processed'].includes(page.state) ||
        typeof page.text !== 'string' || page.text.length > MAX_PAGE_CHARACTERS || typeof page.textTruncated !== 'boolean') return null;
    totalBytes += Buffer.byteLength(page.text, 'utf8');
    if (totalBytes > MAX_TEXT_BYTES || (page.state === 'text') !== (page.text.length >= MIN_TEXT_CHARACTERS) ||
        (page.state === 'not_processed' && (page.text !== '' || page.textTruncated)) ||
        (index >= item.pagesProcessed && page.state !== 'not_processed') ||
        (index < item.pagesProcessed && page.state === 'not_processed')) return null;
  }
  if (item.state === 'failed') {
    if (item.coverage !== 'none' || item.pagesProcessed !== 0 ||
        !['unsupported_file', 'file_too_large', 'invalid_pdf', 'invalid_page_result', 'ocr_failed', 'ocr_timeout', 'ocr_aborted'].includes(item.failureCode ?? '')) return null;
  } else {
    if (item.totalPages === null || item.pages.length !== item.totalPages || item.pagesProcessed !== Math.min(item.totalPages, MAX_PROCESSED_PAGES) || item.failureCode) return null;
    const coverage = item.pagesProcessed === item.totalPages && !item.pages.some(page => page.textTruncated) ? 'complete' : 'partial';
    const state = item.pages.every(page => page.state === 'text') ? 'text' : 'mixed';
    if (item.coverage !== coverage || item.state !== state) return null;
  }
  return {
    version: 1, engine: 'local-ocr', filename: item.filename, sha256: item.sha256,
    sizeBytes: item.sizeBytes, checkedAt: item.checkedAt, totalPages: item.totalPages,
    pagesProcessed: item.pagesProcessed, coverage: item.coverage, state: item.state,
    ...(item.failureCode ? { failureCode: item.failureCode } : {}),
    pages: item.pages.map(page => ({ num: page.num, state: page.state, text: page.text, textTruncated: page.textTruncated })),
  };
}
