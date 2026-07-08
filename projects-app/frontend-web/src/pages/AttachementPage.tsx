import { FC, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProject, useBordereaux, usePeriodes, useMetres } from '../hooks/useUnifiedData';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toDecimal, round2, toNumber } from '../utils/financeEngine';

// 🔒 تقريب الكميات لرقمين - ROUND_HALF_UP via Decimal.js
const roundQuantity = (value: number): number => {
  return toNumber(round2(toDecimal(value)));
};

const AttachementPage: FC = () => {
  const { projectId: rawProjectId, periodeId: rawPeriodeId } = useParams<{ projectId: string; periodeId?: string }>();
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);

  // Normalize IDs - ensure they have the correct prefix
  const rawProjectIdClean = rawProjectId?.replace('project:', '') || '';
  const periodeId = rawPeriodeId 
    ? (rawPeriodeId.includes(':') ? rawPeriodeId : `periode:${rawPeriodeId}`)
    : null;
  const rawPeriodeIdClean = rawPeriodeId?.replace('periode:', '') || '';

  // Use unified hooks
  const { project } = useProject(rawProjectIdClean || null);
  const { bordereau } = useBordereaux(rawProjectIdClean || null);
  const { periodes } = usePeriodes(rawProjectIdClean || null);
  // 🔴 FIX: جلب كل الميتريات للمشروع (بدون فلترة بالفترة) ثم نفلتر يدوياً
  const { metres: allProjectMetres } = useMetres(rawProjectIdClean || null);

  // Find the current période from the list
  const periode = useMemo(() => {
    if (!periodes || !periodeId) return null;
    return periodes.find((p: any) => 
      p.id === periodeId || 
      p.id === rawPeriodeIdClean ||
      p.id === `periode:${rawPeriodeIdClean}`
    ) || null;
  }, [periodes, periodeId, rawPeriodeIdClean]);

  // Helper to normalize periodeId (remove prefix if present)
  const normalizePeriodeId = (id: string): string => {
    if (!id) return '';
    return id.replace(/^periode:/, '');
  };

  // 🔴 FIX: فلترة الميتريات لتشمل كل الفترات من 1 إلى الفترة الحالية
  const metres = useMemo(() => {
    if (!allProjectMetres || !periode || !periodes) return [];
    
    const currentNumero = periode.numero || 1;
    
    // إنشاء قائمة بأرقام الفترات من 1 إلى الفترة الحالية
    const validPeriodeIds = periodes
      .filter((p: any) => (p.numero || 1) <= currentNumero)
      .map((p: any) => normalizePeriodeId(p.id));
    
    return allProjectMetres.filter((m: any) => {
      const metrePeriodeId = normalizePeriodeId(m.periodeId);
      return validPeriodeIds.includes(metrePeriodeId);
    });
  }, [allProjectMetres, periode, periodes]);

  // Helper to normalize bordereauLigneId (remove prefix if present)
  const normalizeBordereauLigneId = (id: string): string => {
    if (!id) return '';
    return id.replace(/^bordereau:/, '');
  };

  // Préparer les données pour l'attachement (cumul des quantités)
  const getAttachementData = () => {
    if (!bordereau?.lignes || !metres) return [];

    return bordereau.lignes.map((ligne, index) => {
      // Trouver le métré correspondant à cette ligne du bordereau
      // Support both with and without prefix
      const cleanBordereauId = normalizeBordereauLigneId(bordereau.id);
      const ligneId = `${cleanBordereauId}-ligne-${ligne.numero}`;
      
      // 🔴 FIX: جمع كل الميتريات لهذا السطر من كل الفترات (cumul)
      const metresForLigne = metres.filter((m: any) => {
        const metreLineId = normalizeBordereauLigneId(m.bordereauLigneId);
        return metreLineId === ligneId;
      });

      // 🔒 FIX: جمع القياسات الخام من lignes ثم تقريب مرة واحدة فقط
      // بدلاً من جمع totalPartiel المقرّبة مسبقاً (يسبب خطأ ±0.01)
      const rawSum = metresForLigne.reduce((sum: number, m: any) => {
        // استخدام lignes الخام إذا متوفرة
        if (m.lignes && Array.isArray(m.lignes) && m.lignes.length > 0) {
          return sum + m.lignes.reduce((s: number, l: any) => s + (Number(l.partiel) || 0), 0);
        }
        // fallback: استخدام totalPartiel
        return sum + (Number(m.totalPartiel) || 0);
      }, 0);
      const quantiteCumulee = roundQuantity(rawSum);
      
      return {
        numero: index + 1,
        designation: ligne.designation,
        unite: ligne.unite || '',
        quantiteCumulee,
      };
    }).filter(item => item.quantiteCumulee > 0); // Afficher seulement les lignes avec des quantités
  };

  const attachementData = getAttachementData();

  const exportToPDF = async () => {
    if (!project || !bordereau) return;
    
    setIsExporting(true);
    
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      
      // ============ EN-TÊTE ============
      // Texte "Royaume du Maroc" en haut
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Royaume du Maroc', pageWidth / 2, 12, { align: 'center' });
      
      // Logo du Maroc - charger l'image (sous le titre)
      let logoEndY = 45; // Position Y après le logo par défaut
      try {
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          logoImg.onload = () => resolve();
          logoImg.onerror = () => reject();
          logoImg.src = '/maroc-logo.png'; // Mettre le logo dans public/maroc-logo.png
        });
        // Ajouter le logo centré (largeur: 30mm, hauteur proportionnelle)
        const logoWidth = 30;
        const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
        doc.addImage(logoImg, 'PNG', (pageWidth - logoWidth) / 2, 16, logoWidth, logoHeight);
        logoEndY = 16 + logoHeight + 4;
      } catch {
        // Si l'image ne charge pas, dessiner un placeholder
        doc.setFillColor(200, 200, 200);
        doc.circle(pageWidth / 2, 28, 12, 'F');
        logoEndY = 45;
      }
      
      // Ministère
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const ministereLines = [
        "Ministère de l'Agriculture, de la Pêche Maritime,",
        "du Développement Rural et des Eaux et Forêt",
        "Direction Provinciale de l'Agriculture de Tata",
        "Service des Aménagement hydro-agricole"
      ];
      
      let yPos = logoEndY;
      ministereLines.forEach(line => {
        doc.text(line, pageWidth / 2, yPos, { align: 'center' });
        yPos += 4;
      });
      
      // Type de marché
      yPos += 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      const typeMarcheLabel = project.typeMarche === 'negocie' ? 'MARCHE NEGOCIE' : 'MARCHE';
      doc.text(`${typeMarcheLabel} N°${project.marcheNo}`, pageWidth / 2, yPos, { align: 'center' });
      
      // Objet du marché (en majuscules, gras)
      yPos += 8;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      
      // Découper l'objet en plusieurs lignes si nécessaire
      const objetLines = doc.splitTextToSize(project.objet.toUpperCase(), pageWidth - 2 * margin);
      objetLines.forEach((line: string) => {
        doc.text(line, pageWidth / 2, yPos, { align: 'center' });
        yPos += 4;
      });
      
      // Titre ATTACHEMENT PROVISOIRE
      yPos += 6;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      if (periode) {
        const attachementSuffix = periode.isDecompteDernier ? ' et dernier' : '';
        doc.text(`ATTACHEMENT PROVISOIRE  N°${periode.numero.toString().padStart(2, '0')}${attachementSuffix}`, pageWidth / 2, yPos, { align: 'center' });
      } else {
        // Sans période, juste "ATTACHEMENT"
        doc.text('ATTACHEMENT DES TRAVAUX', pageWidth / 2, yPos, { align: 'center' });
      }
      
      // Ligne de séparation
      yPos += 4;
      doc.setLineWidth(0.5);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      
      // ============ TABLEAU ============
      yPos += 6;
      
      const tableData = attachementData.map(item => [
        item.numero.toString(),
        item.designation,
        item.unite,
        Number(item.quantiteCumulee).toFixed(2)
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [['N°', 'Désignation des ouvrages', 'U', 'Quantité']],
        body: tableData,
        theme: 'grid',
        styles: {
          fontSize: 9,
          cellPadding: 3,
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          halign: 'center',
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
        },
        columnStyles: {
          0: { cellWidth: 15, halign: 'center' },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 30, halign: 'right' },
        },
        didDrawPage: () => {
          // Numéro de page
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const pageNumber = doc.getCurrentPageInfo().pageNumber;
          doc.text(`Page ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        },
      });
      
      // ============ SIGNATURES ============
      const finalY = (doc as any).lastAutoTable.finalY + 15;
      
      // Tableau de signatures
      autoTable(doc, {
        startY: finalY,
        head: [['Etabli par', 'Accepté par', 'Vérifié par']],
        body: [['', '', '']],
        theme: 'grid',
        styles: {
          fontSize: 9,
          cellPadding: 15,
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          minCellHeight: 25,
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          halign: 'center',
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
        },
        columnStyles: {
          0: { halign: 'center' },
          1: { halign: 'center' },
          2: { halign: 'center' },
        },
      });
      
      // Sauvegarder
      const fileName = periode 
        ? `Attachement_${project.marcheNo}_P${periode.numero}.pdf`
        : `Attachement_${project.marcheNo}.pdf`;
      doc.save(fileName);
      
    } catch (error) {
      console.error('Erreur export PDF:', error);
      alert('Erreur lors de l\'export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  // Loading state - periode غير مطلوب إذا كان المسار بدون periodeId
  if (!project || !bordereau || (periodeId && !periode)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => {
            if (periodeId) {
              navigate(`/projects/${rawProjectIdClean}/metre/${rawPeriodeIdClean}`);
            } else {
              navigate(`/projects/${rawProjectIdClean}`);
            }
          }}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          {periodeId ? 'Retour au métré' : 'Retour au projet'}
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              {periode 
                ? `Attachement Provisoire N° ${periode.numero.toString().padStart(2, '0')}${periode.isDecompteDernier ? ' et dernier' : ''}`
                : 'Attachement des Travaux'
              }
            </h1>
            <p className="text-gray-600">Marché N° {project.marcheNo} - {project.annee}</p>
            <p className="text-sm text-gray-500 mt-1">{project.objet}</p>
          </div>

          <button
            onClick={exportToPDF}
            disabled={isExporting || attachementData.length === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Export en cours...' : 'Exporter PDF'}
          </button>
        </div>
      </div>

      {/* Aperçu du document */}
      <div className="card bg-white">
        {/* En-tête du document */}
        <div className="text-center border-b pb-6 mb-6">
          {/* Titre Royaume du Maroc en haut */}
          <h2 className="text-lg font-bold mb-3">Royaume du Maroc</h2>
          {/* Logo du Maroc */}
          <img 
            src="/maroc-logo.png" 
            alt="Emblème du Royaume du Maroc" 
            className="h-24 mx-auto mb-3"
            onError={(e) => {
              // Si l'image ne charge pas, la cacher
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <p className="text-sm text-gray-600">Ministère de l'Agriculture, de la Pêche Maritime,</p>
          <p className="text-sm text-gray-600">du Développement Rural et des Eaux et Forêt</p>
          <p className="text-sm text-gray-600 mb-4">Direction Provinciale de l'Agriculture de Tata</p>
          
          <p className="font-bold text-sm mb-2">
            {project.typeMarche === 'negocie' ? 'MARCHE NEGOCIE' : 'MARCHE'} N°{project.marcheNo}
          </p>
          
          <p className="text-sm font-semibold text-gray-800 mb-4 px-8">
            {project.objet.toUpperCase()}
          </p>
          
          <h3 className="text-lg font-bold border-t border-b py-2 inline-block px-8">
            {periode 
              ? `ATTACHEMENT PROVISOIRE N°${periode.numero.toString().padStart(2, '0')}${periode.isDecompteDernier ? ' et dernier' : ''}`
              : 'ATTACHEMENT DES TRAVAUX'
            }
          </h3>
        </div>

        {/* Tableau des quantités */}
        {attachementData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-400">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-400 px-4 py-3 text-center font-semibold w-16">N°</th>
                  <th className="border border-gray-400 px-4 py-3 text-left font-semibold">Désignation des ouvrages</th>
                  <th className="border border-gray-400 px-4 py-3 text-center font-semibold w-20">U</th>
                  <th className="border border-gray-400 px-4 py-3 text-right font-semibold w-32">Quantité</th>
                </tr>
              </thead>
              <tbody>
                {attachementData.map((item) => (
                  <tr key={item.numero} className="hover:bg-gray-50">
                    <td className="border border-gray-400 px-4 py-2 text-center">{item.numero}</td>
                    <td className="border border-gray-400 px-4 py-2">{item.designation}</td>
                    <td className="border border-gray-400 px-4 py-2 text-center">{item.unite}</td>
                    <td className="border border-gray-400 px-4 py-2 text-right font-medium">
                      {Number(item.quantiteCumulee).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune quantité saisie</h3>
            <p className="text-gray-600">
              Saisissez d'abord les quantités dans le métré pour générer l'attachement
            </p>
          </div>
        )}

        {/* Zone de signatures */}
        {attachementData.length > 0 && (
          <div className="mt-8 pt-6 border-t">
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-gray-400 p-4 text-center">
                <p className="font-semibold mb-8">Etabli par</p>
                <div className="h-16"></div>
              </div>
              <div className="border border-gray-400 p-4 text-center">
                <p className="font-semibold mb-8">Accepté par</p>
                <div className="h-16"></div>
              </div>
              <div className="border border-gray-400 p-4 text-center">
                <p className="font-semibold mb-8">Vérifié par</p>
                <div className="h-16"></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttachementPage;
