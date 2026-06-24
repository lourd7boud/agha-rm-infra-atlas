import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFParse } from 'pdf-parse';

const execFileAsync = promisify(execFile);

/**
 * Shared OCR / PDF-text plumbing for ATLAS extractors. The PDF helpers are
 * lifted verbatim from the dossier-text module (where they were proven on
 * thousands of live DCEs) so the result/PV crawlers can reuse the same path
 * for the scanned avis served by the Atexo portal. ocrBytesToText extends
 * the family with a magic-byte router that also accepts raw image bytes
 * (TIFF/JPEG/PNG/BMP) — ocrmypdf eats those natively, so no img2pdf needed.
 */

/** Pulls plain text from one PDF's bytes. Injectable so tests avoid real PDFs. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<string>;

/** A "real" body-text char count, ignoring the per-page sentinel pdf-parse
 *  emits even for empty (scanned-only) pages. Below this threshold the doc
 *  is treated as an image scan and routed through OCR. */
export const MIN_TEXT_LAYER_CHARS = 200;

/** ocrmypdf invocation timeout per PDF — covers a worst-case ~30-page scanned
 *  CPS without hanging the whole batch when a single doc is pathological. */
export const OCR_TIMEOUT_MS = 5 * 60 * 1000;

/** Cap OCR to the first N pages. The headline facts (estimation, cautions,
 *  qualifications/classe, délais) live in the RC + the opening articles of the
 *  CPS — never on page 120 of a 140-page scan. Limiting pages turns a fragile
 *  multi-minute marathon (which errored out entirely on big DCEs) into a fast,
 *  reliable pass. BPU detail, when present, is usually its own short BDP file. */
export const OCR_MAX_PAGES = 30;

/** pdf-parse emits a per-page sentinel like "-- 1 of 1 --" even when the page
 *  has zero text layer (scanned PDF). Strip those lines so a 4-file scanned
 *  dossier doesn't masquerade as "163 chars of text". */
const SENTINEL_LINE = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

/** Pure pdf-parse text-layer extraction — fast, free, works on any PDF that
 *  has actual embedded text (digital exports from Word, LibreOffice, etc.). */
