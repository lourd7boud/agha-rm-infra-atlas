/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Edit Index Dialog - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Dialog for editing/creating monthly indexes
 * - Edit individual index values
 * - Change status (provisoire/définitif)
 * - Filter by category
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Save,
  Search,
  Filter,
  Check,
  Clock,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import {
  getMonthIndexes,
  createMonthIndexes,
  updateMonthIndexes,
  getIndexCatalog,
  IndexCatalog
} from '../../services/indexManagementService';

interface EditIndexDialogProps {
  month: string | null; // null = create new
  onClose: () => void;
  onSave: () => void;
}

const EditIndexDialog: React.FC<EditIndexDialogProps> = ({ month, onClose, onSave }) => {
  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form data
  const [monthDate, setMonthDate] = useState(month || '');
  const [status, setStatus] = useState<'provisoire' | 'definitif'>('provisoire');
  const [source, setSource] = useState('');
  const [indexes, setIndexes] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<IndexCatalog | null>(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedListe, setSelectedListe] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load catalog
        const catalogData = await getIndexCatalog();
        setCatalog(catalogData);
        
        // Initialize indexes with 0 values
        const initialIndexes: Record<string, number> = {};
        Object.keys(catalogData.catalog).forEach(code => {
          initialIndexes[code] = 0;
        });
        
        // If editing, load existing data
        if (month) {
          const data = await getMonthIndexes(month);
          setMonthDate(data.monthDate);
          setStatus(data.status);
          setSource(data.source || '');
          
          // Merge with existing indexes
          setIndexes({
            ...initialIndexes,
            ...data.rawIndexes
          });
        } else {
          setIndexes(initialIndexes);
          // Set default month to current
          const now = new Date();
          setMonthDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [month]);
  
  // Filter indexes
  const filteredIndexes = useMemo(() => {
    if (!catalog) return [];
    
    return Object.entries(catalog.catalog)
      .filter(([code, info]) => {
        // Liste filter
        if (selectedListe !== 'all' && info.liste !== selectedListe) {
          return false;
        }
        
        // Category filter
        if (selectedCategory !== 'all' && info.category !== selectedCategory) {
          return false;
        }
        
        // Search filter
        if (searchTerm) {
          const search = searchTerm.toLowerCase();
          return (
            code.toLowerCase().includes(search) ||
            info.name.toLowerCase().includes(search)
          );
        }
        
        return true;
      })
      .map(([code, info]) => ({
        code,
        ...info,
        value: indexes[code] || 0
      }));
  }, [catalog, indexes, selectedListe, selectedCategory, searchTerm]);
  
  // Get listes
  const listes = useMemo(() => {
    if (!catalog?.listes) return [];
    return Object.keys(catalog.listes).sort();
  }, [catalog]);
  
  // Get categories (filtered by selected liste)
  const categories = useMemo(() => {
    if (!catalog) return [];
    
    const cats = new Set<string>();
    Object.entries(catalog.catalog).forEach(([_, info]) => {
      if (selectedListe === 'all' || info.liste === selectedListe) {
        cats.add(info.category);
      }
    });
    return Array.from(cats).sort();
  }, [catalog, selectedListe]);
  
  // Handle index change
  const handleIndexChange = (code: string, value: string) => {
    const numValue = parseFloat(value);
    setIndexes(prev => ({
      ...prev,
      [code]: isNaN(numValue) ? 0 : numValue
    }));
  };
  
  // Handle save
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      
      // Validate
      if (!monthDate) {
        throw new Error('Le mois est requis');
      }
      
      // Filter out zero values
      const nonZeroIndexes: Record<string, number> = {};
      Object.entries(indexes).forEach(([code, value]) => {
        if (value > 0) {
          nonZeroIndexes[code] = value;
        }
      });
      
      if (Object.keys(nonZeroIndexes).length === 0) {
        throw new Error('Au moins un index doit avoir une valeur');
      }
      
      if (month) {
        // Update
        await updateMonthIndexes(month, {
          indexes: nonZeroIndexes,
          status,
          source: source || undefined
        });
      } else {
        // Create
        await createMonthIndexes({
          monthDate: monthDate + '-01',
          indexes: nonZeroIndexes,
          status,
          source: source || 'Manual entry'
        });
      }
      
      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };
  
  // Count non-zero indexes
  const nonZeroCount = Object.values(indexes).filter(v => v > 0).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {month ? `Modifier: ${new Date(month).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' })}` : 'Ajouter un nouveau mois'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        
        {/* Form */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            {/* Month and Status */}
            <div className="px-6 py-4 border-b dark:border-gray-700 grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Mois
                </label>
                <input
                  type="month"
                  value={monthDate.substring(0, 7)}
                  onChange={(e) => setMonthDate(e.target.value)}
                  disabled={!!month}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-800"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Statut
                </label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'provisoire'}
                      onChange={() => setStatus('provisoire')}
                      className="text-yellow-600"
                    />
                    <span className="flex items-center gap-1 text-sm">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      Provisoire (**)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'definitif'}
                      onChange={() => setStatus('definitif')}
                      className="text-green-600"
                    />
                    <span className="flex items-center gap-1 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      Définitif (*)
                    </span>
                  </label>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Source
                </label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Ex: Bulletin officiel Mars 2024"
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
            </div>
            
            {/* Filters */}
            <div className="px-6 py-3 border-b dark:border-gray-700 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Rechercher un index..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <select
                  value={selectedListe}
                  onChange={(e) => {
                    setSelectedListe(e.target.value);
                    setSelectedCategory('all');
                  }}
                  className="px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm"
                >
                  <option value="all">Toutes les Listes</option>
                  {listes.map(liste => (
                    <option key={liste} value={liste}>{liste}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm"
                >
                  <option value="all">Toutes catégories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              
              <div className="text-sm text-gray-500">
                {nonZeroCount} / {filteredIndexes.length} index renseignés
              </div>
            </div>
            
            {/* Index List */}
            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredIndexes.map(({ code, name, category, liste, value }) => (
                  <div
                    key={code}
                    className={`p-3 border rounded-lg ${
                      value > 0
                        ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900 dark:text-white">{code}</span>
                      <span className="text-xs text-gray-400 truncate max-w-[100px]" title={liste}>{liste}</span>
                    </div>
                    <div className="text-xs text-blue-600 dark:text-blue-400 mb-1 truncate" title={category}>
                      {category}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate" title={name}>
                      {name}
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={value || ''}
                      onChange={(e) => handleIndexChange(code, e.target.value)}
                      placeholder="0.0"
                      className="w-full px-2 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                ))}
              </div>
              
              {filteredIndexes.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  Aucun index trouvé
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Footer */}
        <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {nonZeroCount} index avec valeur
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {month ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditIndexDialog;
