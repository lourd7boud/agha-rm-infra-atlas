import { zipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import {
  extractDossierText,
  MAX_DOSSIER_CHARS,
  type PdfTextExtractor,
} from './dossier-text';

// The injected extractor treats the "pdf bytes" as UTF-8 text and returns them
// verbatim — so the tests exercise unzip + priority + bounding without real PDFs.
const echoExtract: PdfTextExtractor = async (bytes) => strFromU8(bytes);

describe('extractDossierText', () => {
  test('reads only PDFs, most-informative first, skipping empty ones and non-PDFs', async () => {
    const zip = zipSync({
      'AVIS AO 06-2026.pdf': strToU8('avis content'),
      'CPS AO 06-2026.pdf': strToU8('cps content with prices'),
      'RC AO 06-2026.pdf': strToU8('rc content caution provisoire'),
      'BPU 06-2026.pdf': strToU8('bordereau prix detail estimatif'),
      'DH AE 06-2026.docx': strToU8('declaration template — must be ignored'),
      'empty.pdf': strToU8('   '),
    });

    const out = await extractDossierText(zip, echoExtract);

    // RC(0) → BPU(1) → CPS(2) → AVIS(4); empty.pdf + the .docx are excluded.
    // RC leads because it carries the headline estimation/caution figures.
    expect(out.files.map((f) => f.name)).toEqual([
      'RC AO 06-2026.pdf',
      'BPU 06-2026.pdf',
      'CPS AO 06-2026.pdf',
      'AVIS AO 06-2026.pdf',
    ]);
    expect(out.text.indexOf('rc content')).toBeLessThan(out.text.indexOf('cps content'));
    expect(out.text.indexOf('cps content')).toBeLessThan(out.text.indexOf('avis content'));
    expect(out.text).not.toContain('must be ignored');
    expect(out.text).toContain('===== RC AO 06-2026.pdf =====');
  });

  test('bounds the combined text to the char budget', async () => {
    const zip = zipSync({ 'CPS.pdf': strToU8('x'.repeat(MAX_DOSSIER_CHARS + 10_000)) });
    const out = await extractDossierText(zip, echoExtract);
    // The slice is bounded; headers add a little, but never the full oversize doc.
    expect(out.text.length).toBeLessThanOrEqual(MAX_DOSSIER_CHARS + 64);
    expect(out.files[0]!.chars).toBe(MAX_DOSSIER_CHARS + 10_000); // full size reported
  });

  test('a single unreadable PDF does not abort the dossier', async () => {
    const zip = zipSync({
      'CPS.pdf': strToU8('good cps text'),
      'RC.pdf': strToU8('boom'),
    });
    const flaky: PdfTextExtractor = async (bytes) => {
      const t = strFromU8(bytes);
      if (t === 'boom') throw new Error('corrupt pdf');
      return t;
    };
    const out = await extractDossierText(zip, flaky);
    expect(out.files.map((f) => f.name)).toEqual(['CPS.pdf']);
    expect(out.text).toContain('good cps text');
  });

  test('returns empty on bytes that are not a valid zip', async () => {
    const out = await extractDossierText(new Uint8Array([1, 2, 3, 4]), echoExtract);
    expect(out).toEqual({ text: '', files: [] });
  });
});
