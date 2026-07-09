// Export Excel — bordereau, décompte, attachement, récapitulatif. Like the
// source app, the sheets embed LIVE formulas (=E7*F7, =SUM(...)) so the files
// keep computing when edited in Excel.
import { Inject, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { BTP_EXECUTION_REPOSITORY, type BtpExecutionRepository } from './btp.repository';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F2A3C' },
};

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function moneyFmt(cell: ExcelJS.Cell): void {
  cell.numFmt = '#,##0.00';
}

function sanitizeSheetTitle(title: string): string {
  return title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

function fileNameFor(reference: string, suffix: string): string {
  const clean = reference.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `${clean}_${suffix}.xlsx`;
}

async function toStreamable(workbook: ExcelJS.Workbook, filename: string): Promise<StreamableFile> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new StreamableFile(Buffer.from(buffer), {
    type: XLSX_MIME,
    disposition: `attachment; filename="${filename}"`,
  });
}

@Injectable()
export class BtpExportService {
  constructor(
    @Inject(BTP_EXECUTION_REPOSITORY) private readonly execution: BtpExecutionRepository,
  ) {}

  private async projectOr404(projectId: string) {
    const project = await this.execution.getProject(projectId);
    if (!project) throw new NotFoundException(`Marché introuvable: ${projectId}`);
    return project;
  }

