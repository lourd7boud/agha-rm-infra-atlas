import type { ObjectStorage } from '../vault/storage';
import { extractDocText } from './dossier-text';
import { ocrBytesToText, pdfParseExtract } from './pdf-ocr';
import { defaultBinaryExtractor } from './dossier-binary';

/**
 * Shared plumbing for the text of a company LEGAL document (/compta/legal coffre)
 * — used both by the chat read path (CompanyLegalService) and by the upload path
 * (compta controller) so the extraction + cache-key stay identical. Kept as plain
 * functions (no NestJS provider) so the compta module can call it without a
 * module cycle: this file imports only the OCR/parse helpers, never compta.
 */

/** Per-document extracted-text budget (attestations are short). */
export const MAX_LEGAL_DOC_TEXT_CHARS = 6_000;

/** Office/text formats read by the in-house parsers — never need OCR. */
const OFFICE_NAME = /\.(docx?|xlsx?|odt|ods|csv|txt|rtf|ppt)$/i;

/** MinIO key of a document's cached extracted text. */
export function legalDocTextCacheKey(docId: string): string {
  return `legal-doc-text/${docId}.md`;
}

function normalizeWs(s: string): string {
  return s.replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function streamToString(body: AsyncIterable<Buffer | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Extracts a legal document's text. `ocr=true` routes PDFs/images through
 * ocrmypdf (fra+ara) so SCANNED papers (CIN, an attestation photographed…)
 * become readable — used at UPLOAD time. `ocr=false` is the cheap path
 * (pdf-parse text layer + OOXML, no OCR) used lazily on the chat request path.
 * Office/text formats always use the in-house parsers (no OCR needed). Never
 * throws — returns '' on any failure. Bounded to MAX_LEGAL_DOC_TEXT_CHARS.
 */
export async function extractLegalDocText(
  bytes: Uint8Array,
  fileName: string,
  ocr: boolean,
): Promise<string> {
  let raw = '';
  try {
    if (OFFICE_NAME.test(fileName)) {
      raw = await extractDocText(fileName, bytes, pdfParseExtract, defaultBinaryExtractor);
    } else if (ocr) {
      // PDF → pdf-parse then ocrmypdf fallback; raster image → ocrmypdf.
      raw = await ocrBytesToText(bytes);
    } else {
      raw = await extractDocText(fileName, bytes, pdfParseExtract, defaultBinaryExtractor);
    }
  } catch {
    raw = '';
  }
  return normalizeWs(raw).slice(0, MAX_LEGAL_DOC_TEXT_CHARS);
}

/** Cached extracted text for a document, or null when absent / empty. */
export async function readCachedLegalDocText(
  storage: ObjectStorage,
  docId: string,
): Promise<string | null> {
  try {
    const obj = await storage.getObject(legalDocTextCacheKey(docId));
    const text = await streamToString(obj.body as AsyncIterable<Buffer | Uint8Array>);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * Extracts (optionally with OCR) a document's text and caches it to MinIO under
 * legalDocTextCacheKey(docId). Caches only NON-empty text, so a scan whose OCR
 * yielded nothing can be retried by a later re-index. Returns the text.
 */
export async function extractAndCacheLegalDocText(
  storage: ObjectStorage,
  docId: string,
  bytes: Uint8Array,
  fileName: string,
  ocr: boolean,
): Promise<string> {
  const text = await extractLegalDocText(bytes, fileName, ocr);
  if (text) {
    await storage.put(
      legalDocTextCacheKey(docId),
      Buffer.from(text, 'utf8'),
      'text/markdown; charset=utf-8',
    );
  }
  return text;
}
