import { FC, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, Metre, MetreSection, MetreSubSection } from '../db/database';
import { useProject, useBordereaux, usePeriodes, useMetres, useDecompts } from '../hooks/useUnifiedData';
import { isWeb } from '../utils/platform';
import { apiService } from '../services/apiService';
import { useAuthStore } from '../store/authStore';
import DateInput from '../components/ui/DateInput';
import {
  ArrowLeft,
  Save,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Download,
  Calculator,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  DollarSign,
  FileText,
  Eye,
  EyeOff,
  RefreshCw,
  Printer,
  Layers,
  MapPin,
  Building2,
  Edit3,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { logSyncOperation } from '../services/syncService';
import { calculatePartiel, getCalculationType, type UniteType } from '../utils/metreCalculations';
import { pullLatestData } from '../hooks/useSyncManager';
import { useDirtyStateStore } from '../store/dirtyStateStore';
import { generateMetrePDF } from '../utils/metrePdfExport';

// ============================================================
// 🔒 FINANCE ENGINE - للحسابات المالية (Décompte)
// ============================================================
import {
  calculateMontantHTInternal,
  calculateTotalHTWithInternal,
  calculateTVAWithInternal,
  calculateTTCWithInternal,
  toDecimal,
  round2,
  trunc2,
  toNumber,
  Decimal,
} from '../utils/financeEngine';

// 🔒 تقريب الكميات لرقمين - ROUND_HALF_UP via Decimal.js
// هذا الرقم المقرّب سيُستخدم في الديكونت
// ⚠️ Math.round(x*100)/100 يُسبب أخطاء (مثل 2.675 → 2.67 بدل 2.68)
const roundQuantity = (value: number): number => {
  return toNumber(round2(toDecimal(value)));
};

// ============== INTERFACES ==============

interface MetreLigneInput {
  id: string;
  sectionId?: string;
  subSectionId?: string;
  numero: number;
  designation: string;
  nombreSemblables?: number;
  nombreElements?: number;    // عدد الهياكل المتكررة (للحديد: عدد الأعمدة، الكمرات...)
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  partiel: number;
  observations?: string;
  isFromPreviousPeriode?: boolean;  // 🔴 لتحديد إذا كان من فترة سابقة
}

interface MetreQuickV3 {
  bordereauLigneId: string;
  numeroLigne: number;
  designation: string;
  unite: string;
  quantiteBordereau: number;
  prixUnitaire: number;
  // Hierarchical structure
  sections: MetreSection[];
  subSections: MetreSubSection[];
  lignes: MetreLigneInput[];
  isExpanded: boolean;
  cumulPrecedent: number;
}

// ============== SECTION COLORS ==============
const SECTION_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800', header: 'bg-blue-500' },
  { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800', header: 'bg-green-500' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800', header: 'bg-purple-500' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', header: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-800', header: 'bg-pink-500' },
  { bg: 'bg-cyan-100', border: 'border-cyan-400', text: 'text-cyan-800', header: 'bg-cyan-500' },
];

