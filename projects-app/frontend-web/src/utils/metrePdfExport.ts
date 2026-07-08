import { jsPDF } from 'jspdf';
import autoTable, { RowInput, CellDef } from 'jspdf-autotable';
import { Project, Bordereau, MetreSection, MetreSubSection } from '../db/database';
import { savePDF, hasFileSystemAccess } from './desktopFileService';

// ============================================================
// 📊 METRE PDF EXPORT - تصدير الميتري بالشكل الرسمي المغربي
// ============================================================

// Interface للـ Periode مرنة تدعم كلا النوعين (database و useWebData)
interface PeriodeForExport {
  id: string;
  numero: number;
  libelle?: string;
  dateDebut: string;
  dateFin: string;
  isDecompteDernier?: boolean;
}

interface MetreLigneInput {
  id: string;
  sectionId?: string;
  subSectionId?: string;
  numero: number;
  designation: string;
  nombreSemblables?: number;
  nombreElements?: number;
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  partiel: number;
  observations?: string;
  isFromPreviousPeriode?: boolean;
  periodeNumero?: number;
}

interface MetreQuickData {
  bordereauLigneId: string;
  numeroLigne: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  prixUnitaire: number;
  sections: MetreSection[];
  subSections: MetreSubSection[];
  lignes: MetreLigneInput[];
  cumulPrecedent: number;
}

/**
 * توليد PDF لتفاصيل الميتري — بالشكل الرسمي المغربي
 * ═══════════════════════════════════════════════════════
 * جدول موحد مستمر: أزرق للبنود الرئيسية، وردي للأقسام الفرعية، أبيض للقياسات
 */
