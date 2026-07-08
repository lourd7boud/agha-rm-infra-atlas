/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 RevisionTab Component - Révision des Prix
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * تبويب مراجعة الأسعار في صفحة المشروع
 * 
 * 📌 الوظائف:
 *    - عرض معلومات الصيغة والتواريخ الأساسية
 *    - حساب المعاملات الشهرية (Coefficients)
 *    - حساب مراجعة كل ديكونت
 *    - تصدير PDF
 * 
 * 🔒 EXCEL COMPLIANCE:
 *    - Coefficient: TRUNC(x, 4)
 *    - Montant révision: TRUNC(x, 2)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Calculator,
  FileText,
  Download,
  Printer,
  AlertCircle,
  Calendar,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Settings
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';

import {
  calculateMonthCoefficient,
  getMonthsInPeriod,
  getDaysInMonthForPeriod,
  trunc,
  dateToMonthKey,
  IndexValues
} from '../../utils/priceRevisionEngine.v2';
import { getMultipleIndexValues } from '../../services/indexManagementService';
import { generateRevisionPDF } from '../../utils/revisionPdfExport';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface Decompt {
  id: string;
  numero: number;
  periodeId: string;
  montantHT?: number;
  statut: string;
  dateDebut?: string;
  dateFin?: string;
  createdAt: string;
}

interface Periode {
  id: string;
  numero: number;
  libelle: string;
  dateDebut: string;
  dateFin: string;
  statut: string;
}

interface Project {
  id: string;
  marcheNo: string;
  objet: string;
  societe?: string;
  dateOuverture?: string;
  osc?: string;
  delaisExecution?: number;
}

interface RevisionConfig {
  formula?: {
    id?: number;
    name?: string;
    fixedPart: number;
    weights: Record<string, number>;
  } | null;
  baseIndexes?: IndexValues;
  baseDate?: string;
  isEnabled?: boolean;
}

interface Props {
  project: Project;
  decompts: Decompt[];
  periodes: Periode[];
  revisionConfig?: RevisionConfig | null;
}