  /** Bordereau des prix — lignes + montant en formules + totaux HT/TVA/TTC. */
  async bordereau(projectId: string): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const bordereau = await this.execution.getBordereau(projectId);
    if (!bordereau || bordereau.lignes.length === 0) {
      throw new NotFoundException('Aucun bordereau à exporter');
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetTitle('Bordereau des prix'));
    sheet.columns = [
      { width: 8 },
      { width: 60 },
      { width: 8 },
      { width: 12 },
      { width: 14 },
      { width: 16 },
    ];
    sheet.addRow([`Marché N° ${project.reference}`]).font = { bold: true, size: 14 };
    sheet.addRow([project.objet ?? project.name]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'N° Prix',
      'Désignation des ouvrages',
      'Unité',
      'Quantité',
      'P.U. (MAD HT)',
      'Montant (MAD HT)',
    ]);
    styleHeaderRow(header);

    const firstDataRow = header.number + 1;
    for (const ligne of bordereau.lignes) {
      const row = sheet.addRow([
        ligne.numero,
        ligne.designation,
        ligne.unite,
        ligne.quantite,
        ligne.prixUnitaire,
        null,
      ]);
      row.getCell(6).value = { formula: `D${row.number}*E${row.number}` };
      moneyFmt(row.getCell(5));
      moneyFmt(row.getCell(6));
      row.getCell(2).alignment = { wrapText: true };
    }
    const lastDataRow = sheet.lastRow!.number;

    sheet.addRow([]);
    const htRow = sheet.addRow(['', '', '', '', 'Total HT', null]);
    htRow.getCell(6).value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})` };
    const tvaRow = sheet.addRow(['', '', '', '', 'TVA 20%', null]);
    tvaRow.getCell(6).value = { formula: `F${htRow.number}*0.2` };
    const ttcRow = sheet.addRow(['', '', '', '', 'Total TTC', null]);
    ttcRow.getCell(6).value = { formula: `F${htRow.number}+F${tvaRow.number}` };
    for (const row of [htRow, tvaRow, ttcRow]) {
      row.getCell(5).font = { bold: true };
      row.getCell(6).font = { bold: true };
      moneyFmt(row.getCell(6));
    }

    return toStreamable(workbook, fileNameFor(project.reference, 'bordereau'));
  }

  /** Décompte n°X — lignes cumulées + récapitulatif complet. */
  async decompte(projectId: string, decompteId: string): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const decompte = await this.execution.getDecompte(decompteId);
    if (!decompte || decompte.projectId !== projectId) {
      throw new NotFoundException(`Décompte introuvable: ${decompteId}`);
    }

    const workbook = new ExcelJS.Workbook();
    const title = decompte.isDernier
      ? `Décompte n°${decompte.numero} et dernier`
      : `Décompte n°${decompte.numero}`;
    const sheet = workbook.addWorksheet(sanitizeSheetTitle(title));
    sheet.columns = [
      { width: 8 },
      { width: 55 },
      { width: 8 },
      { width: 12 },
      { width: 13 },
      { width: 14 },
      { width: 16 },
    ];
    sheet.addRow([`Marché N° ${project.reference} — ${title}`]).font = { bold: true, size: 14 };
    sheet.addRow([project.objet ?? project.name]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'N° Prix',
      'Désignation des ouvrages',
      'Unité',
      'Qté marché',
      'Qté réalisée',
      'P.U. (MAD HT)',
      'Montant (MAD HT)',
    ]);
    styleHeaderRow(header);

    const firstDataRow = header.number + 1;
    for (const ligne of decompte.lignes) {
      const row = sheet.addRow([
        ligne.prixNo,
        ligne.designation,
        ligne.unite,
        ligne.quantiteBordereau,
        ligne.quantiteRealisee,
        ligne.prixUnitaireHT,
        null,
      ]);
      row.getCell(7).value = { formula: `E${row.number}*F${row.number}` };
      moneyFmt(row.getCell(6));
      moneyFmt(row.getCell(7));
      row.getCell(2).alignment = { wrapText: true };
    }
    const lastDataRow = sheet.lastRow!.number;

    sheet.addRow([]);
    const recap: [string, number | { formula: string }][] = [
      ['Total HT (cumulé)', { formula: `SUM(G${firstDataRow}:G${lastDataRow})` }],
      ...(decompte.revisionMontantMad !== 0
        ? ([['Révision des prix', decompte.revisionMontantMad]] as [string, number][])
        : []),
      [`TVA ${decompte.tauxTva}%`, decompte.montantTvaMad],
      ['Total TTC (cumulé)', decompte.totalTtcMad],
      ['Retenue de garantie', decompte.retenueGarantieMad],
      ['Dépenses des exercices antérieurs', decompte.depensesAnterieuresMad],
      ["Acomptes délivrés sur l'exercice en cours", decompte.decomptesPrecedentsMad],
      ["Montant de l'acompte à délivrer", decompte.montantAcompteMad],
    ];
    for (const [label, value] of recap) {
      const row = sheet.addRow(['', '', '', '', '', label, value]);
      row.getCell(6).font = { bold: true };
      row.getCell(7).font = { bold: true };
      moneyFmt(row.getCell(7));
    }

    return toStreamable(workbook, fileNameFor(project.reference, `decompte_${decompte.numero}`));
  }

  /** Attachement — certification des quantités, sans prix. */
  async attachement(projectId: string, periodeId?: string): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const attachement = await this.execution.getAttachement(projectId, periodeId);
    if (!attachement) throw new NotFoundException('Aucun bordereau — attachement indisponible');

    const numero = attachement.periode?.numero ?? 0;
    const title = attachement.isDernier
      ? `Attachement n°${numero} et dernier`
      : `Attachement n°${numero}`;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetTitle(title));
    sheet.columns = [
      { width: 8 },
      { width: 55 },
      { width: 8 },
      { width: 13 },
      { width: 14 },
      { width: 13 },
      { width: 14 },
    ];
    sheet.addRow([`Marché N° ${project.reference} — ${title.toUpperCase()}`]).font = {
      bold: true,
      size: 14,
    };
    sheet.addRow([project.objet ?? project.name]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'N° Prix',
      'Désignation des ouvrages',
      'Unité',
      'Qté marché',
      'Qté précédente',
      'Qté période',
      'Qté cumulée',
    ]);
    styleHeaderRow(header);
    for (const ligne of attachement.lignes) {
      const row = sheet.addRow([
        ligne.prixNo,
        ligne.designation,
        ligne.unite,
        ligne.quantiteBordereau,
        ligne.quantitePrecedente,
        ligne.quantitePeriode,
        null,
      ]);
      row.getCell(7).value = { formula: `E${row.number}+F${row.number}` };
      row.getCell(2).alignment = { wrapText: true };
    }

    return toStreamable(workbook, fileNameFor(project.reference, `attachement_${numero}`));
  }

  /** Récapitulatif — la situation financière décompte par décompte. */
  async recapitulatif(projectId: string): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const decomptes = await this.execution.listDecomptes(projectId);
    if (decomptes.length === 0) throw new NotFoundException('Aucun décompte à récapituler');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetTitle('Récapitulatif'));
    sheet.columns = [
      { width: 8 },
      { width: 22 },
      { width: 16 },
      { width: 14 },
      { width: 16 },
      { width: 16 },
      { width: 18 },
      { width: 12 },
    ];
    sheet.addRow([`Marché N° ${project.reference} — Récapitulatif des décomptes`]).font = {
      bold: true,
      size: 14,
    };
    sheet.addRow([project.objet ?? project.name]);
    sheet.addRow([`Montant du marché (TTC): ${project.montantMarcheMad.toLocaleString('fr-MA')}`]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'N°',
      'Période',
      'HT cumulé',
      'TVA',
      'TTC cumulé',
      'Retenue',
      "Montant de l'acompte",
      'Statut',
    ]);
    styleHeaderRow(header);
    for (const decompte of decomptes) {
      const row = sheet.addRow([
        decompte.isDernier ? `${decompte.numero} (dernier)` : decompte.numero,
        decompte.periodeLibelle ?? '—',
        decompte.totalHtMad,
        decompte.montantTvaMad,
        decompte.totalTtcMad,
        decompte.retenueGarantieMad,
        decompte.montantAcompteMad,
        decompte.statut,
      ]);
      for (const col of [3, 4, 5, 6, 7]) moneyFmt(row.getCell(col));
    }
    const first = header.number + 1;
    const last = sheet.lastRow!.number;
    const totalRow = sheet.addRow(['', 'Total acomptes', '', '', '', '', null, '']);
    totalRow.getCell(7).value = { formula: `SUM(G${first}:G${last})` };
    totalRow.getCell(7).font = { bold: true };
    moneyFmt(totalRow.getCell(7));

    return toStreamable(workbook, fileNameFor(project.reference, 'recapitulatif'));
  }
}
