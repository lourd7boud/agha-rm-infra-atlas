import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import {
  extractBordereauFromDce,
  isBordereauFileName,
  parseBordereauDocx,
  parseBordereauXlsx,
} from './bordereau-parser';

/** Build a minimal-but-valid XLSX (OOXML) from a plain 2D rows array. The
 *  workbook has one sheet, all cells emitted as inline strings — enough for the
 *  parser, which reads sharedStrings + inline `<t>` + numeric `<v>` cells alike. */
function buildXlsx(rows: ReadonlyArray<ReadonlyArray<string>>): Uint8Array {
  const colLetter = (n: number) => {
    let s = '';
    let k = n;
    while (k >= 0) {
      s = String.fromCharCode(65 + (k % 26)) + s;
      k = Math.floor(k / 26) - 1;
    }
    return s;
  };
  const xmlEscape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const rowsXml = rows
    .map((cells, r) => {
      const cellsXml = cells
        .map((v, c) => {
          const trimmed = v.trim();
          if (!trimmed) return '';
          const ref = `${colLetter(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(trimmed)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cellsXml}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  return zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}

describe('parseBordereauXlsx', () => {
  test('reads a standard Moroccan BPU (N° | Désignation | Unité | Quantité)', () => {
    const xlsx = buildXlsx([
      ['BORDEREAU DES PRIX'],
      ['N°', 'Désignation', 'Unité', 'Quantité'],
      ['1', "CENTRALE D'OXYGENE MEDICAL AVEC 3 SOURCES", 'E', '1,00'],
      ['2', "CENTRALE DE PROTOXYDE D'AZOTE", 'E', '1,00'],
      ['3', 'TUYAUTERIE CUIVRE Diam 12x1', 'ML', '9 365,00'],
      ['4', 'Prise pour Oxygène', 'U', '140,00'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.length).toBe(4);
    expect(out.items[0]).toEqual({
      section: null,
      designation: "CENTRALE D'OXYGENE MEDICAL AVEC 3 SOURCES",
      quantite: 1,
      unite: 'E',
      prixUnitaireMad: null,
    });
    expect(out.items[2]).toEqual({
      section: null,
      designation: 'TUYAUTERIE CUIVRE Diam 12x1',
      quantite: 9365,
      unite: 'ML',
      prixUnitaireMad: null,
    });
  });

  test('detects section header rows (single-cell rows between item blocks)', () => {
    const xlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['A - CENTRALES'],
      ['Centrale O2', 'E', '1'],
      ['Centrale N2O', 'E', '1'],
      ['B - PRISES'],
      ['Prise O2', 'U', '140'],
      ['Prise Vide', 'U', '222'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.map((i) => `${i.section ?? '-'}|${i.designation}`)).toEqual([
      'A - CENTRALES|Centrale O2',
      'A - CENTRALES|Centrale N2O',
      'B - PRISES|Prise O2',
      'B - PRISES|Prise Vide',
    ]);
  });

  test('parses French number formats (space-grouped, comma-decimal)', () => {
    const xlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Item 1', 'U', '1 234,5'],
      ['Item 2', 'U', '12.345,67'],
      ['Item 3', 'U', '0,5'],
      ['Item 4', 'U', '42'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.map((i) => i.quantite)).toEqual([1234.5, 12345.67, 0.5, 42]);
  });

  test('captures prix unitaire when present (rare — buyers usually omit it)', () => {
    const xlsx = buildXlsx([
      ['Désignation', 'Unité', 'Qté', 'P.U. (DH HT)'],
      ['Béton B25', 'M3', '120', '850,00'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items[0]?.prixUnitaireMad).toBe(850);
  });

  test('recognises common header variations (qte/qty/unite/unit/u)', () => {
    const xlsx = buildXlsx([
      ['Désignation des prestations', 'U', 'Qté'],
      ['Item', 'KG', '5'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items[0]).toMatchObject({
      designation: 'Item',
      unite: 'KG',
      quantite: 5,
    });
  });

  test('skips rows that look like totals / sub-totals / page footers', () => {
    const xlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Real item', 'U', '10'],
      ['TOTAL HT'],
      ['Sous-total partiel'],
      ['Another item', 'M2', '5'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    const designations = out.items.map((i) => i.designation);
    expect(designations).toContain('Real item');
    expect(designations).toContain('Another item');
    expect(designations).not.toContain('TOTAL HT');
    expect(designations).not.toContain('Sous-total partiel');
  });

  test('returns empty items when the sheet has no header row resembling a BPU', () => {
    const xlsx = buildXlsx([
      ['Lorem ipsum dolor sit amet'],
      ['Some unrelated content here'],
      ['No quantité column anywhere'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items).toEqual([]);
  });

  test('returns empty on non-zip bytes (corrupt input)', () => {
    const out = parseBordereauXlsx(new Uint8Array([1, 2, 3, 4]));
    expect(out.items).toEqual([]);
  });

  test('truncates pathological designations to 300 chars (mirrors LLM bound)', () => {
    const huge = 'X'.repeat(600);
    const xlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      [huge, 'U', '1'],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items[0]?.designation.length).toBeLessThanOrEqual(300);
  });

  test('strips empty trailing items and ignores fully empty rows between data', () => {
    const xlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Item A', 'U', '1'],
      ['', '', ''],
      ['Item B', 'U', '2'],
      ['', '', ''],
    ]);

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.map((i) => i.designation)).toEqual(['Item A', 'Item B']);
  });

  test('looks across multiple sheets (multi-lot BPU: one sheet per lot)', () => {
    const colLetter = (n: number) => String.fromCharCode(65 + n);
    const xmlEscape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
    const sheetXml = (rows: string[][]) => {
      const rowsXml = rows.map((cells, r) => {
        const cellsXml = cells.map((v, c) => v
          ? `<c r="${colLetter(c)}${r + 1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>` : '').join('');
        return `<row r="${r + 1}">${cellsXml}</row>`;
      }).join('');
      return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
    };
    const xlsx = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(sheetXml([
        ['Désignation', 'U', 'Qté'],
        ['Lot 1 item', 'U', '1'],
      ])),
      'xl/worksheets/sheet2.xml': strToU8(sheetXml([
        ['Désignation', 'U', 'Qté'],
        ['Lot 2 item', 'M2', '5'],
      ])),
    });

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.length).toBe(2);
    expect(out.items.map((i) => i.designation).sort()).toEqual(['Lot 1 item', 'Lot 2 item']);
  });

  test('isBordereauFileName matches common Moroccan BPU file names', () => {
    expect(isBordereauFileName('AO 09 DR4 2026/Bordereau.xlsx')).toBe(true);
    expect(isBordereauFileName('BPU 06-2026.xlsx')).toBe(true);
    expect(isBordereauFileName('Detail estimatif lot 1.xlsx')).toBe(true);
    expect(isBordereauFileName('Cadre du bordereau.xlsx')).toBe(true);
    // Negative
    expect(isBordereauFileName('CPS.pdf')).toBe(false);
    expect(isBordereauFileName('AVIS.docx')).toBe(false);
    expect(isBordereauFileName('Random.xlsx')).toBe(false); // no bordereau token
  });

  test('extractBordereauFromDce picks the bordereau xlsx out of a DCE archive', () => {
    const bordereauXlsx = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Item A', 'U', '1'],
      ['Item B', 'M2', '5'],
    ]);
    const dce = zipSync({
      'AO 09 2026/CPS.pdf': strToU8('cps content'),
      'AO 09 2026/Bordereau.xlsx': bordereauXlsx,
      'AO 09 2026/AVIS.docx': strToU8('avis'),
    });

    const out = extractBordereauFromDce(dce);

    expect(out).not.toBeNull();
    expect(out!.fileName).toBe('AO 09 2026/Bordereau.xlsx');
    expect(out!.items.length).toBe(2);
    expect(out!.items.map((i) => i.designation)).toEqual(['Item A', 'Item B']);
  });

  test('extractBordereauFromDce returns null when DCE has no XLSX BPU', () => {
    const dce = zipSync({
      'CPS.pdf': strToU8('cps'),
      'RC.pdf': strToU8('rc'),
    });
    expect(extractBordereauFromDce(dce)).toBeNull();
  });

  test('extractBordereauFromDce prefers "Bordereau" over "Estimatif" when both ship', () => {
    const goodBordereau = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Bordereau item', 'U', '1'],
    ]);
    const estimatif = buildXlsx([
      ['Désignation', 'U', 'Qté'],
      ['Estimatif item', 'M2', '5'],
    ]);
    const dce = zipSync({
      'Detail estimatif.xlsx': estimatif,
      'Bordereau prix.xlsx': goodBordereau,
    });

    const out = extractBordereauFromDce(dce);

    expect(out!.fileName).toBe('Bordereau prix.xlsx');
    expect(out!.items[0]?.designation).toBe('Bordereau item');
  });

  // ===== DOCX (Word) table BPU =====
  // Build a minimal-but-valid DOCX from a 2D rows array. Word stores tables as
  // <w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell text</w:t> — the parser walks that.
  const buildDocx = (rows: ReadonlyArray<ReadonlyArray<string>>): Uint8Array => {
    const xmlEscape = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const tableXml = rows
      .map(
        (row) =>
          `<w:tr>${row
            .map(
              (cell) =>
                `<w:tc><w:p><w:r><w:t>${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`,
            )
            .join('')}</w:tr>`,
      )
      .join('');
    const docXml =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:tbl>${tableXml}</w:tbl></w:body></w:document>`;
    return zipSync({ 'word/document.xml': strToU8(docXml) });
  };

  test('parseBordereauDocx: reads a Word table BPU with the same shape', () => {
    const docx = buildDocx([
      ['N°', 'Désignation', 'Unité', 'Quantité'],
      ['1', 'Béton armé pour fondations', 'M3', '120,5'],
      ['2', 'Acier HA Fe E 500', 'KG', '8 400'],
      ['3', 'Coffrage métallique', 'M2', '250'],
    ]);

    const out = parseBordereauDocx(docx);

    expect(out.items.length).toBe(3);
    expect(out.items[0]).toEqual({
      section: null,
      designation: 'Béton armé pour fondations',
      quantite: 120.5,
      unite: 'M3',
      prixUnitaireMad: null,
    });
    expect(out.items[1]!.quantite).toBe(8400);
  });

  test('parseBordereauDocx: handles multi-table workbooks (lots split across tables)', () => {
    // Build a doc with TWO tables, one per lot.
    const xmlEscape = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const table = (rows: string[][]) =>
      `<w:tbl>${rows
        .map(
          (row) =>
            `<w:tr>${row
              .map((c) => `<w:tc><w:p><w:r><w:t>${xmlEscape(c)}</w:t></w:r></w:p></w:tc>`)
              .join('')}</w:tr>`,
        )
        .join('')}</w:tbl>`;
    const docXml =
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>` +
      table([['Désignation', 'U', 'Qté'], ['Lot 1 item', 'U', '1']]) +
      table([['Désignation', 'U', 'Qté'], ['Lot 2 item', 'M2', '5']]) +
      `</w:body></w:document>`;
    const docx = zipSync({ 'word/document.xml': strToU8(docXml) });

    const out = parseBordereauDocx(docx);

    expect(out.items.map((i) => i.designation).sort()).toEqual(['Lot 1 item', 'Lot 2 item']);
  });

  test('parseBordereauDocx: ignores non-BPU tables in the same document', () => {
    // A doc that has a junk table (no BPU headers) and a real BPU table.
    const xmlEscape = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const table = (rows: string[][]) =>
      `<w:tbl>${rows
        .map(
          (row) =>
            `<w:tr>${row
              .map((c) => `<w:tc><w:p><w:r><w:t>${xmlEscape(c)}</w:t></w:r></w:p></w:tc>`)
              .join('')}</w:tr>`,
        )
        .join('')}</w:tbl>`;
    const docXml =
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>` +
      // Junk table: legal-clause table with no quantity column
      table([['Article', 'Description'], ['Art. 1', 'Conditions générales']]) +
      // Real BPU
      table([['Désignation', 'U', 'Qté'], ['Real item', 'U', '5']]) +
      `</w:body></w:document>`;
    const docx = zipSync({ 'word/document.xml': strToU8(docXml) });

    const out = parseBordereauDocx(docx);

    expect(out.items.length).toBe(1);
    expect(out.items[0]!.designation).toBe('Real item');
  });

  test('parseBordereauDocx: returns empty on non-zip / no tables / no headers', () => {
    expect(parseBordereauDocx(new Uint8Array([1, 2, 3])).items).toEqual([]);
    const empty = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="x"><w:body/></w:document>') });
    expect(parseBordereauDocx(empty).items).toEqual([]);
  });

  test('extractBordereauFromDce picks a .docx bordereau when no xlsx is present', () => {
    const xmlEscape = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const tableXml =
      `<w:tbl>` +
      [
        ['Désignation', 'U', 'Qté'],
        ['Item A', 'U', '1'],
      ]
        .map(
          (row) =>
            `<w:tr>${row
              .map((c) => `<w:tc><w:p><w:r><w:t>${xmlEscape(c)}</w:t></w:r></w:p></w:tc>`)
              .join('')}</w:tr>`,
        )
        .join('') +
      `</w:tbl>`;
    const docXml = `<w:document xmlns:w="x"><w:body>${tableXml}</w:body></w:document>`;
    const docxBytes = zipSync({ 'word/document.xml': strToU8(docXml) });
    const dce = zipSync({
      'CPS.pdf': strToU8('cps'),
      'Bordereau des prix.docx': docxBytes,
    });

    const out = extractBordereauFromDce(dce);

    expect(out).not.toBeNull();
    expect(out!.fileName).toBe('Bordereau des prix.docx');
    expect(out!.items.length).toBe(1);
    expect(out!.items[0]!.designation).toBe('Item A');
  });

  test('isBordereauFileName matches .docx files (Word bordereaux)', () => {
    expect(isBordereauFileName('Bordereau.docx')).toBe(true);
    expect(isBordereauFileName('BPU 2026.docx')).toBe(true);
    expect(isBordereauFileName('Random.docx')).toBe(false);
  });

  test('reads shared-strings cells (Office often interns repeated strings)', () => {
    // Build XLSX where designations live in xl/sharedStrings.xml and cells
    // reference them via t="s" + <v>index</v>. This is Office's default.
    const shared = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>Désignation</t></si><si><t>Item Shared</t></si><si><t>U</t></si></sst>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="inlineStr"><is><t>Qté</t></is></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>7</v></c></row>` +
      `</sheetData></worksheet>`;
    const xlsx = zipSync({
      'xl/sharedStrings.xml': strToU8(shared),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });

    const out = parseBordereauXlsx(xlsx);

    expect(out.items.length).toBe(1);
    expect(out.items[0]).toMatchObject({ designation: 'Item Shared', unite: 'U', quantite: 7 });
  });
});
