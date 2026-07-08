import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSignature, Plus, X, Save, Send, Bell, CheckCircle, XCircle,
  Play, Clock, ChevronDown, ChevronUp, Info, Edit2, Trash2,
  Link2, AlertTriangle, DollarSign, Calendar, Lock
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import DateInput from '../ui/DateInput';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface ODS {
  id: string;
  projectId: string;
  numero: number;
  reference: string;
  type: string;
  objet: string;
  description: string | null;
  motif: string | null;
  dateEmission: string;
  dateEffet: string | null;
  dateFin: string | null;
  delaiJours: number | null;
  impactFinancier: number;
  impactDelai: number;
  emetteur: string | null;
  destinataire: string | null;
  emetteurFonction: string | null;
  avenantId: string | null;
  avenantNumero: number | null;
  avenantObjet: string | null;
  odsParentId: string | null;
  piecesJointes: any[];
  statut: string;
  dateNotification: string | null;
  dateAccuseReception: string | null;
  accusePar: string | null;
  observationsDestinataire: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ODSStats {
  total: string;
  brouillons: string;
  emis: string;
  enCours: string;
  clotures: string;
  annules: string;
  totalImpactFinancier: string;
  totalImpactDelai: string;
  arretsActifs: string;
  commencements: string;
  travauxSup: string;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const ODS_TYPES = [
  { value: 'commencement', label: 'Commencement des travaux', icon: '🚀', color: 'green' },
  { value: 'arret', label: 'Arrêt des travaux', icon: '🛑', color: 'red' },
  { value: 'reprise', label: 'Reprise des travaux', icon: '▶️', color: 'blue' },
  { value: 'modification', label: 'Modification des travaux', icon: '🔄', color: 'orange' },
  { value: 'travaux_supplementaires', label: 'Travaux supplémentaires', icon: '➕', color: 'purple' },
  { value: 'prolongation', label: 'Prolongation de délai', icon: '⏳', color: 'amber' },
  { value: 'reception_provisoire', label: 'Réception provisoire', icon: '📋', color: 'teal' },
  { value: 'reception_definitive', label: 'Réception définitive', icon: '✅', color: 'emerald' },
  { value: 'mise_en_demeure', label: 'Mise en demeure', icon: '⚠️', color: 'rose' },
  { value: 'autre', label: 'Autre', icon: '📄', color: 'gray' },
];

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  brouillon: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Brouillon', icon: <Edit2 className="w-3 h-3" /> },
  emis: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Émis', icon: <Send className="w-3 h-3" /> },
  notifie: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Notifié', icon: <Bell className="w-3 h-3" /> },
  accuse: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Accusé', icon: <CheckCircle className="w-3 h-3" /> },
  execute: { bg: 'bg-green-100', text: 'text-green-700', label: 'Exécuté', icon: <Play className="w-3 h-3" /> },
  cloture: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Clôturé', icon: <Lock className="w-3 h-3" /> },
  annule: { bg: 'bg-red-100', text: 'text-red-700', label: 'Annulé', icon: <XCircle className="w-3 h-3" /> },
};

const formatDate = (d: string | null): string => {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
};
const formatDH = (v: number | string | null): string => {
  const n = Number(v || 0);
  if (n === 0) return '-';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.brouillon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const t = ODS_TYPES.find(o => o.value === type) || ODS_TYPES[ODS_TYPES.length - 1];
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span>{t.icon}</span> <span className="font-medium">{t.label}</span>
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
interface ODSPanelProps {
  projectId: string;
}

const ODSPanel: React.FC<ODSPanelProps> = ({ projectId }) => {
  const [odsList, setOdsList] = useState<ODS[]>([]);
  const [stats, setStats] = useState<ODSStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOds, setEditingOds] = useState<ODS | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Form state
  const [form, setForm] = useState({
    type: 'commencement',
    objet: '',
    description: '',
    motif: '',
    dateEmission: new Date().toISOString().slice(0, 10),
    dateEffet: '',
    dateFin: '',
    delaiJours: '',
    impactFinancier: '',
    impactDelai: '',
    emetteur: '',
    destinataire: '',
    emetteurFonction: '',
  });

  const resetForm = () => {
    setForm({
      type: 'commencement', objet: '', description: '', motif: '',
      dateEmission: new Date().toISOString().slice(0, 10),
      dateEffet: '', dateFin: '', delaiJours: '',
      impactFinancier: '', impactDelai: '',
      emetteur: '', destinataire: '', emetteurFonction: '',
    });
    setEditingOds(null);
  };

  const fetchODS = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiService.getODSByProject(projectId);
      if (response.success) {
        setOdsList(response.data || []);
        setStats(response.stats || null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchODS(); }, [fetchODS]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.objet.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        projectId,
        type: form.type,
        objet: form.objet,
        description: form.description || null,
        motif: form.motif || null,
        dateEmission: form.dateEmission || null,
        dateEffet: form.dateEffet || null,
        dateFin: form.dateFin || null,
        delaiJours: form.delaiJours ? parseInt(form.delaiJours) : null,
        impactFinancier: form.impactFinancier ? parseFloat(form.impactFinancier) : 0,
        impactDelai: form.impactDelai ? parseInt(form.impactDelai) : 0,
        emetteur: form.emetteur || null,
        destinataire: form.destinataire || null,
        emetteurFonction: form.emetteurFonction || null,
      };

      if (editingOds) {
        await apiService.updateODS(editingOds.id, payload);
      } else {
        await apiService.createODS(payload);
      }
      resetForm();
      setShowForm(false);
      fetchODS();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Erreur sauvegarde');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (ods: ODS) => {
    setForm({
      type: ods.type,
      objet: ods.objet,
      description: ods.description || '',
      motif: ods.motif || '',
      dateEmission: ods.dateEmission ? ods.dateEmission.slice(0, 10) : '',
      dateEffet: ods.dateEffet ? ods.dateEffet.slice(0, 10) : '',
      dateFin: ods.dateFin ? ods.dateFin.slice(0, 10) : '',
      delaiJours: ods.delaiJours ? String(ods.delaiJours) : '',
      impactFinancier: ods.impactFinancier ? String(ods.impactFinancier) : '',
      impactDelai: ods.impactDelai ? String(ods.impactDelai) : '',
      emetteur: ods.emetteur || '',
      destinataire: ods.destinataire || '',
      emetteurFonction: ods.emetteurFonction || '',
    });
    setEditingOds(ods);
    setShowForm(true);
  };

  const handleAction = async (odsId: string, action: string) => {
    setActionLoading(`${odsId}-${action}`);
    try {
      switch (action) {
        case 'emit': await apiService.emitODS(odsId); break;
        case 'notify': await apiService.notifyODS(odsId, {}); break;
        case 'acknowledge': await apiService.acknowledgeODS(odsId, {}); break;
        case 'execute': await apiService.executeODS(odsId); break;
        case 'close': await apiService.closeODS(odsId); break;
        case 'cancel': await apiService.cancelODS(odsId, {}); break;
      }
      fetchODS();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || `Erreur action ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (odsId: string) => {
    if (!confirm('Supprimer cet ODS ?')) return;
    try {
      await apiService.deleteODS(odsId);
      fetchODS();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Erreur suppression');
    }
  };

  const getNextActions = (ods: ODS): { action: string; label: string; icon: React.ReactNode; color: string }[] => {
    const actions: { action: string; label: string; icon: React.ReactNode; color: string }[] = [];
    switch (ods.statut) {
      case 'brouillon':
        actions.push({ action: 'emit', label: 'Émettre', icon: <Send className="w-3.5 h-3.5" />, color: 'blue' });
        break;
      case 'emis':
        actions.push({ action: 'notify', label: 'Notifier', icon: <Bell className="w-3.5 h-3.5" />, color: 'indigo' });
        break;
      case 'notifie':
        actions.push({ action: 'acknowledge', label: 'Accusé réception', icon: <CheckCircle className="w-3.5 h-3.5" />, color: 'amber' });
        break;
      case 'accuse':
        actions.push({ action: 'execute', label: 'Marquer exécuté', icon: <Play className="w-3.5 h-3.5" />, color: 'green' });
        break;
    }
    if (!['cloture', 'annule'].includes(ods.statut)) {
      if (['execute', 'accuse', 'notifie', 'emis'].includes(ods.statut)) {
        actions.push({ action: 'close', label: 'Clôturer', icon: <Lock className="w-3.5 h-3.5" />, color: 'emerald' });
      }
      actions.push({ action: 'cancel', label: 'Annuler', icon: <XCircle className="w-3.5 h-3.5" />, color: 'red' });
    }
    return actions;
  };

  // Filter
  const filtered = odsList.filter(o => {
    if (filterType !== 'all' && o.type !== filterType) return false;
    if (filterStatus !== 'all' && o.statut !== filterStatus) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-500">Chargement des ordres de service...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileSignature className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Ordres de Service</h2>
            <p className="text-sm text-gray-500">
              Gestion des ODS — CCAG-T articles 9 et 10
            </p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Fermer' : 'Nouvel ODS'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && parseInt(stats.total) > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-xs text-gray-500">Total ODS</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{parseInt(stats.emis) + parseInt(stats.enCours)}</div>
            <div className="text-xs text-blue-600">En cours</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{stats.clotures}</div>
            <div className="text-xs text-emerald-600">Clôturés</div>
          </div>
          {parseInt(stats.arretsActifs) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.arretsActifs}</div>
              <div className="text-xs text-red-600">Arrêts actifs</div>
            </div>
          )}
          {parseFloat(stats.totalImpactFinancier) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-amber-600">{formatDH(stats.totalImpactFinancier)}</div>
              <div className="text-xs text-amber-600">Impact financier</div>
            </div>
          )}
          {parseInt(stats.totalImpactDelai) > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.totalImpactDelai}</div>
              <div className="text-xs text-purple-600">Jours délai</div>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border-2 border-blue-200 rounded-xl p-6 space-y-4">
          <h3 className="text-md font-semibold text-gray-800">
            {editingOds ? `Modifier ODS N° ${editingOds.numero}` : 'Nouvel Ordre de Service'}
          </h3>

          {/* Row 1: Type + Objet */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type d'ODS *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                {ODS_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Objet *</label>
              <input
                type="text"
                value={form.objet}
                onChange={(e) => setForm({ ...form, objet: e.target.value })}
                required
                placeholder="Objet de l'ordre de service..."
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Row 2: Description + Motif */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Détails de l'ordre de service..."
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
              <textarea
                value={form.motif}
                onChange={(e) => setForm({ ...form, motif: e.target.value })}
                rows={3}
                placeholder="Justification / motif..."
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Row 3: Dates */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date émission</label>
              <DateInput
                value={form.dateEmission}
                onChange={(val) => setForm({ ...form, dateEmission: val })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date d'effet</label>
              <DateInput
                value={form.dateEffet}
                onChange={(val) => setForm({ ...form, dateEffet: val })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin</label>
              <DateInput
                value={form.dateFin}
                onChange={(val) => setForm({ ...form, dateFin: val })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Délai (jours)</label>
              <input
                type="number"
                value={form.delaiJours}
                onChange={(e) => setForm({ ...form, delaiJours: e.target.value })}
                placeholder="0"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Row 4: Financial + Parties */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Impact financier (DH)</label>
              <input
                type="number"
                step="0.01"
                value={form.impactFinancier}
                onChange={(e) => setForm({ ...form, impactFinancier: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Impact délai (jours)</label>
              <input
                type="number"
                value={form.impactDelai}
                onChange={(e) => setForm({ ...form, impactDelai: e.target.value })}
                placeholder="0"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Émetteur</label>
              <input
                type="text"
                value={form.emetteur}
                onChange={(e) => setForm({ ...form, emetteur: e.target.value })}
                placeholder="Nom de l'émetteur"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
              <input
                type="text"
                value={form.destinataire}
                onChange={(e) => setForm({ ...form, destinataire: e.target.value })}
                placeholder="Entreprise / personne"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { resetForm(); setShowForm(false); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border rounded-lg hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || !form.objet.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Enregistrement...' : editingOds ? 'Modifier' : 'Créer l\'ODS'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      {odsList.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          <span className="text-sm text-gray-500 font-medium">Filtrer:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-sm rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">Tous les types</option>
            {ODS_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {(filterType !== 'all' || filterStatus !== 'all') && (
            <button
              onClick={() => { setFilterType('all'); setFilterStatus('all'); }}
              className="text-xs text-blue-600 hover:underline"
            >
              Réinitialiser
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} ODS</span>
        </div>
      )}

      {/* ODS List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          <FileSignature className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Aucun ordre de service</p>
          <p className="text-sm text-gray-400 mt-1">
            {odsList.length > 0 ? 'Modifiez les filtres' : 'Cliquez sur "Nouvel ODS" pour commencer'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ods) => {
            const isExpanded = expandedId === ods.id;
            const typeInfo = ODS_TYPES.find(t => t.value === ods.type) || ODS_TYPES[ODS_TYPES.length - 1];
            const nextActions = getNextActions(ods);

            return (
              <div
                key={ods.id}
                className={`bg-white border rounded-xl overflow-hidden transition-all ${
                  isExpanded ? 'border-blue-300 shadow-md' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Card Header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : ods.id)}
                >
                  {/* Type icon circle */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg bg-${typeInfo.color}-100 flex-shrink-0`}>
                    {typeInfo.icon}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">ODS N° {ods.numero}</span>
                      <span className="text-xs text-gray-400">{ods.reference}</span>
                      <StatusBadge status={ods.statut} />
                    </div>
                    <p className="text-sm text-gray-600 truncate">{ods.objet}</p>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {formatDate(ods.dateEmission)}
                      </span>
                      <TypeBadge type={ods.type} />
                      {Number(ods.impactFinancier) > 0 && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <DollarSign className="w-3 h-3" /> {formatDH(ods.impactFinancier)}
                        </span>
                      )}
                      {Number(ods.impactDelai) > 0 && (
                        <span className="flex items-center gap-1 text-purple-600">
                          <Clock className="w-3 h-3" /> +{ods.impactDelai}j
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expand toggle */}
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-4 bg-gray-50/50">
                    {/* Details grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      {ods.description && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-xs">Description</span>
                          <p className="text-gray-800">{ods.description}</p>
                        </div>
                      )}
                      {ods.motif && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-xs">Motif</span>
                          <p className="text-gray-800">{ods.motif}</p>
                        </div>
                      )}
                      {ods.emetteur && (
                        <div>
                          <span className="text-gray-500 text-xs">Émetteur</span>
                          <p className="text-gray-800 font-medium">{ods.emetteur}</p>
                          {ods.emetteurFonction && <p className="text-xs text-gray-500">{ods.emetteurFonction}</p>}
                        </div>
                      )}
                      {ods.destinataire && (
                        <div>
                          <span className="text-gray-500 text-xs">Destinataire</span>
                          <p className="text-gray-800 font-medium">{ods.destinataire}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500 text-xs">Date d'effet</span>
                        <p className="text-gray-800">{formatDate(ods.dateEffet)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Date de fin</span>
                        <p className="text-gray-800">{formatDate(ods.dateFin)}</p>
                      </div>
                      {ods.delaiJours && (
                        <div>
                          <span className="text-gray-500 text-xs">Délai</span>
                          <p className="text-gray-800">{ods.delaiJours} jours</p>
                        </div>
                      )}
                      {ods.dateNotification && (
                        <div>
                          <span className="text-gray-500 text-xs">Date notification</span>
                          <p className="text-gray-800">{formatDate(ods.dateNotification)}</p>
                        </div>
                      )}
                      {ods.dateAccuseReception && (
                        <div>
                          <span className="text-gray-500 text-xs">Accusé réception</span>
                          <p className="text-gray-800">{formatDate(ods.dateAccuseReception)}</p>
                          {ods.accusePar && <p className="text-xs text-gray-500">Par: {ods.accusePar}</p>}
                        </div>
                      )}
                      {ods.observationsDestinataire && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-xs">Observations destinataire</span>
                          <p className="text-gray-800">{ods.observationsDestinataire}</p>
                        </div>
                      )}
                      {ods.avenantNumero && (
                        <div>
                          <span className="text-gray-500 text-xs">Avenant lié</span>
                          <p className="text-gray-800 flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> Avenant N° {ods.avenantNumero}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Workflow progress */}
                    <div className="bg-white rounded-lg p-3 border">
                      <p className="text-xs font-medium text-gray-500 mb-2">Workflow ODS</p>
                      <div className="flex items-center gap-1 text-xs">
                        {['brouillon', 'emis', 'notifie', 'accuse', 'execute', 'cloture'].map((step, i) => {
                          const statuses = ['brouillon', 'emis', 'notifie', 'accuse', 'execute', 'cloture'];
                          const currentIdx = statuses.indexOf(ods.statut);
                          const isActive = i <= currentIdx && ods.statut !== 'annule';
                          const isCurrent = step === ods.statut;
                          const cfg = STATUS_CONFIG[step];
                          return (
                            <React.Fragment key={step}>
                              {i > 0 && (
                                <div className={`flex-1 h-0.5 ${isActive ? 'bg-blue-400' : 'bg-gray-200'}`} />
                              )}
                              <div
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isCurrent ? 'bg-blue-600 text-white ring-2 ring-blue-300' :
                                  isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                                }`}
                                title={cfg.label}
                              >
                                {i + 1}
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
                        <span>Brouillon</span>
                        <span>Émis</span>
                        <span>Notifié</span>
                        <span>Accusé</span>
                        <span>Exécuté</span>
                        <span>Clôturé</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      {nextActions.map(({ action, label, icon, color }) => (
                        <button
                          key={action}
                          onClick={(e) => { e.stopPropagation(); handleAction(ods.id, action); }}
                          disabled={actionLoading === `${ods.id}-${action}`}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                            ${action === 'cancel' ? 'border-red-200 text-red-600 hover:bg-red-50' :
                              `border-${color}-200 text-${color}-600 hover:bg-${color}-50`}`}
                        >
                          {actionLoading === `${ods.id}-${action}` ? (
                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current"></div>
                          ) : icon}
                          {label}
                        </button>
                      ))}

                      {ods.statut === 'brouillon' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(ods); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            <Edit2 className="w-3.5 h-3.5" /> Modifier
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(ods.id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <p className="font-medium mb-1">Ordres de Service — Réglementation marocaine</p>
          <p>
            Selon le CCAG-T (articles 9 et 10), les ordres de service sont des instructions
            écrites émanant du maître d'ouvrage ou de son représentant. Ils ont un caractère
            obligatoire et doivent être notifiés par écrit à l'entrepreneur. Le suivi de leur
            exécution passe par les étapes: émission → notification → accusé de réception →
            exécution → clôture.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ODSPanel;