export async function pdfParseExtract(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Runs ocrmypdf on bytes, then re-parses the OCR'd PDF to get the new text
 *  layer. Returns empty string on any failure (binary missing, timeout,
 *  unsupported PDF) — caller falls back to the bare pdf-parse output. */
export async function ocrFallback(bytes: Uint8Array): Promise<string> {
  if (process.env.ATLAS_OCR_DISABLED === '1') return '';
  const stamp = `${process.pid}-${(globalThis as { __ocrSeq?: number }).__ocrSeq ?? 0}`;
  (globalThis as { __ocrSeq?: number }).__ocrSeq =
    ((globalThis as { __ocrSeq?: number }).__ocrSeq ?? 0) + 1;
  const dir = await mkdtemp(join(tmpdir(), `atlas-ocr-${stamp}-`));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, bytes);
    // --force-ocr: re-OCR even pages with a (broken) text layer.
    // --pages 1-N: only OCR the opening pages (headline facts live there); a
    //   140-page scan otherwise errored out entirely ("[tesseract] Error during
    //   processing") and produced NO output, leaving every field empty.
    // --skip-big: pass through pages whose raster exceeds N megapixels instead
    //   of choking tesseract — another source of the whole-doc failure.
    // NOTE: --rotate-pages / --deskew were REMOVED — on multi-page Moroccan DCE
    //   scans they triggered the tesseract processing error that killed the run.
    // --tesseract-timeout: cap per-page time so a noisy page is skipped, not fatal.
    // -l fra+ara: French + Arabic (Moroccan PMP DCEs are bilingual).
    await execFileAsync(
      'ocrmypdf',
      [
        '--force-ocr',
        '--pages',
        `1-${OCR_MAX_PAGES}`,
        '--skip-big',
        '50',
        '--tesseract-timeout',
        '90',
        '-l',
        'fra+ara',
        '--output-type',
        'pdf',
        '--quiet',
        inPath,
        outPath,
      ],
      { timeout: OCR_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );
    const ocrBytes = await readFile(outPath);
    return await pdfParseExtract(new Uint8Array(ocrBytes));
  } catch {
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Default PDF extractor: pdf-parse first (cheap), OCR fallback when the
 *  text layer comes back empty or sentinel-only (scanned PDF). The OCR path
 *  is what unlocks Budget / Caution / BPU on the ~70% of communal-BTP DCEs
 *  that ship as scans — without it, we were dropping those silently. */
export const defaultPdfExtractor: PdfTextExtractor = async (bytes) => {
  const direct = await pdfParseExtract(bytes);
  // Mirror normalize()'s sentinel strip so we measure REAL body text only
  // (not the pdf-parse "-- 1 of N --" page markers a scanned PDF emits).
  const measure = direct
    .replace(SENTINEL_LINE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (measure.length >= MIN_TEXT_LAYER_CHARS) return direct;
  // Skip OCR on suspiciously tiny PDFs — likely just a cover page or an
  // empty stub, not worth the 30s+ OCR round-trip.
  if (bytes.length < 50_000) return direct;
  const ocred = await ocrFallback(bytes);
  return ocred.length > direct.length ? ocred : direct;
};

/** Magic-byte sniff so we route PDF bytes through the proven dossier path and
 *  raster bytes (TIFF/JPEG/PNG/BMP) through ocrmypdf directly. ocrmypdf accepts
 *  image inputs natively (transparent --image-dpi=300), so no img2pdf needed. */
type RasterFmt = { ext: 'tif' | 'jpg' | 'png' | 'bmp' };
function sniffRaster(bytes: Uint8Array): RasterFmt | null {
  if (bytes.length < 4) return null;
  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) return { ext: 'tif' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg' };
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return { ext: 'png' };
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return { ext: 'bmp' };
  return null;
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  );
}

/** Runs ocrmypdf on raster image bytes (TIFF/JPEG/PNG/BMP), then parses the
 *  produced PDF for its OCR'd text layer. Mirrors ocrFallback's failure model:
 *  any failure returns '' so the caller can decide what to do. */
async function ocrImageBytes(bytes: Uint8Array, ext: RasterFmt['ext']): Promise<string> {
  if (process.env.ATLAS_OCR_DISABLED === '1') return '';
  const stamp = `${process.pid}-${(globalThis as { __ocrSeq?: number }).__ocrSeq ?? 0}`;
  (globalThis as { __ocrSeq?: number }).__ocrSeq =
    ((globalThis as { __ocrSeq?: number }).__ocrSeq ?? 0) + 1;
  const dir = await mkdtemp(join(tmpdir(), `atlas-ocr-img-${stamp}-`));
  const inPath = join(dir, `in.${ext}`);
  const outPath = join(dir, 'out.pdf');
  try {
    await writeFile(inPath, bytes);
    // --image-dpi 300: assume a sensible scan DPI when the image embeds none
    // (typical for portal-issued TIFF/JPEG). --skip-big guards huge rasters.
    // --rotate-pages/--deskew removed (same tesseract failure as ocrFallback).
    await execFileAsync(
      'ocrmypdf',
      [
        '--image-dpi',
        '300',
        '--skip-big',
        '50',
        '--tesseract-timeout',
        '90',
        '-l',
        'fra+ara',
        '--output-type',
        'pdf',
        '--quiet',
        inPath,
        outPath,
      ],
      { timeout: OCR_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );
    const ocrBytes = await readFile(outPath);
    return await pdfParseExtract(new Uint8Array(ocrBytes));
  } catch {
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * One entry point for "give me text from these avis bytes". Routes PDF input
 * through the dossier defaultPdfExtractor (pdf-parse → OCR fallback) and raster
 * input straight to ocrmypdf. Throws on unknown formats so the caller can log
 * + skip rather than silently feeding garbage to the LLM.
 */
export async function ocrBytesToText(
  bytes: Uint8Array,
  extractPdf: PdfTextExtractor = defaultPdfExtractor,
): Promise<string> {
  if (isPdf(bytes)) return extractPdf(bytes);
  const raster = sniffRaster(bytes);
  if (raster) return ocrImageBytes(bytes, raster.ext);
  throw new Error('avis bytes: unsupported format');
}
