import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { savePDF, saveExcel } from './desktopFileService';

// ═══════════════════════════════════════════════════════════════
// 📊 DELAIS EXPORT — تصدير بيانات الآجال (Excel + PDF)
// Export des délais multi-projets — Suivi global des échéances
// ═══════════════════════════════════════════════════════════════

interface DeadlineProject {
  id: string;
  objet: string;
  marcheNo?: string;
  societe?: string;
  status: string;
  dateCommencement?: string;
  delaisExecution?: number;
  dateFinPrevue?: string;
  joursRestants?: number;
  nbArrets?: number;
  joursSupplementaires?: number;
  achevementTravaux?: string;
  dateReceptionProvisoire?: string;
  dateReceptionDefinitive?: string;
  arrets?: Array<{
    id: string;
    dateArret: string;
    dateReprise?: string;
    motif: string;
  }>;
}

// ─── Status Helpers ──────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  en_cours: 'En cours',
  draft: 'Brouillon',
  completed: 'Terminé',
  termine: 'Terminé',
  suspendu: 'Suspendu',
  planifie: 'Planifié',
};

function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

function getRealDaysRemaining(p: DeadlineProject): number {
  // Calculate real days remaining (negative = overdue)
  if (!p.dateCommencement || !p.delaisExecution) return 0;
  const start = new Date(p.dateCommencement);
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + p.delaisExecution * 30);
  const now = new Date();
  const diffMs = endDate.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function getDeadlineStatus(p: DeadlineProject): { label: string; color: string } {
  if (!p.dateCommencement || !p.delaisExecution) {
    return { label: 'Dates non définies', color: '#9CA3AF' };
  }
  const jours = getRealDaysRemaining(p);
  const isActive = p.status === 'active' || p.status === 'en_cours';
  if (p.status === 'completed' || p.status === 'termine') {
    return { label: 'Terminé', color: '#10B981' };
  }
  if (jours <= 0 && isActive) {
    return { label: 'En retard', color: '#EF4444' };
  }
  if (jours > 0 && jours <= 30) {
    return { label: `Urgent (${Math.round(jours)}j)`, color: '#F59E0B' };
  }
  if (jours > 30 && jours <= 90) {
    return { label: `Attention (${Math.round(jours)}j)`, color: '#F97316' };
  }
  return { label: `Normal (${Math.round(jours)}j)`, color: '#10B981' };
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('fr-FR');
  } catch {
    return '—';
  }
}

function calculateProgress(p: DeadlineProject): number {
  if (!p.dateCommencement || !p.delaisExecution) return 0;
  const start = new Date(p.dateCommencement).getTime();
  const end = new Date(p.dateCommencement);
  end.setDate(end.getDate() + p.delaisExecution * 30);
  const endMs = end.getTime();
  const now = Date.now();
  const total = endMs - start;
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((now - start) / total) * 100)));
}

function calculateTotalArretDays(p: DeadlineProject): number {
  if (!p.arrets || p.arrets.length === 0) return Number(p.joursSupplementaires) || 0;
  let total = 0;
  for (const a of p.arrets) {
    if (a.dateArret) {
      const start = new Date(a.dateArret).getTime();
      const end = a.dateReprise ? new Date(a.dateReprise).getTime() : Date.now();
      total += Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
    }
  }
  return total || Number(p.joursSupplementaires) || 0;
}

// ═══════════════════════════════════════════════════════════════
// 📗 EXCEL EXPORT — تصدير Excel شامل
// ═══════════════════════════════════════════════════════════════

