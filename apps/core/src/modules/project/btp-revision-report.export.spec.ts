import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { calculateRevisionPeriod, type PublishedIndexes } from './btp-revision.domain';
import { buildRevisionReport } from './btp-revision-report.domain';
import { revisionReportPdf, revisionReportXlsx } from './btp-revision-report.export';

function fixture(pending = false) {
  const formula = { name: 'CPS', fixedPart: 0.2, weights: { TEST: 0.8 } };
  const publication: PublishedIndexes = { values: { TEST: 87.5 }, source: 'DATRP/TEST', status: 'definitif', publishedOn: '2026-03-01' };
  const period = calculateRevisionPeriod({ formula, baseIndexes: { TEST: 100 },
    monthlyIndexes: new Map(pending ? [] : [['2026-01', publication]]), start: new Date('2026-01-01'),
    end: new Date('2026-01-31'), amount: 1000, cutoff: '2026-03-10', allowProvisional: false });
  return buildRevisionReport({ project: { reference: 'TEST/2026', name: 'Ouvrage test', ordreServiceDate: '2025-12-31' },
    mode: 'final_only', cutoff: '2026-03-10', baseDate: '2025-12-01', formula,
    basePublication: { ...publication, values: { TEST: 100 } },
    rows: [{ decompteId: 'd1', numero: 1, isDernier: true, dateDecompte: '2026-03-10',
      statut: 'paid', cumulative: 0, trace: null, period, origin: 'reconstituted', warnings: ['Date historique à vérifier.'] }],
  });
}

function textOfPdf(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const decoded = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
      parts.push(...[...decoded.matchAll(/<([a-f0-9]+)>/gi)].map((value) => Buffer.from(value[1]!, 'hex').toString('latin1')));
    } catch { /* Embedded font or image data is outside the text stream. */ }
  }
  return parts.join('');
}

describe('standalone price revision exports', () => {
  it('exports both actual tables with numeric ratios and negative total, plus historical warnings', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await revisionReportXlsx(fixture());
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Calcul des coefficients', 'Calcul de la révision']);
    const coefficients = workbook.worksheets[0]!;
    const amounts = workbook.worksheets[1]!;
    const values = (sheet: ExcelJS.Worksheet) => sheet.getSheetValues().flatMap((row) => Array.isArray(row) ? row : []);
    expect(values(coefficients)).toEqual(expect.arrayContaining([100, 87.5, 0.875, -0.1]));
    expect(values(amounts)).toContain(-100);
    expect(values(amounts).some((value) => String(value).includes('Reconstitution'))).toBe(true);
    expect(values(amounts)).toContain('Montant total de la révision HT');
    expect(amounts.pageSetup.orientation).toBe('landscape');
  });

  it('exports missing amounts as blank cells instead of a computed zero total', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await revisionReportXlsx(fixture(true));
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const sheet = workbook.getWorksheet('Calcul de la révision')!;
    let totalRow: ExcelJS.Row | undefined;
    sheet.eachRow((row) => { if (row.getCell(1).value === 'Montant total de la révision HT') totalRow = row; });
    expect(totalRow?.getCell(11).value).toBeNull();
    expect(sheet.getSheetValues().flatMap((row) => Array.isArray(row) ? row : []).some((value) => String(value).includes('En attente'))).toBe(true);
  });

  it('produces a printable PDF containing both table titles, the signed amount and warning', async () => {
    const buffer = await revisionReportPdf(fixture());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect([...buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)]).toHaveLength(2);
    const text = textOfPdf(buffer);
    expect(text).toContain('Calcul des coefficients');
    expect(text).toContain('Calcul de la révision');
    expect(text).toContain('-100,00');
    expect(text).toContain('Reconstitution');
  });

  it('preserves the published precision of index values in Excel and PDF', async () => {
    const report = fixture();
    report.coefficientGroups[0]!.baseValues.TEST = 100.123456;
    report.coefficientGroups[0]!.months[0]!.values.TEST = 87.56789;
    const workbook = new ExcelJS.Workbook();
    const buffer = await revisionReportXlsx(report);
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    let current: ExcelJS.Cell | undefined;
    sheet.eachRow((row) => row.eachCell((cell) => { if (cell.value === 87.56789) current = cell; }));
    expect(current?.numFmt).toBe('#,##0.0#####');
    const text = textOfPdf(await revisionReportPdf(report));
    expect(text).toContain('100,123456');
    expect(text).toContain('87,56789');
  });
});
