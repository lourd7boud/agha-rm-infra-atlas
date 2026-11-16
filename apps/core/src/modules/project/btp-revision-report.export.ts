import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { RevisionReport, RevisionReportCoefficientGroup } from './btp-revision-report.domain';

const headerColor = 'AFD6E1';
const baseColor = 'FCE7D1';
const totalColor = 'FFFED3';
const gridColor = '92A6B0';
const modeLabel = (report: RevisionReport) => report.mode === 'final_only'
  ? 'Intégration au décompte et dernier' : 'Intégration à chaque décompte';

function dateLabel(value: string | null | undefined) {
  return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—';
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}-01T00:00:00Z`));
}

function numberLabel(value: number | null | undefined, decimals = 2, maxDecimals = decimals) {
  return value == null ? '—' : value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals, maximumFractionDigits: maxDecimals,
  }).replace(/[\u00a0\u202f]/g, ' ');
}

function publicationLabel(month: RevisionReportCoefficientGroup['months'][number]) {
  const source = month.publication?.source ?? 'Publication à vérifier';
  const date = month.publication?.publishedOn ? dateLabel(month.publication.publishedOn) : 'Date de publication à vérifier';
  return `${source} · ${date} · Décompte ${month.statementNumeros.join(', ')}`;
}

function mergedText(sheet: ExcelJS.Worksheet, text: string, columns: number, fill?: string) {
  const row = sheet.addRow([text]);
  if (columns > 1) sheet.mergeCells(row.number, 1, row.number, columns);
  row.getCell(1).alignment = { vertical: 'middle', wrapText: true };
  if (fill) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } };
  return row;
}

function gridRow(row: ExcelJS.Row, columns: number, fill?: string) {
  for (let index = 1; index <= columns; index++) {
    const cell = row.getCell(index);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: `FF${gridColor}` } }, bottom: { style: 'thin', color: { argb: `FF${gridColor}` } },
      left: { style: 'thin', color: { argb: `FF${gridColor}` } }, right: { style: 'thin', color: { argb: `FF${gridColor}` } },
    };
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } };
  }
}

function sheetHeading(sheet: ExcelJS.Worksheet, report: RevisionReport, title: string, columns: number) {
  const reference = mergedText(sheet, `MARCHÉ N° ${report.project.reference}`, columns);
  reference.font = { name: 'Arial', bold: true, size: 14 };
  reference.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  const subject = mergedText(sheet, report.project.objet ?? report.project.name, columns);
  subject.getCell(1).alignment = { horizontal: 'center', wrapText: true };
  subject.height = 30;
  const heading = mergedText(sheet, title, columns);
  heading.font = { name: 'Arial', bold: true, size: 12 };
  heading.getCell(1).alignment = { horizontal: 'center' };
  mergedText(sheet, `${modeLabel(report)} · Publications examinées au ${dateLabel(report.cutoff)}`, columns);
  for (const warning of report.warnings) {
    mergedText(sheet, warning, columns, totalColor).height = 30;
  }
  sheet.addRow([]);
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } };
  sheet.headerFooter.oddFooter = '&L ATLAS · Révision des prix&R Page &P / &N';
}

function coefficientsSheet(workbook: ExcelJS.Workbook, report: RevisionReport) {
  const sheet = workbook.addWorksheet('Calcul des coefficients');
  const maxIndices = Math.max(1, ...report.coefficientGroups.map((group) => group.indices.length));
  const columns = maxIndices * 2 + 3;
  sheet.columns = Array.from({ length: columns }, (_, index) => ({ width: index === 0 ? 18 : index === columns - 1 ? 48 : 15 }));
  sheetHeading(sheet, report, 'Calcul des coefficients', columns);
  if (!report.coefficientGroups.length) {
    mergedText(sheet, 'En attente des éléments nécessaires au calcul des coefficients.', columns, totalColor);
  }
  for (const group of report.coefficientGroups) {
    mergedText(sheet, `${group.label} · Référence du ${dateLabel(group.baseDate)}`, columns).font = { bold: true };
    const count = group.indices.length;
    const groupColumns = count * 2 + 3;
    const header = sheet.addRow(['Mois', ...group.indices, ...group.indices.map((code) => `${code}/${code}0`), 'Coefficient du mois', 'Publication et décomptes']);
    gridRow(header, groupColumns, headerColor);
    header.font = { bold: true };
    header.height = 34;
    const base = sheet.addRow([group.baseDate ? monthLabel(group.baseDate.slice(0, 7)) : 'Base à renseigner',
      ...group.indices.map((code) => group.baseValues[code] ?? null), ...group.indices.map(() => null), null,
      `Époque de base · ${group.manualBaseIndices?.length ? `Valeurs saisies manuellement (${group.manualBaseIndices.join(', ')})` : group.basePublication?.source ?? 'Pièce de référence à vérifier'}`]);
    gridRow(base, groupColumns, baseColor);
    base.height = 30;
    for (let index = 2; index <= count + 1; index++) base.getCell(index).numFmt = '#,##0.0#####';
    for (const month of group.months) {
      const row = sheet.addRow([monthLabel(month.month), ...group.indices.map((code) => month.values[code] ?? null),
        ...group.indices.map((code) => month.ratios[code] ?? null), month.coefficient, publicationLabel(month)]);
      gridRow(row, groupColumns);
      row.height = 32;
      for (let index = 2; index <= count + 1; index++) row.getCell(index).numFmt = '#,##0.0#####';
      for (let index = count + 2; index <= count * 2 + 2; index++) row.getCell(index).numFmt = '0.0000';
      row.getCell(count * 2 + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${totalColor}` } };
    }
    mergedText(sheet, group.formula, columns).getCell(1).alignment = { horizontal: 'center', wrapText: true };
    sheet.addRow([]);
  }
  return sheet;
}

