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

  test('ingests a .docx CPS (some buyers ship CPS as Word, not PDF)', async () => {
    // Minimal valid DOCX = ZIP with word/document.xml. We don't need the full
    // OOXML scaffolding (styles, rels) — the extractor only reads document.xml.
    const docXml =
      '<?xml version="1.0"?><w:document xmlns:w="x">' +
      '<w:body><w:p><w:r><w:t>article 5 caution provisoire 52000 dh</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>estimation maitre 3 995 328 mad</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const docxBytes = zipSync({ 'word/document.xml': strToU8(docXml) });
    const zip = zipSync({
      'CPS 07-2026.docx': docxBytes,
      'RC 07-2026.pdf': strToU8('rc règlement de consultation'),
    });
    const out = await extractDossierText(zip, echoExtract);
    expect(out.files.map((f) => f.name)).toEqual([
      'RC 07-2026.pdf',
      'CPS 07-2026.docx',
    ]);
    expect(out.text).toContain('caution provisoire 52000');
    expect(out.text).toContain('estimation maitre 3 995 328');
  });

  test('rejects bidder-fillable templates (DH / AE / Acte d’engagement)', async () => {
    const docXml =
      '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>blank form to fill</w:t></w:r></w:p></w:body></w:document>';
    const docxBytes = zipSync({ 'word/document.xml': strToU8(docXml) });
    const zip = zipSync({
      'DH AE 07-2026.docx': docxBytes,
      'Declaration sur Honneur.docx': docxBytes,
      'Acte d’engagement.docx': docxBytes,
      'CPS 07-2026.pdf': strToU8('real cps content'),
    });
    const out = await extractDossierText(zip, echoExtract);
    // Only the CPS PDF survives — templates are filtered out by name.
    expect(out.files.map((f) => f.name)).toEqual(['CPS 07-2026.pdf']);
    expect(out.text).not.toContain('blank form to fill');
  });

  test('per-bucket budget prevents a fat RC from starving the BPU', async () => {
    // RC fills its 24k bucket; BPU still gets its own 20k bucket; total stays
    // bounded but BPU is no longer starved (the pre-bucket version would have
    // truncated BPU to 0 since RC could eat the whole global budget).
    const zip = zipSync({
      'RC 07-2026.pdf': strToU8('R'.repeat(60_000)),
      'BPU 07-2026.pdf': strToU8('B'.repeat(30_000)),
    });
    const out = await extractDossierText(zip, echoExtract);
    const rcChars = (
      out.text.split('===== BPU 07-2026.pdf =====')[0] ?? ''
    ).replace(/^.*?===== RC 07-2026.pdf =====/s, '');
    const bpuChars = out.text.split('===== BPU 07-2026.pdf =====')[1] ?? '';
    expect(rcChars.length).toBeLessThanOrEqual(24_064);
    expect(rcChars.length).toBeGreaterThan(20_000);
    expect(bpuChars.length).toBeLessThanOrEqual(20_064);
    expect(bpuChars.length).toBeGreaterThan(15_000);
  });
});