export async function generateMetrePDF(
  project: Project,
  periode: PeriodeForExport,
  _bordereau: Bordereau,
  metresData: MetreQuickData[],
  metreDate: string
): Promise<void> {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.width;
  const margin = 10;
  let yPos = 12;

  // ═══════════════════════════════════════
  // الألوان الرسمية (كما في الوثيقة Excel)
  // ═══════════════════════════════════════
  const COLORS = {
    headerBlue: [0, 176, 240] as [number, number, number],           // أزرق فاتح (رؤوس البنود + TOTAL)
    subDescPink: [255, 204, 204] as [number, number, number],         // وردي (وصف فرعي)
    white: [255, 255, 255] as [number, number, number],               // أبيض (قياسات)
    darkBlue: [0, 112, 192] as [number, number, number],              // أزرق غامق (رأس الجدول)
    totalRow: [146, 208, 80] as [number, number, number],             // أخضر فاتح (مجموع فرعي)
    textDark: [0, 0, 0] as [number, number, number],
    textWhite: [255, 255, 255] as [number, number, number],
  };

  // ═══════════════════════════════════════
  // رأس الوثيقة الرسمية
  // ═══════════════════════════════════════
  const drawDocumentHeader = () => {
    // Royaume du Maroc
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bolditalic');
    doc.text('Royaume du Maroc', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;

    // الوزارة
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const ministryLines = [
      "Ministère de l'Agriculture, de la Pêche Maritime,",
      "du Développement Rural et des Eaux et Forêts",
      "Direction Provinciale de l'Agriculture",
      "Service des Aménagement hydro-agricole",
    ];
    ministryLines.forEach(line => {
      doc.text(line, pageWidth / 2, yPos, { align: 'center' });
      yPos += 4;
    });

    yPos += 2;

    // رقم الصفقة
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`MARCHE N° ${project.marcheNo || ''}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 6;

    // عنوان المشروع
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const titleText = `Travaux: ${project.objet || ''}${project.commune ? ', Commune de ' + project.commune : ''}`;
    const titleLines = doc.splitTextToSize(titleText, pageWidth - margin * 4);
    titleLines.forEach((line: string) => {
      doc.text(line, pageWidth / 2, yPos, { align: 'center' });
      yPos += 4;
    });

    yPos += 4;

    // عنوان الميتري
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    const decompteSuffix = periode.isDecompteDernier ? ' et Dernier' : '';
    const formattedDate = new Date(metreDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.text(
      `METRE N° ${String(periode.numero).padStart(2, '0')}${decompteSuffix}  DU  ${formattedDate}`,
      pageWidth / 2, yPos, { align: 'center' }
    );
    yPos += 8;
  };

  drawDocumentHeader();

  // ═══════════════════════════════════════
  // بناء الجدول الموحد المستمر
  // ═══════════════════════════════════════
  
  // الأعمدة الثابتة (كما في Excel الرسمي):
  // N° du prix | Désignation | Nbre parties semblables | Unité | Dimensions (Longueur/Largeur/Hauteur) | Cubage résultant (Partiel/Cumulé) | Observations
  const tableHead: RowInput[] = [
    // صف رأس مزدوج
    [
      { content: 'N° du prix', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Désignations des ouvrages et parties d\'ouvrages', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Nombre des\nparties\nsemblables', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fontSize: 6 } },
      { content: 'Unité', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Dimensions', colSpan: 3, styles: { halign: 'center' } },
      { content: 'Cubage résultant / Cumulé', colSpan: 2, styles: { halign: 'center' } },
      { content: 'Observations et détails de calcul', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fontSize: 6 } },
    ],
    [
      { content: 'Longueur', styles: { halign: 'center' } },
      { content: 'Largeur', styles: { halign: 'center' } },
      { content: 'Hauteur', styles: { halign: 'center' } },
      { content: 'Partiel', styles: { halign: 'center' } },
      { content: 'Cumulé', styles: { halign: 'center' } },
    ],
  ];

  // بناء كل صفوف الجدول
  const tableBody: RowInput[] = [];

  // Helper: تنسيق عدد
  const fmt = (v: number | undefined | null, d: number = 2): string => {
    if (v === undefined || v === null || isNaN(v) || v === 0) return '';
    return v.toFixed(d);
  };

  // فلترة الأرتيكلات التي لها بيانات
  const articlesWithData = metresData.filter(m => m.lignes.length > 0 || m.sections.length > 0);

  for (const article of articlesWithData) {
    const sectionsForArticle = article.sections || [];
    const subSectionsForArticle = article.subSections || [];
    const lignesForArticle = article.lignes || [];

    // ──────────────────────────────────────
    // صف البند الرئيسي (أزرق فاتح)
    // ──────────────────────────────────────
    tableBody.push([
      { content: String(article.numeroLigne), styles: { fillColor: COLORS.headerBlue, fontStyle: 'bold', halign: 'center', valign: 'middle' } },
      { content: article.designation, styles: { fillColor: COLORS.headerBlue, fontStyle: 'bold', fontSize: 7 } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: article.unite, styles: { fillColor: COLORS.headerBlue, fontStyle: 'bold', halign: 'center' } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
    ] as CellDef[]);

    let articleTotal = 0;

    // ──────────────────────────────────────
    // قياسات بدون section (مباشرة)
    // ──────────────────────────────────────
    const rootLignes = lignesForArticle.filter(l => !l.sectionId);
    if (rootLignes.length > 0) {
      rootLignes.forEach(l => {
        tableBody.push([
          { content: '', styles: { fillColor: COLORS.white } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: fmt(l.nombreSemblables), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: fmt(l.longueur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.largeur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.profondeur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.partiel), styles: { fillColor: COLORS.white, halign: 'right' } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: l.observations || l.designation || '', styles: { fillColor: COLORS.white, fontSize: 6 } },
        ] as CellDef[]);
        articleTotal += l.partiel || 0;
      });
    }

    // ──────────────────────────────────────
    // الأقسام (Sections = Douars/Lieux)
    // ──────────────────────────────────────
    for (const section of sectionsForArticle) {
      let sectionTotal = 0;

      // صف عنوان القسم (وردي)
      tableBody.push([
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: section.titre || 'Section', styles: { fillColor: COLORS.subDescPink, fontStyle: 'bold', fontSize: 7 } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
        { content: '', styles: { fillColor: COLORS.subDescPink } },
      ] as CellDef[]);

      // القياسات المباشرة تحت القسم
      const directLignes = lignesForArticle.filter(l => l.sectionId === section.id && !l.subSectionId);
      directLignes.forEach(l => {
        tableBody.push([
          { content: '', styles: { fillColor: COLORS.white } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: fmt(l.nombreSemblables), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: fmt(l.longueur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.largeur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.profondeur), styles: { fillColor: COLORS.white, halign: 'center' } },
          { content: fmt(l.partiel), styles: { fillColor: COLORS.white, halign: 'right' } },
          { content: '', styles: { fillColor: COLORS.white } },
          { content: l.observations || l.designation || '', styles: { fillColor: COLORS.white, fontSize: 6 } },
        ] as CellDef[]);
        sectionTotal += l.partiel || 0;
      });

      // الأقسام الفرعية (Sub-sections = Éléments: radier, voile, dalle...)
      const subSectionsForSection = subSectionsForArticle.filter(ss => ss.sectionId === section.id);
      for (const subSection of subSectionsForSection) {
        const nombreElements = (subSection as any).nombreElements || 1;

        // صف عنوان القسم الفرعي (وردي)
        const ssLabel = subSection.titre || 'Élément';
        tableBody.push([
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: `    ${ssLabel}`, styles: { fillColor: COLORS.subDescPink, fontStyle: 'italic', fontSize: 7 } },
          { content: nombreElements > 1 ? String(nombreElements) : '', styles: { fillColor: COLORS.subDescPink, halign: 'center' } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
          { content: '', styles: { fillColor: COLORS.subDescPink } },
        ] as CellDef[]);

        // قياسات القسم الفرعي (أبيض)
        const subLignes = lignesForArticle.filter(l => l.subSectionId === subSection.id);
        let subTotal = 0;
        subLignes.forEach(l => {
          tableBody.push([
            { content: '', styles: { fillColor: COLORS.white } },
            { content: '', styles: { fillColor: COLORS.white } },
            { content: fmt(l.nombreSemblables), styles: { fillColor: COLORS.white, halign: 'center' } },
            { content: '', styles: { fillColor: COLORS.white } },
            { content: fmt(l.longueur), styles: { fillColor: COLORS.white, halign: 'center' } },
            { content: fmt(l.largeur), styles: { fillColor: COLORS.white, halign: 'center' } },
            { content: fmt(l.profondeur), styles: { fillColor: COLORS.white, halign: 'center' } },
            { content: fmt(l.partiel), styles: { fillColor: COLORS.white, halign: 'right' } },
            { content: '', styles: { fillColor: COLORS.white } },
            { content: l.observations || l.designation || '', styles: { fillColor: COLORS.white, fontSize: 6 } },
          ] as CellDef[]);
          subTotal += l.partiel || 0;
        });

        sectionTotal += subTotal * nombreElements;
      }

      articleTotal += sectionTotal;
    }

    // ──────────────────────────────────────
    // صف TOTAL للبند (أزرق فاتح كما في Excel)
    // ──────────────────────────────────────
    tableBody.push([
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: 'TOTAL', colSpan: 4, styles: { fillColor: COLORS.headerBlue, fontStyle: 'bold', halign: 'right', fontSize: 9 } },
      { content: fmt(articleTotal), styles: { fillColor: COLORS.headerBlue, fontStyle: 'bold', halign: 'right', fontSize: 9 } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
      { content: '', styles: { fillColor: COLORS.headerBlue } },
    ] as CellDef[]);
  }

  // ═══════════════════════════════════════
  // رسم الجدول الموحد
  // ═══════════════════════════════════════
  autoTable(doc, {
    startY: yPos,
    head: tableHead,
    body: tableBody,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      lineColor: [150, 150, 150],
      lineWidth: 0.2,
      textColor: COLORS.textDark,
      minCellHeight: 6,
    },
    headStyles: {
      fillColor: COLORS.darkBlue,
      textColor: COLORS.textWhite,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      fontSize: 7,
      minCellHeight: 10,
    },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },   // N° du prix
      1: { cellWidth: 'auto', halign: 'left' },  // Désignation
      2: { cellWidth: 18, halign: 'center' },     // Nbre parties semblables
      3: { cellWidth: 14, halign: 'center' },     // Unité
      4: { cellWidth: 20, halign: 'center' },     // Longueur
      5: { cellWidth: 20, halign: 'center' },     // Largeur
      6: { cellWidth: 20, halign: 'center' },     // Hauteur
      7: { cellWidth: 22, halign: 'right' },      // Partiel
      8: { cellWidth: 22, halign: 'right' },      // Cumulé
      9: { cellWidth: 'auto', halign: 'left' },   // Observations
    },
    margin: { left: margin, right: margin },
    // رأس الصفحة في كل صفحة جديدة
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(`Marché N° ${project.marcheNo}  —  Métré N° ${periode.numero}`, margin, 8);
        doc.text(`Page ${data.pageNumber}`, pageWidth - margin, 8, { align: 'right' });
      }
    },
  });

  // ═══════════════════════════════════════
  // التوقيعات — تتبع آخر جدول
  // ═══════════════════════════════════════
  const pageHeight = doc.internal.pageSize.height;
  yPos = (doc as any).lastAutoTable.finalY + 12;

  if (yPos > pageHeight - 50) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const formattedSignDate = new Date(metreDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  doc.text(`Dressé le: ${formattedSignDate}`, margin, yPos);

  yPos += 15;

  doc.setFont('helvetica', 'bold');
  doc.text(project.assistanceTechnique ? "L'ASSISTANCE TECHNIQUE:" : "L'ASSISTANCE TECHNIQUE:", margin + 10, yPos);
  doc.text(project.maitreOeuvre ? "Le Maître d'Oeuvre:" : "Le Maître d'Oeuvre:", pageWidth / 2, yPos);

  if (project.assistanceTechnique) {
    doc.setFont('helvetica', 'normal');
    doc.text(project.assistanceTechnique, margin + 10, yPos + 7);
  }
  if (project.maitreOeuvre) {
    doc.setFont('helvetica', 'normal');
    doc.text(project.maitreOeuvre, pageWidth / 2, yPos + 7);
  }

  yPos += 30;
  doc.setFont('helvetica', 'normal');
  doc.text('Visa:', margin + 10, yPos);
  doc.text('Visa:', pageWidth / 2, yPos);

  // ═══════════════════════════════════════
  // حفظ الملف
  // ═══════════════════════════════════════
  const fileName = `Metre_${project.marcheNo}_N${periode.numero}_${new Date().toISOString().split('T')[0]}.pdf`;

  if (hasFileSystemAccess()) {
    const pdfData = doc.output('arraybuffer');
    const result = await savePDF(new Uint8Array(pdfData), fileName);
    if (!result.success && !result.canceled) {
      console.error('[MetrePDF] Save failed:', result.error);
      doc.save(fileName);
    } else if (result.success) {
      console.log('[MetrePDF] Saved to:', result.filePath);
    }
  } else {
    doc.save(fileName);
  }
}
