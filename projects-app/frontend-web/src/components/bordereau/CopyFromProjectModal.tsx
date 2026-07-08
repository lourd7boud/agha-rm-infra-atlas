import { FC, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Bordereau, Project } from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import { logSyncOperation } from '../../services/syncService';
import { X, Copy, FileText } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { isWeb } from '../../utils/platform';
import { apiService } from '../../services/apiService';

interface Props {
  currentProjectId: string;
  onClose: () => void;
  onCopied: (bordereauId: string) => void;
}

const CopyFromProjectModal: FC<Props> = ({ currentProjectId, onClose, onCopied }) => {
  const { user } = useAuthStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedBordereauId, setSelectedBordereauId] = useState<string>('');
  const [newReference, setNewReference] = useState('');
  const [newDesignation, setNewDesignation] = useState('');

  // For Electron: use IndexedDB
  const electronProjects = useLiveQuery<Project[]>(
    () => {
      if (isWeb()) return Promise.resolve([] as Project[]);
      return db.projects
        .where('userId')
        .equals(user?.id || '')
        .and((p) => !p.deletedAt && p.id !== `project:${currentProjectId}`)
        .toArray();
    },
    [user, currentProjectId]
  );

  const electronBordereaux = useLiveQuery<Bordereau[]>(
    () => {
      if (isWeb() || !selectedProjectId) return Promise.resolve([] as Bordereau[]);
      return db.bordereaux
        .where('projectId')
        .equals(selectedProjectId)
        .and((b) => !b.deletedAt)
        .toArray();
    },
    [selectedProjectId]
  );

  const electronSelectedBordereau = useLiveQuery<Bordereau | null>(
    () => {
      if (isWeb() || !selectedBordereauId) return Promise.resolve(null);
      return db.bordereaux.get(selectedBordereauId) as Promise<Bordereau>;
    },
    [selectedBordereauId]
  );

  // For Web: use API
  const [webProjects, setWebProjects] = useState<any[]>([]);
  const [webBordereaux, setWebBordereaux] = useState<Bordereau[]>([]);
  const [webSelectedBordereau, setWebSelectedBordereau] = useState<Bordereau | null>(null);

  useEffect(() => {
    if (isWeb()) {
      apiService.getProjects().then(res => {
        const data = res.data || res;
        setWebProjects(data.filter((p: any) => p.id !== currentProjectId));
      });
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (isWeb() && selectedProjectId) {
      const cleanId = selectedProjectId.replace('project:', '');
      apiService.getBordereaux(cleanId).then(res => {
        setWebBordereaux((res.data || res) as Bordereau[]);
      });
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (isWeb() && selectedBordereauId) {
      const found = webBordereaux.find(b => b.id === selectedBordereauId);
      setWebSelectedBordereau(found || null);
    }
  }, [selectedBordereauId, webBordereaux]);

  const projects = isWeb() ? webProjects : electronProjects;
  const bordereaux = isWeb() ? webBordereaux : electronBordereaux;
  const selectedBordereau = isWeb() ? webSelectedBordereau : electronSelectedBordereau;

  const handleCopy = async () => {
    if (!user || !selectedBordereau || !newReference.trim() || !newDesignation.trim()) {
      alert('Veuillez remplir tous les champs et sélectionner un bordereau');
      return;
    }

    const bordereauId = `bordereau:${uuidv4()}`;
    const now = new Date().toISOString();

    const copiedLignes = selectedBordereau.lignes.map((ligne, index) => ({
      ...ligne,
      id: uuidv4(),
      numero: index + 1,
      quantite: 0, // Reset quantities
      montant: 0,
    }));

    const newBordereau = {
      id: bordereauId,
      projectId: currentProjectId,
      userId: user.id,
      reference: newReference.trim(),
      designation: newDesignation.trim(),
      lignes: copiedLignes,
      montantTotal: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (isWeb()) {
      // Web: use API
      await apiService.createBordereau({
        projectId: currentProjectId.replace('project:', ''),
        reference: newReference.trim(),
        designation: newDesignation.trim(),
        lignes: copiedLignes,
        montantTotal: 0,
      });
    } else {
      // Electron: use IndexedDB
      await db.bordereaux.add(newBordereau);
      await logSyncOperation('CREATE', 'bordereau', bordereauId.replace('bordereau:', ''), newBordereau, user.id);
    }

    onCopied(bordereauId);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Copier depuis un projet</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1: Select Project */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              1. Sélectionner le projet source
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSelectedBordereauId('');
              }}
              className="input w-full"
            >
              <option value="">Choisir un projet...</option>
              {projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.objet} - Marché N° {project.marcheNo}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Select Bordereau */}
          {selectedProjectId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                2. Sélectionner le bordereau à copier
              </label>
              {bordereaux && bordereaux.length > 0 ? (
                <div className="space-y-2">
                  {bordereaux.map((bordereau) => (
                    <div
                      key={bordereau.id}
                      onClick={() => setSelectedBordereauId(bordereau.id)}
                      className={`card cursor-pointer transition-all border-2 ${
                        selectedBordereauId === bordereau.id
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-primary-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 text-primary-600 rounded-lg flex items-center justify-center">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{bordereau.reference}</div>
                          <div className="text-sm text-gray-600">{bordereau.designation}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {bordereau.lignes?.length || 0} lignes • {bordereau.montantTotal?.toLocaleString()} MAD
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p>Aucun bordereau dans ce projet</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: New Info */}
          {selectedBordereauId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                3. Informations du nouveau bordereau
              </label>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Référence *</label>
                  <input
                    type="text"
                    value={newReference}
                    onChange={(e) => setNewReference(e.target.value)}
                    className="input w-full"
                    placeholder="Ex: BPU-2024-02"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Désignation *</label>
                  <input
                    type="text"
                    value={newDesignation}
                    onChange={(e) => setNewDesignation(e.target.value)}
                    className="input w-full"
                    placeholder="Ex: Bordereau copié"
                  />
                </div>

                {selectedBordereau && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <Copy className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div className="text-sm text-blue-900">
                        <p className="font-medium mb-1">Contenu à copier:</p>
                        <ul className="list-disc list-inside space-y-1 text-blue-700">
                          <li>{selectedBordereau.lignes?.length || 0} lignes de bordereau</li>
                          <li>Désignations et unités</li>
                          <li>Prix unitaires de référence</li>
                          <li className="font-medium">Les quantités seront remises à 0</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Annuler
            </button>
            <button
              onClick={handleCopy}
              disabled={!selectedBordereauId || !newReference.trim() || !newDesignation.trim()}
              className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copier le bordereau
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CopyFromProjectModal;
