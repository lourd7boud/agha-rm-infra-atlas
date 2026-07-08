/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📄 Revision PDF Export - Note de calcul de la révision des prix
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * تصدير PDF لحساب مراجعة الأسعار
 * 
 * 📌 الصفحات:
 *    - الصفحة 1: معلومات المشروع والصيغة
 *    - الصفحة 2: جدول المعاملات الشهرية (Calcul des coefficients)
 *    - الصفحة 3: جدول حساب المراجعة (Calcul de la révision)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { savePDF, hasFileSystemAccess } from './desktopFileService';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface RevisionProject {
  id: string;
  marcheNo: string;
  objet: string;
  societe?: string;
  dateOuverture?: string;
  osc?: string;
  delaisExecution?: number;
}

interface MonthCoefficient {
  month: string;
  monthLabel: string;
  indexes: Record<string, number>;
  ratios: Record<string, number>;
  coefficient: number;
}

interface DecomptRevision {
  decomptId: string;
  decomptNumero: number;
  dateDebut: string;
  dateFin: string;
  totalJours: number;
  monthsBreakdown: Array<{
    month: string;
    days: number;
    coefficient: number;
  }>;
  coefficientApplique: number;
  montantAReviser: number;
  montantRevision: number;
}

interface RevisionConfig {
  formula: {
    name?: string;
    fixedPart: number;
    weights: Record<string, number>;
  };
  baseDate?: string | Date;
  baseIndexes?: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// NUMBER TO WORDS (French)
// ═══════════════════════════════════════════════════════════════════════════

function numberToWords(num: number): string {
  const absNum = Math.abs(num);
  const dirhams = Math.floor(absNum);
  const centimes = Math.round((absNum - dirhams) * 100);

  const convertNumber = (n: number): string => {
    const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
    const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

    if (n === 0) return '';
    if (n < 10) return units[n];
    if (n >= 10 && n < 20) return teens[n - 10];

    const ten = Math.floor(n / 10);
    const unit = n % 10;

    if (ten === 7 || ten === 9) {
      const baseTen = tens[ten];
      const remainder = 10 + unit;
      if (remainder < 20) return baseTen + '-' + teens[remainder - 10];
      return baseTen + '-' + units[unit];
    }

    if (ten === 8) {
      if (unit === 0) return 'quatre-vingts';
      return 'quatre-vingt-' + units[unit];
    }

    if (unit === 0) return tens[ten];
    if (unit === 1 && ten === 2) return 'vingt et un';
    if (unit === 1 && (ten === 3 || ten === 4 || ten === 5 || ten === 6)) return tens[ten] + ' et un';
    
    return tens[ten] + '-' + units[unit];
  };

  const convertHundreds = (n: number): string => {
    if (n === 0) return '';
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;

    let result = '';
    if (hundred > 1) {
      result = convertNumber(hundred) + ' cent';
      if (remainder === 0) result += 's';
    } else if (hundred === 1) {
      result = 'cent';
    }

    if (remainder > 0) {
      if (result) result += ' ';
      result += convertNumber(remainder);
    }

    return result;
  };

  const convertThousands = (n: number): string => {
    if (n === 0) return 'zéro';
    
    const millions = Math.floor(n / 1000000);
    const thousands = Math.floor((n % 1000000) / 1000);
    const hundreds = n % 1000;

    let result = '';

    if (millions > 0) {
      if (millions === 1) {
        result += 'un million';
      } else {
        result += convertHundreds(millions) + ' millions';
      }
    }

    if (thousands > 0) {
      if (result) result += ' ';
      if (thousands === 1) {
        result += 'mille';
      } else {
        result += convertHundreds(thousands) + ' mille';
      }
    }

    if (hundreds > 0) {
      if (result) result += ' ';
      result += convertHundreds(hundreds);
    }

    return result;
  };

  let result = (num < 0 ? 'moins ' : '') + convertThousands(dirhams).trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);
  result += ' Dirhams';

