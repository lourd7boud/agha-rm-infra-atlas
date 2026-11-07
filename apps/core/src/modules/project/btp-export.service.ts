// Export Excel + PDF — bordereau, décompte, attachement, récapitulatif, dépenses
// et métré détaillé. Like the source app, the sheets embed LIVE formulas
// (=E7*F7, =SUM(...)) so the files keep computing when edited in Excel. Le PDF
// du métré est généré en A4 paysage avec pdfkit (Helvetica/WinAnsi).
import { Inject, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  computePourcentageRealisation,
  normaliseNombreElements,
  resolveUniteConfig,
  type MetreLigne,
} from './btp-metre.domain';
import { round2, toDecimal, toNumber } from './btp-finance.domain';
import {
  BTP_EXECUTION_REPOSITORY,
  type BtpExecutionRepository,
  type BtpProjectRecord,
  type MetreRecord,
  type PeriodeRecord,
} from './btp.repository';
import { BTP_TERRAIN_REPOSITORY, type BtpTerrainRepository } from './btp-terrain.repository';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

// ── Métré détaillé — modèle commun Excel/PDF ─────────────────────────────────

interface MetreDetailPrix {
  numero: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  quantitePrecedente: number;
  quantitePeriode: number;
  quantiteCumulee: number;
  pourcentage: number;
  metre: MetreRecord | null;
}

interface MetreDetailModel {
  project: BtpProjectRecord;
  periode: PeriodeRecord;
  titre: string;
  prix: MetreDetailPrix[];
}

const FR_NUMBER = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "12 345,67" avec espaces normales (pas d'insécables — encodage PDF sûr). */
function fmtFr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return FR_NUMBER.format(n).replace(/[  ]/g, ' ');
}