const amountHeaders = ['N° de décompte', 'Début de tranche', 'Travaux arrêtés au', 'Établissement', 'Mois', 'Coefficient du mois',
  'Jours du mois', 'Total des jours', 'Coefficient moyen', 'Montant à réviser HT', 'Révision HT'];
const amountColumns = amountHeaders.length;

function revisionSheet(workbook: ExcelJS.Workbook, report: RevisionReport) {
  const sheet = workbook.addWorksheet('Calcul de la révision');
  sheet.columns = [18, 18, 18, 18, 20, 18, 14, 14, 18, 21, 21].map((width) => ({ width }));
  sheetHeading(sheet, report, 'Calcul de la révision', amountColumns);
  const header = sheet.addRow(amountHeaders);
  gridRow(header, amountColumns, headerColor);
  header.font = { bold: true };
  header.height = 38;
  mergedText(sheet, `Époque de base · ${dateLabel(report.baseDate)}`, amountColumns, baseColor);
  mergedText(sheet, `Ordre de service de commencement · ${dateLabel(report.project.ordreServiceDate)}`, amountColumns, baseColor);
  for (const item of report.rows) {
    const start = sheet.rowCount + 1;
    const months = item.months.length ? item.months : [null];
    for (const month of months) {
      const row = sheet.addRow([`${item.numero}${item.isDernier ? ' et dernier' : ''}`, dateLabel(item.start), dateLabel(item.end), dateLabel(item.dateDecompte),
        month ? monthLabel(month.month) : 'En attente', month?.coefficient ?? null, month?.days ?? null,
        item.totalDays, item.appliedCoefficient, item.ht, item.amount]);
      gridRow(row, amountColumns);
      row.height = 27;
      row.getCell(6).numFmt = '0.0000';
      row.getCell(9).numFmt = '0.0000';
      row.getCell(10).numFmt = '#,##0.00';
      row.getCell(11).numFmt = '#,##0.00';
    }
    if (months.length > 1) for (const column of [1, 2, 3, 4, 8, 9, 10, 11]) sheet.mergeCells(start, column, sheet.rowCount, column);
    const details = [...item.months.flatMap((month) => month.priceBasis ? [month.priceBasis.label] : []), ...item.issues, ...item.warnings];
    if (item.origin === 'reconstituted') details.push('Reconstitution à vérifier avant régularisation.');
    if (details.length) mergedText(sheet, [...new Set(details)].join(' · '), amountColumns, item.amount == null ? totalColor : undefined).height = 30;
  }
  sheet.addRow([]);
  const total = sheet.addRow(['Montant total de la révision HT', null, null, null, null, null, null, null, null, null, report.summary.calculatedTotal]);
  sheet.mergeCells(total.number, 1, total.number, amountColumns - 1);
  gridRow(total, amountColumns, totalColor);
  total.font = { bold: true };
  total.height = 30;
  total.getCell(amountColumns).numFmt = '#,##0.00';
  if (report.summary.pendingCount) mergedText(sheet, 'En attente · le total sera arrêté lorsque les périodes auront toutes été calculées.', amountColumns, totalColor);
  for (const [label, value] of [['Révision déjà intégrée aux décomptes', report.summary.postedTotal],
    ['Solde calculé à rapprocher', report.summary.balance]] as const) {
    const row = sheet.addRow([label, null, null, null, null, null, null, null, null, null, value]);
    sheet.mergeCells(row.number, 1, row.number, amountColumns - 1);
    row.getCell(amountColumns).numFmt = '#,##0.00';
  }
  mergedText(sheet, 'Le coefficient moyen est présenté pour lecture. Les montants reprennent les calculs mensuels détaillés.', amountColumns).height = 28;
  return sheet;
}

