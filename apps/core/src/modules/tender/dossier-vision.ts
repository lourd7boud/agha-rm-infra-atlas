import { unzipSync } from 'fflate';
import type { LlmVisionDocImage } from '../brain/llm.client';
import {
  docPriority,
  isDataBearingDoc,
  MAX_PDF_BYTES,
  MIN_READABLE_FILE_CHARS,
} from './dossier-text';
import { pdfPageCount, pdfParseExtract, renderPdfToJpegBase64 } from './pdf-ocr';

/**
 * Builds the input for the VISION extraction path: unzips the DCE, classifies
 * each data-bearing PDF as digital (has a text layer) or scanned, renders the
 * scanned ones to page images (poppler), and keeps any digital text-layer
 * content alongside. The images go straight to the multimodal model — no
 * tesseract — which is both faster (no CPU OCR) and more accurate on scans and
 * BPU tables. DOCX is left to the text path (it already carries clean text).
 */

/** Total page-images sent to the model across all docs (cost/quality balance). */
export const VISION_MAX_PAGES = 20;
/** Per-document page cap so a fat RC never consumes the whole page budget,
 *  starving the BPU/CPS that follow it in priority order. */
export const VISION_PER_DOC_PAGES = 12;
/** A PDF counts as "digital" (text kept, NOT imaged) only when its text layer
 *  is DENSE enough — chars per page. A scanned PDF with a junk OCR layer
 *  (~14 chars/page) must fail this and be rendered to images, otherwise its
 *  pages — including a bordereau buried in the scan — never reach the model. */
const MIN_CHARS_PER_PAGE_DIGITAL = 120;
/** Keep at most this much digital text-layer content (hybrid dossiers) as
 *  context — the images carry the bulk of the signal. */
const MAX_DIGITAL_CONTEXT = 12_000;

/**
 * Chooses which pages of a scanned doc to image, within `budget` pages. The
 * bordereau des prix is almost always the LAST pages of the CPS, while the
 * headline facts (estimation, caution) are on the FIRST pages — so for a doc
 * longer than the budget we render the first half AND the last half rather than
 * a single leading block that would miss the bordereau. Returns contiguous
 * [first,last] page ranges (1-based, inclusive).
 */
export function selectVisionPageRanges(
  pages: number,
  budget: number,
): Array<[number, number]> {
  if (pages <= 0 || budget <= 0) return [];
  if (pages <= budget) return [[1, pages]];
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  const ranges: Array<[number, number]> = [[1, head]];
  if (tail > 0) ranges.push([pages - tail + 1, pages]);
  return ranges;
}

/** Loose image files in the DCE (a buyer who scanned the whole dossier to JPGs
 *  instead of a PDF). Sent straight to the multimodal model — only the formats
 *  Gemini accepts as inline_data. */
const IMAGE_NAME = /\.(jpe?g|png|webp)$/i;
function imageMediaType(name: string): LlmVisionDocImage['mediaType'] {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export interface DossierVisionInput {
  images: LlmVisionDocImage[];
  /** Text-layer content found in the same dossier (digital pieces), bounded. */
  digitalText: string;
  /** Names of the documents rendered or read (provenance). */
  sourceFiles: string[];
}

export async function buildVisionInput(
  zipBytes: Uint8Array,
  maxPages: number = VISION_MAX_PAGES,
): Promise<DossierVisionInput> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) =>
        (isDataBearingDoc(file.name) || IMAGE_NAME.test(file.name)) &&
        file.originalSize <= MAX_PDF_BYTES,
    });
  } catch {
    return { images: [], digitalText: '', sourceFiles: [] };
  }

  // PDFs are rendered to images; loose image files go straight to the model;
  // DOCX/XLSX text is handled by the text path. Priority order keeps RC/BPU first.
  const names = Object.keys(entries)
    .filter((n) => /\.pdf$/i.test(n) || IMAGE_NAME.test(n))
    .sort((a, b) => docPriority(a) - docPriority(b) || a.localeCompare(b));

  const images: LlmVisionDocImage[] = [];
  const digitalParts: string[] = [];
  const sourceFiles: string[] = [];
  let pagesLeft = maxPages;
  let digitalUsed = 0;

  for (const name of names) {
    if (pagesLeft <= 0) break;
    const bytes = entries[name];
    if (!bytes || bytes.length === 0) continue;

    // Loose image file → send the bytes straight to the model (counts as a page).
    if (IMAGE_NAME.test(name)) {
      images.push({
        base64: Buffer.from(bytes).toString('base64'),
        mediaType: imageMediaType(name),
      });
      pagesLeft -= 1;
      sourceFiles.push(name);
      continue;
    }

    // Page count drives BOTH the density gate and the page selection.
    const pages = await pdfPageCount(bytes);

    // Classify by DENSITY (chars per page), not an absolute count. Only a
    // genuinely text-rich PDF is kept as text and skipped for rendering; a
    // scanned PDF with a thin junk OCR layer fails this and is imaged, so a
    // bordereau buried in the scan still reaches the model.
    let txt = '';
    try {
      txt = await pdfParseExtract(bytes);
    } catch {
      txt = '';
    }
    const measured = txt.replace(/\s+/g, ' ').trim();
    const isDigital =
      measured.length >= MIN_READABLE_FILE_CHARS &&
      (pages <= 0 || measured.length / pages >= MIN_CHARS_PER_PAGE_DIGITAL);
    if (isDigital) {
      if (digitalUsed < MAX_DIGITAL_CONTEXT) {
        const room = MAX_DIGITAL_CONTEXT - digitalUsed;
        const slice = measured.slice(0, room);
        digitalParts.push(`===== ${name} =====\n${slice}`);
        digitalUsed += slice.length;
        sourceFiles.push(name);
      }
      continue;
    }

    // Scanned → render FIRST and LAST pages (headline at the start, bordereau at
    // the end), bounded per-doc and by the global budget.
    const take = Math.min(VISION_PER_DOC_PAGES, pagesLeft);
    const ranges =
      pages > 0
        ? selectVisionPageRanges(pages, take)
        : [[1, take] as [number, number]];
    const jpgs: string[] = [];
    for (const [first, last] of ranges) {
      if (jpgs.length >= take) break;
      const rendered = await renderPdfToJpegBase64(bytes, first, last);
      for (const b of rendered) {
        if (jpgs.length >= take) break;
        jpgs.push(b);
      }
    }
    if (jpgs.length === 0) continue;
    for (const base64 of jpgs) images.push({ base64, mediaType: 'image/jpeg' });
    pagesLeft -= jpgs.length;
    sourceFiles.push(name);
  }

  return { images, digitalText: digitalParts.join('\n\n').trim(), sourceFiles };
}
