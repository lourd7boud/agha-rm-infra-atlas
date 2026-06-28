import { unzipSync } from 'fflate';
import type { LlmVisionDocImage } from '../brain/llm.client';
import {
  docPriority,
  isDataBearingDoc,
  MAX_PDF_BYTES,
  MIN_READABLE_FILE_CHARS,
} from './dossier-text';
import { pdfParseExtract, renderPdfToJpegBase64 } from './pdf-ocr';

/**
 * Builds the input for the VISION extraction path: unzips the DCE, classifies
 * each data-bearing PDF as digital (has a text layer) or scanned, renders the
 * scanned ones to page images (poppler), and keeps any digital text-layer
 * content alongside. The images go straight to the multimodal model — no
 * tesseract — which is both faster (no CPU OCR) and more accurate on scans and
 * BPU tables. DOCX is left to the text path (it already carries clean text).
 */

/** Total page-images sent to the model across all docs (cost/quality balance). */
export const VISION_MAX_PAGES = 15;
/** Per-document page cap so a fat RC never consumes the whole page budget,
 *  starving the BPU/CPS that follow it in priority order. */
export const VISION_PER_DOC_PAGES = 8;
/** Keep at most this much digital text-layer content (hybrid dossiers) as
 *  context — the images carry the bulk of the signal. */
const MAX_DIGITAL_CONTEXT = 12_000;

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

    // Classify: a usable text layer → keep its text (cheap, free, no render).
    let txt = '';
    try {
      txt = await pdfParseExtract(bytes);
    } catch {
      txt = '';
    }
    const measured = txt.replace(/\s+/g, ' ').trim();
    if (measured.length >= MIN_READABLE_FILE_CHARS) {
      if (digitalUsed < MAX_DIGITAL_CONTEXT) {
        const room = MAX_DIGITAL_CONTEXT - digitalUsed;
        const slice = measured.slice(0, room);
        digitalParts.push(`===== ${name} =====\n${slice}`);
        digitalUsed += slice.length;
        sourceFiles.push(name);
      }
      continue;
    }

    // Scanned → render the first pages (bounded per-doc and by the global budget).
    const take = Math.min(VISION_PER_DOC_PAGES, pagesLeft);
    const jpgs = await renderPdfToJpegBase64(bytes, 1, take);
    if (jpgs.length === 0) continue;
    for (const base64 of jpgs) images.push({ base64, mediaType: 'image/jpeg' });
    pagesLeft -= jpgs.length;
    sourceFiles.push(name);
  }

  return { images, digitalText: digitalParts.join('\n\n').trim(), sourceFiles };
}
