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

  test('ingests an .xlsx BPU (bordereau des prix is usually a spreadsheet)', async () => {
    // Minimal valid XLSX = ZIP with sharedStrings + one worksheet. String cells
    // (t="s") point into the shared table by index; bare cells carry numbers.
    const shared =
      '<?xml version="1.0"?><sst xmlns="x">' +
      '<si><t>Désignation</t></si>' +
      '<si><t>Béton armé</t></si>' +
      '<si><t>Lot n&#176; 1</t></si>' +
      '</sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>120</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>2</v></c></row>' +
      '</sheetData></worksheet>';
    const xlsxBytes = zipSync({
      'xl/sharedStrings.xml': strToU8(shared),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });
    const zip = zipSync({
      'BORDEREAU DES PRIX 08-2026.xlsx': xlsxBytes,
      'RC 08-2026.pdf': strToU8('rc règlement de consultation'),
    });
    const out = await extractDossierText(zip, echoExtract);
    expect(out.files.map((f) => f.name)).toContain('BORDEREAU DES PRIX 08-2026.xlsx');
    expect(out.text).toContain('Désignation');
    expect(out.text).toContain('Béton armé | 120'); // row cells joined by " | "
    expect(out.text).toContain('Lot n° 1'); // numeric XML entity (&#176;) decoded
  });

  test('ingests an .ods spreadsheet (OpenDocument / LibreOffice)', async () => {
    const content =
      '<?xml version="1.0"?><office:document-content xmlns:office="x" xmlns:table="t" xmlns:text="tx">' +
      '<table:table-row><table:table-cell><text:p>Désignation</text:p></table:table-cell>' +
      '<table:table-cell><text:p>Quantité</text:p></table:table-cell></table:table-row>' +
      '<table:table-row><table:table-cell><text:p>Carrelage</text:p></table:table-cell>' +
      '<table:table-cell><text:p>250</text:p></table:table-cell></table:table-row>' +
      '</office:document-content>';
    const odsBytes = zipSync({ 'content.xml': strToU8(content) });
    const zip = zipSync({
      'BORDEREAU 09-2026.ods': odsBytes,
      'RC 09-2026.pdf': strToU8('rc règlement'),
    });
    const out = await extractDossierText(zip, echoExtract);
    expect(out.text).toContain('Désignation');
    expect(out.text).toContain('Carrelage');
    expect(out.text).toContain('250');
  });

  test('ingests a .csv / .txt file verbatim', async () => {
    const zip = zipSync({
      'detail estimatif.csv': strToU8('Designation,Quantite,Prix\nBeton,120,1500'),
      'RC.pdf': strToU8('rc règlement'),
    });
    const out = await extractDossierText(zip, echoExtract);
    expect(out.text).toContain('Designation,Quantite,Prix');
    expect(out.text).toContain('Beton,120,1500');
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
