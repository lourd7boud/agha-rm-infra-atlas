/**
 * Export Controller — Smart Excel Export for Moroccan BTP
 * ═══════════════════════════════════════════════════════
 * Generates professional Excel workbooks with proper formatting,
 * formulas, and Moroccan construction standards (CCAG-T).
 * 
 * Export types:
 *  1. Bordereau des prix — Full price schedule with formulas
 *  2. Décompte provisoire — Progress payment certificate
 *  3. Situation des travaux — Work status with all periods
 *  4. Récapitulatif projet — Complete project summary (multi-sheet)
 *  5. Pénalités & Cautions — Financial instruments summary
 */

import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { keysToCamel } from '../utils/transform';
import { getPool } from '../config/postgres';

// ═══════════════════════════════════════════════════════════════
// Style constants
// ═══════════════════════════════════════════════════════════════

const COLORS = {
  primary: '1B4F72',      // Dark blue
  secondary: '2E86C1',    // Medium blue
  accent: 'D4E6F1',       // Light blue
  headerBg: '1B4F72',     // Header background
  headerFg: 'FFFFFF',     // Header text
  subtotalBg: 'EBF5FB',   // Subtotal row
  totalBg: 'D4E6F1',      // Total row
  grandTotalBg: '1B4F72', // Grand total
  alternateBg: 'F8F9FA',  // Alternate row
  warningBg: 'FFF3CD',    // Warning
  successBg: 'D4EDDA',    // Success
  dangerBg: 'F8D7DA',     // Danger
  borderColor: 'BDC3C7',  // Border
};

const FONT_HEADER: Partial<ExcelJS.Font> = {
  name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.headerFg }
};

const FONT_TITLE: Partial<ExcelJS.Font> = {
  name: 'Calibri', size: 14, bold: true, color: { argb: COLORS.primary }
};

const FONT_SUBTITLE: Partial<ExcelJS.Font> = {
  name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.secondary }
};

const FONT_NORMAL: Partial<ExcelJS.Font> = {
  name: 'Calibri', size: 10
};

const FONT_TOTAL: Partial<ExcelJS.Font> = {
  name: 'Calibri', size: 11, bold: true
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.borderColor } },
  left: { style: 'thin', color: { argb: COLORS.borderColor } },
  bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
  right: { style: 'thin', color: { argb: COLORS.borderColor } },
};

const NUM_FMT_DH = '#,##0.00 "DH"';
const NUM_FMT_PCT = '0.00%';
const NUM_FMT_QTY = '#,##0.000';

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function formatDateFR(date: string | Date | null): string {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function addHeaderRow(ws: ExcelJS.Worksheet, headers: string[], startRow: number) {
  const row = ws.getRow(startRow);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.border = BORDER_THIN;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  row.height = 30;
}

function addProjectHeader(ws: ExcelJS.Worksheet, project: any, title: string): number {
  // Title
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = FONT_TITLE;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 35;

  // Project info
  const info = [
    ['Objet du marché:', project.objet || '-', 'N° Marché:', project.marcheNo || '-'],
    ['Entreprise:', project.societe || '-', 'Commune:', project.commune || '-'],
    ['Montant TTC:', `${Number(project.montant || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`, 'Date:', formatDateFR(project.dateOuverture)],
    ['Programme:', project.programme || '-', 'Délai:', project.delaisExecution ? `${project.delaisExecution} jours` : '-'],
  ];

  let row = 3;
  info.forEach((line) => {
    const r = ws.getRow(row);
    r.getCell(1).value = line[0];
    r.getCell(1).font = { ...FONT_NORMAL, bold: true };
    r.getCell(2).value = line[1];
    r.getCell(2).font = FONT_NORMAL;
    if (line[2]) {
      r.getCell(5).value = line[2];
      r.getCell(5).font = { ...FONT_NORMAL, bold: true };
      r.getCell(6).value = line[3];
      r.getCell(6).font = FONT_NORMAL;
    }
    row++;
  });

  // Separator
  row++;
  return row;
}

async function fetchProjectWithAuth(projectId: string, userId: string): Promise<any> {
  const result = await getPool().query(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [projectId, userId]
  );
  if (result.rows.length === 0) return null;
  return keysToCamel(result.rows[0]);
}

function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  return workbook.xlsx.write(res);
}

// ═══════════════════════════════════════════════════════════════
// 1. EXPORT BORDEREAU DES PRIX
// ═══════════════════════════════════════════════════════════════

