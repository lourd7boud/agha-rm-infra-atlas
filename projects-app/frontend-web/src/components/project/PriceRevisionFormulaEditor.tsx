/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📐 Price Revision Formula Editor
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Component for defining price revision formula in project settings
 * 
 * Formula: P = P0 × [ a + b(X/X0) + c(Y/Y0) + … ]
 * 
 * Rules:
 * - a (fixed part) ≥ 0.15
 * - a + b + c + … = 1
 * - X0 fetched from Index of Date d'ouverture
 * 
 * Indexes are loaded from Gestion des Index (API) to ensure they match
 * the stored data for the project's base month.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  Info,
  Calculator,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2
} from 'lucide-react';
import { getIndexCatalog } from '../../services/indexManagementService';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FormulaWeight {
  indexCode: string;
  indexName: string;
  weight: number;
}

export interface RevisionFormulaData {
  name: string;
  description?: string;
  fixedPart: number;
  weights: FormulaWeight[];
}

interface IndexCatalogItem {
  code: string;
  name: string;
  category: string;
}

interface Props {
  value: RevisionFormulaData | null;
  onChange: (formula: RevisionFormulaData | null) => void;
  dateOuverture?: string;
  disabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK CATALOG (used if API fails)
// ═══════════════════════════════════════════════════════════════════════════

const FALLBACK_CATALOG: Record<string, { name: string; category: string }> = {
  A: { name: "Acier rond lisse", category: "Métaux ferreux" },
  At: { name: "Acier torsadé", category: "Métaux ferreux" },
  Fe: { name: "Fer pour charpente", category: "Métaux ferreux" },
  Cs: { name: "Ciment en sacs", category: "Liants et terre cuite" },
  Cv: { name: "Ciment en vrac", category: "Liants et terre cuite" },
  G: { name: "Gasoil", category: "Carburant et Énergie" },
  S: { name: "Salaire moyen", category: "Salaires" },
  S1: { name: "Salaire faible proportion SMIG", category: "Salaires" },
  S2: { name: "Salaire forte proportion SMIG", category: "Salaires" },
  Mc1: { name: "Index terrassements ordinaires", category: "Matériels" },
  Mc2: { name: "Matériel terrassement gros engins", category: "Matériels" },
  Bi: { name: "Bitume d'étanchéité", category: "Etanchéité et Bitumes" },
  Bs: { name: "Bitume pur routier", category: "Etanchéité et Bitumes" },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const PriceRevisionFormulaEditor: React.FC<Props> = ({
  value,
  onChange,
  dateOuverture,
  disabled = false
}) => {
  // State
  const [isEnabled, setIsEnabled] = useState(!!value);
  const [fixedPart, setFixedPart] = useState(value?.fixedPart ?? 0.15);
  const [weights, setWeights] = useState<FormulaWeight[]>(value?.weights ?? []);
  const [formulaName, setFormulaName] = useState(value?.name ?? 'Formule de révision');
  const [showCatalog, setShowCatalog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedListe, setSelectedListe] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedSection, setExpandedSection] = useState(true);
  
  // Catalog loaded from API
  const [indexCatalog, setIndexCatalog] = useState<Record<string, { name: string; category: string; liste?: string }>>(FALLBACK_CATALOG);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // 🔧 تحديث الحالة عند تغير value من الـ parent (مثلاً بعد تحميل البيانات من API)
  useEffect(() => {
    if (value) {
      setIsEnabled(true);
      setFixedPart(value.fixedPart ?? 0.15);
      setWeights(value.weights ?? []);
      setFormulaName(value.name ?? 'Formule de révision');
    }
  }, [value]);

  // Load catalog from API on mount
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        setLoadingCatalog(true);
        setCatalogError(null);
        const result = await getIndexCatalog();
        if (result.catalog && Object.keys(result.catalog).length > 0) {
          setIndexCatalog(result.catalog);
        } else {
          setCatalogError('Catalogue vide');
        }
      } catch (error) {
        console.error('Failed to load index catalog:', error);
        setCatalogError('Échec du chargement du catalogue');
        // Keep fallback catalog
      } finally {
        setLoadingCatalog(false);
      }
    };
    loadCatalog();
  }, []);

  // Get all listes
  const listes = useMemo(() => {
    const listeSet = new Set<string>();
    Object.values(indexCatalog).forEach(info => {
      if (info.liste) listeSet.add(info.liste);
    });
    return Array.from(listeSet).sort();
  }, [indexCatalog]);

  // Group catalog by category (filtered by liste)
  const catalogByCategory = useMemo(() => {
    const grouped: Record<string, IndexCatalogItem[]> = {};
    Object.entries(indexCatalog).forEach(([code, info]) => {
      // Filter by liste first
      if (selectedListe !== 'all' && info.liste !== selectedListe) {
        return;
      }
      if (!grouped[info.category]) {
        grouped[info.category] = [];
      }
      grouped[info.category].push({ code, name: info.name, category: info.category });
    });
    return grouped;
  }, [indexCatalog, selectedListe]);

  const categories = useMemo(() => Object.keys(catalogByCategory).sort(), [catalogByCategory]);

  // Filter catalog items
  const filteredCatalog = useMemo(() => {
    let items: IndexCatalogItem[] = [];
    
    if (selectedCategory === 'all') {
      items = Object.values(catalogByCategory).flat();
    } else {
      items = catalogByCategory[selectedCategory] || [];
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter(
        item => 
          item.code.toLowerCase().includes(term) || 
          item.name.toLowerCase().includes(term)
      );
    }

    // Exclude already selected
    const selectedCodes = weights.map(w => w.indexCode);
    items = items.filter(item => !selectedCodes.includes(item.code));
    
    // Sort: exact code match first, then by code length (shorter first), then alphabetically
    items.sort((a, b) => {
      const termLower = searchTerm.toLowerCase();
      const aExact = a.code.toLowerCase() === termLower;
      const bExact = b.code.toLowerCase() === termLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      // Shorter codes first (S before Sa, Sa before Sab)
      if (a.code.length !== b.code.length) return a.code.length - b.code.length;
      return a.code.localeCompare(b.code);
    });
    
    return items;
  }, [catalogByCategory, selectedCategory, searchTerm, weights]);

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check fixed part
    if (fixedPart < 0.15) {
      errors.push('Le coefficient fixe (a) doit être ≥ 0.15');
    }
    
    // Calculate sum
    const weightsSum = weights.reduce((sum, w) => sum + w.weight, 0);
    const total = fixedPart + weightsSum;
    
    if (Math.abs(total - 1) > 0.0001) {
      errors.push(`La somme des coefficients doit être égale à 1 (actuelle: ${total.toFixed(4)})`);
    }
    
    // Check for zero weights
    const zeroWeights = weights.filter(w => w.weight <= 0);
    if (zeroWeights.length > 0) {
      warnings.push(`${zeroWeights.length} index avec coefficient = 0`);
    }
    
    // Check for missing date
    if (!dateOuverture) {
      warnings.push('Date d\'ouverture non définie - les index de base ne peuvent pas être récupérés');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      total,
      weightsSum
    };
  }, [fixedPart, weights, dateOuverture]);

  // Generate formula display string
  const formulaDisplay = useMemo(() => {
    const parts = [`${fixedPart.toFixed(2)}`];
    weights.forEach(w => {
      parts.push(`${w.weight.toFixed(2)}(${w.indexCode}/${w.indexCode}₀)`);
    });
    return `P = P₀ × [ ${parts.join(' + ')} ]`;
  }, [fixedPart, weights]);

  // Update parent on change
  useEffect(() => {
    if (!isEnabled) {
      onChange(null);
      return;
    }

    const formulaData: RevisionFormulaData = {
      name: formulaName,
      fixedPart,
      weights
    };
    onChange(formulaData);
  }, [isEnabled, formulaName, fixedPart, weights, onChange]);

  // Handlers
  const handleAddIndex = useCallback((item: IndexCatalogItem) => {
    const remainingWeight = Math.max(0, 1 - fixedPart - weights.reduce((s, w) => s + w.weight, 0));
    const suggestedWeight = Math.min(remainingWeight, 0.10);
    
    setWeights(prev => [...prev, {
      indexCode: item.code,
      indexName: item.name,
      weight: parseFloat(suggestedWeight.toFixed(2))
    }]);
    setShowCatalog(false);
    setSearchTerm('');
  }, [fixedPart, weights]);

  const handleRemoveIndex = useCallback((indexCode: string) => {
    setWeights(prev => prev.filter(w => w.indexCode !== indexCode));
  }, []);

  const handleWeightChange = useCallback((indexCode: string, newWeight: number) => {
    setWeights(prev => prev.map(w => 
      w.indexCode === indexCode ? { ...w, weight: newWeight } : w
    ));
  }, []);

  const handleAutoBalance = useCallback(() => {
    if (weights.length === 0) return;
    const remainingForWeights = 1 - fixedPart;
    const equalWeight = parseFloat((remainingForWeights / weights.length).toFixed(4));
    setWeights(prev => prev.map(w => ({ ...w, weight: equalWeight })));
  }, [fixedPart, weights.length]);

  if (disabled) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="text-gray-500 text-sm">
          {value ? (
            <>
              <p className="font-medium">{value.name}</p>
              <p className="mt-1 font-mono text-xs">{formulaDisplay}</p>
            </>
          ) : (
            <p>Aucune formule de révision définie</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header with toggle */}
      <div 
        className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
          isEnabled ? 'bg-primary-50' : 'bg-gray-50'
        }`}
        onClick={() => setExpandedSection(!expandedSection)}
      >
        <div className="flex items-center gap-3">
          <Calculator className={`w-5 h-5 ${isEnabled ? 'text-primary-600' : 'text-gray-400'}`} />
          <div>
            <h3 className="font-semibold text-gray-900">Formule de Révision des Prix</h3>
            <p className="text-sm text-gray-500">P = P₀ × [ a + b(X/X₀) + c(Y/Y₀) + … ]</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="w-4 h-4 text-primary-600 rounded"
            />
            <span className="text-sm text-gray-600">Activer</span>
          </label>
          {expandedSection ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Content */}
      {expandedSection && isEnabled && (
        <div className="p-4 space-y-4 bg-white">
          {/* Formula name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom de la formule
            </label>
            <input
              type="text"
              value={formulaName}
              onChange={(e) => setFormulaName(e.target.value)}
              className="input text-sm"
              placeholder="Ex: Formule BTP Standard"
            />
          </div>

          {/* Fixed part (a) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Coefficient fixe (a) <span className="text-gray-400">- minimum 0.15</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.15"
                max="1"
                step="0.01"
                value={fixedPart}
                onChange={(e) => setFixedPart(parseFloat(e.target.value) || 0)}
                className={`input w-32 text-center font-mono ${
                  fixedPart < 0.15 ? 'border-red-500' : ''
                }`}
              />
              <span className="text-sm text-gray-500">
                ({(fixedPart * 100).toFixed(0)}%)
              </span>
            </div>
          </div>

          {/* Weights */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Index et coefficients
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoBalance}
                  className="text-xs text-primary-600 hover:text-primary-700"
                  disabled={weights.length === 0}
                >
                  Équilibrer
                </button>
                <button
                  type="button"
                  onClick={() => setShowCatalog(!showCatalog)}
                  className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un index
                </button>
              </div>
            </div>

            {/* Catalog dropdown */}
            {showCatalog && (
              <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                {/* Loading state */}
                {loadingCatalog ? (
                  <div className="flex items-center justify-center py-4 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                    <span className="text-sm text-gray-500">Chargement des index...</span>
                  </div>
                ) : catalogError ? (
                  <div className="text-center py-4">
                    <AlertCircle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                    <p className="text-sm text-gray-500">{catalogError}</p>
                    <p className="text-xs text-gray-400 mt-1">Utilisation du catalogue par défaut</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <div className="relative flex-1 min-w-[150px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Rechercher un index..."
                          className="w-full pl-9 pr-3 py-2 text-sm border rounded"
                          autoFocus
                        />
                      </div>
                      <select
                        value={selectedListe}
                        onChange={(e) => {
                          setSelectedListe(e.target.value);
                          setSelectedCategory('all');
                        }}
                        className="text-sm border rounded px-2"
                      >
                        <option value="all">Toutes les Listes</option>
                        {listes.map(liste => (
                          <option key={liste} value={liste}>{liste}</option>
                        ))}
                      </select>
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="text-sm border rounded px-2"
                      >
                        <option value="all">Toutes catégories</option>
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-gray-400 mb-2">
                      {Object.keys(indexCatalog).length} index disponibles
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredCatalog.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-2">
                          Aucun index trouvé
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1">
                          {filteredCatalog.slice(0, 20).map(item => (
                            <button
                              key={item.code}
                              type="button"
                              onClick={() => handleAddIndex(item)}
                              className="text-left px-2 py-1 text-sm rounded hover:bg-primary-100 transition-colors"
                            >
                              <span className="font-mono font-semibold text-primary-600">{item.code}</span>
                              <span className="text-gray-600 ml-1 truncate">{item.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {filteredCatalog.length > 20 && (
                        <p className="text-xs text-gray-400 text-center mt-2">
                          +{filteredCatalog.length - 20} autres...
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Weights list */}
            {weights.length === 0 ? (
              <div className="text-sm text-gray-500 bg-gray-50 rounded p-3 text-center">
                Aucun index ajouté. Cliquez sur "Ajouter un index" pour commencer.
              </div>
            ) : (
              <div className="space-y-2">
                {weights.map((w) => (
                  <div key={w.indexCode} className="flex items-center gap-2 bg-gray-50 rounded p-2">
                    <div className="flex-1">
                      <span className="font-mono font-semibold text-primary-600">{w.indexCode}</span>
                      <span className="text-sm text-gray-600 ml-2">{w.indexName}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={w.weight}
                      onChange={(e) => handleWeightChange(w.indexCode, parseFloat(e.target.value) || 0)}
                      className="w-20 text-center font-mono text-sm border rounded px-2 py-1"
                    />
                    <span className="text-xs text-gray-400 w-12">
                      ({(w.weight * 100).toFixed(0)}%)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIndex(w.indexCode)}
                      className="text-red-500 hover:text-red-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formula preview */}
          <div className="bg-gray-100 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Aperçu de la formule</span>
            </div>
            <code className="block text-sm font-mono text-gray-800 overflow-x-auto">
              {formulaDisplay}
            </code>
          </div>

          {/* Validation */}
          <div className="space-y-2">
            {/* Summary */}
            <div className={`flex items-center justify-between p-3 rounded-lg ${
              validation.isValid ? 'bg-green-50' : 'bg-red-50'
            }`}>
              <div className="flex items-center gap-2">
                {validation.isValid ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
                <span className={`font-medium ${
                  validation.isValid ? 'text-green-700' : 'text-red-700'
                }`}>
                  {validation.isValid ? 'Formule valide' : 'Formule invalide'}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-gray-600">Total: </span>
                <span className={`font-mono font-semibold ${
                  Math.abs(validation.total - 1) < 0.0001 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {validation.total.toFixed(4)}
                </span>
                <span className="text-gray-400"> / 1.0000</span>
              </div>
            </div>

            {/* Errors */}
            {validation.errors.map((err, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}

            {/* Warnings */}
            {validation.warnings.map((warn, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-amber-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{warn}</span>
              </div>
            ))}
          </div>

          {/* Info about base indexes */}
          {dateOuverture && (
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
              <Info className="w-4 h-4 inline-block mr-1" />
              Les index de base (X₀, Y₀, ...) seront automatiquement récupérés 
              depuis les données du mois de <strong>{dateOuverture.substring(0, 7)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PriceRevisionFormulaEditor;
