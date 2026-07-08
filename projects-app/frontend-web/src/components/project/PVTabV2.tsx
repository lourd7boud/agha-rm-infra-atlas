/**
 * PVTab Component (V2)
 * Enhanced PV Management System with:
 * - File upload (PDF/Images)
 * - Advanced templates per PV type
 * - Signatures support
 * - Rich metadata
 */

import { FC, useState } from 'react';
import DateInput from '../ui/DateInput';
import { 
  FileText, Plus, Download, Trash2, Loader2, X, Calendar, Eye, 
  Upload, Image, File, Users, CheckCircle, ClipboardList,
  Building, AlertTriangle, Clock, FileCheck
} from 'lucide-react';
import { assetService, ProjectAsset } from '../../services/assetService';
import { apiService } from '../../services/apiService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DropZone from '../common/DropZone';

interface PVTabV2Props {
  projectId: string;
  pvs: ProjectAsset[];
  onRefresh: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// PV TYPE DEFINITIONS - Each type has specific fields
// ═══════════════════════════════════════════════════════════════════════════

interface PVTypeConfig {
  value: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  fields: PVField[];
  description: string;
}

interface PVField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'number' | 'participants' | 'checklist' | 'time';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  rows?: number;
}

const PV_TYPE_CONFIGS: PVTypeConfig[] = [
  {
    value: 'installation_chantier',
    label: 'Installation de Chantier',
    icon: <Building className="w-5 h-5" />,
    color: 'blue',
    description: 'Constatation de l\'installation du chantier',
    fields: [
      { name: 'date', label: 'Date d\'installation', type: 'date', required: true },
      { name: 'heureDebut', label: 'Heure de début', type: 'time' },
      { name: 'lieuInstallation', label: 'Lieu d\'installation', type: 'text', placeholder: 'Adresse du chantier' },
      { name: 'superficieBase', label: 'Superficie de la base vie (m²)', type: 'number' },
      { name: 'installationsRealisees', label: 'Installations réalisées', type: 'checklist', options: [
        'Base vie',
        'Clôture de chantier',
        'Panneau de chantier',
        'Branchement eau',
        'Branchement électricité',
        'Zone de stockage',
        'Sanitaires',
        'Bureau de chantier'
      ]},
      { name: 'observations', label: 'Observations', type: 'textarea', rows: 4 },
      { name: 'participants', label: 'Présents', type: 'participants' }
    ]
  },
  {
    value: 'reunion_chantier',
    label: 'Réunion de Chantier',
    icon: <Users className="w-5 h-5" />,
    color: 'purple',
    description: 'Compte-rendu de réunion de chantier',
    fields: [
      { name: 'date', label: 'Date de la réunion', type: 'date', required: true },
      { name: 'heureDebut', label: 'Heure de début', type: 'time' },
      { name: 'heureFin', label: 'Heure de fin', type: 'time' },
      { name: 'numeroReunion', label: 'N° de réunion', type: 'number' },
      { name: 'ordreJour', label: 'Ordre du jour', type: 'textarea', rows: 3, placeholder: 'Points à aborder...' },
      { name: 'pointsDiscutes', label: 'Points discutés', type: 'textarea', rows: 4 },
      { name: 'decisions', label: 'Décisions prises', type: 'textarea', rows: 3 },
      { name: 'actionsSuivre', label: 'Actions à suivre', type: 'textarea', rows: 3 },
      { name: 'prochaineReunion', label: 'Date prochaine réunion', type: 'date' },
      { name: 'participants', label: 'Participants', type: 'participants' }
    ]
  },
  {
    value: 'constat',
    label: 'Constat',
    icon: <ClipboardList className="w-5 h-5" />,
    color: 'yellow',
    description: 'Constatation de travaux ou situation',
    fields: [
      { name: 'date', label: 'Date du constat', type: 'date', required: true },
      { name: 'heure', label: 'Heure', type: 'time' },
      { name: 'typeConstat', label: 'Type de constat', type: 'select', options: [
        'Constat de travaux réalisés',
        'Constat de malfaçon',
        'Constat d\'avancement',
        'Constat contradictoire',
        'Constat de dégâts',
        'Autre'
      ]},
      { name: 'objet', label: 'Objet du constat', type: 'text', required: true, placeholder: 'Objet précis du constat' },
      { name: 'localisation', label: 'Localisation', type: 'text', placeholder: 'Zone, étage, lot...' },
      { name: 'description', label: 'Description détaillée', type: 'textarea', rows: 5, required: true },
      { name: 'mesures', label: 'Mesures / Dimensions', type: 'textarea', rows: 2 },
      { name: 'conclusionConstat', label: 'Conclusion', type: 'textarea', rows: 3 },
      { name: 'participants', label: 'Témoins présents', type: 'participants' }
    ]
  },
  {
    value: 'reception_provisoire',
    label: 'Réception Provisoire',
    icon: <CheckCircle className="w-5 h-5" />,
    color: 'green',
    description: 'Réception provisoire des travaux',
    fields: [
      { name: 'date', label: 'Date de réception', type: 'date', required: true },
      { name: 'numeroMarche', label: 'N° Marché', type: 'text' },
      { name: 'objetMarche', label: 'Objet du marché', type: 'text', placeholder: 'Description des travaux' },
      { name: 'montantMarche', label: 'Montant du marché (MAD)', type: 'number' },
      { name: 'dateDebutTravaux', label: 'Date début travaux', type: 'date' },
      { name: 'dateFinTravaux', label: 'Date fin travaux', type: 'date' },
      { name: 'delaiExecution', label: 'Délai d\'exécution (jours)', type: 'number' },
      { name: 'resultatReception', label: 'Résultat', type: 'select', required: true, options: [
        'Réception prononcée sans réserves',
        'Réception prononcée avec réserves',
        'Réception refusée'
      ]},
      { name: 'reserves', label: 'Réserves (si applicable)', type: 'textarea', rows: 4 },
      { name: 'delaiLeveeReserves', label: 'Délai levée réserves (jours)', type: 'number' },
      { name: 'observations', label: 'Observations générales', type: 'textarea', rows: 3 },
      { name: 'participants', label: 'Commission de réception', type: 'participants' }
    ]
  },
  {
    value: 'reception_definitive',
    label: 'Réception Définitive',
    icon: <FileCheck className="w-5 h-5" />,
    color: 'emerald',
    description: 'Réception définitive des travaux',
    fields: [
      { name: 'date', label: 'Date de réception définitive', type: 'date', required: true },
      { name: 'numeroMarche', label: 'N° Marché', type: 'text' },
      { name: 'objetMarche', label: 'Objet du marché', type: 'text' },
      { name: 'dateReceptionProvisoire', label: 'Date réception provisoire', type: 'date' },
      { name: 'dureeGarantie', label: 'Durée de garantie (mois)', type: 'number' },
      { name: 'reservesLevees', label: 'Réserves levées ?', type: 'select', options: ['Oui', 'Non', 'Partiellement'] },
      { name: 'etatOuvrage', label: 'État de l\'ouvrage', type: 'textarea', rows: 3 },
      { name: 'conclusion', label: 'Conclusion', type: 'select', required: true, options: [
        'Réception définitive prononcée',
        'Réception définitive refusée'
      ]},
      { name: 'observations', label: 'Observations', type: 'textarea', rows: 3 },
      { name: 'participants', label: 'Commission de réception', type: 'participants' }
    ]
  },
  {
    value: 'arret_travaux',
    label: 'Arrêt de Travaux',
    icon: <AlertTriangle className="w-5 h-5" />,
    color: 'red',
    description: 'Constatation d\'arrêt des travaux',
    fields: [
      { name: 'date', label: 'Date d\'arrêt', type: 'date', required: true },
      { name: 'heure', label: 'Heure', type: 'time' },
      { name: 'motifArret', label: 'Motif de l\'arrêt', type: 'select', required: true, options: [
        'Intempéries',
        'Problème technique',
        'Manque de matériaux',
        'Ordre du maître d\'ouvrage',
        'Problème financier',
        'Force majeure',
        'Autre'
      ]},
      { name: 'detailMotif', label: 'Détail du motif', type: 'textarea', rows: 3 },
      { name: 'etatAvancement', label: 'État d\'avancement au moment de l\'arrêt (%)', type: 'number' },
      { name: 'travauxEnCours', label: 'Travaux en cours', type: 'textarea', rows: 3 },
      { name: 'mesuresConservation', label: 'Mesures de conservation', type: 'textarea', rows: 3 },
      { name: 'dateReprisePrevue', label: 'Date de reprise prévue', type: 'date' },
      { name: 'participants', label: 'Présents', type: 'participants' }
    ]
  },
  {
    value: 'reprise_travaux',
    label: 'Reprise de Travaux',
    icon: <Clock className="w-5 h-5" />,
    color: 'teal',
    description: 'Constatation de reprise des travaux',
    fields: [
      { name: 'date', label: 'Date de reprise', type: 'date', required: true },
      { name: 'heure', label: 'Heure', type: 'time' },
      { name: 'dateArret', label: 'Date de l\'arrêt', type: 'date' },
      { name: 'dureeArret', label: 'Durée de l\'arrêt (jours)', type: 'number' },
      { name: 'motifArret', label: 'Rappel motif arrêt', type: 'text' },
      { name: 'etatChantier', label: 'État du chantier à la reprise', type: 'textarea', rows: 3 },
      { name: 'travauxPrevus', label: 'Travaux prévus à la reprise', type: 'textarea', rows: 3 },
      { name: 'nouveauDelai', label: 'Nouveau délai contractuel (si applicable)', type: 'text' },
      { name: 'participants', label: 'Présents', type: 'participants' }
    ]
  },
  {
    value: 'autre',
    label: 'Autre PV',
    icon: <FileText className="w-5 h-5" />,
    color: 'gray',
    description: 'Autre type de procès-verbal',
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'titre', label: 'Titre du PV', type: 'text', required: true },
      { name: 'contenu', label: 'Contenu', type: 'textarea', rows: 8, required: true },
      { name: 'participants', label: 'Participants', type: 'participants' }
    ]
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const PVTabV2: FC<PVTabV2Props> = ({ projectId, pvs, onRefresh }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<PVTypeConfig | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [participants, setParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  
  // Upload state
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPvType, setUploadPvType] = useState('');
  const [uploadDate, setUploadDate] = useState(new Date().toISOString().split('T')[0]);
  const [uploadDescription, setUploadDescription] = useState('');

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSelectType = (type: PVTypeConfig) => {
    setSelectedType(type);
    setFormData({ date: new Date().toISOString().split('T')[0] });
    setParticipants([]);
    setCheckedItems({});
  };

  const handleCreatePV = async () => {
    if (!selectedType) return;

    // Validate required fields
    const missingFields = selectedType.fields
      .filter(f => f.required && !formData[f.name])
      .map(f => f.label);

    if (missingFields.length > 0) {
      alert(`Veuillez remplir les champs obligatoires:\n${missingFields.join('\n')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      // Prepare data
      const pvData = {
        pvType: selectedType.label,
        pvTypeCode: selectedType.value,
        ...formData,
        participants,
        checklist: checkedItems
      };

      await apiService.post(`/assets/project/${projectId}/pv`, pvData);
      onRefresh();
      closeCreateModal();
    } catch (error) {
      console.error('Error creating PV:', error);
      alert('Erreur lors de la création du PV');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilesSelected = (files: File[]) => {
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleRemoveFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadPV = async () => {
    if (uploadFiles.length === 0 || !uploadPvType) {
      alert('Veuillez sélectionner au moins un fichier et un type de PV');
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      uploadFiles.forEach(file => formData.append('files', file));
      formData.append('pvType', uploadPvType);
      formData.append('date', uploadDate);
      if (uploadDescription) {
        formData.append('description', uploadDescription);
      }

      await apiService.postFormData(
        `/assets/project/${projectId}/pv/upload`,
        formData,
        (progress) => setUploadProgress(progress)
      );

      onRefresh();
      closeUploadModal();
    } catch (error) {
      console.error('Error uploading PV:', error);
      alert('Erreur lors du téléchargement');
    } finally {
      setIsSubmitting(false);
    }
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

  const handleDownload = async (pv: ProjectAsset) => {
    try {
      const token = localStorage.getItem('auth_token');
      const url = assetService.getAssetUrl(pv.storagePath);
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = pv.originalName || pv.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
      const url = assetService.getAssetUrl(pv.storagePath);
      const link = document.createElement('a');
      link.href = url;
      link.download = pv.originalName || pv.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setSelectedType(null);
    setFormData({});
    setParticipants([]);
    setCheckedItems({});
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadProgress(0);
    setUploadPvType('');
    setUploadDate(new Date().toISOString().split('T')[0]);
    setUploadDescription('');
  };

  const addParticipant = () => {
    if (participantInput.trim()) {
      setParticipants(prev => [...prev, participantInput.trim()]);
      setParticipantInput('');
    }
  };

  const removeParticipant = (index: number) => {
    setParticipants(prev => prev.filter((_, i) => i !== index));
  };

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      blue: { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' },
      purple: { bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200' },
      yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600', border: 'border-yellow-200' },
      green: { bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-200' },
      emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-200' },
      red: { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200' },
      teal: { bg: 'bg-teal-100', text: 'text-teal-600', border: 'border-teal-200' },
      gray: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
    };
    return colors[color] || colors.gray;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER FIELD COMPONENT
  // ═══════════════════════════════════════════════════════════════════════════

  const renderField = (field: PVField) => {
    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={formData[field.name] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            value={formData[field.name] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        );
      
      case 'date':
        return (
          <DateInput
            value={formData[field.name] || ''}
            onChange={(val) => setFormData(prev => ({ ...prev, [field.name]: val }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        );

      case 'time':
        return (
          <input
            type="time"
            value={formData[field.name] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        );
      
      case 'textarea':
        return (
          <textarea
            value={formData[field.name] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
            rows={field.rows || 3}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        );
      
      case 'select':
        return (
          <select
            value={formData[field.name] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">Sélectionner...</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      
      case 'checklist':
        return (
          <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
            {field.options?.map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                <input
                  type="checkbox"
                  checked={checkedItems[opt] || false}
                  onChange={(e) => setCheckedItems(prev => ({ ...prev, [opt]: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        );
      
      case 'participants':
        return (
          <div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={participantInput}
                onChange={(e) => setParticipantInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addParticipant())}
                placeholder="Nom et fonction"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={addParticipant}
                type="button"
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm"
                  >
                    <Users className="w-3 h-3" />
                    {p}
                    <button onClick={() => removeParticipant(i)} className="hover:text-red-500 ml-1">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      
      default:
        return null;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // Empty state
  if (pvs.length === 0 && !showCreateModal && !showUploadModal) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun PV</h3>
          <p className="text-gray-600 mb-6">
            Gérez vos procès-verbaux (installation, réception, constat...)
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button 
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Créer un PV
            </button>
            <button 
              onClick={() => setShowUploadModal(true)}
              className="btn btn-outline inline-flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Importer un PV (PDF/Image)
            </button>
          </div>
        </div>

        {/* Modals */}
        {showCreateModal && renderCreateModal()}
        {showUploadModal && renderUploadModal()}
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowUploadModal(true)}
            className="btn btn-outline inline-flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Importer
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Créer un PV
          </button>
        </div>
      </div>

      {/* PV List */}
      <div className="space-y-3">
        {pvs.map((pv) => {
          const metadata = pv.metadata || {};
          const typeConfig = PV_TYPE_CONFIGS.find(t => 
            t.value === metadata.pvTypeCode || t.label === metadata.pvType
          );
          const colorClasses = getColorClasses(typeConfig?.color || 'gray');
          const isImage = pv.mimeType?.startsWith('image/');
          const isPDF = pv.mimeType === 'application/pdf';
          
          return (
            <div key={pv.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 ${colorClasses.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                    {typeConfig?.icon || <FileText className={`w-6 h-6 ${colorClasses.text}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">
                        {metadata.pvType || metadata.titre || 'PV'}
                      </h3>
                      {(isImage || isPDF) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                          {isImage ? <Image className="w-3 h-3" /> : <File className="w-3 h-3" />}
                          {isImage ? 'Image' : 'PDF'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {metadata.date || format(new Date(pv.createdAt), 'dd/MM/yyyy', { locale: fr })}
                      </span>
                      {pv.createdByName && (
                        <span>par {pv.createdByName}</span>
                      )}
                    </div>
                    
                    {/* Preview observations/description */}
                    {(metadata.observations || metadata.description || metadata.contenu) && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                        {metadata.observations || metadata.description || metadata.contenu}
                      </p>
                    )}
                    
                    {/* Participants */}
                    {metadata.participants && metadata.participants.length > 0 && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Users className="w-4 h-4 text-gray-400" />
                        {metadata.participants.slice(0, 3).map((p: string, i: number) => (
                          <span key={i} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                            {p}
                          </span>
                        ))}
                        {metadata.participants.length > 3 && (
                          <span className="text-xs text-gray-500">
                            +{metadata.participants.length - 3} autres
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0 ml-4">
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
          );
        })}
      </div>

      {/* Modals */}
      {showCreateModal && renderCreateModal()}
      {showUploadModal && renderUploadModal()}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  function renderCreateModal() {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedType ? `Créer: ${selectedType.label}` : 'Créer un Procès-Verbal'}
              </h2>
              {selectedType && (
                <p className="text-sm text-gray-500 mt-1">{selectedType.description}</p>
              )}
            </div>
            <button onClick={closeCreateModal} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {!selectedType ? (
              // Type selection
              <div className="grid grid-cols-2 gap-3">
                {PV_TYPE_CONFIGS.map((type) => {
                  const colorClasses = getColorClasses(type.color);
                  return (
                    <button
                      key={type.value}
                      onClick={() => handleSelectType(type)}
                      className={`p-4 rounded-xl border-2 ${colorClasses.border} hover:shadow-md transition-all text-left`}
                    >
                      <div className={`w-10 h-10 ${colorClasses.bg} rounded-lg flex items-center justify-center mb-3`}>
                        <span className={colorClasses.text}>{type.icon}</span>
                      </div>
                      <h3 className="font-semibold text-gray-900">{type.label}</h3>
                      <p className="text-sm text-gray-500 mt-1">{type.description}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              // Form fields
              <div className="space-y-4">
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  ← Changer de type
                </button>

                {selectedType.fields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {renderField(field)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {selectedType && (
            <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50 flex-shrink-0">
              <button
                onClick={closeCreateModal}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleCreatePV}
                disabled={isSubmitting}
                className="btn btn-primary inline-flex items-center gap-2"
              >
                {isSubmitting ? (
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
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  function renderUploadModal() {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-xl font-semibold text-gray-900">Importer un PV</h2>
            <button onClick={closeUploadModal} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Drag & Drop Zone */}
            <DropZone
              onFilesSelected={handleFilesSelected}
              accept=".pdf,image/*"
              multiple={true}
              maxFiles={10}
              icon="mixed"
              title="Glissez-déposez vos fichiers ici"
              subtitle="PDF ou Images (JPG, PNG)"
              showPreview={true}
              selectedFiles={uploadFiles}
              onRemoveFile={handleRemoveFile}
            />

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type de PV *
              </label>
              <select
                value={uploadPvType}
                onChange={(e) => setUploadPvType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">Sélectionner un type</option>
                {PV_TYPE_CONFIGS.map(type => (
                  <option key={type.value} value={type.label}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date du PV
              </label>
              <DateInput
                value={uploadDate}
                onChange={(val) => setUploadDate(val)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optionnel)
              </label>
              <textarea
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                rows={2}
                placeholder="Description du PV importé..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Progress */}
            {isSubmitting && uploadProgress > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Téléchargement...</span>
                  <span className="text-primary-600">{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
            <button
              onClick={closeUploadModal}
              disabled={isSubmitting}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleUploadPV}
              disabled={isSubmitting || uploadFiles.length === 0 || !uploadPvType}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Téléchargement...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Importer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
};

export default PVTabV2;