export const exportBordereau = async (req: Request, res: Response): Promise<void> => {

  try {
    const { projectId } = req.params;
    const userId = (req as any).user?.id;

    const project = await fetchProjectWithAuth(projectId, userId);
    if (!project) { res.status(404).json({ success: false, error: 'Projet non trouvé' }); return; }

    // Fetch bordereau
    const bResult = await getPool().query(
      'SELECT * FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL',
      [projectId]
    );
    if (bResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Aucun bordereau trouvé' }); return;
    }
    const bordereau = keysToCamel<any>(bResult.rows[0]);
    const lignes = bordereau.lignes || [];

    // Create workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BTP App — MarocInfra';
    wb.created = new Date();

    const ws = wb.addWorksheet('Bordereau des Prix', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    // Column widths
    ws.columns = [
      { width: 8 },   // N°
      { width: 45 },  // Désignation
      { width: 10 },  // Unité
      { width: 14 },  // Quantité
      { width: 16 },  // Prix Unitaire
      { width: 18 },  // Montant HT
    ];

    const startRow = addProjectHeader(ws, project, 'BORDEREAU DES PRIX — DÉTAIL ESTIMATIF');

    // Headers
    addHeaderRow(ws, ['N°', 'Désignation des ouvrages', 'Unité', 'Quantité', 'Prix Unitaire (DH)', 'Montant HT (DH)'], startRow);

    // Data rows
    let currentRow = startRow + 1;
    let totalHT = 0;

    lignes.forEach((ligne: any, idx: number) => {
      const row = ws.getRow(currentRow);
      const montant = Number(ligne.montant || 0);
      totalHT += montant;

      row.getCell(1).value = ligne.numero || idx + 1;
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).value = ligne.designation || '';
      row.getCell(2).alignment = { wrapText: true };
      row.getCell(3).value = ligne.unite || '';
      row.getCell(3).alignment = { horizontal: 'center' };
      row.getCell(4).value = Number(ligne.quantite || 0);
      row.getCell(4).numFmt = NUM_FMT_QTY;
      row.getCell(5).value = Number(ligne.prixUnitaire || 0);
      row.getCell(5).numFmt = NUM_FMT_DH;
      // Formula: Quantité × Prix Unitaire
      row.getCell(6).value = { formula: `D${currentRow}*E${currentRow}` };
      row.getCell(6).numFmt = NUM_FMT_DH;

      // Alternate row coloring
      if (idx % 2 === 1) {
        for (let c = 1; c <= 6; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.alternateBg } };
        }
      }
      for (let c = 1; c <= 6; c++) {
        row.getCell(c).border = BORDER_THIN;
        row.getCell(c).font = FONT_NORMAL;
      }
      currentRow++;
    });

    // Totals
    const addTotalRow = (label: string, formula: string, bg: string, isBold: boolean = true) => {
      const row = ws.getRow(currentRow);
      ws.mergeCells(`A${currentRow}:E${currentRow}`);
      row.getCell(1).value = label;
      row.getCell(1).font = { ...FONT_NORMAL, bold: isBold };
      row.getCell(1).alignment = { horizontal: 'right' };
      row.getCell(6).value = { formula };
      row.getCell(6).numFmt = NUM_FMT_DH;
      row.getCell(6).font = { ...FONT_TOTAL };
      for (let c = 1; c <= 6; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        row.getCell(c).border = BORDER_THIN;
      }
      currentRow++;
    };

    const dataStart = startRow + 1;
    const dataEnd = currentRow - 1;
    addTotalRow('TOTAL HT', `SUM(F${dataStart}:F${dataEnd})`, COLORS.totalBg);
    const totalHTRow = currentRow - 1;
    addTotalRow('TVA (20%)', `F${totalHTRow}*0.2`, COLORS.subtotalBg, false);
    const tvaRow = currentRow - 1;
    
    // Grand total with special styling
    const gtRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:E${currentRow}`);
    gtRow.getCell(1).value = 'TOTAL TTC';
    gtRow.getCell(1).font = { ...FONT_HEADER };
    gtRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    gtRow.getCell(6).value = { formula: `F${totalHTRow}+F${tvaRow}` };
    gtRow.getCell(6).numFmt = NUM_FMT_DH;
    gtRow.getCell(6).font = { ...FONT_HEADER };
    for (let c = 1; c <= 6; c++) {
      gtRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grandTotalBg } };
      gtRow.getCell(c).border = BORDER_THIN;
    }
    gtRow.height = 28;

    // Footer
    currentRow += 3;
    ws.getCell(`A${currentRow}`).value = `Généré le ${formatDateFR(new Date())} — BTP App MarocInfra`;
    ws.getCell(`A${currentRow}`).font = { ...FONT_NORMAL, italic: true, color: { argb: '999999' } };

    const filename = `Bordereau_${project.marcheNo || 'PROJ'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    console.error('Export bordereau error:', err);
    res.status(500).json({ success: false, error: 'Erreur export bordereau' });
  }
};