interface MonthCoefficient {
  month: string;
  monthLabel: string;
  indexes: IndexValues;
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

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// Interface for missing indexes tracking
interface MissingIndexInfo {
  indexCode: string;
  months: string[];
  isBaseIndex: boolean;
}

const RevisionTab: React.FC<Props> = ({
  project,
  decompts,
  periodes: _periodes, // Reserved for future use (PDF export)
  revisionConfig
}) => {
  // State
  const [activeView, setActiveView] = useState<'calcul' | 'coefficients'>('calcul');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Index data
  const [monthCoefficients, setMonthCoefficients] = useState<MonthCoefficient[]>([]);
  const [decomptRevisions, setDecomptRevisions] = useState<DecomptRevision[]>([]);
  
  // Missing indexes tracking
  const [missingIndexes, setMissingIndexes] = useState<MissingIndexInfo[]>([]);
  const [hasMissingIndexes, setHasMissingIndexes] = useState(false);
  
  // Expanded states
  const [expandedDecompts, setExpandedDecompts] = useState<Set<string>>(new Set());

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED DATA
  // ═══════════════════════════════════════════════════════════════════════════

  // Check if revision is properly configured
  const hasFormula = !!revisionConfig?.formula && 
    typeof revisionConfig.formula.fixedPart === 'number' &&
    Object.keys(revisionConfig.formula.weights || {}).length > 0;
  const hasRevisionConfig = revisionConfig?.isEnabled !== false && hasFormula;
  
  const baseDate = useMemo(() => {
    if (revisionConfig?.baseDate) return new Date(revisionConfig.baseDate);
    if (project.dateOuverture) return new Date(project.dateOuverture);
    return null;
  }, [revisionConfig?.baseDate, project.dateOuverture]);

  const startDate = useMemo(() => {
    if (project.osc) return new Date(project.osc);
    return null;
  }, [project.osc]);

  const baseDateLabel = useMemo(() => {
    if (!baseDate) return 'Non définie';
    return format(baseDate, 'MMMM yyyy', { locale: fr });
  }, [baseDate]);

  const startDateLabel = useMemo(() => {
    if (!startDate) return 'Non définie';
    return format(startDate, 'dd/MM/yyyy', { locale: fr });
  }, [startDate]);

  // Formula display string
  const formulaDisplay = useMemo(() => {
    if (!revisionConfig?.formula) return null;
    const { fixedPart, weights } = revisionConfig.formula;
    
    const parts = Object.entries(weights).map(([index, weight]) => {
      return `${weight}(${index}/${index}₀)`;
    });
    
    return `P = P₀ × [${fixedPart} + ${parts.join(' + ')}]`;
  }, [revisionConfig?.formula]);

  // Total revision amount
  const totalRevision = useMemo(() => {
    return decomptRevisions.reduce((sum, d) => sum + d.montantRevision, 0);
  }, [decomptRevisions]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD INDEX DATA
  // ═══════════════════════════════════════════════════════════════════════════

  // Track if initial load is done
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  
  // Track last loaded decompts to avoid unnecessary reloads
  const lastDecomptsRef = React.useRef<string>('');

  useEffect(() => {
    if (!hasRevisionConfig || !baseDate || !startDate) return;
    
    // Create a signature of current decompts to detect real changes
    const decomptsSignature = decompts
      .filter(d => d.dateFin)
      .map(d => `${d.id}-${d.dateFin}-${d.montantHT}`)
      .join('|');
    
    // Skip reload if decompts haven't actually changed
    if (initialLoadDone && decomptsSignature === lastDecomptsRef.current) {
      return;
    }
    
    lastDecomptsRef.current = decomptsSignature;
    loadIndexData();
  }, [hasRevisionConfig, baseDate, startDate, decompts]);

  const loadIndexData = async () => {
    if (!revisionConfig?.formula || !baseDate || !startDate) return;
    
    // Only show loading spinner on initial load, not on refresh
    const isInitialLoad = !initialLoadDone;
    if (isInitialLoad) {
      setIsLoading(true);
    }
    setError(null);
    setMissingIndexes([]);
    setHasMissingIndexes(false);
    
    try {
      // Determine date range: from O.S.C to last decompt
      const lastDecompt = decompts
        .filter(d => d.dateFin)
        .sort((a, b) => new Date(b.dateFin!).getTime() - new Date(a.dateFin!).getTime())[0];
      
      const endDate = lastDecompt?.dateFin 
        ? new Date(lastDecompt.dateFin) 
        : new Date();
      
      // Get all required index codes from formula
      const indexCodes = Object.keys(revisionConfig.formula.weights);
      
      // Load base month indexes first
      const baseMonthKey = format(baseDate, 'yyyy-MM');
      
      // Load indexes from O.S.C month (not from base date) to end date
      // O.S.C is startDate (project.osc)
      const oscMonthKey = format(startDate, 'yyyy-MM');
      const endMonthKey = format(endDate, 'yyyy-MM');
      
      // Load all monthly indexes at once (more efficient)
      const indexesMap = await getMultipleIndexValues(
        indexCodes,
        oscMonthKey,  // Start from O.S.C month, not base date
        endMonthKey
      );
      
      // Also load base month if different from O.S.C range
      if (baseMonthKey < oscMonthKey) {
        const baseIndexesResult = await getMultipleIndexValues(
          indexCodes,
          baseMonthKey,
          baseMonthKey
        );
        // Merge base month indexes
        baseIndexesResult.forEach((value, key) => {
          if (!indexesMap.has(key)) {
            indexesMap.set(key, value);
          }
        });
      }
      
      // ═══════════════════════════════════════════════════════════════════════
      // CHECK FOR MISSING INDEXES
      // ═══════════════════════════════════════════════════════════════════════
      const baseIndexes = revisionConfig.baseIndexes || {};
      const missingInfo: MissingIndexInfo[] = [];
      
      console.log('[RevisionTab] Checking missing indexes:', {
        indexCodes,
        baseIndexes,
        revisionConfig: revisionConfig
      });
      
      // Check base indexes first (from project config, NOT from monthly indexes)
      for (const indexCode of indexCodes) {
        const baseValue = baseIndexes[indexCode];
        // Base index is missing if undefined, null, 0, or not in config
        if (baseValue === undefined || baseValue === null || baseValue === 0) {
          missingInfo.push({
            indexCode,
            months: [baseMonthKey + ' (base)'],
            isBaseIndex: true
          });
        }
      }
      
      // Check monthly indexes (only for indexes that have valid base values)
      const allMonths = Array.from(indexesMap.keys()).sort();
      for (const indexCode of indexCodes) {
        // Skip if already marked as missing base index
        if (missingInfo.some(m => m.indexCode === indexCode && m.isBaseIndex)) continue;
        
        const missingMonths: string[] = [];
        for (const monthKey of allMonths) {
          const monthIndexes = indexesMap.get(monthKey);
          // Monthly index is missing only if undefined or null (100 can be a valid placeholder)
          if (!monthIndexes || monthIndexes[indexCode] === undefined || 
              monthIndexes[indexCode] === null) {
            missingMonths.push(monthKey);
          }
        }
        
        // Only report if there are missing months (and not ALL months are missing)
        if (missingMonths.length > 0 && missingMonths.length < allMonths.length) {
          missingInfo.push({
            indexCode,
            months: missingMonths,
            isBaseIndex: false
          });
        }
      }
      
      if (missingInfo.length > 0) {
        setMissingIndexes(missingInfo);
        setHasMissingIndexes(true);
      }
      
      // Calculate coefficients (pass baseMonthKey to mark it)
      calculateAllCoefficients(indexesMap, baseMonthKey);
      
    } catch (err) {
      console.error('Error loading index data:', err);
      setError('Erreur lors du chargement des données des index');
    } finally {
      setIsLoading(false);
      setInitialLoadDone(true);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATE COEFFICIENTS
  // ═══════════════════════════════════════════════════════════════════════════

  const calculateAllCoefficients = (indexesMap: Map<string, IndexValues>, baseMonthKey: string) => {
    if (!revisionConfig?.formula || !baseDate || !startDate) return;
    
    const formula = revisionConfig.formula;
    const baseIndexes = revisionConfig.baseIndexes || indexesMap.get(baseMonthKey) || {};
    
    // Calculate monthly coefficients
    const coefficients: MonthCoefficient[] = [];
    const coefficientsMap = new Map<string, number>();
    
    // Get O.S.C month key for filtering
    const oscMonthKey = format(startDate, 'yyyy-MM');
    
    // Sort months chronologically
    const sortedMonths = Array.from(indexesMap.keys()).sort();
    
    // Add base month first with special label if it's before O.S.C
    if (baseMonthKey < oscMonthKey && indexesMap.has(baseMonthKey)) {
      const baseIndexValues = indexesMap.get(baseMonthKey)!;
      const [year, month] = baseMonthKey.split('-').map(Number);
      const monthDate = new Date(year, month - 1, 1);
      const monthLabel = format(monthDate, 'MMM-yy', { locale: fr }) + ' (base)';
      
      // For base month, ratios are all 1.0000 and coefficient is 1.0000
      const ratios: Record<string, number> = {};
      for (const indexCode of Object.keys(formula.weights)) {
        ratios[indexCode] = 1.0000;
      }
      
      coefficients.push({
        month: baseMonthKey,
        monthLabel,
        indexes: baseIndexValues,
        ratios,
        coefficient: 1.0000
      });
      
      coefficientsMap.set(baseMonthKey, 1.0000);
    }
    
    // Then add months from O.S.C onwards
    for (const monthKey of sortedMonths) {
      // Skip base month (already added above) and months before O.S.C
      if (monthKey === baseMonthKey || monthKey < oscMonthKey) continue;
      
      const indexes = indexesMap.get(monthKey)!;
      
      // Calculate ratios
      const ratios: Record<string, number> = {};
      for (const indexCode of Object.keys(formula.weights)) {
        const currentValue = indexes[indexCode];
        const baseValue = baseIndexes[indexCode];
        if (currentValue && baseValue) {
          ratios[indexCode] = trunc(currentValue / baseValue, 4);
        }
      }
      
      // Calculate coefficient using TRUNC
      // Convert formula to RevisionFormula type (add required name)
      const fullFormula = {
        name: formula.name || 'Formula',
        fixedPart: formula.fixedPart,
        weights: formula.weights
      };
      const result = calculateMonthCoefficient(indexes, baseIndexes, fullFormula);
      
      // Format month label
      const [year, month] = monthKey.split('-').map(Number);
      const monthDate = new Date(year, month - 1, 1);
      const monthLabel = format(monthDate, 'MMM-yy', { locale: fr });
      
      coefficients.push({
        month: monthKey,
        monthLabel,
        indexes,
        ratios,
        coefficient: result.display
      });
      
      coefficientsMap.set(monthKey, result.display);
    }
    
    setMonthCoefficients(coefficients);
    
    // Calculate decompt revisions
    calculateDecomptRevisions(coefficientsMap);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATE DECOMPT REVISIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const calculateDecomptRevisions = (coefficientsMap: Map<string, number>) => {
    if (!startDate) return;
    
    const revisions: DecomptRevision[] = [];
    
    // Sort decompts by numero
    const sortedDecompts = [...decompts]
      .filter(d => d.dateFin)
      .sort((a, b) => a.numero - b.numero);
    
    let previousEndDate = startDate;
    
    for (const decompt of sortedDecompts) {
      const dateDebut = previousEndDate;
      const dateFin = new Date(decompt.dateFin!);
      
      // Get months in period
      const months = getMonthsInPeriod(dateDebut, dateFin);
      
      // Calculate days and coefficients for each month
      const monthsBreakdown: Array<{ month: string; days: number; coefficient: number }> = [];
      let totalDays = 0;
      let weightedSum = 0;
      
      for (const monthKey of months) {
        const days = getDaysInMonthForPeriod(monthKey, dateDebut, dateFin);
        const coefficient = coefficientsMap.get(monthKey) ?? 0;
        
        if (days > 0) {
          monthsBreakdown.push({ month: monthKey, days, coefficient });
          totalDays += days;
          weightedSum += days * coefficient;
        }
      }
      
      // Calculate weighted coefficient (TRUNC 4)
      const coefficientApplique = totalDays > 0 
        ? trunc(weightedSum / totalDays, 4) 
        : 0;
      
      // Get montant from decompt
      const montantAReviser = decompt.montantHT || 0;
      
      // Calculate revision amount (TRUNC 2)
      const montantRevision = trunc(montantAReviser * coefficientApplique, 2);
      
      revisions.push({
        decomptId: decompt.id,
        decomptNumero: decompt.numero,
        dateDebut: format(dateDebut, 'yyyy-MM-dd'),
        dateFin: format(dateFin, 'yyyy-MM-dd'),
        totalJours: totalDays,
        monthsBreakdown,
        coefficientApplique,
        montantAReviser,
        montantRevision
      });
      
      previousEndDate = dateFin;
    }
    
    setDecomptRevisions(revisions);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const toggleDecomptExpand = (decomptId: string) => {
    setExpandedDecompts(prev => {
      const next = new Set(prev);
      if (next.has(decomptId)) {
        next.delete(decomptId);
      } else {
        next.add(decomptId);
      }
      return next;
    });
  };

  const handleRefresh = () => {
    loadIndexData();
  };

  const handleExportPDF = () => {
    if (!revisionConfig?.formula) return;
    
    generateRevisionPDF(
      project,
      {
        formula: revisionConfig.formula,
        baseDate: revisionConfig.baseDate,
        baseIndexes: revisionConfig.baseIndexes
      },
      monthCoefficients,
      decomptRevisions,
      totalRevision
    );
  };

  const handlePrint = () => {
    window.print();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: No Config State
  // ═══════════════════════════════════════════════════════════════════════════

  if (!hasRevisionConfig) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Révision des Prix</h2>
        </div>
        
        <div className="card">
          <div className="text-center py-12">
            <TrendingUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Révision des prix non configurée
            </h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Pour calculer la révision des prix, vous devez d'abord configurer 
              la formule de révision dans les paramètres du projet.
            </p>
            <Link
              to={`/projects/${project.id}/edit`}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Configurer la révision
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Missing Dates
  // ═══════════════════════════════════════════════════════════════════════════

  if (!baseDate || !startDate) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Révision des Prix</h2>
        </div>
        
        <div className="card border-l-4 border-yellow-400 bg-yellow-50">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-yellow-800">Dates manquantes</h3>
                <p className="text-yellow-700 mt-1">
                  Pour calculer la révision des prix, veuillez définir:
                </p>
                <ul className="list-disc list-inside text-yellow-700 mt-2">
                  {!baseDate && <li>Date d'ouverture des plis (époque de base)</li>}
                  {!startDate && <li>Date de l'ordre de service de commencement (O.S.C)</li>}
                </ul>
                <Link
                  to={`/projects/${project.id}/edit`}
                  className="inline-flex items-center gap-2 text-yellow-800 font-medium mt-3 hover:underline"
                >
                  <Settings className="w-4 h-4" />
                  Modifier le projet
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Main Content
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Révision des Prix</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="btn btn-secondary flex items-center gap-2"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <button
            onClick={handleExportPDF}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            PDF
          </button>
          <button
            onClick={handlePrint}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimer
          </button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Formula Card */}
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Calculator className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500">Formule de révision</p>
              <p className="text-sm font-mono text-gray-900 truncate" title={formulaDisplay || ''}>
                {formulaDisplay || 'Non définie'}
              </p>
            </div>
          </div>
        </div>

        {/* Base Date Card */}
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Calendar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Époque de base</p>
              <p className="font-medium text-gray-900">{baseDateLabel}</p>
            </div>
          </div>
        </div>

        {/* Start Date Card */}
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Calendar className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Début des travaux (O.S.C)</p>
              <p className="font-medium text-gray-900">{startDateLabel}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Missing Indexes Warning */}
      {hasMissingIndexes && missingIndexes.length > 0 && (
        <div className="card border-l-4 border-orange-400 bg-orange-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-orange-800">
                ⚠️ Index manquants détectés
              </h3>
              <p className="text-orange-700 mt-1 text-sm">
                Certains index requis par la formule de révision ne sont pas disponibles dans la base de données. 
                Les coefficients affichés peuvent être incorrects ou incomplets.
              </p>
              
              <div className="mt-3 space-y-2">
                {missingIndexes.map((info, idx) => (
                  <div key={idx} className="bg-white/50 rounded-lg p-3 border border-orange-200">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        info.isBaseIndex 
                          ? 'bg-red-100 text-red-700' 
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {info.indexCode}
                      </span>
                      {info.isBaseIndex && (
                        <span className="text-xs text-red-600 font-medium">
                          (Index de base manquant - critique)
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-orange-700 mt-1">
                      {info.isBaseIndex 
                        ? `L'index de base "${info.indexCode}" n'est pas défini pour l'époque de base.`
                        : `Manquant pour ${info.months.length} mois: ${info.months.slice(0, 5).join(', ')}${info.months.length > 5 ? '...' : ''}`
                      }
                    </p>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/revision/indexes"
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors"
                >
                  <TrendingUp className="w-4 h-4" />
                  Gérer les index
                </Link>
                <Link
                  to={`/projects/${project.id}/edit`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-orange-700 rounded-lg text-sm font-medium border border-orange-300 hover:bg-orange-50 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Modifier la formule
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveView('calcul')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeView === 'calcul'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calculator className="w-4 h-4 inline-block mr-2" />
          Calcul
        </button>
        <button
          onClick={() => setActiveView('coefficients')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeView === 'coefficients'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <TrendingUp className="w-4 h-4 inline-block mr-2" />
          Coefficients
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Chargement des données...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card border-l-4 border-red-400 bg-red-50 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Calcul View */}
      {!isLoading && !error && activeView === 'calcul' && (
        <div className="card overflow-hidden">
          {decomptRevisions.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Aucun décompte disponible pour le calcul</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      N° Décompte
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Période
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Jours
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Coefficient
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Montant à réviser
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Révision
                    </th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {decomptRevisions.map((revision) => (
                    <React.Fragment key={revision.decomptId}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {revision.decomptNumero}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {format(new Date(revision.dateDebut), 'dd/MM/yyyy')} - {format(new Date(revision.dateFin), 'dd/MM/yyyy')}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">
                          {revision.totalJours}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          <span className={revision.coefficientApplique >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {revision.coefficientApplique.toFixed(4)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-900">
                          {revision.montantAReviser.toLocaleString('fr-MA', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                          <span className={revision.montantRevision >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {revision.montantRevision.toLocaleString('fr-MA', { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleDecomptExpand(revision.decomptId)}
                            className="p-1 hover:bg-gray-100 rounded"
                          >
                            {expandedDecompts.has(revision.decomptId) ? (
                              <ChevronUp className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            )}
                          </button>
                        </td>
                      </tr>
                      {/* Expanded Details */}
                      {expandedDecompts.has(revision.decomptId) && (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 bg-gray-50">
                            <div className="text-sm">
                              <p className="font-medium text-gray-700 mb-2">Détail par mois:</p>
                              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                {revision.monthsBreakdown.map(({ month, days, coefficient }) => (
                                  <div key={month} className="bg-white p-2 rounded border text-center">
                                    <p className="text-xs text-gray-500">{month}</p>
                                    <p className="font-medium">{days}j</p>
                                    <p className={`text-xs font-mono ${coefficient >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {coefficient.toFixed(4)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot className="bg-blue-50">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right font-medium text-gray-700">
                      Total Révision HT:
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-lg">
                      <span className={totalRevision >= 0 ? 'text-green-700' : 'text-red-700'}>
                        {totalRevision.toLocaleString('fr-MA', { minimumFractionDigits: 2 })} MAD
                      </span>
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>
      )}

      {/* Coefficients View */}
      {!isLoading && !error && activeView === 'coefficients' && (
        <div className="card overflow-x-auto">
          {monthCoefficients.length === 0 ? (
            <div className="p-8 text-center">
              <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Aucune donnée de coefficient disponible</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">
                    Mois
                  </th>
                  {/* Dynamic index columns */}
                  {revisionConfig?.formula && Object.keys(revisionConfig.formula.weights).map(indexCode => (
                    <th key={indexCode} className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      {indexCode}
                    </th>
                  ))}
                  {/* Ratio columns */}
                  {revisionConfig?.formula && Object.keys(revisionConfig.formula.weights).map(indexCode => (
                    <th key={`ratio-${indexCode}`} className="px-4 py-3 text-right text-xs font-medium text-blue-500 uppercase bg-blue-50">
                      {indexCode}/{indexCode}₀
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-900 uppercase bg-yellow-50">
                    Coefficient
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthCoefficients.map((row, idx) => {
                  const isBaseMonth = baseDate && dateToMonthKey(baseDate) === row.month;
                  
                  return (
                    <tr 
                      key={row.month} 
                      className={isBaseMonth ? 'bg-green-50' : (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                    >
                      <td className={`px-4 py-2 text-sm font-medium sticky left-0 ${isBaseMonth ? 'bg-green-50 text-green-800' : 'bg-inherit text-gray-900'}`}>
                        {row.monthLabel}
                        {isBaseMonth && (
                          <span className="ml-2 text-xs text-green-600">(base)</span>
                        )}
                      </td>
                      {/* Index values */}
                      {revisionConfig?.formula && Object.keys(revisionConfig.formula.weights).map(indexCode => (
                        <td key={indexCode} className="px-4 py-2 text-right text-sm font-mono text-gray-600">
                          {row.indexes[indexCode]?.toLocaleString('fr-MA') || '-'}
                        </td>
                      ))}
                      {/* Ratio values */}
                      {revisionConfig?.formula && Object.keys(revisionConfig.formula.weights).map(indexCode => (
                        <td key={`ratio-${indexCode}`} className="px-4 py-2 text-right text-sm font-mono text-blue-600 bg-blue-50/50">
                          {isBaseMonth ? '-' : (row.ratios[indexCode]?.toFixed(4) || '-')}
                        </td>
                      ))}
                      {/* Coefficient */}
                      <td className="px-4 py-2 text-right font-mono text-sm font-medium bg-yellow-50/50">
                        {isBaseMonth ? (
                          <span className="text-green-600">Époque de base</span>
                        ) : (
                          <span className={row.coefficient >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {row.coefficient.toFixed(4)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Info Note */}
      <div className="flex items-start gap-2 text-sm text-gray-500">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          Les coefficients sont calculés avec TRUNC (troncature à 4 décimales) conformément aux normes Excel.
          Formule: Coef = TRUNC(a + Σ(poids × index/index₀) - 1, 4)
        </p>
      </div>
    </div>
  );
};

export default RevisionTab;