const SUBSECTION_COLORS = [
  { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700' },
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700' },
  { bg: 'bg-lime-50', border: 'border-lime-300', text: 'text-lime-700' },
  { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-700' },
  { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-700' },
];

// ============== PERIOD COLORS (for visual distinction) ==============
const PERIODE_COLORS = [
  { bg: 'bg-slate-50', border: 'border-l-slate-400', text: 'text-slate-600', badge: 'bg-slate-200 text-slate-700', dot: 'bg-slate-400' },
  { bg: 'bg-sky-50', border: 'border-l-sky-400', text: 'text-sky-700', badge: 'bg-sky-100 text-sky-700', dot: 'bg-sky-400' },
  { bg: 'bg-violet-50', border: 'border-l-violet-400', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-400' },
  { bg: 'bg-emerald-50', border: 'border-l-emerald-400', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
  { bg: 'bg-amber-50', border: 'border-l-amber-400', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  { bg: 'bg-rose-50', border: 'border-l-rose-400', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-700', dot: 'bg-rose-400' },
];
// Current period always uses this distinct style
const CURRENT_PERIODE_COLOR = { bg: 'bg-white', border: 'border-l-orange-400', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700 ring-1 ring-orange-300', dot: 'bg-orange-400' };

const getPeriodeColor = (periodeNumero: number, currentPeriodeNumero: number) => {
  if (periodeNumero === currentPeriodeNumero) return CURRENT_PERIODE_COLOR;
  return PERIODE_COLORS[(periodeNumero - 1) % PERIODE_COLORS.length];
};

// ============== MAIN COMPONENT ==============

const MetrePage: FC = () => {
  const { projectId: rawProjectId, periodeId: rawPeriodeId } = useParams<{ projectId: string; periodeId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  // Dirty State - لحماية التغييرات غير المحفوظة
  const { setDirty, clearDirty } = useDirtyStateStore();
  const pageId = `metre-${rawProjectId}-${rawPeriodeId}`;

  // State
  const [metresQuick, setMetresQuick] = useState<MetreQuickV3[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showOnlyWithData, setShowOnlyWithData] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSubSectionId, setEditingSubSectionId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // 🔴 حالات جديدة لتاريخ الميتري والنهائي
  const [metreDate, setMetreDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isDecompteDernier, setIsDecompteDernier] = useState(false);
  
  // 🔴 useRef للتحقق الفوري من dirty state (لا يتأخر مثل useState)
  const hasUnsavedChangesRef = useRef(false);

  // Normalize IDs
  const projectId = rawProjectId?.includes(':') ? rawProjectId : `project:${rawProjectId}`;
  const periodeId = rawPeriodeId ? (rawPeriodeId.includes(':') ? rawPeriodeId : `periode:${rawPeriodeId}`) : null;

  // تنظيف dirty state عند مغادرة الصفحة
  useEffect(() => {
    return () => {
      clearDirty(pageId);
    };
  }, [pageId, clearDirty]);

  // تحذير عند محاولة مغادرة الصفحة مع تغييرات غير محفوظة
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // دالة لتحديث الـ dirty state
  const markAsChanged = useCallback(() => {
    // تحديث الـ ref فوراً (لا ينتظر render)
    hasUnsavedChangesRef.current = true;
    
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      setDirty(pageId, `Métré ${rawPeriodeId}`);
    }
  }, [hasUnsavedChanges, pageId, rawPeriodeId, setDirty]);

  // تنظيف dirty state بعد الحفظ
  const markAsSaved = useCallback(() => {
    hasUnsavedChangesRef.current = false;
    setHasUnsavedChanges(false);
    clearDirty(pageId);
  }, [pageId, clearDirty]);

  // ============== DATA QUERIES ==============

  // استخدام unified hooks للبيانات
  const { project, refresh: refreshProject } = useProject(projectId);
  const { bordereau, refresh: refreshBordereau } = useBordereaux(projectId);
  const { periodes: allPeriodes, refresh: refreshPeriodes } = usePeriodes(projectId);
  const { metres: allProjectMetres, refresh: refreshMetres } = useMetres(projectId);
  const { decompts: allDecompts, refresh: refreshDecompts } = useDecompts(projectId);

  // الحصول على الـ periode الحالية من قائمة الفترات
  const currentPeriode = useMemo(() => {
    if (!periodeId || !allPeriodes) return undefined;
    const rawPeriodeIdClean = periodeId.replace('periode:', '');
    return allPeriodes.find(p => p.id === periodeId || p.id === rawPeriodeIdClean);
  }, [periodeId, allPeriodes]);

  // 🔴 الحصول على الـ Décompte الموجود لهذه الفترة
  const existingDecompte = useMemo(() => {
    if (!periodeId || !allDecompts) return undefined;
    return allDecompts.find(d => {
      const dPeriodeId = d.periodeId?.includes(':') ? d.periodeId : `periode:${d.periodeId}`;
      return dPeriodeId === periodeId && !d.deletedAt;
    });
  }, [periodeId, allDecompts]);

  // تحميل التاريخ وخيار النهائي من الـ période
  useEffect(() => {
    if (currentPeriode) {
      // تحميل تاريخ الميتري
      const dateToUse = currentPeriode.dateFin || currentPeriode.dateDebut || new Date().toISOString();
      setMetreDate(dateToUse.split('T')[0]);
      // تحميل خيار النهائي
      setIsDecompteDernier(currentPeriode.isDecompteDernier || false);
    }
  }, [currentPeriode]);

  // allPeriodes و allProjectMetres يأتيان من unified hooks أعلاه

  // ============== HELPER FUNCTIONS ==============

  const normalizeBordereauLigneId = (id: string): string => {
    if (!id) return '';
    return id.replace(/^bordereau:/, '');
  };

  // 🔴 Helper لتطبيع periodeId (إزالة البادئة periode:)
  const normalizePeriodeId = (id: string | null | undefined): string => {
    if (!id) return '';
    return id.replace(/^periode:/, '');
  };

  const getSectionColor = (index: number) => SECTION_COLORS[index % SECTION_COLORS.length];
  const getSubSectionColor = (index: number) => SUBSECTION_COLORS[index % SUBSECTION_COLORS.length];

  // ============== COMPUTED VALUES ==============

  // تحديد رقم الفترة الحالية والفترات السابقة
  const currentPeriodeNumero = useMemo(() => {
    if (!currentPeriode) return 0;
    return currentPeriode.numero;
  }, [currentPeriode]);

  // جمع كل القياسات من الفترات السابقة فقط (نظام تراكمي)
  // 🔴 تم التعديل: يجلب من الفترات السابقة فقط (< currentPeriodeNumero) وليس الحالية
  const cumulativeMetresData = useMemo(() => {
    if (!allProjectMetres || !allPeriodes || !periodeId) {
      return new Map<string, { sections: any[]; subSections: any[]; lignes: any[]; total: number }>();
    }

    const result = new Map<string, { sections: any[]; subSections: any[]; lignes: any[]; total: number }>();

    // ترتيب الفترات حسب الرقم
    const sortedPeriodes = [...allPeriodes].sort((a, b) => a.numero - b.numero);

    for (const metre of allProjectMetres) {
      // 🔴 التحقق من أن الميتري ينتمي لفترة سابقة فقط (وليس الحالية)
      const normalizedMetrePeriodeId = normalizePeriodeId(metre.periodeId);
      const metrePeriode = sortedPeriodes.find(p => 
        p.id === metre.periodeId || 
        p.id === normalizedMetrePeriodeId || 
        normalizePeriodeId(p.id) === normalizedMetrePeriodeId
      );
      if (!metrePeriode || metrePeriode.numero >= currentPeriodeNumero) continue;

      const key = normalizeBordereauLigneId(metre.bordereauLigneId);
      
      if (!result.has(key)) {
        result.set(key, { sections: [], subSections: [], lignes: [], total: 0 });
      }
      
      const data = result.get(key)!;
      
      // إضافة الأقسام مع تمييزها بالفترة
      if (metre.sections) {
        for (const section of metre.sections) {
          // إضافة معلومات الفترة للقسم
          const sectionWithPeriode = {
            ...section,
            periodeId: metre.periodeId,
            periodeNumero: metrePeriode.numero,
            isFromPreviousPeriode: normalizePeriodeId(metre.periodeId) !== normalizePeriodeId(periodeId),
          };
          data.sections.push(sectionWithPeriode);
        }
      }
      
      // إضافة الأقسام الفرعية
      if (metre.subSections) {
        for (const subSection of metre.subSections) {
          const subSectionWithPeriode = {
            ...subSection,
            periodeId: metre.periodeId,
            periodeNumero: metrePeriode.numero,
            isFromPreviousPeriode: normalizePeriodeId(metre.periodeId) !== normalizePeriodeId(periodeId),
          };
          data.subSections.push(subSectionWithPeriode);
        }
      }
      
      // إضافة الأسطر (القياسات)
      if (metre.lignes) {
        for (const ligne of metre.lignes) {
          const ligneWithPeriode = {
            ...ligne,
            periodeId: metre.periodeId,
            periodeNumero: metrePeriode.numero,
            isFromPreviousPeriode: normalizePeriodeId(metre.periodeId) !== normalizePeriodeId(periodeId),
          };
          data.lignes.push(ligneWithPeriode);
        }
      }
      
      // 🔴 FIX: تأكد من أن totalPartiel رقم وليس string
      const metreTotal = Number((metre as any).totalPartiel) || 0;
      data.total += metreTotal;
    }

    return result;
  }, [allProjectMetres, allPeriodes, periodeId, currentPeriodeNumero]);

  // ============== INITIALIZATION ==============
  
  // متغير لتتبع ما إذا تم تحميل البيانات الأولية
  const dataInitializedRef = useRef(false);

  useEffect(() => {
    // 🔴 لا نعيد تحميل البيانات إذا كانت هناك تغييرات غير محفوظة
    // استخدام ref للتحقق الفوري (لا ينتظر re-render)
    if (hasUnsavedChangesRef.current || hasUnsavedChanges) {
      console.log('⚠️ Skipping data reload - unsaved changes present (ref:', hasUnsavedChangesRef.current, ', state:', hasUnsavedChanges, ')');
      return;
    }

    if (bordereau && allProjectMetres !== undefined && currentPeriode) {
      const quickData: MetreQuickV3[] = bordereau.lignes.map((ligne) => {
        const cleanBordereauId = normalizeBordereauLigneId(bordereau.id);
        const ligneId = `${cleanBordereauId}-ligne-${ligne.numero}`;
        
        // جلب البيانات التراكمية من الفترات السابقة
        const cumulData = cumulativeMetresData.get(ligneId);
        
        // جلب بيانات الفترة الحالية (إن وجدت)
        const currentMetreData = allProjectMetres?.find(
          m => normalizeBordereauLigneId(m.bordereauLigneId) === ligneId && 
               normalizePeriodeId(m.periodeId) === normalizePeriodeId(periodeId)
        );
        
        console.log('🔄 Loading data for ligne:', ligneId, {
          foundCurrentMetre: !!currentMetreData,
          currentMetreId: currentMetreData?.id,
          currentMetreSections: currentMetreData?.sections?.length || 0,
          currentMetreSubSections: currentMetreData?.subSections?.length || 0,
          currentMetreLignes: currentMetreData?.lignes?.length || 0,
          // 🔴 طباعة البيانات الخام للتشخيص
          rawSections: currentMetreData?.sections,
          rawSubSections: currentMetreData?.subSections,
          cumulData: cumulData ? { sections: cumulData.sections?.length, lignes: cumulData.lignes?.length } : null
        });

        // دمج البيانات: السابقة + الحالية
        const allSections = [
          ...(cumulData?.sections || []),
          ...(currentMetreData?.sections || []).map((s: any) => ({
            ...s,
            periodeId: periodeId,
            periodeNumero: currentPeriode.numero,
            isFromPreviousPeriode: false,
          })),
        ];
        
        const allSubSections = [
          ...(cumulData?.subSections || []),
          ...(currentMetreData?.subSections || []).map((ss: any) => ({
            ...ss,
            periodeId: periodeId,
            periodeNumero: currentPeriode.numero,
            isFromPreviousPeriode: false,
          })),
        ];
        
        const allLignes = [
          ...(cumulData?.lignes || []),
          ...(currentMetreData?.lignes || []).map((l: any) => ({
            ...l,
            periodeId: periodeId,
            periodeNumero: currentPeriode.numero,
            isFromPreviousPeriode: false,
          })),
        ];

        return {
          bordereauLigneId: ligneId,
          numeroLigne: ligne.numero,
          designation: ligne.designation,
          unite: ligne.unite,
          quantiteBordereau: ligne.quantite,
          prixUnitaire: ligne.prixUnitaire || 0,
          sections: allSections,
          subSections: allSubSections,
          lignes: allLignes,
          isExpanded: false,
          cumulPrecedent: cumulData?.total || 0,
        };
      });

      setMetresQuick(quickData);
      
      if (!dataInitializedRef.current) {
        dataInitializedRef.current = true;
      }
    }
  }, [bordereau, allProjectMetres, cumulativeMetresData, currentPeriode, hasUnsavedChanges, periodeId]);

  // ============== SECTION HANDLERS ==============

  const handleAddSection = (bordereauLigneId: string) => {
    const item = metresQuick.find((m) => m.bordereauLigneId === bordereauLigneId);
    if (!item) return;
    
    // تحديد أن هناك تغييرات
    markAsChanged();

    const newSection: MetreSection = {
      id: `section-${uuidv4()}`,
      titre: '', // سيظهر placeholder في الحقل
      ordre: item.sections.length + 1,
      isCollapsed: false,
      isFromPreviousPeriode: false, // 🔴 تأكيد أن هذا من الفترة الحالية
    };

    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? { ...m, sections: [...m.sections, newSection], isExpanded: true }
          : m
      )
    );
    setEditingSectionId(newSection.id);
  };

  const handleUpdateSection = (bordereauLigneId: string, sectionId: string, titre: string) => {
    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              sections: m.sections.map((s) =>
                s.id === sectionId ? { ...s, titre } : s
              ),
            }
          : m
      )
    );
  };

  const handleDeleteSection = (bordereauLigneId: string, sectionId: string) => {
    if (!confirm('Supprimer cette section et toutes ses sous-sections et mesures ?')) return;

    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              sections: m.sections.filter((s) => s.id !== sectionId),
              subSections: m.subSections.filter((ss) => ss.sectionId !== sectionId),
              lignes: m.lignes.filter((l) => l.sectionId !== sectionId),
            }
          : m
      )
    );
  };

  const handleToggleSection = (bordereauLigneId: string, sectionId: string) => {
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              sections: m.sections.map((s) =>
                s.id === sectionId ? { ...s, isCollapsed: !s.isCollapsed } : s
              ),
            }
          : m
      )
    );
  };

  // ============== SUBSECTION HANDLERS ==============

  const handleAddSubSection = (bordereauLigneId: string, sectionId: string) => {
    const item = metresQuick.find((m) => m.bordereauLigneId === bordereauLigneId);
    if (!item) return;
    
    markAsChanged();

    const sectionSubSections = item.subSections.filter((ss) => ss.sectionId === sectionId);
    const isAcier = item.unite === 'KG' || item.unite === 'T';
    
    const newSubSectionId = `subsection-${uuidv4()}`;
    
    const newSubSection: MetreSubSection = {
      id: newSubSectionId,
      sectionId,
      titre: '', // سيظهر placeholder في الحقل
      ordre: sectionSubSections.length + 1,
      isCollapsed: false,
      nombreElements: 1,
      isFromPreviousPeriode: false, // 🔴 تأكيد أن هذا من الفترة الحالية
    };

    // إضافة صفين تلقائياً للحديد مع الوصف الافتراضي
    const defaultLignes: MetreLigneInput[] = isAcier ? [
      {
        id: `${bordereauLigneId}-mesure-${Date.now()}-1`,
        sectionId,
        subSectionId: newSubSectionId,
        numero: 1,
        designation: 'filantes Longi  f 10 mm   esp 0,20',
        partiel: 0,
        isFromPreviousPeriode: false, // 🔴 تأكيد أن هذا من الفترة الحالية
      },
      {
        id: `${bordereauLigneId}-mesure-${Date.now()}-2`,
        sectionId,
        subSectionId: newSubSectionId,
        numero: 2,
        designation: 'Cadres filantes  f 8 mm   esp 0,20',
        partiel: 0,
        isFromPreviousPeriode: false, // 🔴 تأكيد أن هذا من الفترة الحالية
      },
    ] : [];

    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? { 
              ...m, 
              subSections: [...m.subSections, newSubSection],
              lignes: [...m.lignes, ...defaultLignes]
            }
          : m
      )
    );
    setEditingSubSectionId(newSubSection.id);
  };

  const handleUpdateSubSection = (bordereauLigneId: string, subSectionId: string, titre: string) => {
    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              subSections: m.subSections.map((ss) =>
                ss.id === subSectionId ? { ...ss, titre } : ss
              ),
            }
          : m
      )
    );
  };

  const handleUpdateSubSectionNombreElements = (bordereauLigneId: string, subSectionId: string, nombreElements: number) => {
    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              subSections: m.subSections.map((ss) =>
                ss.id === subSectionId ? { ...ss, nombreElements: nombreElements || 1 } : ss
              ),
            }
          : m
      )
    );
  };

  const handleDeleteSubSection = (bordereauLigneId: string, subSectionId: string) => {
    if (!confirm('Supprimer cette sous-section et toutes ses mesures ?')) return;

    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              subSections: m.subSections.filter((ss) => ss.id !== subSectionId),
              lignes: m.lignes.filter((l) => l.subSectionId !== subSectionId),
            }
          : m
      )
    );
  };

  const handleToggleSubSection = (bordereauLigneId: string, subSectionId: string) => {
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              subSections: m.subSections.map((ss) =>
                ss.id === subSectionId ? { ...ss, isCollapsed: !ss.isCollapsed } : ss
              ),
            }
          : m
      )
    );
  };

  // ============== LIGNE HANDLERS ==============

  const handleAddLigne = (bordereauLigneId: string, sectionId?: string, subSectionId?: string) => {
    const item = metresQuick.find((m) => m.bordereauLigneId === bordereauLigneId);
    if (!item) return;

    markAsChanged();

    // Filter lignes by context
    let contextLignes = item.lignes;
    if (subSectionId) {
      contextLignes = item.lignes.filter((l) => l.subSectionId === subSectionId);
    } else if (sectionId) {
      contextLignes = item.lignes.filter((l) => l.sectionId === sectionId && !l.subSectionId);
    }

    const newLigneNumero = contextLignes.length + 1;

    const newLigne: MetreLigneInput = {
      id: `${bordereauLigneId}-mesure-${Date.now()}`,
      sectionId,
      subSectionId,
      numero: newLigneNumero,
      designation: '', // سيظهر placeholder في الحقل
      partiel: 0,
      isFromPreviousPeriode: false, // 🔴 تأكيد أن هذا من الفترة الحالية
    };

    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? { ...m, lignes: [...m.lignes, newLigne], isExpanded: true }
          : m
      )
    );
  };

  const handleDeleteLigne = (bordereauLigneId: string, ligneId: string) => {
    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((m) =>
        m.bordereauLigneId === bordereauLigneId
          ? {
              ...m,
              lignes: m.lignes.filter((l) => l.id !== ligneId),
            }
          : m
      )
    );
  };

  const handleLigneChange = (
    bordereauLigneId: string,
    ligneId: string,
    field: keyof MetreLigneInput,
    value: string | number
  ) => {
    markAsChanged();
    setMetresQuick((prev) =>
      prev.map((item) => {
        if (item.bordereauLigneId !== bordereauLigneId) return item;

        const updatedLignes = item.lignes.map((ligne) => {
          if (ligne.id !== ligneId) return ligne;

          const updated = { ...ligne, [field]: value };

          // 🆕 إذا تم تغيير partiel مباشرة، لا نعيد الحساب
          if (field === 'partiel') {
            // إدخال مباشر - نحتفظ بالقيمة كما هي
            return updated;
          }

          if (['nombreSemblables', 'nombreElements', 'longueur', 'largeur', 'profondeur', 'nombre', 'diametre'].includes(field)) {
            const basePartiel = calculatePartiel(
              item.unite as UniteType,
              updated.longueur,
              updated.largeur,
              updated.profondeur,
              updated.nombre,
              updated.diametre,
              updated.nombreSemblables
            );
            // Pour KG/T: multiplier par nombreElements (nombre de poteaux, poutres, etc.)
            const nombreElements = updated.nombreElements || 1;
            updated.partiel = basePartiel * nombreElements;
          }

          return updated;
        });

        return { ...item, lignes: updatedLignes };
      })
    );
  };

  const handleToggleExpand = (bordereauLigneId: string) => {
    setMetresQuick((prev) =>
      prev.map((item) =>
        item.bordereauLigneId === bordereauLigneId
          ? { ...item, isExpanded: !item.isExpanded }
          : item
      )
    );
  };

  // ============================================================
  // 🔴 DÉCOMPTE AUTO-SAVE: دالة حساب وحفظ الديكونت تلقائياً
  // ============================================================
  const saveDecompteAfterMetre = async (now: string) => {
    if (!user || !projectId || !bordereau || !periodeId || !currentPeriode) {
      console.log('⏭️ [DECOMPTE] Skipping - missing required data');
      return;
    }

    console.log('🔴 [DECOMPTE AUTO-SAVE] Starting décompte calculation...');

    try {
      const rawProjectId = projectId.replace('project:', '');
      const rawPeriodeId = periodeId.replace('periode:', '');
      const cleanBordereauId = normalizeBordereauLigneId(bordereau.id);

      // ============================================================
      // 1. حساب الكميات التراكمية لكل سطر بوردرو (حتى الفترة الحالية)
      // ============================================================
      const sortedPeriodes = [...(allPeriodes || [])]
        .filter(p => !p.deletedAt)
        .sort((a, b) => (a.numero || 0) - (b.numero || 0));

      const currentPeriodeIndex = sortedPeriodes.findIndex(p => {
        const pId = p.id?.includes(':') ? p.id : `periode:${p.id}`;
        return pId === periodeId;
      });

      if (currentPeriodeIndex === -1) {
        console.log('⚠️ [DECOMPTE] Current periode not found in sorted list');
        return;
      }

      // الفترات حتى الحالية (شاملة)
      const relevantPeriodeIds = sortedPeriodes
        .slice(0, currentPeriodeIndex + 1)
        .map(p => p.id?.includes(':') ? p.id : `periode:${p.id}`);

      // حساب الكميات التراكمية
      const cumulativeQuantities = new Map<string, number>();
      
      // استخدام الميتري المحفوظ للتو (من metresQuick) + الميتري السابق
      const allMetres = allProjectMetres || [];
      
      // أولاً: الميتري من الفترات السابقة
      allMetres.filter(m => !m.deletedAt).forEach(m => {
        const mPeriodeId = m.periodeId?.includes(':') ? m.periodeId : `periode:${m.periodeId}`;
        
        // فقط الفترات السابقة (ليس الحالية)
        if (mPeriodeId === periodeId) return;
        if (!relevantPeriodeIds.includes(mPeriodeId)) return;
        
        const key = m.bordereauLigneId;
        let metreTotal = 0;
        if (m.lignes && m.lignes.length > 0) {
          metreTotal = m.lignes.reduce((sum: number, l: any) => sum + (Number(l.partiel) || 0), 0);
        } else {
          metreTotal = Number((m as any).totalPartiel) || 0;
        }
        
        const currentSum = cumulativeQuantities.get(key) || 0;
        cumulativeQuantities.set(key, currentSum + metreTotal);
      });

      // ثانياً: إضافة الميتري من الفترة الحالية (من metresQuick)
      metresQuick.forEach(mq => {
        const key = mq.bordereauLigneId;
        const currentPeriodeLignes = mq.lignes.filter((l: any) => l.isFromPreviousPeriode !== true);
        const totalCurrentPeriode = currentPeriodeLignes.reduce((sum: number, l: any) => sum + (Number(l.partiel) || 0), 0);
        
        const previousSum = cumulativeQuantities.get(key) || 0;
        cumulativeQuantities.set(key, roundQuantity(previousSum + totalCurrentPeriode));
      });

      console.log('📊 [DECOMPTE] Cumulative quantities:', Object.fromEntries(cumulativeQuantities));

      // ============================================================
      // 2. إنشاء سطور الديكونت مع الحسابات المالية
      // ============================================================
      interface DecompteLigne {
        prixNo: number;
        designation: string;
        unite: string;
        quantiteBordereau: number;
        quantiteRealisee: number;
        prixUnitaireHT: number;
        montantHT: number;
        bordereauLigneId: string;
      }

      const decompteLines: DecompteLigne[] = bordereau.lignes.map((ligne: any) => {
        const ligneId = `${cleanBordereauId}-ligne-${ligne.numero}`;
        const quantiteRealisee = cumulativeQuantities.get(ligneId) || 0;
        const prixUnitaireHT = ligne.prixUnitaire || 0;
        const montantHTInternal = calculateMontantHTInternal(quantiteRealisee, prixUnitaireHT);
        
        return {
          prixNo: ligne.numero,
          designation: ligne.designation,
          unite: ligne.unite,
          quantiteBordereau: ligne.quantite,
          quantiteRealisee,
          prixUnitaireHT,
          montantHT: toNumber(round2(montantHTInternal)),
          bordereauLigneId: ligneId,
        };
      });

      // ============================================================
      // 3. حساب المجاميع المالية (Excel Compliance)
      // ============================================================
      const calculatedLignes = decompteLines.map(l => ({
        ...l,
        montantHTInternal: calculateMontantHTInternal(l.quantiteRealisee, l.prixUnitaireHT),
      }));

      const totalHTResult = calculateTotalHTWithInternal(calculatedLignes);
      const totalHTInternal = totalHTResult.internal;
      
      const tauxTVA = currentPeriode.tauxTVA ?? 20;
      const tvaResult = calculateTVAWithInternal(totalHTInternal, tauxTVA);
      const montantTVA = tvaResult.display;
      
      // 🔒 EXCEL: TTC = HT_Internal + TVA_Display
      const ttcResult = calculateTTCWithInternal(totalHTInternal, toDecimal(montantTVA));
      const totalTTC = ttcResult.display;
      const ttcInternal = ttcResult.internal;

      // ============================================================
      // 4. حساب Montant de l'acompte (مع Excel floating point)
      // ============================================================
      
      // جلب مصاريف الفترات السابقة
      const previousDecompts = (allDecompts || [])
        .filter(d => !d.deletedAt && d.numero < currentPeriode.numero);
      
      let depensesExercicesAnterieursDecimal = new Decimal(0);
      let decomptesPrecedentsDecimal = new Decimal(0);
      const anneePeriodeActuelle = new Date(currentPeriode.dateDebut).getFullYear();
      
      for (const decompt of previousDecompts) {
        const periodeDecompt = allPeriodes?.find(p => {
          const pId = p.id?.includes(':') ? p.id : `periode:${p.id}`;
          const dPId = decompt.periodeId?.includes(':') ? decompt.periodeId : `periode:${decompt.periodeId}`;
          return pId === dPId;
        });
        if (!periodeDecompt) continue;
        
        const anneeDecompt = new Date(periodeDecompt.dateDebut).getFullYear();
        const montantAPrendre = toDecimal((decompt as any).montantTotal || 0);
        
        if (anneeDecompt < anneePeriodeActuelle) {
          depensesExercicesAnterieursDecimal = depensesExercicesAnterieursDecimal.plus(montantAPrendre);
        } else if (anneeDecompt === anneePeriodeActuelle) {
          decomptesPrecedentsDecimal = decomptesPrecedentsDecimal.plus(montantAPrendre);
        }
      }
      const depensesExercicesAnterieurs = toNumber(depensesExercicesAnterieursDecimal);
      const decomptesPrecedents = toNumber(decomptesPrecedentsDecimal);

      // حساب Retenue de Garantie: MIN(TRUNC(TTC×10%;2); TRUNC(Marché×7%;2))
      let montantMarcheTTC = new Decimal(0);
      for (const ligne of bordereau.lignes) {
        const qte = toDecimal(ligne.quantite);
        const pu = toDecimal(ligne.prixUnitaire);
        const montantHT = qte.times(pu);
        const montantTTC = montantHT.times(1.2);
        montantMarcheTTC = montantMarcheTTC.plus(montantTTC);
      }
      
      const retenue10Pourcent = trunc2(ttcInternal.times(0.10));
      const retenue7Pourcent = trunc2(montantMarcheTTC.times(0.07));
      const retenueGarantie = Decimal.min(retenue10Pourcent, retenue7Pourcent);
      
      // الحسابات النهائية
      const restes = ttcInternal.minus(retenueGarantie);
      const resteAPayer = restes.minus(toDecimal(depensesExercicesAnterieurs));
      
      // 🔒 EXCEL: تقريب نهائي عبر Decimal.js
      const montantAcompteExact = resteAPayer.minus(toDecimal(decomptesPrecedents));
      const montantAcompte = toNumber(round2(montantAcompteExact));

      console.log('💰 [DECOMPTE] Financial calculations:', {
        totalTTC,
        retenueGarantie: toNumber(retenueGarantie),
        depensesExercicesAnterieurs,
        decomptesPrecedents,
        montantAcompte
      });

      // ============================================================
      // 5. حفظ الديكونت
      // ============================================================
      const decompteData = {
        projectId: rawProjectId,
        periodeId: rawPeriodeId,
        userId: user.id.replace('user:', ''),
        numero: currentPeriode.numero,
        lignes: decompteLines,
        montantTotal: montantAcompte,
        totalTTC: totalTTC,
        totalGeneralTTC: totalTTC, // TTC تراكمي = نفس totalTTC لأنه محسوب تراكمياً
        statut: 'draft' as const,
      };

      if (isWeb()) {
        // 🔒 FIX: Fresh query to find existing décompte (avoid stale hook state)
        let freshDecompte = existingDecompte;
        if (!freshDecompte) {
          try {
            const searchRes = await apiService.getDecompts(rawProjectId);
            const allDecs = searchRes?.data || searchRes || [];
            freshDecompte = allDecs.find((d: any) => {
              const dPId = (d.periodeId || d.periode_id || '').replace('periode:', '');
              return dPId === rawPeriodeId && !d.deletedAt && !d.deleted_at;
            });
            if (freshDecompte) {
              console.log('🔒 [WEB] Found existing décompte via fresh query:', freshDecompte.id);
            }
          } catch (e) {
            console.warn('⚠️ [WEB] Could not fetch fresh décomptes, using hook state');
          }
        }

        if (freshDecompte) {
          const rawDecomptId = freshDecompte.id.replace('decompt:', '');
          await apiService.updateDecompt(rawDecomptId, decompteData);
          console.log('✅ [WEB] Décompte updated:', rawDecomptId);
        } else {
          try {
            await apiService.createDecompt(decompteData);
            console.log('✅ [WEB] Décompte created');
          } catch (createError: any) {
            // 🔒 If 409 (duplicate), find and update instead
            if (createError?.response?.status === 409) {
              console.warn('⚠️ [WEB] Décompte already exists (409), fetching and updating...');
              const retryRes = await apiService.getDecompts(rawProjectId);
              const allDecs = retryRes?.data || retryRes || [];
              const dup = allDecs.find((d: any) => {
                const dPId = (d.periodeId || d.periode_id || '').replace('periode:', '');
                return dPId === rawPeriodeId && !d.deletedAt && !d.deleted_at;
              });
              if (dup) {
                await apiService.updateDecompt(dup.id.replace('decompt:', ''), decompteData);
                console.log('✅ [WEB] Décompte updated after 409 recovery:', dup.id);
              }
            } else {
              throw createError;
            }
          }
        }
      } else {
        // Electron mode — 🔒 FIX: Fresh query from IndexedDB
        let freshDecompte = existingDecompte;
        if (!freshDecompte) {
          const allLocalDecompts = await db.decompts
            .where('projectId').equals(projectId)
            .filter((d: any) => !d.deletedAt)
            .toArray();
          freshDecompte = allLocalDecompts.find((d: any) => {
            const dPId = d.periodeId?.includes(':') ? d.periodeId : `periode:${d.periodeId}`;
            return dPId === periodeId;
          });
          if (freshDecompte) {
            console.log('🔒 [ELECTRON] Found existing décompte via fresh query:', freshDecompte.id);
          }
        }

        if (freshDecompte) {
          await db.decompts.update(freshDecompte.id, {
            lignes: decompteLines,
            montantTotal: montantAcompte,
            totalTTC: totalTTC,
            statut: 'draft',
            updatedAt: now,
          });
          await logSyncOperation(
            'UPDATE',
            'decompt',
            freshDecompte.id.replace('decompt:', ''),
            { montantTotal: montantAcompte, totalTTC, lignesCount: decompteLines.length },
            user.id
          );
          console.log('✅ [ELECTRON] Décompte updated');
        } else {
          const decomptId = `decompt:${uuidv4()}`;
          const newDecompte = {
            id: decomptId,
            projectId: projectId,
            periodeId: periodeId,
            userId: user.id,
            numero: currentPeriode.numero,
            lignes: decompteLines,
            montantTotal: montantAcompte,
            totalTTC: totalTTC,
            statut: 'draft' as const,
            createdAt: now,
            updatedAt: now,
          };
          await db.decompts.add(newDecompte);
          await logSyncOperation('CREATE', 'decompt', decomptId.replace('decompt:', ''), newDecompte, user.id);
          console.log('✅ [ELECTRON] Décompte created');
        }
      }

      console.log('🎉 [DECOMPTE AUTO-SAVE] Completed successfully!');
    } catch (error) {
      console.error('❌ [DECOMPTE AUTO-SAVE] Error:', error);
      // لا نلغي الحفظ الرئيسي، فقط نسجل الخطأ
    }
  };

  // ============================================================
  // 📄 EXPORT METRE PDF - تصدير تفاصيل الميتري
  // ============================================================
  const handleExportMetre = async () => {
    if (!project || !currentPeriode || !bordereau) {
      alert('Données manquantes pour générer le PDF');
      return;
    }

    try {
      console.log('📄 [EXPORT METRE] Starting PDF generation...');
      
      // تحويل metresQuick إلى الشكل المطلوب للتصدير
      const metresDataForExport = metresQuick.map(mq => ({
        bordereauLigneId: mq.bordereauLigneId,
        numeroLigne: mq.numeroLigne,
        designation: mq.designation,
        unite: mq.unite,
        quantiteBordereau: mq.quantiteBordereau,
        prixUnitaire: mq.prixUnitaire,
        sections: mq.sections,
        subSections: mq.subSections,
        lignes: mq.lignes,
        cumulPrecedent: mq.cumulPrecedent,
      }));

      await generateMetrePDF(
        project,
        currentPeriode,
        bordereau,
        metresDataForExport,
        metreDate
      );

      console.log('✅ [EXPORT METRE] PDF generated successfully!');
    } catch (error) {
      console.error('❌ [EXPORT METRE] Error:', error);
      alert('Erreur lors de la génération du PDF');
    }
  };

  // ============== SAVE FUNCTION ==============

  const handleSaveAll = async () => {
    if (!user || !projectId || !bordereau || !periodeId) {
      alert('⚠️ Erreur: Période non définie. Veuillez revenir à la liste des métrés.');
      return;
    }

    setIsSaving(true);

    try {
      const now = new Date().toISOString();

      console.log('🔴 Starting save... metresQuick count:', metresQuick.length);
      console.log('🔴 periodeId:', periodeId);
      console.log('🔴 projectId:', projectId);
      console.log('🔴 allProjectMetres:', allProjectMetres?.length, allProjectMetres?.map(m => ({id: m.id, bordereauLigneId: m.bordereauLigneId, periodeId: m.periodeId})));

      for (const metreQuick of metresQuick) {
        // 🔴 تم تعديل الفلترة: نحفظ كل البيانات التي ليست من فترة سابقة
        // إذا كانت isFromPreviousPeriode غير معرفة أو false، نحفظها
        const currentPeriodeSections = metreQuick.sections.filter(
          (s: any) => s.isFromPreviousPeriode !== true
        );
        const currentPeriodeSubSections = metreQuick.subSections.filter(
          (ss: any) => ss.isFromPreviousPeriode !== true
        );
        const currentPeriodeLignes = metreQuick.lignes.filter(
          (l: any) => l.isFromPreviousPeriode !== true
        );

        console.log('🔵 Article:', metreQuick.bordereauLigneId);
        console.log('  - All sections:', metreQuick.sections.length, 'Current:', currentPeriodeSections.length);
        console.log('  - All subSections:', metreQuick.subSections.length, 'Current:', currentPeriodeSubSections.length);
        console.log('  - All lignes:', metreQuick.lignes.length, 'Current:', currentPeriodeLignes.length);
        console.log('  - Lignes data:', metreQuick.lignes.map(l => ({ id: l.id, partiel: l.partiel, isFromPrev: l.isFromPreviousPeriode })));

        // حساب المجموع الجزئي للفترة الحالية فقط
        // ⚠️ تقريب المجموع لرقمين - هذا الرقم سيُستخدم في الديكونت
        const totalPartielCurrentPeriode = roundQuantity(
          currentPeriodeLignes.reduce((sum: number, ligne: any) => sum + (Number(ligne.partiel) || 0), 0)
        );
        
        // 🔴 FIX: حساب المجموع التراكمي الصحيح = الفترات السابقة + الفترة الحالية
        // cumulPrecedent يحتوي على مجموع كل الفترات السابقة
        // تأكد من أن كلا القيمتين أرقام
        const cumulPrecedent = Number(metreQuick.cumulPrecedent) || 0;
        // ⚠️ تقريب الكميلي أيضاً
        const totalCumule = roundQuantity(cumulPrecedent + totalPartielCurrentPeriode);
        
        console.log('  💰 Totals:', {
          cumulPrecedent,
          totalPartielCurrentPeriode,
          totalCumule
        });
        
        // 🔴 FIX: Limit pourcentage to avoid database overflow (DECIMAL(5,2) max is 999.99)
        const rawPourcentage = metreQuick.quantiteBordereau > 0
          ? (totalCumule / metreQuick.quantiteBordereau) * 100
          : 0;
        const pourcentage = Math.min(Math.max(rawPourcentage, -999.99), 999.99);

        // البحث عن الميتري الموجود لهذه الفترة
        const existingMetre = allProjectMetres?.find(
          (m) => m.bordereauLigneId === metreQuick.bordereauLigneId && 
                 normalizePeriodeId(m.periodeId) === normalizePeriodeId(periodeId)
        );
        
        console.log('  🔍 Looking for existing metre:', {
          searchBordereauLigneId: metreQuick.bordereauLigneId,
          searchPeriodeId: periodeId,
          found: !!existingMetre,
          existingMetreId: existingMetre?.id,
          allMetresCount: allProjectMetres?.length,
          allMetresBordereauIds: allProjectMetres?.map(m => m.bordereauLigneId)
        });

        // تنظيف البيانات قبل الحفظ (إزالة الحقول المؤقتة)
        const cleanSections = currentPeriodeSections.map((s: any) => {
          const { periodeId: _, periodeNumero: __, isFromPreviousPeriode: ___, ...clean } = s;
          return clean;
        });
        const cleanSubSections = currentPeriodeSubSections.map((ss: any) => {
          const { periodeId: _, periodeNumero: __, isFromPreviousPeriode: ___, ...clean } = ss;
          return clean;
        });
        const cleanLignes = currentPeriodeLignes.map((l: any) => {
          const { periodeId: _, periodeNumero: __, isFromPreviousPeriode: ___, ...clean } = l;
          return clean;
        });

        // تخطي إذا لم يكن هناك أي بيانات للفترة الحالية
        if (cleanLignes.length === 0 && cleanSections.length === 0 && cleanSubSections.length === 0) {
          console.log('  ⏭️ Skipping - no data for current period');
          continue;
        }

        console.log('  ✅ Saving:', cleanLignes.length, 'lignes,', cleanSections.length, 'sections,', cleanSubSections.length, 'subSections');
        console.log('  📦 Clean Sections to save:', JSON.stringify(cleanSections));
        console.log('  📦 Clean SubSections to save:', JSON.stringify(cleanSubSections));
        console.log('  📦 Clean Lignes to save:', JSON.stringify(cleanLignes));

        // 🌐 Web: استخدام API مباشرة
        if (isWeb()) {
          const metreData = {
            projectId: projectId.replace('project:', ''),
            periodeId: periodeId.replace('periode:', ''),
            bordereauLigneId: metreQuick.bordereauLigneId,
            userId: user.id.replace('user:', ''),
            reference: `METRE-L${metreQuick.numeroLigne}`,
            designationBordereau: metreQuick.designation,
            unite: metreQuick.unite,
            sections: cleanSections,
            subSections: cleanSubSections,
            lignes: cleanLignes,
            totalPartiel: totalPartielCurrentPeriode,
            totalCumule,
            quantiteBordereau: metreQuick.quantiteBordereau,
            pourcentageRealisation: pourcentage,
          };

          if (existingMetre) {
            console.log('  📝 [WEB] Updating existing metre:', existingMetre.id);
            await apiService.updateMetre(existingMetre.id.replace('metre:', ''), metreData);
            console.log('  ✅ [WEB] Metre updated successfully!');
          } else {
            console.log('  🆕 [WEB] Creating new metre');
            await apiService.createMetre(metreData);
            console.log('  ✅ [WEB] Metre created successfully!');
          }
        } else {
          // 🖥️ Electron: استخدام IndexedDB + sync
          if (existingMetre) {
            console.log('  📝 Updating existing metre:', existingMetre.id, {
              sections: cleanSections,
              subSections: cleanSubSections,
              lignes: cleanLignes
            });
            
            await db.metres.update(existingMetre.id, {
              sections: cleanSections,
              subSections: cleanSubSections,
              lignes: cleanLignes,
              totalPartiel: totalPartielCurrentPeriode,
              totalCumule,
              pourcentageRealisation: pourcentage,
              updatedAt: now,
            });
            console.log('  ✅ Metre updated successfully!');
            
            // 🔴 التحقق من التحديث
            const updatedMetre = await db.metres.get(existingMetre.id);
            console.log('  🔍 Verification - Updated metre:', updatedMetre ? {
              id: updatedMetre.id,
              sectionsCount: updatedMetre.sections?.length,
              subSectionsCount: updatedMetre.subSections?.length,
              lignesCount: updatedMetre.lignes?.length,
              sections: updatedMetre.sections,
              lignes: updatedMetre.lignes,
            } : 'NOT FOUND!');

            await logSyncOperation(
              'UPDATE',
              'metre',
              existingMetre.id.replace('metre:', ''),
              {
                sections: cleanSections,
                subSections: cleanSubSections,
                lignes: cleanLignes,
                totalPartiel: totalPartielCurrentPeriode,
                totalCumule,
                pourcentageRealisation: pourcentage,
              },
              user.id
            );
          } else {
            const metreId = `metre:${uuidv4()}`;

            console.log('  🆕 Creating new metre:', metreId, {
              bordereauLigneId: metreQuick.bordereauLigneId,
              sections: cleanSections,
              subSections: cleanSubSections,
              lignes: cleanLignes
            });

            const newMetre: Metre = {
              id: metreId,
              projectId: projectId,
              periodeId: periodeId,
              bordereauLigneId: metreQuick.bordereauLigneId,
              userId: user.id,
              reference: `METRE-L${metreQuick.numeroLigne}`,
              designationBordereau: metreQuick.designation,
              unite: metreQuick.unite,
              sections: cleanSections,
              subSections: cleanSubSections,
              lignes: cleanLignes,
              totalPartiel: totalPartielCurrentPeriode,
              totalCumule,
              quantiteBordereau: metreQuick.quantiteBordereau,
              pourcentageRealisation: pourcentage,
              createdAt: now,
              updatedAt: now,
            };

            await db.metres.add(newMetre);
            console.log('  ✅ Metre created successfully!');
            
            // 🔴 التحقق من الحفظ
            const savedMetre = await db.metres.get(metreId);
            console.log('  🔍 Verification - Saved metre:', savedMetre ? {
              id: savedMetre.id,
              sectionsCount: savedMetre.sections?.length,
              subSectionsCount: savedMetre.subSections?.length,
              lignesCount: savedMetre.lignes?.length,
            } : 'NOT FOUND!');
            
            await logSyncOperation('CREATE', 'metre', metreId.replace('metre:', ''), newMetre, user.id);
          }
        }
      }

      // 🔴 حفظ تاريخ الميتري وخيار النهائي في الـ période
      const periodeUpdateData = {
        dateFin: metreDate + 'T23:59:59.999Z',
        isDecompteDernier: isDecompteDernier,
        updatedAt: now,
      };

      if (isWeb()) {
        await apiService.updatePeriode(periodeId.replace('periode:', ''), periodeUpdateData);
      } else {
        await db.periodes.update(periodeId, periodeUpdateData);
        await logSyncOperation(
          'UPDATE',
          'periode',
          periodeId.replace('periode:', ''),
          { dateFin: metreDate, isDecompteDernier },
          user.id
        );
      }

      // ============================================================
      // 🔴 DÉCOMPTE AUTO-SAVE: حفظ الديكونت تلقائياً بعد حفظ الميتري
      // ============================================================
      await saveDecompteAfterMetre(now);

      // تنظيف dirty state بعد الحفظ الناجح
      markAsSaved();
      
      // Refresh data after save
      await refreshMetres();
      await refreshPeriodes();
      await refreshDecompts();
      
      alert('✅ Métrés et Décompte enregistrés avec succès !');
    } catch (error: any) {
      console.error('Erreur lors de la sauvegarde:', error);
      // 🔒 Afficher le message d'erreur du serveur si disponible (ex: duplicate numero)
      const errorMessage = error?.response?.data?.message || error?.message || 'Erreur lors de la sauvegarde des métrés';
      alert(`❌ ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (isWeb()) {
        // Web: استخدام refresh من unified hooks
        await Promise.all([
          refreshProject(),
          refreshBordereau(),
          refreshPeriodes(),
          refreshMetres(),
        ]);
      } else {
        // Electron: استخدام pullLatestData
        const rawProjectId = projectId.replace('project:', '');
        await pullLatestData(rawProjectId);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExportAttachement = () => {
    const rawProjectId = projectId.replace('project:', '');
    const rawPeriode = periodeId?.replace('periode:', '') || '';
    navigate(`/projects/${rawProjectId}/periodes/${rawPeriode}/attachement`);
  };

  // ============== CALCULATIONS ==============

  const getTotalRealise = () => {
    return metresQuick.reduce((sum, item) => {
      const totalPartiel = item.lignes.reduce((s, ligne) => s + ligne.partiel, 0);
      return sum + totalPartiel;
    }, 0);
  };

  const getTotalBordereau = () => {
    return metresQuick.reduce((sum, m) => sum + m.quantiteBordereau, 0);
  };

  const getPourcentageGlobal = () => {
    const total = getTotalBordereau();
    return total > 0 ? (getTotalRealise() / total) * 100 : 0;
  };

  const getMontantRealise = () => {
    return metresQuick.reduce((sum, item) => {
      const totalPartiel = item.lignes.reduce((s, ligne) => s + ligne.partiel, 0);
      return sum + (totalPartiel * item.prixUnitaire);
    }, 0);
  };

  const getMontantBordereau = () => {
    return metresQuick.reduce((sum, m) => sum + (m.quantiteBordereau * m.prixUnitaire), 0);
  };

  // 🔧 Total TTC du marché (bordereau × 1.2)
  const getMontantBordereauTTC = () => {
    const ht = getMontantBordereau();
    return ht * 1.2;
  };

  // 🔧 Total Général TTC réalisé — حساب تراكمي مباشر من البيانات الحالية
  // cumulPrecedent (كميات الفترات السابقة) + partiel الفترة الحالية = الكمية التراكمية الكلية
  // ثم نضربها في سعر الوحدة ونضيف TVA 20%
  const getTotalGeneralTTC = () => {
    if (!metresQuick || metresQuick.length === 0) return 0;
    
    let totalHTCumule = 0;
    
    for (const item of metresQuick) {
      // كمية الفترة الحالية
      const totalPartielCurrentPeriode = item.lignes
        .filter((l: any) => l.isFromPreviousPeriode !== true)
        .reduce((s: number, l: any) => s + (Number(l.partiel) || 0), 0);
      
      // الكمية التراكمية = الفترات السابقة + الفترة الحالية
      const cumulPrecedent = Number(item.cumulPrecedent) || 0;
      const quantiteCumulative = cumulPrecedent + totalPartielCurrentPeriode;
      
      // المبلغ HT التراكمي لهذا السطر
      const montantHT = quantiteCumulative * item.prixUnitaire;
      totalHTCumule += montantHT;
    }
    
    // TTC = HT × 1.2 (TVA 20%)
    const totalTTC = totalHTCumule * 1.2;
    
    return totalTTC;
  };

  // 🔧 Montant restant (TTC marché - TTC réalisé)
  const getMontantRestant = () => {
    return getMontantBordereauTTC() - getTotalGeneralTTC();
  };

  const getPourcentageFinancier = () => {
    const total = getMontantBordereau();
    return total > 0 ? (getMontantRealise() / total) * 100 : 0;
  };

  // Calculate section total
  const getSectionTotal = (item: MetreQuickV3, sectionId: string) => {
    return item.lignes
      .filter((l) => l.sectionId === sectionId)
      .reduce((sum, l) => sum + l.partiel, 0);
  };

  // Calculate subsection total (with nombreElements multiplier)
  const getSubSectionTotal = (item: MetreQuickV3, subSectionId: string) => {
    const subSection = item.subSections.find((ss) => ss.id === subSectionId);
    const nombreElements = subSection?.nombreElements || 1;
    const lignesTotal = item.lignes
      .filter((l) => l.subSectionId === subSectionId)
      .reduce((sum, l) => sum + l.partiel, 0);
    return lignesTotal * nombreElements;
  };

  const displayItems = showOnlyWithData
    ? metresQuick.filter((m) => m.lignes.length > 0 || m.sections.length > 0)
    : metresQuick;

  // ============== LOADING STATES ==============

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement du projet...</p>
        </div>
      </div>
    );
  }

  if (!bordereau) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Retour au projet
          </button>
        </div>

        <div className="card">
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun bordereau</h3>
            <p className="text-gray-600 mb-4">
              Vous devez d'abord créer un bordereau avant de faire des métrés
            </p>
            <button
              onClick={() => navigate(`/projects/${projectId}/bordereau`)}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Créer le bordereau
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============== RENDER TABLE FOR A CONTEXT ==============

  const renderMeasurementTable = (
    item: MetreQuickV3,
    sectionId?: string,
    subSectionId?: string,
    colorClass?: string
  ) => {
    const calculationType = getCalculationType(item.unite as UniteType);
    const champs = calculationType?.champs || [];

    // Filter lignes based on context
    let contextLignes = item.lignes;
    if (subSectionId) {
      contextLignes = item.lignes.filter((l) => l.subSectionId === subSectionId);
    } else if (sectionId) {
      contextLignes = item.lignes.filter((l) => l.sectionId === sectionId && !l.subSectionId);
    } else {
      // Root level - lignes without section
      contextLignes = item.lignes.filter((l) => !l.sectionId);
    }

    if (contextLignes.length === 0) {
      return (
        <div className="text-center py-4 text-gray-500 text-sm">
          <p>Aucune mesure. Cliquez sur "+ Ajouter mesure" pour commencer.</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className={`w-full border ${colorClass || 'border-gray-300'}`}>
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 border-r border-gray-300 w-14" title="Période">Pér.</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-r border-gray-300 w-12">N°</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-r border-gray-300">Désignation</th>
              {['M³', 'M²', 'ML', 'M'].includes(item.unite) && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-16" title="Nombre des parties semblables">Nbre</th>
              )}
              {champs.includes('longueur') && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-24">Longueur (m)</th>
              )}
              {champs.includes('largeur') && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-24">Largeur (m)</th>
              )}
              {champs.includes('profondeur') && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-24">Profondeur (m)</th>
              )}
              {champs.includes('nombre') && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-20">Nombre</th>
              )}
              {champs.includes('diametre') && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-24">Diamètre (mm)</th>
              )}
              {['KG', 'T'].includes(item.unite) && (
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-r border-gray-300 w-20 bg-yellow-50" title="Nombre d'éléments (poteaux, poutres...)">N.Élém</th>
              )}
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 border-r border-gray-300 w-28 bg-blue-50">Partiel</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 w-16">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {contextLignes.map((ligne, idx) => {
              const lignePeriodeNum = (ligne as any).periodeNumero || currentPeriodeNumero;
              const isFromPrev = ligne.isFromPreviousPeriode === true;
              const periodeColor = getPeriodeColor(lignePeriodeNum, currentPeriodeNumero);
              return (
              <tr key={ligne.id} className={`${isFromPrev ? periodeColor.bg + ' opacity-80' : 'hover:bg-gray-50'} border-l-4 ${periodeColor.border}`}>
                <td className="px-1 py-2 text-center border-r border-gray-200">
                  <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full ${periodeColor.badge}`}>
                    {isFromPrev ? `P${lignePeriodeNum}` : 'Act'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 font-medium border-r border-gray-200">{idx + 1}</td>
                <td className="px-3 py-2 border-r border-gray-200">
                  {isFromPrev ? (
                    <span className="text-sm text-gray-600">{ligne.designation || <span className="italic text-gray-400">—</span>}</span>
                  ) : (
                    <input
                      type="text"
                      value={ligne.designation}
                      onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'designation', e.target.value)}
                      className="input text-sm w-full"
                      placeholder="Mesure / Description..."
                    />
                  )}
                </td>
                {['M³', 'M²', 'ML', 'M'].includes(item.unite) && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.nombreSemblables || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.nombreSemblables || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'nombreSemblables', parseInt(e.target.value) || 1)}
                        className="input text-sm text-center w-full"
                        step="1"
                        min="1"
                        placeholder="1"
                      />
                    )}
                  </td>
                )}
                {champs.includes('longueur') && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.longueur || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.longueur || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'longueur', parseFloat(e.target.value) || 0)}
                        className="input text-sm text-center w-full"
                        step="0.01"
                        placeholder="0.00"
                      />
                    )}
                  </td>
                )}
                {champs.includes('largeur') && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.largeur || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.largeur || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'largeur', parseFloat(e.target.value) || 0)}
                        className="input text-sm text-center w-full"
                        step="0.01"
                        placeholder="0.00"
                      />
                    )}
                  </td>
                )}
                {champs.includes('profondeur') && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.profondeur || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.profondeur || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'profondeur', parseFloat(e.target.value) || 0)}
                        className="input text-sm text-center w-full"
                        step="0.01"
                        placeholder="0.00"
                      />
                    )}
                  </td>
                )}
                {champs.includes('nombre') && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.nombre || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.nombre || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'nombre', parseInt(e.target.value) || 0)}
                        className="input text-sm text-center w-full"
                        step="1"
                        placeholder="0"
                      />
                    )}
                  </td>
                )}
                {champs.includes('diametre') && (
                  <td className="px-3 py-2 border-r border-gray-200">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.diametre || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.diametre || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'diametre', parseFloat(e.target.value) || 0)}
                        className="input text-sm text-center w-full"
                        step="0.1"
                        placeholder="0"
                      />
                    )}
                  </td>
                )}
                {['KG', 'T'].includes(item.unite) && (
                  <td className="px-3 py-2 border-r border-gray-200 bg-yellow-50">
                    {isFromPrev ? (
                      <span className="text-sm text-gray-500 block text-center">{ligne.nombreElements || ''}</span>
                    ) : (
                      <input
                        type="number"
                        value={ligne.nombreElements || ''}
                        onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'nombreElements', parseInt(e.target.value) || 1)}
                        className="input text-sm text-center w-full bg-yellow-50"
                        step="1"
                        min="1"
                        placeholder="1"
                        title="Nombre d'éléments (poteaux, poutres...)"
                      />
                    )}
                  </td>
                )}
                {/* 🆕 Partiel - قابل للتعديل المباشر */}
                <td className={`px-3 py-2 border-r border-gray-200 ${isFromPrev ? 'bg-gray-50' : 'bg-blue-50'}`}>
                  {isFromPrev ? (
                    <span className="text-sm text-right block font-bold text-gray-500">{ligne.partiel ? ligne.partiel.toFixed(3) : ''}</span>
                  ) : (
                    <input
                      type="number"
                      value={ligne.partiel || ''}
                      onChange={(e) => handleLigneChange(item.bordereauLigneId, ligne.id, 'partiel', parseFloat(e.target.value) || 0)}
                      className="input text-sm text-right w-full font-bold text-primary-600 bg-blue-50"
                      step="0.01"
                      placeholder="0.00"
                      title="Saisie directe du partiel ou calculé automatiquement"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {isFromPrev ? (
                    <span className="text-gray-300" title={`Période ${lignePeriodeNum} (verrouillé)`}>🔒</span>
                  ) : (
                    <button
                      onClick={() => handleDeleteLigne(item.bordereauLigneId, ligne.id)}
                      className="p-1 text-red-500 hover:bg-red-100 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-100">
            <tr>
              <td colSpan={3 + champs.length + (['M³', 'M²', 'ML', 'M'].includes(item.unite) ? 1 : 0) + (['KG', 'T'].includes(item.unite) ? 1 : 0)} className="px-3 py-2 text-right font-semibold text-gray-700 border-r border-gray-300">
                Total:
              </td>
              <td className="px-3 py-2 text-right font-bold text-primary-700 bg-primary-50 border-r border-gray-300">
                {contextLignes.reduce((sum, l) => sum + l.partiel, 0).toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // ============== MAIN RENDER ==============

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(`/projects/${rawProjectId}`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Retour au projet
        </button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">
                Métré N° {currentPeriode?.numero || ''}
              </h1>
              {isDecompteDernier && (
                <span className="px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold rounded-full">
                  et Dernier
                </span>
              )}
              <span className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded-full">
                {currentPeriode?.libelle || 'Hiérarchique'}
              </span>
            </div>
            <p className="text-gray-700 font-medium">{project.objet}</p>
            <p className="text-sm text-gray-500">Marché N° {project.marcheNo} - {project.annee}</p>
            
            {/* 🔴 تاريخ الميتري وخيار النهائي */}
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Date des travaux:</label>
                <DateInput
                  value={metreDate}
                  onChange={(val) => {
                    setMetreDate(val);
                    markAsChanged();
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDecompteDernier}
                  onChange={(e) => {
                    setIsDecompteDernier(e.target.checked);
                    markAsChanged();
                  }}
                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                />
                <span className="text-sm font-medium text-gray-700">Décompte et Dernier</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
            <button
              onClick={handleExportAttachement}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Attachement
            </button>
            <button
              onClick={() => navigate(`/projects/${rawProjectId}/periodes/${rawPeriodeId}/decompte`)}
              className="btn btn-secondary flex items-center gap-2"
            >
              <DollarSign className="w-4 h-4" />
              Décompte
            </button>
            <button 
              onClick={handleExportMetre}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Exporter
            </button>
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className={`btn flex items-center gap-2 ${
                hasUnsavedChanges 
                  ? 'btn-primary bg-orange-500 hover:bg-orange-600 animate-pulse' 
                  : 'btn-primary'
              }`}
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {hasUnsavedChanges ? '⚠️ Enregistrer' : 'Enregistrer'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{bordereau.lignes.length}</p>
              <p className="text-sm text-gray-600">Lignes bordereau</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 text-green-600 rounded-lg">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{getTotalRealise().toFixed(2)}</p>
              <p className="text-sm text-gray-600">Total réalisé</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 text-purple-600 rounded-lg">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${getPourcentageGlobal() > 100 ? 'text-orange-600' : 'text-gray-900'}`}>
                {getPourcentageGlobal().toFixed(1)}%
              </p>
              <p className="text-sm text-gray-600">Avancement quantité</p>
            </div>
          </div>
        </div>

        <div className={`card ${getPourcentageFinancier() > 100 ? 'border-2 border-orange-400 bg-orange-50' : ''}`}>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${getPourcentageFinancier() > 100 ? 'text-orange-600' : 'text-gray-900'}`}>
                {getPourcentageFinancier().toFixed(1)}%
              </p>
              <p className="text-sm text-gray-600">Avancement financier</p>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="card mb-6 bg-gradient-to-r from-primary-50 to-blue-50">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Marché (TTC)</p>
            <p className="text-xl font-bold text-gray-900">
              {getMontantBordereauTTC().toLocaleString('fr-MA', { minimumFractionDigits: 2 })} DH
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Total Général (TTC)</p>
            <p className="text-xl font-bold text-primary-600">
              {getTotalGeneralTTC().toLocaleString('fr-MA', { minimumFractionDigits: 2 })} DH
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Montant Restant</p>
            <p className={`text-xl font-bold ${getMontantRestant() < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {getMontantRestant().toLocaleString('fr-MA', { minimumFractionDigits: 2 })} DH
            </p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="card mb-4 bg-gradient-to-r from-gray-50 to-slate-50">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            <span className="font-medium">Section</span>
            <span className="text-gray-500">= Douar / Lieu</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-red-600" />
            <span className="font-medium">Sous-section</span>
            <span className="text-gray-500">= Élément (semeille, radier, voile...)</span>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-600" />
            <span className="font-medium">Mesure</span>
            <span className="text-gray-500">= Ligne de calcul</span>
          </div>
        </div>
      </div>

      {/* Period Legend - Légende des périodes */}
      {currentPeriodeNumero > 1 && (
        <div className="card mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold text-gray-700 mr-2">📊 Périodes :</span>
            {allPeriodes
              ?.filter(p => p.numero <= currentPeriodeNumero)
              .sort((a, b) => a.numero - b.numero)
              .map(p => {
                const color = getPeriodeColor(p.numero, currentPeriodeNumero);
                const isCurrent = p.numero === currentPeriodeNumero;
                return (
                  <div key={p.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${color.badge} ${isCurrent ? 'ring-2 ring-orange-300 font-bold' : ''}`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                    <span>{isCurrent ? `P${p.numero} (actuelle)` : `P${p.numero}`}</span>
                    {p.dateFin && <span className="text-[10px] opacity-70">({new Date(p.dateFin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })})</span>}
                  </div>
                );
              })
            }
            <span className="ml-2 text-gray-400">|</span>
            <span className="text-gray-500 flex items-center gap-1">🔒 = verrouillé (période précédente)</span>
          </div>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => setShowOnlyWithData(!showOnlyWithData)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
            showOnlyWithData
              ? 'bg-primary-100 text-primary-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {showOnlyWithData ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          {showOnlyWithData ? 'Afficher tout' : 'Uniquement les métrés'}
        </button>
        <span className="text-sm text-gray-500">
          {displayItems.length} / {metresQuick.length} lignes affichées
        </span>
      </div>

      {/* Main Accordion List */}
      <div className="card">
        <div className="space-y-3">
          {displayItems.map((item) => {
            const totalPartiel = item.lignes.reduce((sum, ligne) => sum + ligne.partiel, 0);
            const pourcentage = item.quantiteBordereau > 0
              ? (totalPartiel / item.quantiteBordereau) * 100
              : 0;
            const isComplete = pourcentage >= 100;
            const isStarted = totalPartiel > 0;

            return (
              <div
                key={item.bordereauLigneId}
                className={`border-2 rounded-xl overflow-hidden shadow-sm ${
                  isComplete
                    ? pourcentage > 100
                      ? 'border-orange-400 bg-orange-50/50'
                      : 'border-green-400 bg-green-50/50'
                    : 'border-gray-200'
                }`}
              >
                {/* Article Header */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition bg-white"
                  onClick={() => handleToggleExpand(item.bordereauLigneId)}
                >
                  {item.isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />
                  )}

                  <div className="w-12 h-12 flex items-center justify-center bg-primary-100 text-primary-700 font-bold rounded-lg text-lg">
                    {item.numeroLigne}
                  </div>

                  <div className="flex-1">
                    <p className="text-gray-900 font-semibold">{item.designation}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                        {item.unite}
                      </span>
                      {item.sections.length > 0 && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                          {item.sections.length} section(s)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm text-gray-600">
                      Bordereau: {Number(item.quantiteBordereau || 0).toLocaleString()}
                    </div>
                    <div className="text-lg font-bold text-primary-600">
                      Réalisé: {roundQuantity(totalPartiel || 0).toFixed(2)}
                    </div>
                  </div>

                  <div className="w-36">
                    <div className="flex items-center gap-2">
                      {isComplete ? (
                        pourcentage > 100 ? (
                          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        )
                      ) : isStarted ? (
                        <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      ) : (
                        <div className="w-5 h-5 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              pourcentage > 100
                                ? 'bg-gradient-to-r from-orange-400 to-red-500'
                                : isComplete
                                ? 'bg-gradient-to-r from-green-400 to-emerald-500'
                                : pourcentage >= 75
                                ? 'bg-gradient-to-r from-blue-400 to-cyan-500'
                                : 'bg-gradient-to-r from-yellow-400 to-orange-500'
                            }`}
                            style={{ width: `${Math.min(pourcentage, 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className={`text-sm font-bold w-16 text-right ${pourcentage > 100 ? 'text-orange-600' : 'text-gray-700'}`}>
                        {pourcentage.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {item.isExpanded && (
                  <div className="border-t-2 border-gray-200 bg-gray-50 p-4">
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-200">
                      <button
                        onClick={() => handleAddSection(item.bordereauLigneId)}
                        className="btn btn-secondary flex items-center gap-2 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200"
                      >
                        <MapPin className="w-4 h-4" />
                        + Ajouter Section (Douar)
                      </button>
                      <button
                        onClick={() => handleAddLigne(item.bordereauLigneId)}
                        className="btn btn-secondary flex items-center gap-2 text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        + Ajouter Mesure Directe
                      </button>
                    </div>

                    {/* Root Level Measurements (without section) */}
                    {item.lignes.filter((l) => !l.sectionId).length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-600 mb-2">Mesures Générales</h4>
                        {renderMeasurementTable(item)}
                        <button
                          onClick={() => handleAddLigne(item.bordereauLigneId)}
                          className="mt-2 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Ajouter mesure
                        </button>
                      </div>
                    )}

                    {/* Sections */}
                    {item.sections.map((section, sectionIndex) => {
                      const sectionColor = getSectionColor(sectionIndex);
                      const sectionSubSections = item.subSections.filter((ss) => ss.sectionId === section.id);
                      const sectionTotal = getSectionTotal(item, section.id);

                      return (
                        <div
                          key={section.id}
                          className={`mb-4 rounded-lg border-2 ${sectionColor.border} ${sectionColor.bg} overflow-hidden`}
                        >
                          {/* Section Header */}
                          <div
                            className={`flex items-center gap-3 px-4 py-3 ${sectionColor.header} text-white cursor-pointer`}
                            onClick={() => handleToggleSection(item.bordereauLigneId, section.id)}
                          >
                            {section.isCollapsed ? (
                              <ChevronRight className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                            <MapPin className="w-5 h-5" />
                            
                            {editingSectionId === section.id ? (
                              <input
                                type="text"
                                value={section.titre}
                                onChange={(e) => handleUpdateSection(item.bordereauLigneId, section.id, e.target.value)}
                                onBlur={() => setEditingSectionId(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingSectionId(null)}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 bg-white/20 text-white placeholder-white/70 px-2 py-1 rounded border-0 focus:ring-2 focus:ring-white/50"
                                placeholder="Douar / Lieu..."
                                autoFocus
                              />
                            ) : (
                              <span className="flex-1 font-bold text-lg">{section.titre || <span className="opacity-60 italic">Douar / Lieu...</span>}</span>
                            )}

                            <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-semibold">
                              Total: {sectionTotal.toFixed(2)}
                            </span>

                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setEditingSectionId(section.id)}
                                className="p-1 hover:bg-white/20 rounded"
                                title="Modifier"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteSection(item.bordereauLigneId, section.id)}
                                className="p-1 hover:bg-white/20 rounded"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Section Content */}
                          {!section.isCollapsed && (
                            <div className="p-4">
                              {/* Add SubSection Button */}
                              <div className="flex items-center gap-2 mb-4">
                                <button
                                  onClick={() => handleAddSubSection(item.bordereauLigneId, section.id)}
                                  className="btn btn-secondary flex items-center gap-2 text-sm bg-white"
                                >
                                  <Building2 className="w-4 h-4" />
                                  + Ajouter Élément (semeille, radier...)
                                </button>
                                <button
                                  onClick={() => handleAddLigne(item.bordereauLigneId, section.id)}
                                  className="btn btn-secondary flex items-center gap-2 text-sm bg-white"
                                >
                                  <Plus className="w-4 h-4" />
                                  + Mesure directe
                                </button>
                              </div>

                              {/* Section-level measurements (without subsection) */}
                              {item.lignes.filter((l) => l.sectionId === section.id && !l.subSectionId).length > 0 && (
                                <div className="mb-4 bg-white rounded-lg p-3">
                                  {renderMeasurementTable(item, section.id, undefined, sectionColor.border)}
                                </div>
                              )}

                              {/* SubSections */}
                              {sectionSubSections.map((subSection, subIndex) => {
                                const subColor = getSubSectionColor(subIndex);
                                const subSectionTotal = getSubSectionTotal(item, subSection.id);

                                return (
                                  <div
                                    key={subSection.id}
                                    className={`mb-3 rounded-lg border ${subColor.border} ${subColor.bg} overflow-hidden`}
                                  >
                                    {/* SubSection Header */}
                                    <div
                                      className={`flex items-center gap-3 px-3 py-2 bg-white border-b ${subColor.border} cursor-pointer`}
                                      onClick={() => handleToggleSubSection(item.bordereauLigneId, subSection.id)}
                                    >
                                      {subSection.isCollapsed ? (
                                        <ChevronRight className="w-4 h-4 text-gray-500" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-500" />
                                      )}
                                      <Building2 className={`w-4 h-4 ${subColor.text}`} />
                                      
                                      {editingSubSectionId === subSection.id ? (
                                        <input
                                          type="text"
                                          value={subSection.titre}
                                          onChange={(e) => handleUpdateSubSection(item.bordereauLigneId, subSection.id, e.target.value)}
                                          onBlur={() => setEditingSubSectionId(null)}
                                          onKeyDown={(e) => e.key === 'Enter' && setEditingSubSectionId(null)}
                                          onClick={(e) => e.stopPropagation()}
                                          className={`flex-1 px-2 py-1 rounded border ${subColor.border} focus:ring-2 focus:ring-primary-300`}
                                          placeholder="Élément (semeille, radier, poteau...)"
                                          autoFocus
                                        />
                                      ) : (
                                        <span className={`flex-1 font-semibold ${subColor.text}`}>{subSection.titre || <span className="opacity-60 italic">Élément...</span>}</span>
                                      )}

                                      {/* Nombre d'éléments (multiplicateur) */}
                                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-xs text-gray-500">×</span>
                                        <input
                                          type="number"
                                          value={subSection.nombreElements || 1}
                                          onChange={(e) => handleUpdateSubSectionNombreElements(item.bordereauLigneId, subSection.id, parseInt(e.target.value) || 1)}
                                          className="w-12 px-1 py-0.5 text-center text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-300"
                                          min="1"
                                          step="1"
                                          title="Nombre d'éléments (ex: nombre de poteaux)"
                                        />
                                      </div>

                                      <span className={`px-2 py-0.5 ${subColor.bg} ${subColor.text} rounded text-sm font-medium`}>
                                        {subSectionTotal.toFixed(2)}
                                      </span>

                                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                        <button
                                          onClick={() => setEditingSubSectionId(subSection.id)}
                                          className="p-1 hover:bg-gray-100 rounded"
                                          title="Modifier"
                                        >
                                          <Edit3 className="w-3 h-3 text-gray-500" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteSubSection(item.bordereauLigneId, subSection.id)}
                                          className="p-1 hover:bg-gray-100 rounded"
                                          title="Supprimer"
                                        >
                                          <Trash2 className="w-3 h-3 text-gray-500" />
                                        </button>
                                      </div>
                                    </div>

                                    {/* SubSection Content */}
                                    {!subSection.isCollapsed && (
                                      <div className="p-3">
                                        {renderMeasurementTable(item, section.id, subSection.id, subColor.border)}
                                        <button
                                          onClick={() => handleAddLigne(item.bordereauLigneId, section.id, subSection.id)}
                                          className="mt-2 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                                        >
                                          <Plus className="w-3 h-3" />
                                          Ajouter mesure
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Grand Total */}
                    <div className="mt-4 pt-4 border-t-2 border-gray-300 bg-gradient-to-r from-primary-50 to-blue-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-gray-700">TOTAL PARTIEL (Article {item.numeroLigne})</span>
                        <span className="text-2xl font-bold text-primary-700">
                          {totalPartiel.toFixed(2)} {item.unite}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MetrePage;