// ═══════════════════════════════════════════════════════════════
// 2. EXPORT DÉCOMPTE PROVISOIRE
// ═══════════════════════════════════════════════════════════════

export const exportDecompte = async (req: Request, res: Response): Promise<void> => {

  try {
    const { decomptId } = req.params;
    const userId = (req as any).user?.id;

    // Fetch décompte with project
    const dResult = await getPool().query(
      `SELECT d.*, p.objet, p.marche_no, p.societe, p.commune, p.montant as project_montant,
              p.programme, p.delais_execution, p.date_ouverture
       FROM decompts d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2 AND d.deleted_at IS NULL`,
      [decomptId, userId]
    );
    if (dResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Décompte non trouvé' }); return;
    }
    const decompt = keysToCamel<any>(dResult.rows[0]);
    const lignes = decompt.lignes || [];

    // Fetch période info
    let periode: any = null;
    if (decompt.periodeId) {
      const pResult = await getPool().query('SELECT * FROM periodes WHERE id = $1', [decompt.periodeId]);
      if (pResult.rows.length > 0) periode = keysToCamel(pResult.rows[0]);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'BTP App — MarocInfra';
    wb.created = new Date();

    const ws = wb.addWorksheet(`Décompte N°${decompt.numero}`, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    ws.columns = [
      { width: 8 },   // N°
      { width: 40 },  // Désignation
      { width: 10 },  // Unité
      { width: 12 },  // Qté marché
      { width: 12 },  // PU
      { width: 14 },  // Qté précédente
      { width: 14 },  // Qté actuelle
      { width: 14 },  // Qté cumulée
      { width: 16 },  // Montant cumulé
    ];

    // Title
    ws.mergeCells('A1:I1');
    ws.getCell('A1').value = `DÉCOMPTE PROVISOIRE N° ${decompt.numero}`;
    ws.getCell('A1').font = FONT_TITLE;
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 35;

    // Project info
    let row = 3;
    const infoLines = [
      ['Objet:', decompt.objet || '-', 'N° Marché:', decompt.marcheNo || '-'],
      ['Entreprise:', decompt.societe || '-', 'Commune:', decompt.commune || '-'],
      ['Période:', periode ? `${formatDateFR(periode.dateDebut)} — ${formatDateFR(periode.dateFin)}` : '-', 'Montant marché:', `${Number(decompt.projectMontant || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH TTC`],
      ['Date décompte:', formatDateFR(decompt.dateDecompte), 'Statut:', decompt.statut || '-'],
    ];
    infoLines.forEach((line) => {
      const r = ws.getRow(row);
      r.getCell(1).value = line[0]; r.getCell(1).font = { ...FONT_NORMAL, bold: true };
      r.getCell(2).value = line[1]; r.getCell(2).font = FONT_NORMAL;
      ws.mergeCells(`B${row}:D${row}`);
      r.getCell(6).value = line[2]; r.getCell(6).font = { ...FONT_NORMAL, bold: true };
      r.getCell(7).value = line[3]; r.getCell(7).font = FONT_NORMAL;
      ws.mergeCells(`G${row}:I${row}`);
      row++;
    });
    row++;

    // Header
    addHeaderRow(ws, ['N°', 'Désignation', 'Unité', 'Qté Marché', 'P.U. (DH)', 'Qté Précéd.', 'Qté Actuelle', 'Qté Cumulée', 'Montant Cumulé (DH)'], row);
    row++;

    // Data
    const dataStartRow = row;
    lignes.forEach((l: any, idx: number) => {
      const r = ws.getRow(row);
      r.getCell(1).value = l.numero || idx + 1;
      r.getCell(1).alignment = { horizontal: 'center' };
      r.getCell(2).value = l.designation || '';
      r.getCell(2).alignment = { wrapText: true };
      r.getCell(3).value = l.unite || '';
      r.getCell(3).alignment = { horizontal: 'center' };
      r.getCell(4).value = Number(l.quantiteMarche || l.quantite || 0);
      r.getCell(4).numFmt = NUM_FMT_QTY;
      r.getCell(5).value = Number(l.prixUnitaire || 0);
      r.getCell(5).numFmt = NUM_FMT_DH;
      r.getCell(6).value = Number(l.quantitePrecedente || 0);
      r.getCell(6).numFmt = NUM_FMT_QTY;
      r.getCell(7).value = Number(l.quantiteActuelle || l.partiel || 0);
      r.getCell(7).numFmt = NUM_FMT_QTY;
      r.getCell(8).value = Number(l.quantiteCumulee || l.cumule || 0);
      r.getCell(8).numFmt = NUM_FMT_QTY;
      // Montant cumulé = Qté Cumulée × PU
      r.getCell(9).value = { formula: `H${row}*E${row}` };
      r.getCell(9).numFmt = NUM_FMT_DH;

      if (idx % 2 === 1) {
        for (let c = 1; c <= 9; c++) {
          r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.alternateBg } };
        }
      }
      for (let c = 1; c <= 9; c++) {
        r.getCell(c).border = BORDER_THIN;
        r.getCell(c).font = FONT_NORMAL;
      }
      row++;
    });
    const dataEndRow = row - 1;

    // Totals section
    const addSummaryRow = (label: string, value: any, bg: string, isFormula: boolean = false) => {
      const r = ws.getRow(row);
      ws.mergeCells(`A${row}:H${row}`);
      r.getCell(1).value = label;
      r.getCell(1).font = FONT_TOTAL;
      r.getCell(1).alignment = { horizontal: 'right' };
      if (isFormula) {
        r.getCell(9).value = { formula: value };
      } else {
        r.getCell(9).value = Number(value || 0);
      }
      r.getCell(9).numFmt = NUM_FMT_DH;
      r.getCell(9).font = FONT_TOTAL;
      for (let c = 1; c <= 9; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        r.getCell(c).border = BORDER_THIN;
      }
      row++;
    };

    addSummaryRow('TOTAL TRAVAUX HT (Cumulé)', `SUM(I${dataStartRow}:I${dataEndRow})`, COLORS.totalBg, true);
    const totalHTRow = row - 1;
    addSummaryRow('TVA (20%)', `I${totalHTRow}*0.2`, COLORS.subtotalBg, true);
    const tvaRow = row - 1;
    addSummaryRow('TOTAL TTC (Cumulé)', `I${totalHTRow}+I${tvaRow}`, COLORS.totalBg, true);
    const totalTTCRow = row - 1;
    addSummaryRow('Décomptes précédents TTC', decompt.montantPrecedent || 0, COLORS.warningBg);
    const precedentRow = row - 1;

    // Net à payer
    const netRow = ws.getRow(row);
    ws.mergeCells(`A${row}:H${row}`);
    netRow.getCell(1).value = 'NET À PAYER (Présent décompte)';
    netRow.getCell(1).font = FONT_HEADER;
    netRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    netRow.getCell(9).value = { formula: `I${totalTTCRow}-I${precedentRow}` };
    netRow.getCell(9).numFmt = NUM_FMT_DH;
    netRow.getCell(9).font = FONT_HEADER;
    for (let c = 1; c <= 9; c++) {
      netRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grandTotalBg } };
      netRow.getCell(c).border = BORDER_THIN;
    }
    netRow.height = 28;

    // Footer
    row += 3;
    ws.getCell(`A${row}`).value = `Généré le ${formatDateFR(new Date())} — BTP App MarocInfra`;
    ws.getCell(`A${row}`).font = { ...FONT_NORMAL, italic: true, color: { argb: '999999' } };

    const filename = `Decompte_N${decompt.numero}_${decompt.marcheNo || 'PROJ'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    console.error('Export decompt error:', err);
    res.status(500).json({ success: false, error: 'Erreur export décompte' });
  }
};

// ═══════════════════════════════════════════════════════════════
// 3. EXPORT SITUATION DES TRAVAUX
// ═══════════════════════════════════════════════════════════════

export const exportSituation = async (req: Request, res: Response): Promise<void> => {

  try {
    const { projectId } = req.params;
    const userId = (req as any).user?.id;

    const project = await fetchProjectWithAuth(projectId, userId);
    if (!project) { res.status(404).json({ success: false, error: 'Projet non trouvé' }); return; }

    // Fetch all data
    const [bResult, pResult, mResult] = await Promise.all([
      getPool().query('SELECT * FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
      getPool().query('SELECT * FROM periodes WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero ASC', [projectId]),
      getPool().query('SELECT * FROM metres WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC', [projectId]),
    ]);

    const bordereau = bResult.rows.length > 0 ? keysToCamel<any>(bResult.rows[0]) : null;
    const periodes = pResult.rows.map((r: any) => keysToCamel(r));
    const metres = mResult.rows.map((r: any) => keysToCamel(r));

    if (!bordereau) {
      res.status(404).json({ success: false, error: 'Aucun bordereau trouvé' }); return;
    }

    const lignes = bordereau.lignes || [];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'BTP App — MarocInfra';

    const ws = wb.addWorksheet('Situation des Travaux', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    // Dynamic columns: fixed cols + one per period
    const fixedCols = [
      { width: 6 },   // N°
      { width: 35 },  // Désignation
      { width: 8 },   // Unité
      { width: 12 },  // Qté marché
      { width: 14 },  // PU
    ];
    const periodCols = periodes.map(() => ({ width: 14 }));
    ws.columns = [
      ...fixedCols,
      ...periodCols,
      { width: 14 },  // Total cumulé
      { width: 14 },  // % réalisation
      { width: 16 },  // Montant cumulé
    ];

    const startRow = addProjectHeader(ws, project, 'SITUATION DES TRAVAUX — RÉCAPITULATIF PAR PÉRIODE');

    // Headers
    const headers = ['N°', 'Désignation', 'Unité', 'Qté Marché', 'P.U. (DH)'];
    periodes.forEach((p: any) => headers.push(`P${p.numero}`));
    headers.push('Cumulé', '% Réal.', 'Montant (DH)');
    addHeaderRow(ws, headers, startRow);

    let currentRow = startRow + 1;
    const totalCols = headers.length;

    // Data rows
    lignes.forEach((ligne: any, idx: number) => {
      const row = ws.getRow(currentRow);
      row.getCell(1).value = ligne.numero || idx + 1;
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).value = ligne.designation || '';
      row.getCell(2).alignment = { wrapText: true };
      row.getCell(3).value = ligne.unite || '';
      row.getCell(3).alignment = { horizontal: 'center' };
      row.getCell(4).value = Number(ligne.quantite || 0);
      row.getCell(4).numFmt = NUM_FMT_QTY;
      row.getCell(5).value = Number(ligne.prixUnitaire || 0);
      row.getCell(5).numFmt = NUM_FMT_DH;

      // Period columns — find metre for this ligne × period
      let cumule = 0;
      periodes.forEach((p: any, pi: number) => {
        const metre = metres.find((m: any) =>
          m.periodeId === p.id && (m.bordereauLigneId === ligne.id || m.bordereauLigneId === `ligne:${ligne.id}`)
        );
        const partiel = Number(metre?.totalPartiel || 0);
        cumule += partiel;
        const col = 6 + pi;
        row.getCell(col).value = partiel || '';
        row.getCell(col).numFmt = NUM_FMT_QTY;
      });

      const cumCol = 6 + periodes.length;
      const pctCol = cumCol + 1;
      const mntCol = cumCol + 2;

      row.getCell(cumCol).value = cumule;
      row.getCell(cumCol).numFmt = NUM_FMT_QTY;
      
      const qteMarche = Number(ligne.quantite || 0);
      row.getCell(pctCol).value = qteMarche > 0 ? cumule / qteMarche : 0;
      row.getCell(pctCol).numFmt = NUM_FMT_PCT;

      row.getCell(mntCol).value = cumule * Number(ligne.prixUnitaire || 0);
      row.getCell(mntCol).numFmt = NUM_FMT_DH;

      // Styling
      if (idx % 2 === 1) {
        for (let c = 1; c <= totalCols; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.alternateBg } };
        }
      }
      for (let c = 1; c <= totalCols; c++) {
        row.getCell(c).border = BORDER_THIN;
        row.getCell(c).font = FONT_NORMAL;
      }
      currentRow++;
    });

    // Total row
    const totalRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:E${currentRow}`);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(1).font = FONT_TOTAL;
    totalRow.getCell(1).alignment = { horizontal: 'right' };
    const mntCol = 6 + periodes.length + 2;
    const dataStart = startRow + 1;
    const dataEnd = currentRow - 1;
    const mntColLetter = String.fromCharCode(64 + mntCol);
    totalRow.getCell(mntCol).value = { formula: `SUM(${mntColLetter}${dataStart}:${mntColLetter}${dataEnd})` };
    totalRow.getCell(mntCol).numFmt = NUM_FMT_DH;
    totalRow.getCell(mntCol).font = FONT_TOTAL;
    for (let c = 1; c <= totalCols; c++) {
      totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
      totalRow.getCell(c).border = BORDER_THIN;
    }

    // Footer
    currentRow += 3;
    ws.getCell(`A${currentRow}`).value = `Généré le ${formatDateFR(new Date())} — BTP App MarocInfra`;
    ws.getCell(`A${currentRow}`).font = { ...FONT_NORMAL, italic: true, color: { argb: '999999' } };

    const filename = `Situation_Travaux_${project.marcheNo || 'PROJ'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    console.error('Export situation error:', err);
    res.status(500).json({ success: false, error: 'Erreur export situation' });
  }
};

// ═══════════════════════════════════════════════════════════════
// 4. EXPORT RÉCAPITULATIF PROJET (Multi-sheet)
// ═══════════════════════════════════════════════════════════════

export const exportRecapitulatif = async (req: Request, res: Response): Promise<void> => {

  try {
    const { projectId } = req.params;
    const userId = (req as any).user?.id;

    const project = await fetchProjectWithAuth(projectId, userId);
    if (!project) { res.status(404).json({ success: false, error: 'Projet non trouvé' }); return; }

    // Fetch all project data
    const [bResult, pResult, dResult, mResult, penResult, bondResult] = await Promise.all([
      getPool().query('SELECT * FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
      getPool().query('SELECT * FROM periodes WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero', [projectId]),
      getPool().query('SELECT * FROM decompts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero', [projectId]),
      getPool().query('SELECT * FROM metres WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
      getPool().query('SELECT * FROM penalties WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at', [projectId]),
      getPool().query('SELECT * FROM bonds WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at', [projectId]),
    ]);

    const bordereau = bResult.rows.length > 0 ? keysToCamel<any>(bResult.rows[0]) : null;
    const periodes = pResult.rows.map((r: any) => keysToCamel(r));
    const decompts = dResult.rows.map((r: any) => keysToCamel(r));
    const penalties = penResult.rows.map((r: any) => keysToCamel(r));
    const bonds = bondResult.rows.map((r: any) => keysToCamel(r));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'BTP App — MarocInfra';
    wb.created = new Date();

    // ── Sheet 1: Fiche projet ───────────────────────
    const ws1 = wb.addWorksheet('Fiche Projet', {
      pageSetup: { paperSize: 9, orientation: 'portrait' }
    });
    ws1.columns = [{ width: 25 }, { width: 40 }, { width: 25 }, { width: 40 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = 'FICHE RÉCAPITULATIVE DU PROJET';
    ws1.getCell('A1').font = FONT_TITLE;
    ws1.getCell('A1').alignment = { horizontal: 'center' };
    ws1.getRow(1).height = 35;

    const projectInfo = [
      ['Objet du marché', project.objet, 'N° Marché', project.marcheNo],
      ['Entreprise', project.societe, 'Commune', project.commune],
      ['Programme', project.programme, 'Projet', project.projet],
      ['Ligne budgétaire', project.ligne, 'Chapitre', project.chapitre],
      ['Montant TTC', `${Number(project.montant || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`, 'Type', project.typeMarche],
      ['Délai d\'exécution', project.delaisExecution ? `${project.delaisExecution} jours` : '-', 'Statut', project.status],
      ['Date ouverture', formatDateFR(project.dateOuverture), 'OSC', formatDateFR(project.osc)],
      ['Réception provisoire', formatDateFR(project.dateReceptionProvisoire), 'Réception définitive', formatDateFR(project.dateReceptionDefinitive)],
      ['Maître d\'œuvre', project.maitreOeuvre || '-', 'Assistance technique', project.assistanceTechnique || '-'],
      ['RC', project.rc || '-', 'CNSS', project.cnss || '-'],
      ['ICE', project.cb || '-', 'Patente', project.patente || '-'],
    ];

    let row = 3;
    projectInfo.forEach((info) => {
      const r = ws1.getRow(row);
      r.getCell(1).value = info[0];
      r.getCell(1).font = { ...FONT_NORMAL, bold: true };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.accent } };
      r.getCell(1).border = BORDER_THIN;
      r.getCell(2).value = info[1];
      r.getCell(2).font = FONT_NORMAL;
      r.getCell(2).border = BORDER_THIN;
      r.getCell(3).value = info[2];
      r.getCell(3).font = { ...FONT_NORMAL, bold: true };
      r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.accent } };
      r.getCell(3).border = BORDER_THIN;
      r.getCell(4).value = info[3];
      r.getCell(4).font = FONT_NORMAL;
      r.getCell(4).border = BORDER_THIN;
      row++;
    });

    // Summary statistics
    row += 2;
    ws1.mergeCells(`A${row}:D${row}`);
    ws1.getCell(`A${row}`).value = 'RÉSUMÉ FINANCIER';
    ws1.getCell(`A${row}`).font = FONT_SUBTITLE;
    row++;

    const montantHT = Number(project.montant || 0) / 1.2;
    const lastDecompt = decompts.length > 0 ? decompts[decompts.length - 1] : null;
    const totalPenalties = penalties.reduce((s: number, p: any) => s + Number(p.montantApplique || 0), 0);
    const totalBonds = bonds.filter((b: any) => b.statut === 'active').reduce((s: number, b: any) => s + Number(b.montant || 0), 0);

    const summaryData = [
      ['Montant HT du marché', `${montantHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`],
      ['Montant TTC du marché', `${Number(project.montant || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`],
      ['Nombre de décomptes', `${decompts.length}`],
      ['Dernier décompte TTC', lastDecompt ? `${Number(lastDecompt.totalGeneralTtc || lastDecompt.montantCumule || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH` : '-'],
      ['Nombre de périodes', `${periodes.length}`],
      ['Total pénalités', `${totalPenalties.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`],
      ['Cautions actives', `${totalBonds.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH`],
    ];
    summaryData.forEach((sd) => {
      const r = ws1.getRow(row);
      r.getCell(1).value = sd[0];
      r.getCell(1).font = { ...FONT_NORMAL, bold: true };
      r.getCell(1).border = BORDER_THIN;
      ws1.mergeCells(`B${row}:D${row}`);
      r.getCell(2).value = sd[1];
      r.getCell(2).font = FONT_NORMAL;
      r.getCell(2).border = BORDER_THIN;
      row++;
    });

    // ── Sheet 2: Décomptes ──────────────────────────
    if (decompts.length > 0) {
      const ws2 = wb.addWorksheet('Décomptes', {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
      });
      ws2.columns = [
        { width: 10 }, { width: 20 }, { width: 18 }, { width: 18 },
        { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 },
      ];

      ws2.mergeCells('A1:H1');
      ws2.getCell('A1').value = 'HISTORIQUE DES DÉCOMPTES';
      ws2.getCell('A1').font = FONT_TITLE;
      ws2.getCell('A1').alignment = { horizontal: 'center' };

      addHeaderRow(ws2, ['N°', 'Date', 'Montant Actuel', 'Montant Précédent', 'Montant Cumulé', 'Total TTC', 'Total Général TTC', 'Statut'], 3);

      let r2 = 4;
      decompts.forEach((d: any) => {
        const r = ws2.getRow(r2);
        r.getCell(1).value = d.numero;
        r.getCell(1).alignment = { horizontal: 'center' };
        r.getCell(2).value = formatDateFR(d.dateDecompte);
        r.getCell(3).value = Number(d.montantActuel || 0);
        r.getCell(3).numFmt = NUM_FMT_DH;
        r.getCell(4).value = Number(d.montantPrecedent || 0);
        r.getCell(4).numFmt = NUM_FMT_DH;
        r.getCell(5).value = Number(d.montantCumule || 0);
        r.getCell(5).numFmt = NUM_FMT_DH;
        r.getCell(6).value = Number(d.totalTtc || 0);
        r.getCell(6).numFmt = NUM_FMT_DH;
        r.getCell(7).value = Number(d.totalGeneralTtc || 0);
        r.getCell(7).numFmt = NUM_FMT_DH;
        r.getCell(8).value = d.statut || 'draft';
        r.getCell(8).alignment = { horizontal: 'center' };
        for (let c = 1; c <= 8; c++) {
          r.getCell(c).border = BORDER_THIN;
          r.getCell(c).font = FONT_NORMAL;
        }
        r2++;
      });
    }

    // ── Sheet 3: Pénalités & Cautions ───────────────
    if (penalties.length > 0 || bonds.length > 0) {
      const ws3 = wb.addWorksheet('Pénalités & Cautions', {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
      });
      ws3.columns = [
        { width: 20 }, { width: 15 }, { width: 12 }, { width: 12 },
        { width: 16 }, { width: 16 }, { width: 14 }, { width: 30 },
      ];

      let r3 = 1;
      // Penalties
      ws3.mergeCells(`A${r3}:H${r3}`);
      ws3.getCell(`A${r3}`).value = 'PÉNALITÉS';
      ws3.getCell(`A${r3}`).font = FONT_TITLE;
      r3++;

      if (penalties.length > 0) {
        addHeaderRow(ws3, ['Type', 'Jours', 'Taux', 'Base (DH)', 'Montant (DH)', 'Appliqué (DH)', 'Statut', 'Motif'], r3);
        r3++;
        const penTypeLabels: Record<string, string> = {
          retard: 'Retard', malfacon: 'Malfaçon', non_conformite: 'Non-conformité',
          securite: 'Sécurité', environnement: 'Environnement', autre: 'Autre'
        };
        penalties.forEach((p: any) => {
          const r = ws3.getRow(r3);
          r.getCell(1).value = penTypeLabels[p.type] || p.type;
          r.getCell(2).value = Number(p.nombreJours || 0);
          r.getCell(3).value = Number(p.taux || 0);
          r.getCell(4).value = Number(p.baseCalcul || 0); r.getCell(4).numFmt = NUM_FMT_DH;
          r.getCell(5).value = Number(p.montantPenalite || 0); r.getCell(5).numFmt = NUM_FMT_DH;
          r.getCell(6).value = Number(p.montantApplique || 0); r.getCell(6).numFmt = NUM_FMT_DH;
          r.getCell(7).value = p.statut || '';
          r.getCell(8).value = p.motif || '';
          for (let c = 1; c <= 8; c++) { r.getCell(c).border = BORDER_THIN; r.getCell(c).font = FONT_NORMAL; }
          r3++;
        });
      }

      r3 += 2;
      // Bonds
      ws3.mergeCells(`A${r3}:H${r3}`);
      ws3.getCell(`A${r3}`).value = 'CAUTIONS & GARANTIES';
      ws3.getCell(`A${r3}`).font = FONT_TITLE;
      r3++;

      if (bonds.length > 0) {
        addHeaderRow(ws3, ['Type', 'Montant (DH)', '%', 'Organisme', 'Référence', 'Émission', 'Expiration', 'Statut'], r3);
        r3++;
        const bondTypeLabels: Record<string, string> = {
          caution_provisoire: 'Caution provisoire', caution_definitive: 'Caution définitive',
          retenue_garantie: 'Retenue de garantie', caution_avance: "Caution d'avance",
          caution_bonne_execution: 'Bonne exécution', garantie_decennale: 'Garantie décennale'
        };
        bonds.forEach((b: any) => {
          const r = ws3.getRow(r3);
          r.getCell(1).value = bondTypeLabels[b.type] || b.type;
          r.getCell(2).value = Number(b.montant || 0); r.getCell(2).numFmt = NUM_FMT_DH;
          r.getCell(3).value = b.pourcentage ? `${b.pourcentage}%` : '-';
          r.getCell(4).value = b.organisme || '-';
          r.getCell(5).value = b.referenceOrganisme || '-';
          r.getCell(6).value = formatDateFR(b.dateEmission);
          r.getCell(7).value = formatDateFR(b.dateExpiration);
          r.getCell(8).value = b.statut || '';
          for (let c = 1; c <= 8; c++) { r.getCell(c).border = BORDER_THIN; r.getCell(c).font = FONT_NORMAL; }
          r3++;
        });
      }
    }

    // Footer on sheet 1
    row += 2;
    ws1.getCell(`A${row}`).value = `Généré le ${formatDateFR(new Date())} — BTP App MarocInfra`;
    ws1.getCell(`A${row}`).font = { ...FONT_NORMAL, italic: true, color: { argb: '999999' } };

    const filename = `Recapitulatif_${project.marcheNo || 'PROJ'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err: any) {
    console.error('Export recap error:', err);
    res.status(500).json({ success: false, error: 'Erreur export récapitulatif' });
  }
};

// ═══════════════════════════════════════════════════════════════
// 5. LIST AVAILABLE EXPORTS
// ═══════════════════════════════════════════════════════════════

export const getAvailableExports = async (req: Request, res: Response): Promise<void> => {

  try {
    const { projectId } = req.params;
    const userId = (req as any).user?.id;

    const project = await fetchProjectWithAuth(projectId, userId);
    if (!project) { res.status(404).json({ success: false, error: 'Projet non trouvé' }); return; }

    // Check what data exists
    const [bResult, dResult, pResult] = await Promise.all([
      getPool().query('SELECT COUNT(*) as count FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
      getPool().query('SELECT id, numero, date_decompte, statut FROM decompts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero', [projectId]),
      getPool().query('SELECT COUNT(*) as count FROM periodes WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
    ]);

    const hasBordereau = parseInt(bResult.rows[0].count) > 0;
    const decompts = dResult.rows.map((r: any) => keysToCamel(r));
    const hasPeriodes = parseInt(pResult.rows[0].count) > 0;

    const exports = [
      {
        id: 'bordereau',
        label: 'Bordereau des Prix',
        description: 'Détail estimatif complet avec formules',
        icon: 'table',
        available: hasBordereau,
        url: `/export/bordereau/${projectId}`,
      },
      {
        id: 'situation',
        label: 'Situation des Travaux',
        description: 'Récapitulatif des quantités par période',
        icon: 'bar-chart',
        available: hasBordereau && hasPeriodes,
        url: `/export/situation/${projectId}`,
      },
      {
        id: 'recapitulatif',
        label: 'Récapitulatif Projet',
        description: 'Fiche complète multi-feuilles (projet, décomptes, pénalités)',
        icon: 'file-text',
        available: true,
        url: `/export/recapitulatif/${projectId}`,
      },
      ...decompts.map((d: any) => ({
        id: `decompt-${d.id}`,
        label: `Décompte N° ${d.numero}`,
        description: `${formatDateFR(d.dateDecompte)} — ${d.statut || 'draft'}`,
        icon: 'receipt',
        available: true,
        url: `/export/decompt/${d.id}`,
      })),
    ];

    res.json({ success: true, data: exports });
  } catch (err: any) {
    console.error('Get exports error:', err);
    res.status(500).json({ success: false, error: 'Erreur récupération exports' });
  }
};