export async function revisionReportXlsx(report: RevisionReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ATLAS · AGHA RM INFRA';
  coefficientsSheet(workbook, report);
  revisionSheet(workbook, report);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdfText(value: string) {
  return value.replace(/[\u00a0\u202f]/g, ' ').replace(/−/g, '-').replace(/×/g, 'x')
    .replace(/[^\x00-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

export async function revisionReportPdf(report: RevisionReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true,
    info: { Title: `Révision des prix · Marché ${report.project.reference}`, Author: 'ATLAS · AGHA RM INFRA' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = 32;
  const width = doc.page.width - left * 2;
  const bottom = doc.page.height - 42;
  let y = 32;
  let pageTitle = 'Calcul des coefficients';

  function text(value: string, size = 9, fill?: string) {
    const safe = pdfText(value);
    doc.font('Helvetica').fontSize(size);
    const height = Math.max(18, doc.heightOfString(safe, { width: width - 14 }) + 10);
    if (y + height > bottom) newPage();
    if (fill) doc.rect(left, y, width, height).fill(`#${fill}`);
    doc.fillColor('#24313A').text(safe, left + 7, y + 5, { width: width - 14, lineBreak: true });
    y += height;
  }

  function heading() {
    doc.fillColor('#17232B').font('Helvetica-Bold').fontSize(13)
      .text(pdfText(`MARCHÉ N° ${report.project.reference}`), left, 32, { width, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(pdfText(report.project.objet ?? report.project.name), left, 51, { width, height: 26, ellipsis: true, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12).text(pageTitle, left, 82, { width, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(pdfText(`${modeLabel(report)} · Publications au ${dateLabel(report.cutoff)}`), left, 101, { width, align: 'center' });
    y = 122;
  }

  function newPage() {
    doc.addPage();
    heading();
  }

  function table(headers: string[], widths: number[], rows: string[][], baseRows = new Set<number>()) {
    function draw(cells: string[], isHeader: boolean, fill?: string) {
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 8 : 8.5);
      const height = Math.min(110, Math.max(isHeader ? 36 : 24, ...cells.map((cell, index) =>
        doc.heightOfString(pdfText(cell), { width: widths[index]! - 10 }) + 12)));
      let x = left;
      for (const [index, cell] of cells.entries()) {
        const cellWidth = widths[index]!;
        if (fill) doc.rect(x, y, cellWidth, height).fill(`#${fill}`);
        doc.rect(x, y, cellWidth, height).lineWidth(0.5).stroke(`#${gridColor}`);
        doc.fillColor('#24313A').text(pdfText(cell), x + 5, y + 6, { width: cellWidth - 10, height: height - 10, ellipsis: true, align: 'center' });
        x += cellWidth;
      }
      y += height;
    }
    if (y + 75 > bottom) newPage();
    draw(headers, true, headerColor);
    for (const [index, cells] of rows.entries()) {
      doc.font('Helvetica').fontSize(8.5);
      const rowHeight = Math.min(110, Math.max(24, ...cells.map((cell, column) =>
        doc.heightOfString(pdfText(cell), { width: widths[column]! - 10 }) + 12)));
      if (y + rowHeight > bottom) { newPage(); draw(headers, true, headerColor); }
      draw(cells, false, baseRows.has(index) ? baseColor : undefined);
    }
    y += 10;
  }

  heading();
  for (const warning of report.warnings) text(warning, 8, totalColor);
  if (!report.coefficientGroups.length) text('En attente des éléments nécessaires au calcul des coefficients.', 9, totalColor);
  for (const group of report.coefficientGroups) {
    const codeChunks: string[][] = [];
    for (let index = 0; index < group.indices.length; index += 5) codeChunks.push(group.indices.slice(index, index + 5));
    if (!codeChunks.length) codeChunks.push([]);
    for (const indices of codeChunks) {
      text(`${group.label} · Époque de base du ${dateLabel(group.baseDate)}`, 9, baseColor);
      const headers = ['Mois', ...indices, ...indices.map((code) => `${code}/${code}0`), 'Coefficient du mois'];
      const widths = [78, ...indices.map(() => (width - 156) / (indices.length * 2)),
        ...indices.map(() => (width - 156) / (indices.length * 2)), 78];
      if (!indices.length) widths[0] = width - 78;
      const base = [group.baseDate ? monthLabel(group.baseDate.slice(0, 7)) : 'Base manquante',
        ...indices.map((code) => numberLabel(group.baseValues[code], 1, 6)), ...indices.map(() => 'Base'), ''];
      table(headers, widths, [base, ...group.months.map((month) => [monthLabel(month.month),
        ...indices.map((code) => numberLabel(month.values[code], 1, 6)),
        ...indices.map((code) => numberLabel(month.ratios[code], 4)), numberLabel(month.coefficient, 4)])], new Set([0]));
      text(group.formula, 8);
    }
    for (const source of new Set(group.months.map((month) => publicationLabel(month)))) text(source, 7);
    y += 10;
  }

  pageTitle = 'Calcul de la révision';
  newPage();
  for (const warning of report.warnings) text(warning, 8, totalColor);
  text(`Époque de base · ${dateLabel(report.baseDate)} · Ordre de service · ${dateLabel(report.project.ordreServiceDate)}`, 9, baseColor);
  // Each column gets a stable share of the landscape page, including long amounts.
  const weights = [7, 10, 10, 10, 11, 9, 6, 6, 10, 13, 14];
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const widths = weights.map((weight) => width * weight / sum);
  const calculationRows = report.rows.flatMap((row) => {
    const rows = row.months.length ? row.months : [null];
    return rows.map((month, index) => [
      index === 0 ? `${row.numero}${row.isDernier ? ' et dernier' : ''}` : '',
      index === 0 ? dateLabel(row.start) : '', index === 0 ? dateLabel(row.end) : '',
      index === 0 ? dateLabel(row.dateDecompte) : '',
      month ? `${monthLabel(month.month)}${month.priceBasis ? `\n${month.priceBasis.label}` : ''}` : 'En attente',
      numberLabel(month?.coefficient, 4), month ? String(month.days) : '—', index === 0 ? String(row.totalDays ?? '—') : '',
      index === 0 ? numberLabel(row.appliedCoefficient, 4) : '', index === 0 ? numberLabel(row.ht) : '',
      index === 0 ? numberLabel(row.amount) : '',
    ]);
  });
  table(amountHeaders, widths, calculationRows);
  for (const row of report.rows) {
    for (const issue of [...row.issues, ...row.warnings]) text(issue, 8, totalColor);
  }
  text(`Montant total de la révision HT · ${numberLabel(report.summary.calculatedTotal)} MAD`, 12, totalColor);
  if (report.summary.pendingCount) text('En attente · le total sera arrêté lorsque toutes les périodes auront été calculées.', 9, totalColor);
  text(`Révision déjà intégrée · ${numberLabel(report.summary.postedTotal)} MAD · Solde à rapprocher · ${numberLabel(report.summary.balance)} MAD`, 9);
  text('Le coefficient moyen est présenté pour lecture. Les montants reprennent les calculs mensuels détaillés.', 8);
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#56656E').text(`ATLAS · Révision des prix · ${index + 1} / ${pages.count}`,
      left, doc.page.height - 28, { width, lineBreak: false, align: 'right' });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return finished;
}
