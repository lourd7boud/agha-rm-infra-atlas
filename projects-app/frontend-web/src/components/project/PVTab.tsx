/**
 * PVTab Component (V1)
 * Create and display PVs (Procès-Verbaux) for a project
 * Server-first architecture with PDF generation
 */

import { FC, useState } from 'react';
import { FileText, Plus, Download, Trash2, Loader2, X, Calendar, Eye } from 'lucide-react';
import { assetService, ProjectAsset, CreatePVData } from '../../services/assetService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DateInput from '../ui/DateInput';

interface PVTabProps {
  projectId: string;
  pvs: ProjectAsset[];
  onRefresh: () => void;
}

// PV types available
const PV_TYPES = [
  { value: 'Réception Provisoire', label: 'Réception Provisoire' },
  { value: 'Réception Définitive', label: 'Réception Définitive' },
  { value: 'Installation de Chantier', label: 'Installation de Chantier' },
  { value: 'Constat', label: 'Constat' },
  { value: 'Réunion de Chantier', label: 'Réunion de Chantier' },
  { value: 'Arrêt de Travaux', label: 'Arrêt de Travaux' },
  { value: 'Reprise de Travaux', label: 'Reprise de Travaux' },
  { value: 'Autre', label: 'Autre' },
];

const PVTab: FC<PVTabProps> = ({ projectId, pvs, onRefresh }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<CreatePVData>({
    pvType: '',
    date: new Date().toISOString().split('T')[0],
    observations: '',
    participants: [],
  });
  const [participantInput, setParticipantInput] = useState('');

  const handleCreatePV = async () => {
    if (!formData.pvType || !formData.date) {
      alert('Veuillez remplir le type et la date du PV');
      return;
    }

    setIsCreating(true);
    try {
      await assetService.createPV(projectId, formData);
      onRefresh();
      setShowCreateModal(false);
      resetForm();
    } catch (error) {
      console.error('Error creating PV:', error);
      alert('Erreur lors de la création du PV');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setFormData({
      pvType: '',
      date: new Date().toISOString().split('T')[0],
      observations: '',
      participants: [],
    });
    setParticipantInput('');
  };

  const addParticipant = () => {
    if (participantInput.trim()) {
      setFormData(prev => ({
        ...prev,
        participants: [...(prev.participants || []), participantInput.trim()]
      }));
      setParticipantInput('');
    }
  };

  const removeParticipant = (index: number) => {
    setFormData(prev => ({
      ...prev,
      participants: prev.participants?.filter((_, i) => i !== index) || []
    }));
  };

  const handleDelete = async (pv: ProjectAsset) => {
    if (!confirm('Supprimer ce PV ?')) return;

    setDeleting(pv.id);
    try {
      await assetService.deleteAsset(pv.id);
      onRefresh();
    } catch (error) {
      console.error('Delete error:', error);
      alert('Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  };

  const handleView = (pv: ProjectAsset) => {
    const url = assetService.getAssetUrl(pv.storagePath);
    window.open(url, '_blank');
  };

  const handleDownload = (pv: ProjectAsset) => {
    const url = assetService.getAssetUrl(pv.storagePath);
    const link = document.createElement('a');
    link.href = url;
    link.download = pv.originalName || pv.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Empty state
  if (pvs.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun PV</h3>
          <p className="text-gray-600 mb-6">
            Gérez vos procès-verbaux (installation, réception, constat...)
          </p>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Créer un PV
          </button>
        </div>

        {/* Create Modal */}
        {showCreateModal && (
          <CreatePVModal
            formData={formData}
            setFormData={setFormData}
            participantInput={participantInput}
            setParticipantInput={setParticipantInput}
            addParticipant={addParticipant}
            removeParticipant={removeParticipant}
            isCreating={isCreating}
            onClose={() => { setShowCreateModal(false); resetForm(); }}
            onCreate={handleCreatePV}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Procès-Verbaux ({pvs.length})
        </h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Créer un PV
        </button>
      </div>

      {/* PV List */}
      <div className="space-y-3">
        {pvs.map((pv) => {
          const metadata = pv.metadata || {};
          return (
            <div
              key={pv.id}
              className="card hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                    <FileText className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {metadata.pvType || 'PV'}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span>{metadata.date || format(new Date(pv.createdAt), 'dd/MM/yyyy', { locale: fr })}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right text-sm text-gray-500">
                    <p>Créé le {format(new Date(pv.createdAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}</p>
                    {pv.createdByName && <p>par {pv.createdByName}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleView(pv)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Voir"
                    >
                      <Eye className="w-5 h-5 text-gray-600" />
                    </button>
                    <button
                      onClick={() => handleDownload(pv)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Télécharger"
                    >
                      <Download className="w-5 h-5 text-gray-600" />
                    </button>
                    <button
                      onClick={() => handleDelete(pv)}
                      disabled={deleting === pv.id}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Supprimer"
                    >
                      {deleting === pv.id ? (
                        <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                      ) : (
                        <Trash2 className="w-5 h-5 text-red-500" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Observations preview */}
              {metadata.observations && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-sm text-gray-600 line-clamp-2">{metadata.observations}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreatePVModal
          formData={formData}
          setFormData={setFormData}
          participantInput={participantInput}
          setParticipantInput={setParticipantInput}
          addParticipant={addParticipant}
          removeParticipant={removeParticipant}
          isCreating={isCreating}
          onClose={() => { setShowCreateModal(false); resetForm(); }}
          onCreate={handleCreatePV}
        />
      )}
    </div>
  );
};

// Create PV Modal Component
interface CreatePVModalProps {
  formData: CreatePVData;
  setFormData: React.Dispatch<React.SetStateAction<CreatePVData>>;
  participantInput: string;
  setParticipantInput: React.Dispatch<React.SetStateAction<string>>;
  addParticipant: () => void;
  removeParticipant: (index: number) => void;
  isCreating: boolean;
  onClose: () => void;
  onCreate: () => void;
}

const CreatePVModal: FC<CreatePVModalProps> = ({
  formData,
  setFormData,
  participantInput,
  setParticipantInput,
  addParticipant,
  removeParticipant,
  isCreating,
  onClose,
  onCreate,
}) => {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Créer un PV</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Type PV */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type de PV *
            </label>
            <select
              value={formData.pvType}
              onChange={(e) => setFormData(prev => ({ ...prev, pvType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Sélectionner un type</option>
              {PV_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date *
            </label>
            <DateInput
              value={formData.date}
              onChange={(val) => setFormData(prev => ({ ...prev, date: val }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Observations */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Observations
            </label>
            <textarea
              value={formData.observations}
              onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
              rows={4}
              placeholder="Décrivez les observations du PV..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Participants */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Participants
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={participantInput}
                onChange={(e) => setParticipantInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addParticipant())}
                placeholder="Nom du participant"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={addParticipant}
                type="button"
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {formData.participants && formData.participants.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                  >
                    {p}
                    <button
                      onClick={() => removeParticipant(i)}
                      className="hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onCreate}
            disabled={isCreating || !formData.pvType || !formData.date}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Créer le PV
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PVTab;
