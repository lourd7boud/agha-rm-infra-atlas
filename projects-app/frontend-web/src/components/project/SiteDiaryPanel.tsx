import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Plus, X, Save, Calendar, Cloud, Sun, CloudRain, Wind,
  Thermometer, Users, Truck, HardHat, AlertTriangle, Eye, CheckCircle,
  Pen, Copy, Trash2, ChevronDown, ChevronUp, Info, CloudLightning,
  Snowflake, CloudFog
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import DateInput from '../ui/DateInput';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface DiaryEntry {
  id: string;
  projectId: string;
  entryDate: string;
  entryNumber: number;
  weather: string;
  temperatureMin: number | null;
  temperatureMax: number | null;
  workforceOwn: number;
  workforceSubcontractor: number;
  workforceSupervisors: number;
  equipment: Equipment[];
  activities: Activity[];
  materialsDelivered: Material[];
  incidents: Incident[];
  observations: string | null;
  instructions: string | null;
  visitors: Visitor[];
  photos: any[];
  statut: string;
  signedByConductor: string | null;
  signedBySupervisor: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Equipment {
  name: string;
  quantity: number;
  status: string;
}

interface Activity {
  description: string;
  lot: string;
  progress: number;
  status: string;
}

interface Material {
  designation: string;
  quantity: number;
  unite: string;
  fournisseur: string;
}

interface Incident {
  type: string;
  severity: string;
  description: string;
  actions: string;
}

interface Visitor {
  name: string;
  role: string;
  arrival: string;
  departure: string;
}

interface DiaryStats {
  general: {
    totalEntries: number;
    validated: number;
    signed: number;
    drafts: number;
    firstEntry: string | null;
    lastEntry: string | null;
  };
  workforce: {
    totalOwn: number;
    totalSub: number;
    totalSupervisors: number;
    avgDailyTotal: number;
    maxDailyTotal: number;
  };
  weatherDistribution: { weather: string; count: number }[];
  incidents: {
    entriesWithIncidents: number;
    totalIncidents: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const WEATHER_OPTIONS = [
  { value: 'ensoleille', label: 'Ensoleillé', icon: Sun, color: 'text-yellow-500', emoji: '☀️' },
  { value: 'nuageux', label: 'Nuageux', icon: Cloud, color: 'text-gray-500', emoji: '☁️' },
  { value: 'pluvieux', label: 'Pluvieux', icon: CloudRain, color: 'text-blue-500', emoji: '🌧️' },
  { value: 'venteux', label: 'Venteux', icon: Wind, color: 'text-teal-500', emoji: '💨' },
  { value: 'orageux', label: 'Orageux', icon: CloudLightning, color: 'text-purple-500', emoji: '⛈️' },
  { value: 'brumeux', label: 'Brumeux', icon: CloudFog, color: 'text-gray-400', emoji: '🌫️' },
  { value: 'chaud', label: 'Très chaud', icon: Thermometer, color: 'text-red-500', emoji: '🔥' },
  { value: 'froid', label: 'Froid', icon: Snowflake, color: 'text-cyan-500', emoji: '❄️' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  brouillon: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Brouillon' },
  valide: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Validé' },
  signe: { bg: 'bg-green-100', text: 'text-green-700', label: 'Signé' },
  archive: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Archivé' },
};

const EQUIPMENT_STATUS = [
  { value: 'en_service', label: 'En service' },
  { value: 'en_panne', label: 'En panne' },
  { value: 'en_attente', label: 'En attente' },
];

const ACTIVITY_STATUS = [
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine', label: 'Terminé' },
  { value: 'suspendu', label: 'Suspendu' },
  { value: 'non_commence', label: 'Non commencé' },
];

const INCIDENT_TYPES = [
  { value: 'accident', label: 'Accident' },
  { value: 'panne', label: 'Panne matériel' },
  { value: 'intemperie', label: 'Intempérie' },
  { value: 'retard', label: 'Retard livraison' },
  { value: 'qualite', label: 'Non-conformité' },
  { value: 'autre', label: 'Autre' },
];

const INCIDENT_SEVERITY = [
  { value: 'mineur', label: 'Mineur', color: 'text-yellow-600' },
  { value: 'moyen', label: 'Moyen', color: 'text-orange-600' },
  { value: 'grave', label: 'Grave', color: 'text-red-600' },
];

const LOT_OPTIONS = [
  'Gros œuvre', 'Terrassement', 'Fondations', 'Maçonnerie', 'Béton armé',
  'Charpente', 'Étanchéité', 'Plomberie', 'Électricité', 'Menuiserie',
  'Peinture', 'Revêtement', 'VRD', 'Assainissement', 'Aménagement extérieur',
  'Autre'
];

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════
const formatDate = (date: string | null): string => {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleDateString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch { return date; }
};

const formatDateShort = (date: string | null): string => {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  } catch { return date; }
};

const getWeatherInfo = (weather: string) => {
  return WEATHER_OPTIONS.find(w => w.value === weather) || WEATHER_OPTIONS[0];
};

// ═══════════════════════════════════════════════════════════════
// StatusBadge Component
// ═══════════════════════════════════════════════════════════════
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = STATUS_COLORS[status] || STATUS_COLORS.brouillon;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
interface SiteDiaryPanelProps {
  projectId: string;
}

const SiteDiaryPanel: React.FC<SiteDiaryPanelProps> = ({ projectId }) => {
  // ─── State ───
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeView, setActiveView] = useState<'list' | 'stats'>('list');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ─── Form State ───
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().slice(0, 10),
    weather: 'ensoleille',
    temperatureMin: '' as string | number,
    temperatureMax: '' as string | number,
    workforceOwn: 0,
    workforceSubcontractor: 0,
    workforceSupervisors: 0,
    equipment: [] as Equipment[],
    activities: [] as Activity[],
    materialsDelivered: [] as Material[],
    incidents: [] as Incident[],
    observations: '',
    instructions: '',
    visitors: [] as Visitor[],
  });

  // ─── Fetch ───
  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiService.getDiaryEntries(projectId);
      if (res.success) {
        setEntries(res.data || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiService.getDiaryStats(projectId);
      if (res.success) {
        setStats(res.data);
      }
    } catch (err: any) {
      console.error('Stats error:', err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEntries();
    fetchStats();
  }, [fetchEntries, fetchStats]);

  // ─── Show success message ───
  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // ─── Reset form ───
  const resetForm = () => {
    setForm({
      entryDate: new Date().toISOString().slice(0, 10),
      weather: 'ensoleille',
      temperatureMin: '',
      temperatureMax: '',
      workforceOwn: 0,
      workforceSubcontractor: 0,
      workforceSupervisors: 0,
      equipment: [],
      activities: [],
      materialsDelivered: [],
      incidents: [],
      observations: '',
      instructions: '',
      visitors: [],
    });
    setEditingEntry(null);
    setShowForm(false);
  };

  // ─── Edit entry ───
  const startEdit = (entry: DiaryEntry) => {
    setForm({
      entryDate: entry.entryDate?.slice(0, 10) || '',
      weather: entry.weather || 'ensoleille',
      temperatureMin: entry.temperatureMin ?? '',
      temperatureMax: entry.temperatureMax ?? '',
      workforceOwn: entry.workforceOwn || 0,
      workforceSubcontractor: entry.workforceSubcontractor || 0,
      workforceSupervisors: entry.workforceSupervisors || 0,
      equipment: entry.equipment || [],
      activities: entry.activities || [],
      materialsDelivered: entry.materialsDelivered || [],
      incidents: entry.incidents || [],
      observations: entry.observations || '',
      instructions: entry.instructions || '',
      visitors: entry.visitors || [],
    });
    setEditingEntry(entry);
    setShowForm(true);
  };

  // ─── Submit ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload = {
        ...form,
        projectId,
        temperatureMin: form.temperatureMin !== '' ? Number(form.temperatureMin) : null,
        temperatureMax: form.temperatureMax !== '' ? Number(form.temperatureMax) : null,
      };

      if (editingEntry) {
        await apiService.updateDiaryEntry(editingEntry.id, payload);
        showSuccess('Entrée mise à jour');
      } else {
        await apiService.createDiaryEntry(payload);
        showSuccess('Entrée créée');
      }

      resetForm();
      fetchEntries();
      fetchStats();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de sauvegarde');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Actions ───
  const handleValidate = async (id: string) => {
    try {
      await apiService.validateDiaryEntry(id);
      showSuccess('Entrée validée');
      fetchEntries();
      fetchStats();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de validation');
    }
  };

  const handleSign = async (id: string) => {
    try {
      await apiService.signDiaryEntry(id, {});
      showSuccess('Entrée signée');
      fetchEntries();
      fetchStats();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de signature');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await apiService.duplicateDiaryEntry(id, {
        targetDate: new Date().toISOString().slice(0, 10)
      });
      showSuccess('Entrée dupliquée pour aujourd\'hui');
      fetchEntries();
      fetchStats();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de duplication');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Supprimer cette entrée ?')) return;
    try {
      await apiService.deleteDiaryEntry(id);
      showSuccess('Entrée supprimée');
      fetchEntries();
      fetchStats();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur de suppression');
    }
  };

  // ─── Array field helpers ───
  const addEquipment = () => setForm(f => ({
    ...f, equipment: [...f.equipment, { name: '', quantity: 1, status: 'en_service' }]
  }));

  const removeEquipment = (i: number) => setForm(f => ({
    ...f, equipment: f.equipment.filter((_, idx) => idx !== i)
  }));

  const updateEquipment = (i: number, field: keyof Equipment, value: any) => setForm(f => ({
    ...f, equipment: f.equipment.map((eq, idx) => idx === i ? { ...eq, [field]: value } : eq)
  }));

  const addActivity = () => setForm(f => ({
    ...f, activities: [...f.activities, { description: '', lot: 'Gros œuvre', progress: 0, status: 'en_cours' }]
  }));

  const removeActivity = (i: number) => setForm(f => ({
    ...f, activities: f.activities.filter((_, idx) => idx !== i)
  }));

  const updateActivity = (i: number, field: keyof Activity, value: any) => setForm(f => ({
    ...f, activities: f.activities.map((a, idx) => idx === i ? { ...a, [field]: value } : a)
  }));

  const addMaterial = () => setForm(f => ({
    ...f, materialsDelivered: [...f.materialsDelivered, { designation: '', quantity: 0, unite: 'tonnes', fournisseur: '' }]
  }));

  const removeMaterial = (i: number) => setForm(f => ({
    ...f, materialsDelivered: f.materialsDelivered.filter((_, idx) => idx !== i)
  }));

  const updateMaterial = (i: number, field: keyof Material, value: any) => setForm(f => ({
    ...f, materialsDelivered: f.materialsDelivered.map((m, idx) => idx === i ? { ...m, [field]: value } : m)
  }));

  const addIncident = () => setForm(f => ({
    ...f, incidents: [...f.incidents, { type: 'autre', severity: 'mineur', description: '', actions: '' }]
  }));

  const removeIncident = (i: number) => setForm(f => ({
    ...f, incidents: f.incidents.filter((_, idx) => idx !== i)
  }));

  const updateIncident = (i: number, field: keyof Incident, value: any) => setForm(f => ({
    ...f, incidents: f.incidents.map((inc, idx) => idx === i ? { ...inc, [field]: value } : inc)
  }));

  const addVisitor = () => setForm(f => ({
    ...f, visitors: [...f.visitors, { name: '', role: '', arrival: '', departure: '' }]
  }));

  const removeVisitor = (i: number) => setForm(f => ({
    ...f, visitors: f.visitors.filter((_, idx) => idx !== i)
  }));

  const updateVisitor = (i: number, field: keyof Visitor, value: any) => setForm(f => ({
    ...f, visitors: f.visitors.map((v, idx) => idx === i ? { ...v, [field]: value } : v)
  }));

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Success message */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 animate-fadeIn">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <span className="text-sm text-green-700">{successMessage}</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <BookOpen className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Journal de Chantier</h2>
            <p className="text-sm text-gray-500">
              {entries.length} entrée{entries.length !== 1 ? 's' : ''}
              {stats?.general && ` · ${stats.general.validated} validée${Number(stats.general.validated) !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setActiveView('list')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeView === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Journal
            </button>
            <button
              onClick={() => setActiveView('stats')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeView === 'stats' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Statistiques
            </button>
          </div>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nouvelle entrée
            </button>
          )}
        </div>
      </div>

      {/* ═══ FORM ═══ */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">
              {editingEntry ? `Modifier l'entrée #${editingEntry.entryNumber}` : 'Nouvelle entrée'}
            </h3>
            <button type="button" onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-5">

            {/* Date & Weather row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="w-4 h-4 inline mr-1" />Date
                </label>
                <DateInput
                  value={form.entryDate}
                  onChange={(val) => setForm(f => ({ ...f, entryDate: val }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Météo</label>
                <div className="grid grid-cols-4 gap-1">
                  {WEATHER_OPTIONS.map(w => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, weather: w.value }))}
                      className={`p-1.5 rounded-lg text-xs text-center transition-all ${
                        form.weather === w.value
                          ? 'bg-indigo-100 border-2 border-indigo-400 font-medium'
                          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                      }`}
                      title={w.label}
                    >
                      <span className="text-lg">{w.emoji}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">T° Min</label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.temperatureMin}
                    onChange={e => setForm(f => ({ ...f, temperatureMin: e.target.value }))}
                    placeholder="°C"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">T° Max</label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.temperatureMax}
                    onChange={e => setForm(f => ({ ...f, temperatureMax: e.target.value }))}
                    placeholder="°C"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Workforce */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-indigo-500" /> Effectifs du jour
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Ouvriers propres</label>
                  <input
                    type="number" min="0"
                    value={form.workforceOwn}
                    onChange={e => setForm(f => ({ ...f, workforceOwn: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Sous-traitants</label>
                  <input
                    type="number" min="0"
                    value={form.workforceSubcontractor}
                    onChange={e => setForm(f => ({ ...f, workforceSubcontractor: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Encadrement</label>
                  <input
                    type="number" min="0"
                    value={form.workforceSupervisors}
                    onChange={e => setForm(f => ({ ...f, workforceSupervisors: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Total: {form.workforceOwn + form.workforceSubcontractor + form.workforceSupervisors} personnes
              </p>
            </div>

            {/* Activities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <HardHat className="w-4 h-4 text-indigo-500" /> Activités du jour
                </h4>
                <button type="button" onClick={addActivity}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
              {form.activities.map((act, i) => (
                <div key={i} className="flex gap-2 mb-2 items-start">
                  <input
                    value={act.description}
                    onChange={e => updateActivity(i, 'description', e.target.value)}
                    placeholder="Description de l'activité"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <select
                    value={act.lot}
                    onChange={e => updateActivity(i, 'lot', e.target.value)}
                    className="w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  >
                    {LOT_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <input
                    type="number" min="0" max="100"
                    value={act.progress}
                    onChange={e => updateActivity(i, 'progress', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center"
                    title="Avancement %"
                  />
                  <select
                    value={act.status}
                    onChange={e => updateActivity(i, 'status', e.target.value)}
                    className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  >
                    {ACTIVITY_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeActivity(i)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.activities.length === 0 && (
                <p className="text-xs text-gray-400 italic">Aucune activité — cliquez sur Ajouter</p>
              )}
            </div>

            {/* Equipment */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-indigo-500" /> Matériel sur site
                </h4>
                <button type="button" onClick={addEquipment}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
              {form.equipment.map((eq, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input
                    value={eq.name}
                    onChange={e => updateEquipment(i, 'name', e.target.value)}
                    placeholder="Nom du matériel"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="number" min="1"
                    value={eq.quantity}
                    onChange={e => updateEquipment(i, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center"
                    title="Quantité"
                  />
                  <select
                    value={eq.status}
                    onChange={e => updateEquipment(i, 'status', e.target.value)}
                    className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  >
                    {EQUIPMENT_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeEquipment(i)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.equipment.length === 0 && (
                <p className="text-xs text-gray-400 italic">Aucun matériel — cliquez sur Ajouter</p>
              )}
            </div>

            {/* Materials Delivered */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-orange-500" /> Matériaux livrés
                </h4>
                <button type="button" onClick={addMaterial}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
              {form.materialsDelivered.map((mat, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input
                    value={mat.designation}
                    onChange={e => updateMaterial(i, 'designation', e.target.value)}
                    placeholder="Désignation"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="number" min="0" step="0.01"
                    value={mat.quantity}
                    onChange={e => updateMaterial(i, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center"
                    placeholder="Qté"
                  />
                  <input
                    value={mat.unite}
                    onChange={e => updateMaterial(i, 'unite', e.target.value)}
                    placeholder="Unité"
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    value={mat.fournisseur}
                    onChange={e => updateMaterial(i, 'fournisseur', e.target.value)}
                    placeholder="Fournisseur"
                    className="w-32 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <button type="button" onClick={() => removeMaterial(i)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.materialsDelivered.length === 0 && (
                <p className="text-xs text-gray-400 italic">Aucune livraison</p>
              )}
            </div>

            {/* Incidents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-500" /> Incidents
                </h4>
                <button type="button" onClick={addIncident}
                  className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Signaler
                </button>
              </div>
              {form.incidents.map((inc, i) => (
                <div key={i} className="border border-red-100 bg-red-50/30 rounded-lg p-3 mb-2">
                  <div className="flex gap-2 mb-2">
                    <select
                      value={inc.type}
                      onChange={e => updateIncident(i, 'type', e.target.value)}
                      className="w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    >
                      {INCIDENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <select
                      value={inc.severity}
                      onChange={e => updateIncident(i, 'severity', e.target.value)}
                      className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    >
                      {INCIDENT_SEVERITY.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <button type="button" onClick={() => removeIncident(i)}
                      className="ml-auto p-1.5 text-red-400 hover:text-red-600 rounded">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    value={inc.description}
                    onChange={e => updateIncident(i, 'description', e.target.value)}
                    placeholder="Description de l'incident"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm mb-2"
                  />
                  <input
                    value={inc.actions}
                    onChange={e => updateIncident(i, 'actions', e.target.value)}
                    placeholder="Actions correctives prises"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              ))}
              {form.incidents.length === 0 && (
                <p className="text-xs text-gray-400 italic">Aucun incident — cliquez sur Signaler si nécessaire</p>
              )}
            </div>

            {/* Visitors */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-indigo-500" /> Visiteurs
                </h4>
                <button type="button" onClick={addVisitor}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
              {form.visitors.map((v, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input
                    value={v.name}
                    onChange={e => updateVisitor(i, 'name', e.target.value)}
                    placeholder="Nom"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    value={v.role}
                    onChange={e => updateVisitor(i, 'role', e.target.value)}
                    placeholder="Fonction"
                    className="w-36 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="time"
                    value={v.arrival}
                    onChange={e => updateVisitor(i, 'arrival', e.target.value)}
                    className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    title="Arrivée"
                  />
                  <input
                    type="time"
                    value={v.departure}
                    onChange={e => updateVisitor(i, 'departure', e.target.value)}
                    className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    title="Départ"
                  />
                  <button type="button" onClick={() => removeVisitor(i)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.visitors.length === 0 && (
                <p className="text-xs text-gray-400 italic">Aucun visiteur</p>
              )}
            </div>

            {/* Observations & Instructions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
                <textarea
                  value={form.observations}
                  onChange={e => setForm(f => ({ ...f, observations: e.target.value }))}
                  rows={3}
                  placeholder="Observations générales sur le chantier..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                <textarea
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  rows={3}
                  placeholder="Instructions pour le lendemain..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Form actions */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
            <button type="button" onClick={resetForm}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50">
              Annuler
            </button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
              <Save className="w-4 h-4" />
              {submitting ? 'Enregistrement...' : editingEntry ? 'Mettre à jour' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}

      {/* ═══ STATS VIEW ═══ */}
      {activeView === 'stats' && stats && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{stats.general.totalEntries}</p>
              <p className="text-xs text-gray-500 mt-1">Total entrées</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{stats.general.signed}</p>
              <p className="text-xs text-gray-500 mt-1">Signées</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.workforce.avgDailyTotal || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Moy. effectif/jour</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{stats.incidents.totalIncidents || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Incidents signalés</p>
            </div>
          </div>

          {/* Workforce breakdown */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-500" /> Effectifs cumulés
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-indigo-50 rounded-lg">
                <p className="text-lg font-bold text-indigo-700">{stats.workforce.totalOwn || 0}</p>
                <p className="text-xs text-indigo-600">Jours ouvriers propres</p>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <p className="text-lg font-bold text-purple-700">{stats.workforce.totalSub || 0}</p>
                <p className="text-xs text-purple-600">Jours sous-traitants</p>
              </div>
              <div className="text-center p-3 bg-cyan-50 rounded-lg">
                <p className="text-lg font-bold text-cyan-700">{stats.workforce.totalSupervisors || 0}</p>
                <p className="text-xs text-cyan-600">Jours encadrement</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Maximum journalier: {stats.workforce.maxDailyTotal || 0} personnes
            </p>
          </div>

          {/* Weather distribution */}
          {stats.weatherDistribution.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Distribution météo</h3>
              <div className="flex flex-wrap gap-2">
                {stats.weatherDistribution.map(w => {
                  const info = getWeatherInfo(w.weather);
                  return (
                    <div key={w.weather} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-full text-sm">
                      <span>{info.emoji}</span>
                      <span className="text-gray-700">{info.label}</span>
                      <span className="font-bold text-gray-900">{w.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Date range */}
          {stats.general.firstEntry && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-700">
              <strong>Période couverte :</strong> du {formatDateShort(stats.general.firstEntry)} au {formatDateShort(stats.general.lastEntry)}
            </div>
          )}
        </div>
      )}

      {/* ═══ LIST VIEW ═══ */}
      {activeView === 'list' && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-sm text-gray-500 mt-3">Chargement...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-600 mb-1">Aucune entrée de journal</h3>
              <p className="text-sm text-gray-400 mb-4">Commencez à documenter votre chantier quotidiennement</p>
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Créer la première entrée
              </button>
            </div>
          ) : (
            entries.map(entry => {
              const weather = getWeatherInfo(entry.weather);
              const isExpanded = expandedEntry === entry.id;
              const totalWorkforce = (entry.workforceOwn || 0) + (entry.workforceSubcontractor || 0) + (entry.workforceSupervisors || 0);
              const activitiesArr = entry.activities || [];
              const incidentsArr = entry.incidents || [];
              const equipmentArr = entry.equipment || [];
              const materialsArr = entry.materialsDelivered || [];
              const visitorsArr = entry.visitors || [];

              return (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  {/* Entry header */}
                  <div
                    className="px-5 py-3 flex items-center gap-3 cursor-pointer"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  >
                    <div className="flex-shrink-0 w-12 h-12 bg-indigo-50 rounded-xl flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-indigo-600">#{entry.entryNumber}</span>
                      <span className="text-lg">{weather.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{formatDate(entry.entryDate)}</h4>
                        <StatusBadge status={entry.statut} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> {totalWorkforce} pers.
                        </span>
                        <span className="flex items-center gap-1">
                          <HardHat className="w-3.5 h-3.5" /> {activitiesArr.length} activité{activitiesArr.length !== 1 ? 's' : ''}
                        </span>
                        {incidentsArr.length > 0 && (
                          <span className="flex items-center gap-1 text-red-500">
                            <AlertTriangle className="w-3.5 h-3.5" /> {incidentsArr.length} incident{incidentsArr.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.temperatureMin != null && entry.temperatureMax != null && (
                          <span className="flex items-center gap-1">
                            <Thermometer className="w-3.5 h-3.5" /> {entry.temperatureMin}° — {entry.temperatureMax}°C
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {entry.statut === 'brouillon' && (
                        <>
                          <button onClick={e => { e.stopPropagation(); startEdit(entry); }}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Modifier">
                            <Pen className="w-4 h-4" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleValidate(entry.id); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Valider">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {(entry.statut === 'brouillon' || entry.statut === 'valide') && (
                        <button onClick={e => { e.stopPropagation(); handleSign(entry.id); }}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Signer">
                          <Pen className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); handleDuplicate(entry.id); }}
                        className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg" title="Dupliquer">
                        <Copy className="w-4 h-4" />
                      </button>
                      {entry.statut !== 'signe' && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                      {/* Workforce breakdown */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-indigo-50 rounded-lg p-2 text-center">
                          <p className="text-sm font-bold text-indigo-700">{entry.workforceOwn || 0}</p>
                          <p className="text-xs text-indigo-600">Propres</p>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-2 text-center">
                          <p className="text-sm font-bold text-purple-700">{entry.workforceSubcontractor || 0}</p>
                          <p className="text-xs text-purple-600">Sous-traitants</p>
                        </div>
                        <div className="bg-cyan-50 rounded-lg p-2 text-center">
                          <p className="text-sm font-bold text-cyan-700">{entry.workforceSupervisors || 0}</p>
                          <p className="text-xs text-cyan-600">Encadrement</p>
                        </div>
                      </div>

                      {/* Activities */}
                      {activitiesArr.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">Activités</h5>
                          <div className="space-y-1">
                            {activitiesArr.map((act: Activity, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm">
                                <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                                <span className="flex-1 text-gray-700">{act.description}</span>
                                <span className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-500">{act.lot}</span>
                                <div className="w-24 bg-gray-200 rounded-full h-2">
                                  <div className="bg-indigo-500 rounded-full h-2" style={{ width: `${act.progress}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 w-8 text-right">{act.progress}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Equipment */}
                      {equipmentArr.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">Matériel</h5>
                          <div className="flex flex-wrap gap-2">
                            {equipmentArr.map((eq: Equipment, i: number) => (
                              <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                eq.status === 'en_service' ? 'bg-green-100 text-green-700' :
                                eq.status === 'en_panne' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                                {eq.name} × {eq.quantity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Materials */}
                      {materialsArr.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">Matériaux livrés</h5>
                          <div className="space-y-1">
                            {materialsArr.map((mat: Material, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                                <Truck className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                                <span className="font-medium">{mat.designation}</span>
                                <span className="text-gray-400">—</span>
                                <span>{mat.quantity} {mat.unite}</span>
                                {mat.fournisseur && <span className="text-xs text-gray-400">({mat.fournisseur})</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Incidents */}
                      {incidentsArr.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold text-red-600 mb-2">Incidents</h5>
                          {incidentsArr.map((inc: Incident, i: number) => (
                            <div key={i} className="border border-red-100 bg-red-50/50 rounded-lg p-3 mb-1.5">
                              <div className="flex items-center gap-2 mb-1">
                                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                <span className="text-sm font-medium text-red-700">
                                  {INCIDENT_TYPES.find(t => t.value === inc.type)?.label || inc.type}
                                </span>
                                <span className={`text-xs font-medium ${
                                  INCIDENT_SEVERITY.find(s => s.value === inc.severity)?.color || 'text-gray-500'
                                }`}>
                                  [{INCIDENT_SEVERITY.find(s => s.value === inc.severity)?.label || inc.severity}]
                                </span>
                              </div>
                              <p className="text-sm text-gray-700">{inc.description}</p>
                              {inc.actions && (
                                <p className="text-xs text-gray-500 mt-1 italic">Actions: {inc.actions}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Visitors */}
                      {visitorsArr.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">Visiteurs</h5>
                          <div className="space-y-1">
                            {visitorsArr.map((v: Visitor, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                                <Eye className="w-3.5 h-3.5 text-gray-400" />
                                <span className="font-medium">{v.name}</span>
                                <span className="text-xs text-gray-400">({v.role})</span>
                                {v.arrival && <span className="text-xs text-gray-400">{v.arrival} — {v.departure || '?'}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Observations & Instructions */}
                      {(entry.observations || entry.instructions) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {entry.observations && (
                            <div className="bg-gray-50 rounded-lg p-3">
                              <h5 className="text-xs font-semibold text-gray-500 mb-1 uppercase">Observations</h5>
                              <p className="text-sm text-gray-700 whitespace-pre-line">{entry.observations}</p>
                            </div>
                          )}
                          {entry.instructions && (
                            <div className="bg-indigo-50 rounded-lg p-3">
                              <h5 className="text-xs font-semibold text-indigo-500 mb-1 uppercase">Instructions</h5>
                              <p className="text-sm text-indigo-700 whitespace-pre-line">{entry.instructions}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Signature info */}
                      {entry.signedByConductor && (
                        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg p-2">
                          <Pen className="w-3.5 h-3.5" />
                          <span>Signé par: {entry.signedByConductor}</span>
                          {entry.signedAt && <span className="text-green-500">le {formatDateShort(entry.signedAt)}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <p className="font-medium mb-1">Journal de chantier — Obligation réglementaire</p>
          <p>
            Le journal de chantier est un document obligatoire selon le CCAG-T marocain (art. 31).
            Il consigne quotidiennement les événements du chantier: effectifs, météo, activités,
            livraisons, incidents et visites. Chaque entrée doit être validée et signée par le
            chef de chantier et le directeur des travaux.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SiteDiaryPanel;
