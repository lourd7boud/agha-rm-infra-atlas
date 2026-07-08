import { FC, useState } from 'react';
import { Bordereau } from '../../db/database';
import { X, Search, FileText } from 'lucide-react';

interface CreateMetreModalProps {
  bordereau: Bordereau;
  onClose: () => void;
  onCreate: (bordereauLigneIndex: number) => void;
}

const CreateMetreModal: FC<CreateMetreModalProps> = ({ bordereau, onClose, onCreate }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLignes = bordereau.lignes.filter(
    (ligne) =>
      ligne.designation.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ligne.numero.toString().includes(searchTerm)
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 text-primary-600 rounded-lg">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Nouveau métré</h2>
              <p className="text-sm text-gray-600">Sélectionnez une ligne du bordereau</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par N° ou désignation..."
              className="input pl-10 w-full"
              autoFocus
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {filteredLignes.map((ligne) => {
              // Trouver l'index original dans bordereau.lignes
              const originalIndex = bordereau.lignes.findIndex((l) => l.id === ligne.id);

              return (
                <button
                  key={ligne.id}
                  onClick={() => onCreate(originalIndex)}
                  className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex-shrink-0 px-3 py-1 bg-gray-100 text-gray-700 rounded font-medium text-sm">
                          N° {ligne.numero}
                        </span>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {ligne.unite}
                        </span>
                      </div>
                      <p className="text-gray-900 font-medium mb-1 group-hover:text-primary-700">
                        {ligne.designation}
                      </p>
                      {ligne.prixUnitaire && (
                        <p className="text-sm text-gray-500">
                          Prix unitaire: {ligne.prixUnitaire.toLocaleString()} MAD
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-lg font-bold text-gray-900">{ligne.quantite.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">{ligne.unite}</p>
                    </div>
                  </div>
                </button>
              );
            })}

            {filteredLignes.length === 0 && (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">Aucune ligne trouvée</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              {filteredLignes.length} ligne{filteredLignes.length !== 1 ? 's' : ''} sur {bordereau.lignes.length}
            </span>
            <button onClick={onClose} className="btn btn-secondary">
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateMetreModal;