  if (centimes > 0) {
    result += ',' + centimes.toString().padStart(2, '0') + 'Cts';
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatNumber(value: number, decimals: number = 2): string {
  // Manual formatting to avoid locale special characters in PDF
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  // Add space as thousands separator (French style)
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart ? `${intFormatted},${decPart}` : intFormatted;
}

function formatMontant(value: number): string {
  // Manual formatting for currency - no locale special characters
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  // Add space as thousands separator (French style)
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intFormatted},${decPart}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return format(date, 'MMMM-yy', { locale: fr });
}

function formatMonthLabelShort(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  // Format: "24-juillet" for display in revision table
  return `${year.toString().slice(-2)}-${format(new Date(year, month - 1, 1), 'MMMM', { locale: fr })}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PDF EXPORT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function generateRevisionPDF(
  project: RevisionProject,
  revisionConfig: RevisionConfig,
  monthCoefficients: MonthCoefficient[],
  decomptRevisions: DecomptRevision[],
  totalRevision: number
): Promise<void> {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.width;
  // const pageHeight = doc.internal.pageSize.height; // Reserved for future use

  // Get formula info
  const formula = revisionConfig.formula;
  const indexCodes = Object.keys(formula.weights);
  const baseDate = revisionConfig.baseDate 
    ? new Date(revisionConfig.baseDate) 
    : new Date(project.dateOuverture || Date.now());
  const oscDate = project.osc ? new Date(project.osc) : null;
  
  // Get base month indexes
  const baseMonthKey = format(baseDate, 'yyyy-MM');
  const baseCoef = monthCoefficients.find(c => c.month === baseMonthKey);
  const baseIndexes = revisionConfig.baseIndexes || baseCoef?.indexes || {};

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1: Project Info + Formula
  // ═══════════════════════════════════════════════════════════════════════════

  let yPos = 15;

  // Header - ROYAUME DU MAROC
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('ROYAUME DU MAROC', pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;

  // Try to add Morocco logo
  let logoEndY = yPos + 25; // Default position after logo
  try {
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      logoImg.onload = () => resolve();
      logoImg.onerror = () => reject();
      logoImg.src = '/maroc-logo.png';
    });
    // Add centered logo
    const logoWidth = 25;
    const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
    doc.addImage(logoImg, 'PNG', (pageWidth - logoWidth) / 2, yPos, logoWidth, logoHeight);
    logoEndY = yPos + logoHeight + 3;
  } catch {
    // If image doesn't load, skip
    logoEndY = yPos + 3;
  }
  
  yPos = logoEndY;

  // Ministry
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('MINISTERE DE L\'AGRICULTURE ET DE LA PECHE MARITIME', pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;
  doc.text('DIRECTION PROVINCIALE DE L\'AGRICULTURE DE TATA', pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('NOTE DE CALCUL DE LA REVISION DES PRIX', pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;
  doc.setFontSize(12);
  doc.text(`MARCHE N°${project.marcheNo}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Project info table
  const infoData = [
    ['Objet du marché', project.objet || ''],
    ['Société', project.societe || ''],
    ['Mode de passation du marché', `Appel d'offre ouvert sur offre de prix N°${project.marcheNo}`],
    ['Date d\'ouverture des plis', project.dateOuverture ? format(new Date(project.dateOuverture), 'dd/MM/yyyy') : ''],
    ['Date de l\'ordre de service de commencement des travaux', oscDate ? format(oscDate, 'dd/MM/yyyy') : ''],
    ['Délai d\'exécution', project.delaisExecution ? `${project.delaisExecution} mois` : ''],
    ['Formules de la révision', buildFormulaString(formula)]
  ];

  autoTable(doc, {
    startY: yPos,
    head: [],
    body: infoData,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 60, fontStyle: 'bold', fillColor: [240, 240, 240] },
      1: { cellWidth: pageWidth - 80 }
    },
    margin: { left: 10, right: 10 }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2: Coefficients Table
  // ═══════════════════════════════════════════════════════════════════════════

  doc.addPage('landscape');
  yPos = 15;

  // Title
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`MARCHE N°${project.marcheNo}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const objetLines = doc.splitTextToSize(project.objet || '', pageWidth - 40);
  objetLines.forEach((line: string) => {
    doc.text(line, pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
  });
  yPos += 6;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Calcul des coefficients', pageWidth / 2, yPos, { align: 'center' });
  // Underline
  const titleWidth = doc.getTextWidth('Calcul des coefficients');
  doc.line(pageWidth / 2 - titleWidth / 2, yPos + 1, pageWidth / 2 + titleWidth / 2, yPos + 1);
  yPos += 10;

  // Build coefficients table
  // Headers: mois | Index (At, Cs, Mc1, S) | Ratios (At/At0, Cs/Cs0, etc.) | coefficient
  const coefHeaders: any[][] = [
    [
      { content: 'mois', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Index', colSpan: indexCodes.length, styles: { halign: 'center' as const } },
      { content: '', colSpan: indexCodes.length, styles: { halign: 'center' as const } },
      { content: 'coefficient\ndu mois', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } }
    ],
    [
      ...indexCodes.map(code => ({ content: code, styles: { halign: 'center' as const } })),
      ...indexCodes.map(code => ({ content: `${code}/${code}0`, styles: { halign: 'center' as const } }))
    ]
  ];

  // Build data rows
  const coefBody: any[][] = [];

  // Base month row (highlighted)
  const baseRow = monthCoefficients.find(c => c.month === baseMonthKey);
  if (baseRow) {
    coefBody.push([
      { content: formatMonthLabel(baseMonthKey), styles: { fillColor: [255, 230, 204] } },
      ...indexCodes.map(code => ({ 
        content: formatNumber(baseIndexes[code] || baseRow.indexes[code] || 0, 1), 
        styles: { halign: 'right' as const, fillColor: [255, 230, 204] } 
      })),
      { 
        content: 'Epoque de base (l\'index du mois de la date limite de remise des offres)', 
        colSpan: indexCodes.length, 
        styles: { halign: 'center' as const, fillColor: [255, 230, 204], fontSize: 7 } 
      },
      { content: '', styles: { fillColor: [255, 230, 204] } }
    ]);
  }

  // Monthly coefficients (skip base month in main loop)
  for (const coef of monthCoefficients) {
    if (coef.month === baseMonthKey) continue;

    coefBody.push([
      formatMonthLabel(coef.month),
      ...indexCodes.map(code => ({ 
        content: formatNumber(coef.indexes[code] || 0, 1), 
        styles: { halign: 'right' as const } 
      })),
      ...indexCodes.map(code => ({ 
        content: formatNumber(coef.ratios[code] || 0, 4), 
        styles: { halign: 'right' as const, fillColor: [230, 242, 255] } 
      })),
      { 
        content: formatNumber(coef.coefficient, 4), 
        styles: { halign: 'right' as const, fillColor: [255, 255, 204] } 
      }
    ]);
  }

  // Add formula row at the end
  coefBody.push([
    { 
      content: buildFormulaStringShort(formula), 
      colSpan: 1 + indexCodes.length * 2 + 1, 
      styles: { halign: 'center' as const, fontStyle: 'italic' as const, fontSize: 8 } 
    }
  ]);

  autoTable(doc, {
    startY: yPos,
    head: coefHeaders,
    body: coefBody,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center'
    },
    margin: { left: 10, right: 10 }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3: Revision Calculation Table
  // ═══════════════════════════════════════════════════════════════════════════

  doc.addPage('landscape');
  yPos = 15;

  // Title
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`MARCHE N°${project.marcheNo}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  objetLines.forEach((line: string) => {
    doc.text(line, pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
  });
  yPos += 6;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Calcul de la révision', pageWidth / 2, yPos, { align: 'center' });
  // Underline
  const title2Width = doc.getTextWidth('Calcul de la révision');
  doc.line(pageWidth / 2 - title2Width / 2, yPos + 1, pageWidth / 2 + title2Width / 2, yPos + 1);
  yPos += 10;

  // Build revision table headers
  const revHeaders: any[][] = [
    [
      { content: 'N° de\ndécompte', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Date début\nd\'effet', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Date\nd\'établis-\nsement', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Mois', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Coefficient\ndu mois', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'nombre de\njours par\nmois', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'nombre\ntotal de\njours', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Coefficient\nappliqué', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Montant à\nréviser', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Montant de la\nrévision des prix', rowSpan: 1, styles: { halign: 'center' as const, valign: 'middle' as const } }
    ]
  ];

  // Build revision data rows
  const revBody: any[][] = [];

  // Epoch info rows
  const baseDateStr = format(baseDate, 'dd/MM/yyyy');
  revBody.push([
    { content: '', styles: { fillColor: [255, 255, 255] } },
    { content: baseDateStr, styles: { fillColor: [255, 230, 204] } },
    { content: `Epoque de base (mois de la date limite de remise des offres) ${format(baseDate, 'dd/MM/yyyy')}`, colSpan: 8, styles: { fillColor: [255, 230, 204], fontSize: 7 } }
  ]);

  if (oscDate) {
    revBody.push([
      { content: '', styles: { fillColor: [255, 255, 255] } },
      { content: format(oscDate, 'dd/MM/yyyy'), styles: { fillColor: [255, 230, 204] } },
      { content: `Ordre de service de commencement des travaux ${format(oscDate, 'dd/MM/yyyy')}`, colSpan: 8, styles: { fillColor: [255, 230, 204], fontSize: 7 } }
    ]);
  }

  // Decompt rows with monthly breakdown
  for (const rev of decomptRevisions) {
    const monthRows = rev.monthsBreakdown.length;
    
    // First row of decompt
    if (monthRows > 0) {
      const firstMonth = rev.monthsBreakdown[0];
      // Calculate contribution for display if needed
      // const contribution = firstMonth.coefficient * firstMonth.days / rev.totalJours;
      
      // Convert dates from yyyy-MM-dd to dd/MM/yyyy
      const dateDebutFormatted = rev.dateDebut.split('-').reverse().join('/');
      const dateFinFormatted = rev.dateFin.split('-').reverse().join('/');
      
      revBody.push([
        { content: rev.decomptNumero === decomptRevisions[decomptRevisions.length - 1].decomptNumero ? `${rev.decomptNumero} et Dernier` : rev.decomptNumero.toString(), rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        { content: dateDebutFormatted, rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        { content: dateFinFormatted, rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        formatMonthLabelShort(firstMonth.month),
        { content: formatNumber(firstMonth.coefficient, 4), styles: { halign: 'center' as const } },
        { content: firstMonth.days.toString(), styles: { halign: 'center' as const } },
        { content: rev.totalJours.toString(), rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        { content: formatNumber(rev.coefficientApplique, 4), rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        { content: formatMontant(rev.montantAReviser), rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } },
        { content: formatMontant(rev.montantRevision), rowSpan: monthRows, styles: { valign: 'middle' as const, halign: 'center' as const } }
      ]);
      
      // Additional month rows
      for (let i = 1; i < monthRows; i++) {
        const month = rev.monthsBreakdown[i];
        revBody.push([
          formatMonthLabelShort(month.month),
          { content: formatNumber(month.coefficient, 4), styles: { halign: 'center' as const } },
          { content: month.days.toString(), styles: { halign: 'center' as const } }
        ]);
      }
    }
  }

  autoTable(doc, {
    startY: yPos,
    head: revHeaders,
    body: revBody,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: [173, 216, 230], // Light blue
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center'
    },
    margin: { left: 10, right: 10 }
  });

  // Get final Y position
  const finalY = (doc as any).lastAutoTable?.finalY || yPos + 100;

  // Summary table - centered
  const summaryY = finalY + 10;
  const tableWidth = 150;
  const tableLeft = (pageWidth - tableWidth) / 2;
  
  autoTable(doc, {
    startY: summaryY,
    head: [],
    body: [
      [
        { content: 'DESIGNATION', styles: { fontStyle: 'bold' as const, fillColor: [173, 216, 230] } },
        { content: 'Montant de la\nrévision des\nprix', styles: { fontStyle: 'bold' as const, fillColor: [173, 216, 230], halign: 'center' as const } }
      ],
      [
        'Montant de la révision des prix H T.V.A',
        { content: formatMontant(totalRevision), styles: { halign: 'center' as const } }
      ]
    ],
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 50 }
    },
    margin: { left: tableLeft, right: tableLeft }
  });

  // Get position after summary table
  const totalY = (doc as any).lastAutoTable?.finalY || summaryY + 30;

  // Amount in words
  const wordsY = totalY + 10;
  doc.setFillColor(255, 255, 204);
  doc.rect(10, wordsY - 3, pageWidth - 20, 10, 'F');
  doc.setDrawColor(0, 0, 0);
  doc.rect(10, wordsY - 3, pageWidth - 20, 10, 'S');
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Arrêté le montant de la révision des prix à la somme de :    ${numberToWords(totalRevision)}`, 15, wordsY + 2);

  // Signatures
  const sigY = wordsY + 25;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  
  // Draw underlines for signatures
  const sigWidth = 50;
  doc.text('DRESSEE PAR', 40, sigY, { align: 'center' });
  doc.line(15, sigY + 2, 15 + sigWidth, sigY + 2);
  
  doc.text('LUE ET ACCEPTEE PAR', pageWidth / 2, sigY, { align: 'center' });
  doc.line(pageWidth / 2 - sigWidth / 2, sigY + 2, pageWidth / 2 + sigWidth / 2, sigY + 2);
  
  doc.text('APPROUVEE PAR', pageWidth - 40, sigY, { align: 'center' });
  doc.line(pageWidth - 15 - sigWidth, sigY + 2, pageWidth - 15, sigY + 2);

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE PDF
  // ═══════════════════════════════════════════════════════════════════════════

  const fileName = `Revision_Prix_${project.marcheNo?.replace(/\//g, '-') || 'projet'}.pdf`;
  
  // Use native save dialog in Electron, fallback to browser download
  if (hasFileSystemAccess()) {
    const pdfData = doc.output('arraybuffer');
    const result = await savePDF(new Uint8Array(pdfData), fileName);
    if (!result.success && !result.canceled) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildFormulaString(formula: { fixedPart: number; weights: Record<string, number> }): string {
  const parts = Object.entries(formula.weights).map(([index, weight]) => {
    return `${weight}(${index}/${index}0)`;
  });
  return `Formule : P = P0  [${formula.fixedPart} + ${parts.join('+ ')}].`;
}

function buildFormulaStringShort(formula: { fixedPart: number; weights: Record<string, number> }): string {
  const parts = Object.entries(formula.weights).map(([index, weight]) => {
    return `${weight} (${index}/${index}0)`;
  });
  return `Formule N°1: P = P0 [${formula.fixedPart} + ${parts.join('+')}-1`;
}
