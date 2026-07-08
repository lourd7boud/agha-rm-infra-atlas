import { FC, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../db/database';
import { logSyncOperation } from '../../services/syncService';
import { X, Search, Filter } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { isWeb } from '../../utils/platform';
import { apiService } from '../../services/apiService';
import {
  bordereauTemplates,
  categories,
  getTemplatesByCategory,
} from '../../data/bordereauTemplates';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (bordereauId: string) => void;
}

const TemplateLibraryModal: FC<Props> = ({ projectId, onClose, onCreated }) => {
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());

  const filteredTemplates = selectedCategory
    ? getTemplatesByCategory(selectedCategory)
    : bordereauTemplates.filter(
        (t) =>
          searchQuery === '' ||
          t.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      );

  const toggleTemplate = (id: string) => {
    const newSelected = new Set(selectedTemplates);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTemplates(newSelected);
  };

  const handleCreate = async () => {
    if (!user || selectedTemplates.size === 0) {
      alert('Veuillez sélectionner au moins un article');
      return;
    }

    const bordereauId = `bordereau:${uuidv4()}`;
    const now = new Date().toISOString();
    const year = new Date().getFullYear();

    const lignes = Array.from(selectedTemplates)
      .map((templateId, index) => {
        const template = bordereauTemplates.find((t) => t.id === templateId);
        if (!template) return null;

        return {
          id: uuidv4(),
          numero: index + 1,
          designation: template.designation,
          unite: template.unite,
          quantite: 0,
          prixUnitaire: template.prixReference,
          montant: 0,
        };
      })
      .filter((ligne): ligne is NonNullable<typeof ligne> => ligne !== null);

    const newBordereau = {
      id: bordereauId,
      projectId: projectId,
      userId: user.id,
      reference: `BPU-${year}`,
      designation: 'Bordereau des Prix Unitaires',
      lignes,
      montantTotal: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (isWeb()) {
      // Web: use API
      await apiService.createBordereau({
        projectId: projectId.replace('project:', ''),
        reference: `BPU-${year}`,
        designation: 'Bordereau des Prix Unitaires',
        lignes,
        montantTotal: 0,
      });
    } else {
      // Electron: use IndexedDB
      await db.bordereaux.add(newBordereau);
      await logSyncOperation('CREATE', 'bordereau', bordereauId.replace('bordereau:', ''), newBordereau, user.id);
    }

    onCreated(bordereauId);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Bibliothèque de modèles</h3>
            <p className="text-sm text-gray-600 mt-1">
              {selectedTemplates.size} article(s) sélectionné(s)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter */}
        <div className="p-6 border-b space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
                placeholder="Rechercher par désignation, code ou tag..."
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="input w-64"
            >
              <option value="">Toutes les catégories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Templates Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                onClick={() => toggleTemplate(template.id)}
                className={`card cursor-pointer transition-all border-2 ${
                  selectedTemplates.has(template.id)
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-primary-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedTemplates.has(template.id)}
                    onChange={() => {}}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-gray-900">{template.code}</div>
                        <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {template.designation}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-primary-600">
                          {template.prixReference} MAD
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{template.unite}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                        {template.categorie}
                      </span>
                      {template.tags.slice(0, 2).map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12">
              <Filter className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Aucun modèle trouvé</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Annuler
            </button>
            <button
              onClick={handleCreate}
              disabled={selectedTemplates.size === 0}
              className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Créer avec {selectedTemplates.size} article(s)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateLibraryModal;