export async function exportDelaisExcel(projects: DeadlineProject[]): Promise<void> {
  const wb = XLSX.utils.book_new();

  // Sort by N° Marché ascending
  const sorted = [...projects].sort((a, b) => {
    const aNo = (a.marcheNo || '').replace(/[^0-9]/g, '');
    const bNo = (b.marcheNo || '').replace(/[^0-9]/g, '');
    return (parseInt(aNo) || 9999) - (parseInt(bNo) || 9999);
  });

  // ─── Sheet 1: Tableau récapitulatif ────────────────
  const summaryHeaders = [
    'N°',
    'N° Marché',
    'Entreprise',
    'Statut Projet',
    'Date Commencement (OSC)',
    'Délai d\'Exécution (mois)',
    'Délai d\'Exécution (jours)',
    'Date Fin Prévue',
    'Jours Restants',
    'Avancement Temps (%)',
    'État Délai',
    'Nb Arrêts',
    'Jours Arrêt Cumulés',
    'Date Fin Effective (avec arrêts)',
    'Date Achèvement Travaux',
    'Date Réception Provisoire',
    'Date Réception Définitive',
    'Observations',
  ];

  const summaryRows = sorted.map((p, i) => {
    const status = getDeadlineStatus(p);
    const progress = calculateProgress(p);
    const totalArretDays = calculateTotalArretDays(p);
    const delaisJours = p.delaisExecution ? p.delaisExecution * 30 : 0;
    const realDays = getRealDaysRemaining(p);

    // Calculate effective end date (with arrêts)
    let dateFinEffective = '—';
    if (p.dateCommencement && p.delaisExecution) {
      const end = new Date(p.dateCommencement);
      end.setDate(end.getDate() + delaisJours + totalArretDays);
      dateFinEffective = formatDate(end.toISOString());
    }

    // Observations
    const obs: string[] = [];
    if (status.label === 'En retard') obs.push(`⚠️ EN RETARD de ${Math.abs(realDays)} jours`);
    if (status.label.startsWith('Urgent')) obs.push('⏰ Délai urgent');
    if (Number(p.nbArrets) > 0) obs.push(`${p.nbArrets} arrêt(s) enregistré(s)`);
    if (p.dateReceptionProvisoire) obs.push('Réception provisoire effectuée');
    if (p.dateReceptionDefinitive) obs.push('Réception définitive effectuée');

    return [
      i + 1,
      p.marcheNo || '—',
      p.societe || '—',
      getStatusLabel(p.status),
      p.dateCommencement ? formatDate(p.dateCommencement) : '—',
      p.delaisExecution || '—',
      delaisJours || '—',
      p.dateFinPrevue ? formatDate(p.dateFinPrevue) : '—',
      realDays,
      progress,
      status.label,
      Number(p.nbArrets) || 0,
      totalArretDays,
      dateFinEffective,
      p.achevementTravaux ? formatDate(p.achevementTravaux) : '—',
      p.dateReceptionProvisoire ? formatDate(p.dateReceptionProvisoire) : '—',
      p.dateReceptionDefinitive ? formatDate(p.dateReceptionDefinitive) : '—',
      obs.join(' | '),
    ];
  });

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['SUIVI DES DÉLAIS — RAPPORT MULTI-PROJETS'],
    [`Date d'export: ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`],
    [`Nombre total de projets: ${sorted.length}`],
    [],
    summaryHeaders,
    ...summaryRows,
  ]);

  // Column widths
  summarySheet['!cols'] = [
    { wch: 5 },   // N°
    { wch: 18 },  // N° Marché
    { wch: 35 },  // Entreprise
    { wch: 12 },  // Statut
    { wch: 18 },  // Date Commencement
    { wch: 12 },  // Délai mois
    { wch: 12 },  // Délai jours
    { wch: 18 },  // Date Fin Prévue
    { wch: 14 },  // Jours Restants
    { wch: 14 },  // Avancement %
    { wch: 18 },  // État Délai
    { wch: 10 },  // Nb Arrêts
    { wch: 16 },  // Jours Arrêt
    { wch: 22 },  // Date Fin Effective
    { wch: 20 },  // Achèvement
    { wch: 20 },  // Réception Provisoire
    { wch: 20 },  // Réception Définitive
    { wch: 40 },  // Observations
  ];

  // Merge title cells
  summarySheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
  ];

  XLSX.utils.book_append_sheet(wb, summarySheet, 'Récapitulatif Délais');

  // ─── Sheet 2: Statistiques ────────────────────────
  const enRetard = projects.filter(p => {
    const j = Number(p.joursRestants) || 0;
    return j <= 0 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const urgent = projects.filter(p => {
    const j = Number(p.joursRestants) || 0;
    return j > 0 && j <= 30 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const enCours = projects.filter(p => {
    const j = Number(p.joursRestants) || 0;
    return j > 30 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const termines = projects.filter(p => p.status === 'completed' || p.status === 'termine').length;
  const sansDate = projects.filter(p => !p.dateCommencement || !p.delaisExecution).length;
  const avecArrets = projects.filter(p => Number(p.nbArrets) > 0).length;

  const statsData = [
    ['STATISTIQUES DES DÉLAIS'],
    [],
    ['Indicateur', 'Nombre', 'Pourcentage'],
    ['Total projets', projects.length, '100%'],
    ['Projets en retard', enRetard, `${projects.length ? Math.round(enRetard / projects.length * 100) : 0}%`],
    ['Projets urgents (≤30j)', urgent, `${projects.length ? Math.round(urgent / projects.length * 100) : 0}%`],
    ['Projets en cours (normaux)', enCours, `${projects.length ? Math.round(enCours / projects.length * 100) : 0}%`],
    ['Projets terminés', termines, `${projects.length ? Math.round(termines / projects.length * 100) : 0}%`],
    ['Sans dates définies', sansDate, `${projects.length ? Math.round(sansDate / projects.length * 100) : 0}%`],
    ['Projets avec arrêts', avecArrets, `${projects.length ? Math.round(avecArrets / projects.length * 100) : 0}%`],
    [],
    ['PROJETS EN RETARD — DÉTAILS'],
    [],
    ['N° Marché', 'Entreprise', 'Date Fin Prévue', 'Jours de Retard', 'Nb Arrêts'],
    ...sorted
      .filter(p => {
        const days = getRealDaysRemaining(p);
        return days <= 0 && (p.status === 'active' || p.status === 'en_cours');
      })
      .map(p => [
        p.marcheNo || '—',
        p.societe || '—',
        formatDate(p.dateFinPrevue),
        Math.abs(getRealDaysRemaining(p)),
        Number(p.nbArrets) || 0,
      ]),
  ];

  const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
  statsSheet['!cols'] = [
    { wch: 30 }, { wch: 55 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
  ];
  statsSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
  ];
  XLSX.utils.book_append_sheet(wb, statsSheet, 'Statistiques');

  // ─── Sheet 3: Détail des Arrêts ──────────────────
  const arretsHeaders = [
    'N° Marché', 'Entreprise', 'Date Arrêt (OSA)', 'Date Reprise (OSR)',
    'Durée Arrêt (jours)', 'Motif', 'En cours',
  ];
  const arretsRows: any[][] = [];
  for (const p of sorted) {
    if (p.arrets && p.arrets.length > 0) {
      for (const a of p.arrets) {
        const dStart = new Date(a.dateArret).getTime();
        const dEnd = a.dateReprise ? new Date(a.dateReprise).getTime() : Date.now();
        const days = Math.max(0, Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24)));
        arretsRows.push([
          p.marcheNo || '—',
          p.societe || p.objet || '—',
          formatDate(a.dateArret),
          a.dateReprise ? formatDate(a.dateReprise) : '—',
          days,
          a.motif || '—',
          a.dateReprise ? 'Non' : 'Oui',
        ]);
      }
    }
  }

  if (arretsRows.length > 0) {
    const arretsSheet = XLSX.utils.aoa_to_sheet([
      ['DÉTAIL DES ARRÊTS DE TRAVAUX'],
      [`Nombre total d'arrêts: ${arretsRows.length}`],
      [],
      arretsHeaders,
      ...arretsRows,
    ]);
    arretsSheet['!cols'] = [
      { wch: 18 }, { wch: 35 }, { wch: 16 }, { wch: 16 },
      { wch: 16 }, { wch: 40 }, { wch: 10 },
    ];
    arretsSheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    ];
    XLSX.utils.book_append_sheet(wb, arretsSheet, 'Arrêts de Travaux');
  }

  // ─── Sheet 4: Échéancier (Timeline) ──────────────
  const timelineHeaders = [
    'N° Marché', 'Entreprise', 'OSC (Début)', 'Fin Prévue Initiale',
    'Jours Arrêt', 'Fin Prévue Effective', 'Achèvement Travaux',
    'Réception Provisoire', 'Réception Définitive', 'Délai Consommé (%)',
  ];
  const timelineRows = sorted
    .filter(p => p.dateCommencement && p.delaisExecution)
    .map(p => {
      const totalArretDays = calculateTotalArretDays(p);
      const delaisJours = (p.delaisExecution || 0) * 30;
      const endInit = new Date(p.dateCommencement!);
      endInit.setDate(endInit.getDate() + delaisJours);
      const endEff = new Date(p.dateCommencement!);
      endEff.setDate(endEff.getDate() + delaisJours + totalArretDays);

      return [
        p.marcheNo || '—',
        p.societe || p.objet || '—',
        formatDate(p.dateCommencement),
        formatDate(endInit.toISOString()),
        totalArretDays,
        formatDate(endEff.toISOString()),
        p.achevementTravaux ? formatDate(p.achevementTravaux) : '—',
        p.dateReceptionProvisoire ? formatDate(p.dateReceptionProvisoire) : '—',
        p.dateReceptionDefinitive ? formatDate(p.dateReceptionDefinitive) : '—',
        calculateProgress(p),
      ];
    });

  const timelineSheet = XLSX.utils.aoa_to_sheet([
    ['ÉCHÉANCIER DES PROJETS'],
    [`Date d'export: ${new Date().toLocaleDateString('fr-FR')}`],
    [],
    timelineHeaders,
    ...timelineRows,
  ]);
  timelineSheet['!cols'] = [
    { wch: 18 }, { wch: 35 }, { wch: 16 }, { wch: 18 },
    { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    { wch: 18 }, { wch: 16 },
  ];
  timelineSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
  ];
  XLSX.utils.book_append_sheet(wb, timelineSheet, 'Échéancier');

  // ─── Generate & Download ──────────────────────────
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const fileName = `Suivi_Delais_${new Date().toISOString().slice(0, 10)}.xlsx`;
  await saveExcel(new Uint8Array(wbout), fileName);
}


// ═══════════════════════════════════════════════════════════════
// 📕 PDF EXPORT — تصدير PDF مفصل
// ═══════════════════════════════════════════════════════════════

export async function exportDelaisPDF(projects: DeadlineProject[]): Promise<void> {
  // Sort by N° Marché ascending
  const sorted = [...projects].sort((a, b) => {
    const aNo = (a.marcheNo || '').replace(/[^0-9]/g, '');
    const bNo = (b.marcheNo || '').replace(/[^0-9]/g, '');
    return (parseInt(aNo) || 9999) - (parseInt(bNo) || 9999);
  });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ─── Header ──────────────────────────────────────
  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text('SUIVI DES DÉLAIS — RAPPORT MULTI-PROJETS', 15, 13);
  doc.setFontSize(10);
  doc.text(
    `Date d'export: ${new Date().toLocaleDateString('fr-FR')} | Nombre de projets: ${sorted.length}`,
    15, 22
  );

  // ─── Statistics Summary ──────────────────────────
  const enRetard = sorted.filter(p => {
    const j = getRealDaysRemaining(p);
    return j <= 0 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const urgent = sorted.filter(p => {
    const j = getRealDaysRemaining(p);
    return j > 0 && j <= 30 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const enCours = sorted.filter(p => {
    const j = getRealDaysRemaining(p);
    return j > 30 && (p.status === 'active' || p.status === 'en_cours');
  }).length;
  const termines = sorted.filter(p => p.status === 'completed' || p.status === 'termine').length;

  let yPos = 35;

  // Stats boxes
  const boxW = 58;
  const boxH = 16;
  const boxGap = 8;
  const startX = (pageWidth - (4 * boxW + 3 * boxGap)) / 2;

  const statsBoxes = [
    { label: 'En Retard', value: enRetard, bg: [254, 226, 226], fg: [185, 28, 28] },
    { label: 'Urgent (≤30j)', value: urgent, bg: [254, 243, 199], fg: [146, 64, 14] },
    { label: 'En Cours', value: enCours, bg: [220, 252, 231], fg: [21, 128, 61] },
    { label: 'Terminés', value: termines, bg: [219, 234, 254], fg: [29, 78, 216] },
  ];

  statsBoxes.forEach((box, i) => {
    const x = startX + i * (boxW + boxGap);
    doc.setFillColor(box.bg[0], box.bg[1], box.bg[2]);
    doc.roundedRect(x, yPos, boxW, boxH, 2, 2, 'F');
    doc.setTextColor(box.fg[0], box.fg[1], box.fg[2]);
    doc.setFontSize(16);
    doc.text(String(box.value), x + boxW / 2, yPos + 7, { align: 'center' });
    doc.setFontSize(8);
    doc.text(box.label, x + boxW / 2, yPos + 13, { align: 'center' });
  });

  yPos += boxH + 8;

  // ─── Main Table ──────────────────────────────────
  const tableHeaders = [
    'N°',
    'N° Marché',
    'Entreprise',
    'Statut',
    'OSC (Début)',
    'Délai\n(mois)',
    'Fin Prévue',
    'Jours\nRestants',
    'Avancement\n(%)',
    'État',
    'Arrêts',
    'J. Arrêt',
    'Achèvement',
    'Récep.\nProv.',
    'Récep.\nDéf.',
  ];

  const tableRows = sorted.map((p, i) => {
    const status = getDeadlineStatus(p);
    const progress = calculateProgress(p);
    const totalArretDays = calculateTotalArretDays(p);
    const realDays = getRealDaysRemaining(p);

    return [
      String(i + 1),
      p.marcheNo || '—',
      (p.societe || '—').substring(0, 45) + ((p.societe?.length || 0) > 45 ? '...' : ''),
      getStatusLabel(p.status),
      formatDate(p.dateCommencement),
      p.delaisExecution ? String(p.delaisExecution) : '—',
      formatDate(p.dateFinPrevue),
      String(realDays),
      String(progress),
      status.label.replace(/\s*\(\d+j\)/, ''),
      String(Number(p.nbArrets) || 0),
      String(totalArretDays),
      formatDate(p.achevementTravaux),
      formatDate(p.dateReceptionProvisoire),
      formatDate(p.dateReceptionDefinitive),
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [tableHeaders],
    body: tableRows,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineWidth: 0.1,
      lineColor: [200, 200, 200],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
      valign: 'middle',
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { cellWidth: 22 },
      2: { cellWidth: 50 },
      3: { halign: 'center', cellWidth: 16 },
      4: { halign: 'center', cellWidth: 20 },
      5: { halign: 'center', cellWidth: 12 },
      6: { halign: 'center', cellWidth: 20 },
      7: { halign: 'center', cellWidth: 14 },
      8: { halign: 'center', cellWidth: 16 },
      9: { halign: 'center', cellWidth: 20 },
      10: { halign: 'center', cellWidth: 12 },
      11: { halign: 'center', cellWidth: 12 },
      12: { halign: 'center', cellWidth: 20 },
      13: { halign: 'center', cellWidth: 18 },
      14: { halign: 'center', cellWidth: 18 },
    },
    didParseCell(data) {
      // Color-code the "État" column
      if (data.section === 'body' && data.column.index === 9) {
        const val = String(data.cell.raw || '');
        if (val === 'En retard') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [254, 226, 226];
        } else if (val.startsWith('Urgent')) {
          data.cell.styles.textColor = [146, 64, 14];
          data.cell.styles.fillColor = [254, 243, 199];
        } else if (val === 'Terminé') {
          data.cell.styles.textColor = [21, 128, 61];
          data.cell.styles.fillColor = [220, 252, 231];
        }
      }
      // Color-code days remaining
      if (data.section === 'body' && data.column.index === 7) {
        const val = Number(data.cell.raw);
        if (!isNaN(val)) {
          if (val <= 0) {
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = 'bold';
          } else if (val <= 30) {
            data.cell.styles.textColor = [146, 64, 14];
          }
        }
      }
      // Alternating row colors
      if (data.section === 'body' && data.row.index % 2 === 0) {
        if (!data.cell.styles.fillColor || (Array.isArray(data.cell.styles.fillColor) && data.cell.styles.fillColor[0] === 255)) {
          data.cell.styles.fillColor = [245, 247, 250];
        }
      }
    },
    margin: { left: 10, right: 10 },
  });

  // ─── Footer ──────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `Page ${i}/${totalPages} — BTP App — Suivi des Délais — ${new Date().toLocaleDateString('fr-FR')}`,
      pageWidth / 2,
      pageHeight - 5,
      { align: 'center' }
    );
  }

  // ─── Save ────────────────────────────────────────
  const pdfOutput = doc.output('arraybuffer');
  const fileName = `Suivi_Delais_${new Date().toISOString().slice(0, 10)}.pdf`;
  await savePDF(new Uint8Array(pdfOutput), fileName);
}
