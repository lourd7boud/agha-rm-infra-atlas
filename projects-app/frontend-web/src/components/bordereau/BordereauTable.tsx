import { FC, useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import { logSyncOperation } from '../../services/syncService';
import { isWeb } from '../../utils/platform';
import { apiService } from '../../services/apiService';
import { calculateTVA, calculateTTC, formatMontant } from '../../utils/financeEngine';
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Download,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { searchTemplates } from '../../data/bordereauTemplates';

interface BordereauLigne {
  id: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

interface Bordereau {
  id: string;
  projectId: string;
  reference: string;
  designation: string;
  lignes: BordereauLigne[];
  montantTotal: number;
}

interface Props {
  bordereauId: string;
  onClose: () => void;
  onSaved?: () => void; // Callback to refresh parent data after save
}

const BordereauTable: FC<Props> = ({ bordereauId, onClose, onSaved }) => {
  const { user } = useAuthStore();
  const [lignes, setLignes] = useState<BordereauLigne[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  
  // 🌐 Web mode: use state for bordereau
  const [webBordereau, setWebBordereau] = useState<Bordereau | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 🖥️ Electron mode: use Dexie
  const dexieBordereau = useLiveQuery(
    () => isWeb() ? Promise.resolve(undefined) : db.bordereaux.get(bordereauId),
    [bordereauId]
  ) as Bordereau | undefined;

  // Get raw ID for API calls
  const rawBordereauId = bordereauId?.includes(':') ? bordereauId.split(':').pop()! : bordereauId;

  // 🌐 Fetch bordereau from API for Web mode
  const fetchBordereau = useCallback(async () => {
    if (!isWeb() || !rawBordereauId) return;
    
    try {
      setIsLoading(true);
      console.log(`🌐 [BordereauTable] Fetching bordereau ${rawBordereauId}...`);
      const response = await apiService.getBordereau(rawBordereauId);
      const data = response.data || response;
      console.log(`✅ [BordereauTable] Loaded bordereau:`, data);
      setWebBordereau(data);
    } catch (err) {
      console.error(`❌ [BordereauTable] Failed to fetch bordereau:`, err);
    } finally {
      setIsLoading(false);
    }
  }, [rawBordereauId]);

  // Load data on mount for Web mode
  useEffect(() => {
    if (isWeb()) {
      fetchBordereau();
    } else {
      setIsLoading(false);
    }
  }, [fetchBordereau]);

  // Use the appropriate bordereau based on platform
  const bordereau: Bordereau | null | undefined = isWeb() ? webBordereau : dexieBordereau;

  const suggestions = searchQuery.length >= 2 
    ? searchTemplates(searchQuery).slice(0, 5)
    : [];

  useEffect(() => {
    if (bordereau?.lignes) {
      setLignes(bordereau.lignes);
    }
  }, [bordereau]);

  // 🔒 FINANCE ENGINE - حسابات مالية عبر financeEngine
  const calculateTotals = () => {
    const montantHT = lignes.reduce((sum, ligne) => sum + ligne.montant, 0);
    const tva = calculateTVA(montantHT, 20); // ⚠️ قطع TVA
    const montantTTC = calculateTTC(montantHT, tva); // ⚠️ قطع TTC
    return { montantHT, tva, montantTTC };
  };

  const handleAddLine = () => {
    const newLigne: BordereauLigne = {
      id: uuidv4(),
      numero: lignes.length + 1,
      designation: '',
      unite: '',
      quantite: 0,
      prixUnitaire: 0,
      montant: 0,
    };
    setLignes([...lignes, newLigne]);
    setEditingId(newLigne.id);
    setTimeout(() => {
      inputRefs.current[`designation-${newLigne.id}`]?.focus();
    }, 50);
  };

  const handleUpdateLine = (id: string, field: keyof BordereauLigne, value: any) => {
    setLignes((prev) =>
      prev.map((ligne) => {
        if (ligne.id === id) {
          const updated = { ...ligne, [field]: value };
          if (field === 'quantite' || field === 'prixUnitaire') {
            updated.montant = updated.quantite * updated.prixUnitaire;
          }
          return updated;
        }
        return ligne;
      })
    );
  };

  const handleDeleteLine = (id: string) => {
    const filtered = lignes.filter((l) => l.id !== id);
    // Renumber
    const renumbered = filtered.map((l, index) => ({ ...l, numero: index + 1 }));
    setLignes(renumbered);
  };

  const handleSelectSuggestion = (index: number) => {
    if (!editingId || !suggestions[index]) return;

    const template = suggestions[index];
    handleUpdateLine(editingId, 'designation', template.designation);
    handleUpdateLine(editingId, 'unite', template.unite);
    handleUpdateLine(editingId, 'prixUnitaire', template.prixReference);
    
    setSearchQuery('');
    setShowSuggestions(false);
    setSelectedIndex(0);
    
    setTimeout(() => {
      inputRefs.current[`quantite-${editingId}`]?.focus();
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent, _id: string, field: string) => {
    if (field === 'designation' && showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectSuggestion(selectedIndex);
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setSearchQuery('');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'montant' || field === 'prixUnitaire') {
        handleAddLine();
      }
    }
  };

  const handleSave = async () => {
    if (!user || !bordereau) return;

    const { montantHT } = calculateTotals();
    const updated = {
      ...bordereau,
      lignes,
      montantTotal: montantHT,
      updatedAt: new Date().toISOString(),
    };

    if (isWeb()) {
      // 🌐 Web: use API
      try {
        console.log('📤 [BordereauTable] Saving bordereau...');
        await apiService.updateBordereau(rawBordereauId, {
          lignes,
          montantTotal: montantHT,
        });
        setWebBordereau(updated as Bordereau);
        console.log('✅ [BordereauTable] Bordereau saved');
        // Notify parent to refresh data (project montant updated)
        if (onSaved) onSaved();
        alert('Bordereau enregistré avec succès !');
      } catch (error) {
        console.error('❌ [BordereauTable] Failed to save:', error);
        alert('Erreur lors de l\'enregistrement');
      }
    } else {
      // 🖥️ Electron: use IndexedDB + sync
      await db.bordereaux.update(bordereauId, updated);
      await logSyncOperation(
        'UPDATE',
        'bordereau',
        bordereauId.replace('bordereau:', ''),
        updated,
        user.id
      );
      alert('Bordereau enregistré avec succès !');
    }
  };

  const handleExport = () => {
    if (!bordereau) return;

    const { montantHT, tva, montantTTC } = calculateTotals();
    
    let csv = 'N°,Désignation des ouvrages,U,Quantité,Prix unitaire (MAD),Montant (MAD)\n';
    lignes.forEach((ligne) => {
      csv += `${ligne.numero},"${ligne.designation}",${ligne.unite},${ligne.quantite},${ligne.prixUnitaire},${ligne.montant}\n`;
    });
    csv += `\n,,,Total HT:,,${formatMontant(montantHT)}\n`;
    csv += `,,,TVA 20%:,,${formatMontant(tva)}\n`;
    csv += `,,,Total TTC:,,${formatMontant(montantTTC)}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${bordereau.reference}.csv`;
    link.click();
  };

  if (isLoading || !bordereau) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  const { montantHT, tva, montantTTC } = calculateTotals();

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{bordereau.reference}</h2>
            <p className="text-sm text-gray-600">{bordereau.designation}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Exporter CSV
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Enregistrer
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b-2 border-gray-200">
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-16">N°</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Désignation des ouvrages</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-24">Unité</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-32">Quantité</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-40">Prix unitaire (MAD)</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-40">Montant (MAD)</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-700">{ligne.numero}</td>
                <td className="px-4 py-2 relative">
                  <input
                    ref={(el) => (inputRefs.current[`designation-${ligne.id}`] = el)}
                    type="text"
                    value={editingId === ligne.id ? searchQuery || ligne.designation : ligne.designation}
                    onChange={(e) => {
                      const value = e.target.value;
                      handleUpdateLine(ligne.id, 'designation', value);
                      if (editingId === ligne.id) {
                        setSearchQuery(value);
                        setShowSuggestions(value.length >= 2);
                        setSelectedIndex(0);
                      }
                    }}
                    onFocus={() => {
                      setEditingId(ligne.id);
                      setSearchQuery(ligne.designation);
                      if (ligne.designation.length >= 2) {
                        setShowSuggestions(true);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowSuggestions(false);
                        setEditingId(null);
                        setSearchQuery('');
                      }, 200);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, ligne.id, 'designation')}
                    className="input text-sm w-full"
                    placeholder="Rechercher ou taper..."
                  />
                  {editingId === ligne.id && showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {suggestions.map((template, idx) => (
                        <div
                          key={template.id}
                          onClick={() => handleSelectSuggestion(idx)}
                          className={`px-4 py-2 cursor-pointer ${
                            idx === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium text-sm text-gray-900">{template.code}</div>
                          <div className="text-xs text-gray-600 truncate">{template.designation}</div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <span className="font-medium text-primary-600">{template.prixReference} MAD</span>
                            <span>•</span>
                            <span>{template.unite}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 w-24">
                  <select
                    value={ligne.unite || ''}
                    onChange={(e) => handleUpdateLine(ligne.id, 'unite', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">--</option>
                    <option value="M³">M³</option>
                    <option value="ML">ML</option>
                    <option value="M²">M²</option>
                    <option value="KG">KG</option>
                    <option value="T">T</option>
                    <option value="U">U</option>
                    <option value="ENS">ENS</option>
                    <option value="M">M</option>
                    <option value="FF">FF</option>
                    <option value="L">L</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    ref={(el) => (inputRefs.current[`quantite-${ligne.id}`] = el)}
                    type="number"
                    step="0.01"
                    value={ligne.quantite || ''}
                    onChange={(e) => handleUpdateLine(ligne.id, 'quantite', parseFloat(e.target.value) || 0)}
                    onKeyDown={(e) => handleKeyDown(e, ligne.id, 'quantite')}
                    className="input text-sm text-right w-full"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={ligne.prixUnitaire || ''}
                    onChange={(e) => handleUpdateLine(ligne.id, 'prixUnitaire', parseFloat(e.target.value) || 0)}
                    onKeyDown={(e) => handleKeyDown(e, ligne.id, 'prixUnitaire')}
                    className="input text-sm text-right w-full"
                  />
                </td>
                <td className="px-4 py-2 text-right font-medium text-gray-900">
                  {ligne.montant.toFixed(2)}
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleDeleteLine(ligne.id)}
                    className="p-1 hover:bg-red-50 text-red-600 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="px-4 py-2">
                <button
                  onClick={handleAddLine}
                  className="flex items-center gap-2 text-primary-600 hover:text-primary-700 font-medium text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter une ligne
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Totals - 🔒 financeEngine */}
      <div className="mt-6 pt-6 border-t">
        <div className="max-w-md ml-auto space-y-2">
          <div className="flex items-center justify-between text-gray-700">
            <span>Total HT:</span>
            <span className="font-semibold">{formatMontant(montantHT)} MAD</span>
          </div>
          <div className="flex items-center justify-between text-gray-700">
            <span>TVA 20%:</span>
            <span className="font-semibold">{formatMontant(tva)} MAD</span>
          </div>
          <div className="flex items-center justify-between text-lg font-bold text-gray-900 pt-2 border-t">
            <span>Total TTC:</span>
            <span className="text-primary-600">{formatMontant(montantTTC)} MAD</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BordereauTable;