/** Garde uniquement les caractères encodables en WinAnsi (Helvetica pdfkit). */
function pdfSafe(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/[^\x00-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

/** En-têtes du tableau des mesures (identiques en Excel et en PDF). */
const METRE_COLUMNS = [
  'N°',
  'Désignation des ouvrages',
  'Nb semb.',
  'Nombre',
  'Nb élts',
  'Longueur',
  'Largeur',
  'Profond.',
  'Ø (mm)',
  'Partiel',
  'Observations',
] as const;

/** Valeurs d'une ligne de mesure dans l'ordre de METRE_COLUMNS. */
function metreLigneCells(
  index: number,
  unite: string,
  ligne: MetreLigne,
): (number | string | null)[] {
  const isPoids = resolveUniteConfig(unite).type === 'poids';
  return [
    index,
    ligne.designation ?? '',
    ligne.nombreSemblables ?? null,
    ligne.nombre ?? null,
    isPoids ? normaliseNombreElements(ligne.nombreElements) : null,
    ligne.longueur ?? null,
    ligne.largeur ?? null,
    ligne.profondeur ?? null,
    ligne.diametre ?? null,
    ligne.partiel ?? null,
    ligne.observations ?? '',
  ];
}

/** Quantité cumulée d'une ligne sans métré cette période (périodes passées). */
function previousCumule(previous: { totalPartiel: number }[] | undefined): number {
  if (!previous) return 0;
  return toNumber(
    round2(previous.reduce((acc, p) => acc.plus(toDecimal(p.totalPartiel)), toDecimal(0))),
  );
}

// ── PDF — constantes de mise en page (A4 paysage) ────────────────────────────

const PDF_MARGIN = 36;
const PDF_BRAND = 'ATLAS — AGHA RM INFRA';
const PDF_COLS = [26, 238, 42, 44, 38, 52, 52, 52, 34, 68, 78] as const;
const PDF_ALIGN: ('left' | 'center' | 'right')[] = [
  'center',
  'left',
  'center',
  'center',
  'center',
  'right',
  'right',
  'right',
  'center',
  'right',
  'left',
];
const PDF_COLOR_DARK = '#0F2A3C';
const PDF_COLOR_SECTION = '#E3ECF1';
const PDF_COLOR_SOUS = '#F1F5F8';
const PDF_COLOR_ALT = '#FAFBFC';
const PDF_COLOR_LINE = '#C9D6DE';

const DEPENSE_CATEGORIE_LABELS: Record<string, string> = {
  carburant: 'Carburant',
  materiel: 'Location matériel',
  location_materiel: 'Location matériel',
  materiaux: 'Matériaux',
  main_oeuvre: "Main d'œuvre",
  reparation: 'Réparation',
  transport: 'Transport',
  petit_outillage: 'Petit outillage',
  repas: 'Repas / Restauration',
  administratif: 'Administratif',
  taxes: 'Taxes & Frais',
  frais_generaux: 'Frais généraux',
  sous_traitance: 'Sous-traitance',
  autre: 'Autre',
};

const DEPENSE_METHODE_LABELS: Record<string, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  carte: 'Carte bancaire',
  credit: 'Crédit',
  autre: 'Autre',
};

function formatDateFr(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

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
    @Inject(BTP_TERRAIN_REPOSITORY) private readonly terrain: BtpTerrainRepository,
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

    // Feuille « Détail métré » — ajout purement additif : la certification des
    // quantités ci-dessus reste identique. On y reprend les mesures réellement
    // enregistrées pour la période, en séparant les deux comptages du
    // ferraillage : « Nombre » (barres dans UN élément) et « Nombre d’éléments »
    // (éléments identiques répétés, vide = 1). Aucun partiel n'est recalculé ici
    // — le partiel stocké par le moteur fait foi.
    const periode = attachement.periode;
    if (periode) {
      const contexte = await this.execution.getMetreContext(projectId, periode.id);
      if (contexte && contexte.metres.length > 0) {
        const detail = workbook.addWorksheet(sanitizeSheetTitle('Détail métré'));
        detail.columns = [
          { width: 8 },
          { width: 45 },
          { width: 8 },
          { width: 24 },
          { width: 30 },
          { width: 10 },
          { width: 18 },
          { width: 13 },
          { width: 8 },
          { width: 12 },
        ];
        detail.addRow([`Marché N° ${project.reference} — Détail des métrés — ${title}`]).font = {
          bold: true,
          size: 14,
        };
        detail.addRow([
          'Nombre = barres / pièces de ferraillage dans UN élément · Nombre d’éléments = éléments structurels identiques répétés (vide = 1) · quantité = Nombre × Nombre d’éléments × Longueur × poids du Ø.',
        ]);
        detail.addRow([]);
        const detailHeader = detail.addRow([
          'N° Prix',
          'Désignation des ouvrages',
          'Unité',
          'Élément',
          'Mesure',
          'Nombre',
          "Nombre d’éléments",
          'Longueur (ml)',
          'Ø (mm)',
          'Partiel',
        ]);
        styleHeaderRow(detailHeader);

        const bordereauByLigneId = new Map(
          (contexte.bordereau?.lignes ?? []).map((l) => [l.id ?? String(l.numero), l]),
        );
        for (const metre of contexte.metres) {
          const bordereauLigne = bordereauByLigneId.get(metre.bordereauLigneId);
          const isPoids = resolveUniteConfig(metre.unite).type === 'poids';
          const sousSectionsById = new Map(metre.sousSections.map((s) => [s.id, s]));
          for (const ligne of metre.lignes) {
            const sousSection = ligne.subSectionId
              ? sousSectionsById.get(ligne.subSectionId)
              : undefined;
            const repetitionElement =
              sousSection?.nombreElements && sousSection.nombreElements > 1
                ? ` × ${sousSection.nombreElements}`
                : '';
            const row = detail.addRow([
              bordereauLigne?.numero ?? '',
              metre.designationBordereau ?? bordereauLigne?.designation ?? '',
              metre.unite ?? '',
              sousSection ? `${sousSection.titre}${repetitionElement}` : '',
              ligne.designation ?? '',
              ligne.nombre ?? null,
              isPoids ? normaliseNombreElements(ligne.nombreElements) : null,
              ligne.longueur ?? null,
              ligne.diametre ?? null,
              ligne.partiel ?? null,
            ]);
            row.getCell(5).alignment = { wrapText: true };
            row.getCell(10).numFmt = '#,##0.00';
          }
        }
      }
    }

    return toStreamable(workbook, fileNameFor(project.reference, `attachement_${numero}`));
  }

  /** Attachement — certification des quantités (PDF, A4 portrait). La mise en
   *  page reprend la page web : en-tête centré, tableau à filets (pas de
   *  bandeau plein), quantités au format fmtQty (fr-MA, ≤ 4 décimales). */
  async attachementPdf(
    projectId: string,
    periodeId?: string,
  ): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const attachement = await this.execution.getAttachement(projectId, periodeId);
    if (!attachement)
      throw new NotFoundException('Aucun bordereau — attachement indisponible');

    const numero = attachement.periode?.numero ?? 0;
    const title = attachement.isDernier
      ? `ATTACHEMENT N°${numero} ET DERNIER`
      : `ATTACHEMENT PROVISOIRE N°${numero}`;
    const periode = attachement.periode;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: PDF_MARGIN, right: PDF_MARGIN, bottom: 54, left: PDF_MARGIN },
      bufferPages: true,
      info: {
        Title: `${title} — Marché ${project.reference}`,
        Author: PDF_BRAND,
        Subject: 'Certification des quantités (attachement)',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const pageWidth = doc.page.width - PDF_MARGIN * 2;
    const txt = (s: string | null | undefined): string => pdfSafe(s);
    /** Quantité au format de la page web (fmtQty : fr-MA, sans décimale forcée). */
    const QTY_FMT = new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 4 });
    const fmtQty = (n: number | null | undefined): string => {
      if (n == null || !Number.isFinite(n)) return '—';
      return pdfSafe(QTY_FMT.format(n).replace(/[   ]/g, ' '));
    };
    const fmtDate = (d: Date | string | null | undefined): string =>
      d ? pdfSafe(formatDateFr(d)) : '—';

    // Colonnes calées sur la page web (n°, désignation, U, 4 quantités).
    const COLS = [38, 173, 22, 68, 82, 70, 70] as const;
    const ALIGN: ('left' | 'center' | 'right')[] = [
      'left', 'left', 'center', 'right', 'right', 'right', 'right',
    ];
    const HEADERS = [
      'N° PRIX',
      'DÉSIGNATION DES OUVRAGES',
      'U',
      'QTÉ MARCHÉ',
      'QTÉ PRÉCÉDENTE',
      'QTÉ PÉRIODE',
      'QTÉ CUMULÉE',
    ];
    // Polices par colonne : n° et U en mono, qté période/cumulée en gras (web).
    const FONTS = [
      'Courier-Bold',
      'Helvetica',
      'Courier',
      'Courier',
      'Courier',
      'Courier-Bold',
      'Courier-Bold',
    ] as const;
    const tableWidth = COLS.reduce((a, b) => a + b, 0);
    const tableLeft = PDF_MARGIN + (pageWidth - tableWidth) / 2;
    let y = PDF_MARGIN;

    const rowHeight = (cells: (string | number | null)[]): number => {
      let h = 0;
      cells.forEach((cell, i) => {
        const value = cell == null ? '' : String(cell);
        doc.font(FONTS[i] ?? 'Helvetica').fontSize(8.5);
        const height = value
          ? doc.heightOfString(value, { width: (COLS[i] ?? 40) - 10 })
          : 8.5;
        if (height > h) h = height;
      });
      return h + 8;
    };

    /** En-tête de tableau : capitales sur filet gras (pas de bandeau plein). */
    const drawTableHeader = (): void => {
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor(PDF_COLOR_DARK);
      let x = tableLeft;
      HEADERS.forEach((h, i) => {
        doc.text(txt(h), x + 5, y + 3, {
          width: (COLS[i] ?? 40) - 10,
          align: ALIGN[i],
          lineBreak: false,
          characterSpacing: 0.3,
        });
        x += COLS[i] ?? 0;
      });
      doc
        .moveTo(tableLeft, y + 13)
        .lineTo(tableLeft + tableWidth, y + 13)
        .lineWidth(1.4)
        .strokeColor(PDF_COLOR_DARK)
        .stroke();
      y += 18;
    };

    const ensureSpace = (needed: number, repeatTableHeader = true): void => {
      if (y + needed > doc.page.height - 54) {
        doc.addPage();
        y = PDF_MARGIN;
        drawContinuationHeader(repeatTableHeader);
      }
    };

    /** Page suivante : titre centré « (suite) » + en-tête de tableau répété. */
    const drawContinuationHeader = (repeatTableHeader: boolean): void => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#5B6B75');
      doc.text(
        txt(`${title} — Marché n° ${project.reference} (suite)`),
        PDF_MARGIN,
        y,
        { width: pageWidth, align: 'center', lineBreak: false },
      );
      y += 16;
      if (repeatTableHeader) drawTableHeader();
    };

    const drawRow = (cells: (string | number | null)[]): void => {
      const h = rowHeight(cells);
      ensureSpace(h + 8);
      let x = tableLeft;
      cells.forEach((cell, i) => {
        const value = cell == null ? '' : String(cell);
        if (value) {
          doc.font(FONTS[i] ?? 'Helvetica').fontSize(8.5).fillColor('#1A2B34');
          doc.text(value, x + 5, y + 4, {
            width: (COLS[i] ?? 40) - 10,
            align: ALIGN[i],
            lineBreak: i === 1,
          });
        }
        x += COLS[i] ?? 0;
      });
      doc
        .moveTo(tableLeft, y + h)
        .lineTo(tableLeft + tableWidth, y + h)
        .lineWidth(0.4)
        .strokeColor(PDF_COLOR_LINE)
        .stroke();
      y += h + 5;
    };

    // ── En-tête — centré, comme la page web (border-b-2 border-ink) ──
    const centerLine = (
      text: string,
      opts: {
        font?: string;
        size: number;
        color?: string;
        spacing?: number;
        after?: number;
        width?: number;
      },
    ): void => {
      const width = opts.width ?? pageWidth;
      const spacing = opts.spacing ?? 0;
      doc.font(opts.font ?? 'Helvetica').fontSize(opts.size).fillColor(opts.color ?? '#1A2B34');
      doc.text(text, PDF_MARGIN + (pageWidth - width) / 2, y, {
        width,
        align: 'center',
        characterSpacing: spacing,
      });
      y += doc.heightOfString(text, { width, characterSpacing: spacing }) + (opts.after ?? 4);
    };

    const entete = (project.maitreOeuvre ?? project.buyerName ?? '').trim();
    if (entete) {
      centerLine(txt(entete.toUpperCase()), {
        font: 'Helvetica-Bold',
        size: 9,
        color: PDF_COLOR_DARK,
        spacing: 1.2,
        after: project.assistanceTechnique ? 3 : 12,
      });
    }
    if (project.assistanceTechnique) {
      centerLine(txt(`Assistance technique : ${project.assistanceTechnique}`), {
        size: 8,
        color: '#5B6B75',
        after: 12,
      });
    }
    centerLine(txt(title), {
      font: 'Helvetica-Bold',
      size: 15,
      color: PDF_COLOR_DARK,
      spacing: 0.6,
      after: 8,
    });

    // « Marché n° RÉF — Année 2025 » : référence en gras, comme le web.
    const marchePrefix = 'Marché n° ';
    const marcheSuffix = project.annee ? ` — Année ${project.annee}` : '';
    doc.font('Helvetica').fontSize(10.5);
    const wPrefix = doc.widthOfString(txt(marchePrefix));
    doc.font('Helvetica-Bold');
    const wRef = doc.widthOfString(txt(project.reference));
    doc.font('Helvetica');
    const wSuffix = doc.widthOfString(txt(marcheSuffix));
    let mx = PDF_MARGIN + (pageWidth - (wPrefix + wRef + wSuffix)) / 2;
    doc.font('Helvetica').fontSize(10.5).fillColor('#1A2B34');
    doc.text(txt(marchePrefix), mx, y, { lineBreak: false });
    mx += wPrefix;
    doc.font('Helvetica-Bold').text(txt(project.reference), mx, y, { lineBreak: false });
    mx += wRef;
    doc.font('Helvetica').text(txt(marcheSuffix), mx, y, { lineBreak: false });
    y += 16;

    centerLine(txt(project.objet ?? project.name), {
      size: 8.5,
      color: '#5B6B75',
      width: 420,
      after: periode ? 6 : 12,
    });

    if (periode?.dateDebut && periode?.dateFin) {
      const segA = txt(`Période : ${fmtDate(periode.dateDebut)} `);
      const segB = txt(fmtDate(periode.dateFin));
      doc.font('Courier').fontSize(9);
      const wA = doc.widthOfString(segA);
      const wB = doc.widthOfString(segB);
      const arrowW = 14;
      let px = PDF_MARGIN + (pageWidth - (wA + arrowW + wB)) / 2;
      doc.font('Courier').fontSize(9).fillColor('#1A2B34');
      doc.text(segA, px, y, { lineBreak: false });
      px += wA;
      // Flèche « → » tracée à la plume (U+2192 absente de WinAnsi).
      const ay = y + 5;
      doc
        .moveTo(px, ay)
        .lineTo(px + arrowW - 3, ay)
        .moveTo(px + arrowW - 6, ay - 2.2)
        .lineTo(px + arrowW - 3, ay)
        .lineTo(px + arrowW - 6, ay + 2.2)
        .lineWidth(0.8)
        .strokeColor('#1A2B34')
        .stroke();
      doc.text(segB, px + arrowW, y, { lineBreak: false });
      y += 16;
    }

    // Filet sous l'en-tête.
    doc
      .moveTo(PDF_MARGIN, y)
      .lineTo(PDF_MARGIN + pageWidth, y)
      .lineWidth(1.4)
      .strokeColor(PDF_COLOR_DARK)
      .stroke();
    y += 22;

    // ── Tableau ──
    drawTableHeader();
    for (const ligne of attachement.lignes) {
      drawRow([
        ligne.prixNo,
        ligne.designation,
        ligne.unite,
        fmtQty(ligne.quantiteBordereau),
        fmtQty(ligne.quantitePrecedente),
        fmtQty(ligne.quantitePeriode),
        fmtQty(ligne.quantiteCumulee),
      ]);
    }
    if (attachement.lignes.length === 0) {
      ensureSpace(20);
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#6B7A85');
      doc.text('Aucune ligne d\'ouvrage à certifier.', tableLeft, y, {
        width: tableWidth,
        align: 'center',
      });
      y += 20;
    }

    // ── Pied : signatures en 3 colonnes (identique à la page web) ──
    y += 24;
    ensureSpace(120, false);
    const sigGap = 22;
    const sigW = (tableWidth - sigGap * 2) / 3;
    const sigLabels = ["L'ENTREPRENEUR", "LE MAÎTRE D'ŒUVRE", "L'ADMINISTRATION"];
    const sigValues = [
      project.societe ?? '',
      project.maitreOeuvre ?? '',
      project.buyerName ?? '',
    ];
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PDF_COLOR_DARK);
    sigLabels.forEach((label, i) => {
      doc.text(txt(label), tableLeft + i * (sigW + sigGap), y, {
        width: sigW,
        align: 'center',
        characterSpacing: 0.8,
        lineBreak: false,
      });
    });
    y += 11;
    doc.font('Helvetica').fontSize(7.5).fillColor('#5B6B75');
    sigValues.forEach((value, i) => {
      doc.text(txt(value), tableLeft + i * (sigW + sigGap), y, {
        width: sigW,
        align: 'center',
        lineBreak: false,
      });
    });
    y += 52; // mt-14 : espace pour la signature manuscrite
    sigLabels.forEach((_, i) => {
      const sx = tableLeft + i * (sigW + sigGap);
      doc
        .moveTo(sx, y)
        .lineTo(sx + sigW, y)
        .lineWidth(0.5)
        .strokeColor('#9AA5AD')
        .stroke();
    });

    doc.end();
    const buffer = await done;
    const pdfName = fileNameFor(project.reference, `attachement_${numero}`).replace(
      /\.xlsx$/,
      '.pdf',
    );
    return new StreamableFile(buffer, {
      type: PDF_MIME,
      disposition: `attachment; filename="${pdfName}"`,
    });
  }

  // ── Métré détaillé (Excel + PDF) ────────────────────────────────────────────

  /** Assemble le modèle commun aux deux exports du métré détaillé. */
  private async buildMetreDetailModel(
    projectId: string,
    periodeId: string,
  ): Promise<MetreDetailModel> {
    const project = await this.projectOr404(projectId);
    const contexte = await this.execution.getMetreContext(projectId, periodeId);
    if (!contexte) throw new NotFoundException(`Période introuvable: ${periodeId}`);
    const bordereauLignes = contexte.bordereau?.lignes ?? [];
    if (bordereauLignes.length === 0) {
      throw new NotFoundException('Aucun bordereau — métré indisponible');
    }
    const periode = contexte.periode;
    const metresByLigneId = new Map(contexte.metres.map((m) => [m.bordereauLigneId, m]));
    const prix: MetreDetailPrix[] = bordereauLignes.map((ligne) => {
      const key = ligne.id ?? String(ligne.numero);
      const metre = metresByLigneId.get(key) ?? null;
      const quantitePeriode = metre?.totalPartiel ?? 0;
      const quantiteCumulee = metre
        ? metre.totalCumule
        : previousCumule(contexte.previousByLigne?.[key]);
      return {
        numero: ligne.numero,
        designation: metre?.designationBordereau ?? ligne.designation,
        unite: metre?.unite ?? ligne.unite,
        quantiteBordereau: ligne.quantite,
        quantitePrecedente: toNumber(round2(toDecimal(quantiteCumulee).minus(quantitePeriode))),
        quantitePeriode,
        quantiteCumulee,
        pourcentage: computePourcentageRealisation(quantiteCumulee, ligne.quantite),
        metre,
      };
    });
    const titre = periode.isDecompteDernier
      ? `Métré n°${periode.numero} et dernier`
      : `Métré n°${periode.numero}`;
    return { project, periode, titre, prix };
  }

  /** Métré détaillé — Excel : toutes les mesures de la période, prix par prix. */
  async metreXlsx(projectId: string, periodeId: string): Promise<StreamableFile> {
    const model = await this.buildMetreDetailModel(projectId, periodeId);
    const { project, periode, titre, prix } = model;
    const ref = project.reference;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetTitle(titre));
    sheet.columns = [
      { width: 6 },
      { width: 48 },
      { width: 9 },
      { width: 9 },
      { width: 8 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 9 },
      { width: 14 },
      { width: 26 },
    ];
    const lastCol = METRE_COLUMNS.length;
    /** Bordures fines du tableau (appliquées à chaque bloc prix). */
    const thinBorder: ExcelJS.Border = { style: 'thin', color: { argb: 'FFB9C8D2' } };
    const thinBorders: Partial<ExcelJS.Borders> = {
      top: thinBorder,
      left: thinBorder,
      bottom: thinBorder,
      right: thinBorder,
    };
    const thin: ExcelJS.Border = { style: 'thin', color: { argb: 'FFB9C8D2' } };
    const borders: Partial<ExcelJS.Borders> = {
      top: thin,
      left: thin,
      bottom: thin,
      right: thin,
    };

    /** Bandeau pleine largeur (titre, prix, section…) : remplit puis fusionne. */
    const bandRow = (
      label: string,
      fillArgb: string,
      font: Partial<ExcelJS.Font>,
      indent = 1,
      withBorder = false,
    ): ExcelJS.Row => {
      const row = sheet.addRow([label]);
      for (let c = 1; c <= lastCol; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
        if (withBorder) row.getCell(c).border = thinBorders;
      }
      sheet.mergeCells(row.number, 1, row.number, lastCol);
      row.getCell(1).font = font;
      row.getCell(1).alignment = { vertical: 'middle', indent };
      return row;
    };

    // ── Bandeau marché ──
    const title = bandRow(
      `MARCHÉ N° ${ref} — ${titre.toUpperCase()}`,
      'FF0F2A3C',
      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
    );
    title.height = 24;

    const objet = sheet.addRow([project.objet ?? project.name]);
    sheet.mergeCells(objet.number, 1, objet.number, lastCol);
    objet.getCell(1).font = { size: 11, italic: true };

    const infos = sheet.addRow([
      [
        `Période n°${periode.numero}${periode.libelle ? ` — ${periode.libelle}` : ''}`,
        periode.dateDebut && periode.dateFin
          ? `du ${formatDateFr(periode.dateDebut)} au ${formatDateFr(periode.dateFin)}`
          : null,
        `TVA ${periode.tauxTva} %`,
        `Retenue de garantie ${periode.tauxRetenue} %`,
        project.maitreOeuvre ? `Maître d'ouvrage : ${project.maitreOeuvre}` : null,
      ]
        .filter(Boolean)
        .join('   ·   '),
    ]);
    sheet.mergeCells(infos.number, 1, infos.number, lastCol);
    infos.getCell(1).font = { size: 10 };

    const legende = sheet.addRow([
      'Partiel = Nb semb. × (L × l × P pour M³ · L × l pour M² · L pour ML · ' +
        'Nombre × Nb élts × L × poids du Ø pour KG/T · Nombre pour U/ENS). ' +
        'Les partiels affichés sont ceux enregistrés par le moteur de métré (aucun recalcul à l’export).',
    ]);
    sheet.mergeCells(legende.number, 1, legende.number, lastCol);
    legende.getCell(1).font = { size: 8, italic: true, color: { argb: 'FF6B7A85' } };
    legende.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    legende.height = 22;
    sheet.addRow([]);

    // L'en-tête des colonnes apparaît UNE SEULE FOIS, au-dessus de tous les prix
    // — le tableau qui suit couvre l'ensemble du bordereau.
    const columnHeader = sheet.addRow([...METRE_COLUMNS]);
    styleHeaderRow(columnHeader);
    for (let c = 1; c <= lastCol; c++) columnHeader.getCell(c).border = borders;
    columnHeader.height = 20;

    const styleDataRow = (row: ExcelJS.Row): void => {
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        cell.border = borders;
        if (c >= 3 && c <= 10) {
          cell.numFmt = c === 3 || c === 4 || c === 5 || c === 9 ? '#,##0.##' : '#,##0.00';
          cell.alignment = {
            horizontal: c === 6 || c === 7 || c === 8 || c === 10 ? 'right' : 'center',
            vertical: 'middle',
          };
        }
      }
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
      row.getCell(11).alignment = { wrapText: true, vertical: 'middle' };
      row.getCell(10).font = { bold: true };
    };

    for (const p of prix) {
      bandRow(
        `PRIX N°${p.numero} — ${p.designation}`,
        'FF0F2A3C',
        { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
        1,
        true,
      ).height = 18;
      bandRow(
        `Unité : ${p.unite}   ·   Quantité marché : ${fmtFr(p.quantiteBordereau)}   ·   ` +
          `Précédent : ${fmtFr(p.quantitePrecedente)}   ·   Période : ${fmtFr(p.quantitePeriode)}   ·   ` +
          `Cumulé : ${fmtFr(p.quantiteCumulee)}   (${fmtFr(p.pourcentage)} %)`,
        'FFEEF3F6',
        { size: 9, color: { argb: 'FF33424C' } },
      );
      const blockStart = sheet.rowCount - 1;

      const metre = p.metre;
      const mesureRows: number[] = [];
      const renderLignes = (lignes: MetreLigne[]): void => {
        for (const ligne of lignes) {
          const row = sheet.addRow(metreLigneCells(mesureRows.length + 1, p.unite, ligne));
          styleDataRow(row);
          mesureRows.push(row.number);
        }
      };
      const sousById = new Map((metre?.sousSections ?? []).map((s) => [s.id, s]));
      const renderedSous = new Set<string>();
      const renderSousSection = (s: MetreRecord['sousSections'][number]): void => {
        renderedSous.add(s.id);
        bandRow(
          s.nombreElements && s.nombreElements > 1
            ? `${s.titre}  —  × ${s.nombreElements} éléments identiques`
            : s.titre,
          'FFF1F5F8',
          { italic: true, bold: true, size: 9 },
          2,
          true,
        );
        renderLignes(metre!.lignes.filter((l) => l.subSectionId === s.id));
      };
      if (metre) {
        const sections = [...metre.sections].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
        for (const section of sections) {
          bandRow(section.titre, 'FFE3ECF1', { bold: true, size: 10 }, 1, true);
          const sous = metre.sousSections
            .filter((s) => s.sectionId === section.id)
            .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
          for (const s of sous) renderSousSection(s);
        }
        for (const s of metre.sousSections.filter((x) => !renderedSous.has(x.id))) {
          renderSousSection(s);
        }
        const directes = metre.lignes.filter(
          (l) => !l.subSectionId || !sousById.has(l.subSectionId),
        );
        if (directes.length > 0) {
          if (metre.sections.length > 0 || metre.sousSections.length > 0) {
            bandRow('Mesures directes', 'FFF1F5F8', { italic: true, bold: true, size: 9 }, 2, true);
          }
          renderLignes(directes);
        }
      }
      if (mesureRows.length === 0) {
        bandRow(
          metre
            ? 'Aucune mesure détaillée enregistrée.'
            : 'Aucune mesure enregistrée pour cette période.',
          'FFFBFCFD',
          { italic: true, size: 9, color: { argb: 'FF6B7A85' } },
          1,
          true,
        );
      } else {
        const total = sheet.addRow([
          '',
          `Total partiel — Prix n°${p.numero} (période)`,
          '', '', '', '', '', '', '',
          null,
          '',
        ]);
        sheet.mergeCells(total.number, 2, total.number, 9);
        total.getCell(2).font = { bold: true };
        total.getCell(2).alignment = { horizontal: 'right' };
        total.getCell(10).value = {
          formula: `SUM(J${mesureRows[0]!}:J${mesureRows[mesureRows.length - 1]!})`,
        };
        total.getCell(10).font = { bold: true };
        total.getCell(10).numFmt = '#,##0.00';
        for (let c = 1; c <= lastCol; c++) total.getCell(c).border = thinBorders;
      }
      // Cadre extérieur renforcé autour du bloc du prix.
      const blockEnd = sheet.rowCount;
      for (let r = blockStart; r <= blockEnd; r++) {
        const row = sheet.getRow(r);
        row.getCell(1).border = { ...(row.getCell(1).border ?? {}), left: { style: 'medium', color: { argb: 'FF0F2A3C' } } };
        row.getCell(lastCol).border = { ...(row.getCell(lastCol).border ?? {}), right: { style: 'medium', color: { argb: 'FF0F2A3C' } } };
      }
      sheet.addRow([]);
    }

    // ── Feuille récapitulative des quantités (formules live) ──
    const recap = workbook.addWorksheet('Récapitulatif');
    recap.columns = [
      { width: 8 },
      { width: 56 },
      { width: 8 },
      { width: 13 },
      { width: 14 },
      { width: 13 },
      { width: 13 },
      { width: 12 },
    ];
    recap.addRow([`MARCHÉ N° ${ref} — ${titre.toUpperCase()} — RÉCAPITULATIF DES QUANTITÉS`]).font =
      { bold: true, size: 14 };
    recap.addRow([project.objet ?? project.name]);
    recap.addRow([]);
    const recapHeader = recap.addRow([
      'N° Prix',
      'Désignation des ouvrages',
      'Unité',
      'Qté marché',
      'Qté précédente',
      'Qté période',
      'Qté cumulée',
      '% réalisé',
    ]);
    styleHeaderRow(recapHeader);
    for (const p of prix) {
      const row = recap.addRow([
        p.numero,
        p.designation,
        p.unite,
        p.quantiteBordereau,
        p.quantitePrecedente,
        p.quantitePeriode,
        null,
        null,
      ]);
      row.getCell(7).value = { formula: `E${row.number}+F${row.number}`, result: p.quantiteCumulee };
      row.getCell(8).value = {
        formula: `IF(D${row.number}=0,0,MIN(1,G${row.number}/D${row.number}))`,
        result: Math.min(1, p.pourcentage / 100),
      };
      for (const c of [4, 5, 6, 7]) row.getCell(c).numFmt = '#,##0.00';
      row.getCell(8).numFmt = '0.0%';
      row.getCell(2).alignment = { wrapText: true };
    }

    const pageSetup = {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    const footer = `&L&8${PDF_BRAND}&C&8Page &P / &N&R&8${ref} — ${titre}`;
    sheet.pageSetup = pageSetup as ExcelJS.PageSetup;
    sheet.headerFooter = { oddFooter: footer };
    recap.pageSetup = pageSetup as ExcelJS.PageSetup;
    recap.headerFooter = { oddFooter: footer };

    return toStreamable(workbook, fileNameFor(ref, `metre_${periode.numero}`));
  }

  /** Métré détaillé — PDF A4 paysage, prêt pour impression/signature. */
  async metrePdf(projectId: string, periodeId: string): Promise<StreamableFile> {
    const model = await this.buildMetreDetailModel(projectId, periodeId);
    const { project, periode, titre, prix } = model;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: PDF_MARGIN, right: PDF_MARGIN, bottom: 54, left: PDF_MARGIN },
      bufferPages: true,
      info: {
        Title: `${titre} — Marché ${project.reference}`,
        Author: PDF_BRAND,
        Subject: 'Métré détaillé',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const pageWidth = doc.page.width - PDF_MARGIN * 2;
    const tableWidth = PDF_COLS.reduce((a, b) => a + b, 0);
    const tableLeft = PDF_MARGIN + (pageWidth - tableWidth) / 2;
    let y = PDF_MARGIN;

    const fmt = (n: number | null | undefined): string => pdfSafe(fmtFr(n));
    const txt = (s: string | null | undefined): string => pdfSafe(s);

    const rowHeight = (
      cells: (string | number | null)[],
      cols: readonly number[],
      size: number,
      font: string,
    ): number => {
      doc.font(font).fontSize(size);
      let h = 0;
      cells.forEach((cell, i) => {
        const value = cell == null ? '' : String(cell);
        const height = value
          ? doc.heightOfString(value, { width: (cols[i] ?? 40) - 8 })
          : size;
        if (height > h) h = height;
      });
      return h + 7;
    };

    const drawTableHeader = (): void => {
      drawRow([...METRE_COLUMNS].map(txt), PDF_COLS, PDF_ALIGN, {
        fill: PDF_COLOR_DARK,
        color: '#FFFFFF',
        font: 'Helvetica-Bold',
        size: 7.5,
        grid: true,
      });
    };

    const newPage = (): void => {
      doc.addPage();
      y = PDF_MARGIN;
      continuationHeader();
      drawTableHeader();
    };

    const ensureSpace = (needed: number): void => {
      if (y + needed > doc.page.height - 54) newPage();
    };

    const drawRow = (
      cells: (string | number | null)[],
      cols: readonly number[],
      aligns: readonly ('left' | 'center' | 'right')[],
      opts: { fill?: string; color?: string; font?: string; size?: number; grid?: boolean } = {},
    ): void => {
      const size = opts.size ?? 8;
      const font = opts.font ?? 'Helvetica';
      const h = rowHeight(cells, cols, size, font);
      ensureSpace(h);
      const left = PDF_MARGIN + (pageWidth - cols.reduce((a, b) => a + b, 0)) / 2;
      const width = cols.reduce((a, b) => a + b, 0);
      if (opts.fill) doc.rect(left, y, width, h).fill(opts.fill);
      doc.font(font).fontSize(size).fillColor(opts.color ?? '#1A2B34');
      let x = left;
      cells.forEach((cell, i) => {
        const value = cell == null ? '' : String(cell);
        if (value) {
          doc.text(value, x + 4, y + 3.5, {
            width: (cols[i] ?? 40) - 8,
            align: aligns[i],
            lineBreak: i === 1 || i === cols.length - 1,
          });
        }
        x += cols[i] ?? 0;
      });
      doc
        .moveTo(left, y + h)
        .lineTo(left + width, y + h)
        .lineWidth(0.4)
        .strokeColor(PDF_COLOR_LINE)
        .stroke();
      if (opts.grid) {
        // Lignes verticales — le tableau du métré est entièrement quadrillé.
        let gx = left;
        doc.lineWidth(0.3).strokeColor('#5B6B75');
        for (const w of cols) {
          doc.moveTo(gx, y).lineTo(gx, y + h).stroke();
          gx += w;
        }
        doc.moveTo(gx, y).lineTo(gx, y + h).stroke();
      }
      y += h;
    };

    const drawBand = (
      label: string,
      fill: string,
      color: string,
      font = 'Helvetica-Bold',
      size = 9.5,
      pad = 5,
      grid = false,
    ): void => {
      doc.font(font).fontSize(size);
      const h = doc.heightOfString(label, { width: tableWidth - 10 }) + pad * 2;
      ensureSpace(h + 24);
      doc.rect(tableLeft, y, tableWidth, h).fill(fill);
      if (grid) doc.rect(tableLeft, y, tableWidth, h).lineWidth(0.3).strokeColor('#5B6B75').stroke();
      doc.fillColor(color).text(label, tableLeft + 5, y + pad, { width: tableWidth - 10 });
      y += h;
    };

    const headerTitle = (): void => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#5B6B75');
      doc.text(PDF_BRAND, PDF_MARGIN, y, { width: pageWidth / 2, lineBreak: false });
      doc.text(`Exporté le ${formatDateFr(new Date())}`, PDF_MARGIN + pageWidth / 2, y, {
        width: pageWidth / 2,
        align: 'right',
        lineBreak: false,
      });
      y += 16;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_COLOR_DARK);
      doc.text(txt(`MARCHÉ N° ${project.reference}`), PDF_MARGIN, y, { width: pageWidth });
      y = doc.y + 2;
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0E7490');
      doc.text(txt(titre.toUpperCase()), PDF_MARGIN, y, { width: pageWidth });
      y = doc.y + 3;
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#33424C');
      doc.text(txt(project.objet ?? project.name), PDF_MARGIN, y, { width: pageWidth });
      y = doc.y + 4;
      const infoLine = [
        `Période n°${periode.numero}${periode.libelle ? ` — ${periode.libelle}` : ''}`,
        periode.dateDebut && periode.dateFin
          ? `du ${formatDateFr(periode.dateDebut)} au ${formatDateFr(periode.dateFin)}`
          : null,
        `TVA ${periode.tauxTva} %`,
        `Retenue de garantie ${periode.tauxRetenue} %`,
        project.maitreOeuvre ? `Maître d'ouvrage : ${project.maitreOeuvre}` : null,
      ]
        .filter(Boolean)
        .join('   ·   ');
      doc.font('Helvetica').fontSize(8.5).fillColor('#1A2B34');
      doc.text(txt(infoLine), PDF_MARGIN, y, { width: pageWidth });
      y = doc.y + 3;
      doc.font('Helvetica-Oblique').fontSize(6.8).fillColor('#6B7A85');
      doc.text(
        txt(
          'Partiel = Nb semb. × (L × l × P pour M³ · L × l pour M² · L pour ML · ' +
            'Nombre × Nb élts × L × poids du Ø pour KG/T · Nombre pour U/ENS). ' +
            'Quantités telles qu’enregistrées par le moteur de métré.',
        ),
        PDF_MARGIN,
        y,
        { width: pageWidth },
      );
      y = doc.y + 8;
    };

    const continuationHeader = (): void => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#5B6B75');
      doc.text(txt(`Marché ${project.reference} — ${titre} (suite)`), PDF_MARGIN, y, {
        width: pageWidth / 2,
        lineBreak: false,
      });
      doc.text(PDF_BRAND, PDF_MARGIN + pageWidth / 2, y, {
        width: pageWidth / 2,
        align: 'right',
        lineBreak: false,
      });
      y += 14;
    };

    headerTitle();
    drawTableHeader();

    for (const p of prix) {
      ensureSpace(110);
      drawBand(txt(`PRIX N°${p.numero} — ${p.designation}`), PDF_COLOR_DARK, '#FFFFFF', 'Helvetica-Bold', 9.5, 5, true);
      drawBand(
        txt(
          `Unité : ${p.unite}   ·   Quantité marché : ${fmt(p.quantiteBordereau)}   ·   ` +
            `Précédent : ${fmt(p.quantitePrecedente)}   ·   Période : ${fmt(p.quantitePeriode)}   ·   ` +
            `Cumulé : ${fmt(p.quantiteCumulee)}   (${fmt(p.pourcentage)} %)`,
        ),
        '#EEF3F6',
        '#33424C',
        'Helvetica',
        8,
        5,
        true,
      );

      const metre = p.metre;
      let count = 0;
      const renderLignes = (lignes: MetreLigne[]): void => {
        for (const ligne of lignes) {
          count += 1;
          const rendered = metreLigneCells(count, p.unite, ligne).map((c, i) => {
            if (i === 0) return String(count);
            if (typeof c !== 'number') return txt(c as string);
            // Compteurs (Nb semb., Nombre, Nb élts, Ø) en entiers quand possible.
            return i >= 2 && i <= 5 && Number.isInteger(c) ? String(c) : i === 8 && Number.isInteger(c) ? String(c) : fmt(c);
          });
          drawRow(rendered, PDF_COLS, PDF_ALIGN, {
            fill: count % 2 === 0 ? PDF_COLOR_ALT : undefined,
            grid: true,
          });
        }
      };
      const sousById = new Map((metre?.sousSections ?? []).map((s) => [s.id, s]));
      const renderedSous = new Set<string>();
      const renderSousSection = (s: MetreRecord['sousSections'][number]): void => {
        renderedSous.add(s.id);
        drawBand(
          txt(
            s.nombreElements && s.nombreElements > 1
              ? `${s.titre}  —  × ${s.nombreElements} éléments identiques`
              : s.titre,
          ),
          PDF_COLOR_SOUS,
          '#1A2B34',
          'Helvetica-BoldOblique',
          8,
          5,
          true,
        );
        renderLignes(metre!.lignes.filter((l) => l.subSectionId === s.id));
      };
      if (metre) {
        const sections = [...metre.sections].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
        for (const section of sections) {
          drawBand(txt(section.titre), PDF_COLOR_SECTION, '#1A2B34', 'Helvetica-Bold', 8.5, 5, true);
          const sous = metre.sousSections
            .filter((s) => s.sectionId === section.id)
            .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
          for (const s of sous) renderSousSection(s);
        }
        for (const s of metre.sousSections.filter((x) => !renderedSous.has(x.id))) {
          renderSousSection(s);
        }
        const directes = metre.lignes.filter(
          (l) => !l.subSectionId || !sousById.has(l.subSectionId),
        );
        if (directes.length > 0) {
          if (metre.sections.length > 0 || metre.sousSections.length > 0) {
            drawBand('Mesures directes', PDF_COLOR_SOUS, '#1A2B34', 'Helvetica-BoldOblique', 8, 5, true);
          }
          renderLignes(directes);
        }
      }
      if (count === 0) {
        drawBand(
          metre
            ? 'Aucune mesure détaillée enregistrée.'
            : 'Aucune mesure enregistrée pour cette période.',
          '#FBFCFD',
          '#6B7A85',
          'Helvetica-Oblique',
          8,
          3,
          true,
        );
      } else {
        const cells: (string | number | null)[] = new Array(METRE_COLUMNS.length).fill('');
        cells[1] = txt(`Total partiel — Prix n°${p.numero} (période)`);
        cells[9] = fmt(p.quantitePeriode);
        drawRow(cells, PDF_COLS, PDF_ALIGN, {
          fill: '#E9F0F4',
          font: 'Helvetica-Bold',
          size: 8.5,
          grid: true,
        });
      }
    }

    // ── Récapitulatif des quantités ──
    const RECAP_COLS = [34, 292, 44, 74, 76, 74, 76, 70] as const;
    const RECAP_ALIGN: ('left' | 'center' | 'right')[] = [
      'center', 'left', 'center', 'right', 'right', 'right', 'right', 'center',
    ];
    ensureSpace(110);
    drawBand('RÉCAPITULATIF DES QUANTITÉS', PDF_COLOR_DARK, '#FFFFFF');
    drawRow(
      ['N°', 'Désignation des ouvrages', 'Unité', 'Qté marché', 'Qté précédente', 'Qté période', 'Qté cumulée', '% réalisé'],
      RECAP_COLS,
      RECAP_ALIGN,
      { fill: '#3E5A6B', color: '#FFFFFF', font: 'Helvetica-Bold', size: 7.5 },
    );
    prix.forEach((p, i) => {
      drawRow(
        [
          String(p.numero),
          txt(p.designation),
          txt(p.unite),
          fmt(p.quantiteBordereau),
          fmt(p.quantitePrecedente),
          fmt(p.quantitePeriode),
          fmt(p.quantiteCumulee),
          `${fmt(p.pourcentage)} %`,
        ],
        RECAP_COLS,
        RECAP_ALIGN,
        { fill: i % 2 === 1 ? PDF_COLOR_ALT : undefined },
      );
    });

    // ── Pieds de page (pagination) ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Écrire DANS la marge basse : on la neutralise le temps du pied de page,
      // sinon pdfkit insère une page vide à chaque ligne.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const bottom = doc.page.height - 34;
      doc
        .moveTo(PDF_MARGIN, bottom - 6)
        .lineTo(doc.page.width - PDF_MARGIN, bottom - 6)
        .lineWidth(0.4)
        .strokeColor(PDF_COLOR_LINE)
        .stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#5B6B75');
      doc.text(txt(`${project.reference} — ${titre}`), PDF_MARGIN, bottom, {
        width: pageWidth / 3,
        lineBreak: false,
      });
      doc.text(`Page ${i + 1} / ${range.count}`, PDF_MARGIN, bottom, {
        width: pageWidth,
        align: 'center',
        lineBreak: false,
      });
      doc.text(PDF_BRAND, PDF_MARGIN, bottom, {
        width: pageWidth,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
    const buffer = await done;
    const pdfName = fileNameFor(project.reference, `metre_${periode.numero}`).replace(
      /\.xlsx$/,
      '.pdf',
    );
    return new StreamableFile(buffer, {
      type: PDF_MIME,
      disposition: `attachment; filename="${pdfName}"`,
    });
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

  /** Journal des dépenses — liste des dépenses de chantier avec formule live pour le total. */
  async depenses(projectId: string): Promise<StreamableFile> {
    const project = await this.projectOr404(projectId);
    const depenses = await this.terrain.listDepenses(projectId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetTitle('Dépenses'));
    sheet.columns = [
      { width: 6 },  // N°
      { width: 14 }, // Date
      { width: 22 }, // Catégorie
      { width: 40 }, // Libellé
      { width: 16 }, // Mode paiement
      { width: 18 }, // Référence / N° Reçu
      { width: 18 }, // Montant (MAD)
      { width: 18 }, // Saisi par
      { width: 32 }, // Notes
    ];

    sheet.addRow([`Marché N° ${project.reference} — Journal des dépenses de chantier`]).font = {
      bold: true,
      size: 14,
    };
    sheet.addRow([project.objet ?? project.name]);
    sheet.addRow([
      `Date d'export : ${new Date().toLocaleDateString('fr-MA')} · Nombre d'enregistrements : ${depenses.length}`,
    ]);
    sheet.addRow([]);

    const header = sheet.addRow([
      'N°',
      'Date',
      'Catégorie',
      'Libellé',
      'Paiement',
      'Réf. / Reçu',
      'Montant (MAD)',
      'Saisi par',
      'Notes',
    ]);
    styleHeaderRow(header);

    const firstDataRow = header.number + 1;
    let index = 1;
    for (const d of depenses) {
      const row = sheet.addRow([
        index++,
        formatDateFr(d.spentAt),
        DEPENSE_CATEGORIE_LABELS[d.category] ?? d.category,
        d.label,
        d.method ? (DEPENSE_METHODE_LABELS[d.method] ?? d.method) : '—',
        d.reference ?? '—',
        d.amountMad,
        d.saisiPar ?? '—',
        d.notes ?? '',
      ]);
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { wrapText: true };
      moneyFmt(row.getCell(7));
    }

    const lastDataRow = sheet.lastRow ? sheet.lastRow.number : header.number;
    sheet.addRow([]);
    const totalRow = sheet.addRow(['', '', '', 'Total général des dépenses', '', '', null, '', '']);
    totalRow.getCell(4).font = { bold: true };
    totalRow.getCell(7).font = { bold: true };
    if (depenses.length > 0) {
      totalRow.getCell(7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
    } else {
      totalRow.getCell(7).value = 0;
    }
    moneyFmt(totalRow.getCell(7));

    return toStreamable(workbook, fileNameFor(project.reference, 'depenses'));
  }
}
