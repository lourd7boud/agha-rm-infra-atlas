import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Shield, Percent, Plus, X, Check,
  DollarSign, Calendar, Building2, FileText, RefreshCw,
  AlertCircle, Trash2,
  Ban, CheckCircle, XCircle, Info
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { Penalty, Bond, Retention, FinancialSummary } from '../../db/database';
import DateInput from '../ui/DateInput';

// ═══════════════════════════════════════════════════════════════
// Types & Constants
// ═══════════════════════════════════════════════════════════════

type ActiveTab = 'penalties' | 'bonds' | 'retentions';

const PENALTY_TYPES = [
  { value: 'retard', label: 'Pénalité de retard', icon: '⏰' },
  { value: 'malfacon', label: 'Malfaçon', icon: '🔧' },
  { value: 'non_conformite', label: 'Non-conformité', icon: '⚠️' },
  { value: 'securite', label: 'Sécurité', icon: '🛡️' },
  { value: 'environnement', label: 'Environnement', icon: '🌿' },
  { value: 'autre', label: 'Autre', icon: '📋' },
];

const BOND_TYPES = [
  { value: 'caution_provisoire', label: 'Caution provisoire', icon: '📄' },
  { value: 'caution_definitive', label: 'Caution définitive', icon: '📋' },
  { value: 'retenue_garantie', label: 'Retenue de garantie', icon: '🔒' },
  { value: 'caution_avance', label: "Caution d'avance", icon: '💰' },
  { value: 'caution_bonne_execution', label: 'Caution de bonne exécution', icon: '✅' },
  { value: 'garantie_decennale', label: 'Garantie décennale', icon: '🏗️' },
];

const PENALTY_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  calculee: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Calculée' },
  notifiee: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Notifiée' },
  contestee: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Contestée' },
  appliquee: { bg: 'bg-red-100', text: 'text-red-800', label: 'Appliquée' },
  annulee: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Annulée' },
  remise: { bg: 'bg-green-100', text: 'text-green-800', label: 'Remise' },
};

const BOND_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  en_attente: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'En attente' },
  active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
  expiree: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Expirée' },
  liberee: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Libérée' },
  saisie: { bg: 'bg-red-100', text: 'text-red-800', label: 'Saisie' },
  annulee: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Annulée' },
};

// ═══════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════

const StatusBadge: React.FC<{ status: string; colors: Record<string, { bg: string; text: string; label: string }> }> = ({ status, colors }) => {
  const c = colors[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

const formatDH = (amount: number | null | undefined): string => {
  if (amount == null) return '0,00 DH';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' DH';
};

const formatDate = (date: string | null | undefined): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR');
};

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

interface PenaltiesPanelProps {
  projectId: string;
  montantMarche?: number;
}

const PenaltiesPanel: React.FC<PenaltiesPanelProps> = ({ projectId, montantMarche = 0 }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('penalties');
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [retentions, setRetentions] = useState<Retention[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [showPenaltyForm, setShowPenaltyForm] = useState(false);
  const [showBondForm, setShowBondForm] = useState(false);
  const [showRetentionForm, setShowRetentionForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Penalty form
  const [penaltyForm, setPenaltyForm] = useState({
    type: 'retard',
    dateDebut: '',
    dateFin: '',
    nombreJours: 0,
    taux: 0.001,
    baseCalcul: montantMarche,
    plafondPourcentage: 10,
    motif: '',
    observations: '',
  });

  // Bond form
  const [bondForm, setBondForm] = useState({
    type: 'caution_definitive',
    pourcentage: 3,
    baseCalcul: montantMarche,
    organisme: '',
    referenceOrganisme: '',
    dateEmission: '',
    dateExpiration: '',
    observations: '',
  });

  // Retention form
  const [retentionForm, setRetentionForm] = useState({
    decomptNumero: 1,
    montantDecompt: 0,
    tauxRetenue: 7,
  });

  // ─── Data Loading ──────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [penRes, bondRes, retRes, sumRes] = await Promise.all([
        apiService.getPenalties(projectId),
        apiService.getBonds(projectId),
        apiService.getRetentions(projectId),
        apiService.getFinancialSummary(projectId),
      ]);
      setPenalties(penRes.data || []);
      setBonds(bondRes.data || []);
      setRetentions(retRes.data || []);
      setSummary(sumRes.data || null);
    } catch (err: any) {
      console.error('Error loading financial data:', err);
      setError(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Create Penalty ──────────────────────────────────
  const handleCreatePenalty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await apiService.createPenalty({
        projectId,
        ...penaltyForm,
        nombreJours: Number(penaltyForm.nombreJours),
        taux: Number(penaltyForm.taux),
        baseCalcul: Number(penaltyForm.baseCalcul),
        plafondPourcentage: Number(penaltyForm.plafondPourcentage),
      });
      setShowPenaltyForm(false);
      setPenaltyForm({
        type: 'retard', dateDebut: '', dateFin: '', nombreJours: 0,
        taux: 0.001, baseCalcul: montantMarche, plafondPourcentage: 10,
        motif: '', observations: '',
      });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur création pénalité');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Create Bond ─────────────────────────────────────
  const handleCreateBond = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await apiService.createBond({
        projectId,
        ...bondForm,
        pourcentage: Number(bondForm.pourcentage),
        baseCalcul: Number(bondForm.baseCalcul),
      });
      setShowBondForm(false);
      setBondForm({
        type: 'caution_definitive', pourcentage: 3, baseCalcul: montantMarche,
        organisme: '', referenceOrganisme: '', dateEmission: '', dateExpiration: '',
        observations: '',
      });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur création caution');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Create Retention ────────────────────────────────
  const handleCreateRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await apiService.createRetention({
        projectId,
        decomptNumero: Number(retentionForm.decomptNumero),
        montantDecompt: Number(retentionForm.montantDecompt),
        tauxRetenue: Number(retentionForm.tauxRetenue),
      });
      setShowRetentionForm(false);
      setRetentionForm({ decomptNumero: 1, montantDecompt: 0, tauxRetenue: 7 });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur création retenue');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete Penalty ──────────────────────────────────
  const handleDeletePenalty = async (id: string) => {
    if (!confirm('Supprimer cette pénalité ?')) return;
    try {
      await apiService.deletePenalty(id);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur suppression');
    }
  };

  // ─── Delete Bond ─────────────────────────────────────
  const handleDeleteBond = async (id: string) => {
    if (!confirm('Supprimer cette caution ?')) return;
    try {
      await apiService.deleteBond(id);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur suppression');
    }
  };

  // ─── Update Penalty Status ──────────────────────────
  const handleUpdatePenaltyStatus = async (id: string, statut: string) => {
    try {
      await apiService.updatePenalty(id, { statut });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur mise à jour');
    }
  };

  // ─── Update Bond Status ─────────────────────────────
  const handleUpdateBondStatus = async (id: string, statut: string) => {
    try {
      await apiService.updateBond(id, { statut });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur mise à jour');
    }
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Chargement des données financières...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ═══ Financial Summary Header ═══ */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border border-red-200">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-xs font-medium text-red-600 uppercase tracking-wide">Pénalités</span>
            </div>
            <p className="text-2xl font-bold text-red-700">
              {formatDH(summary.penalties?.penalitesAppliquees || 0)}
            </p>
            <p className="text-xs text-red-500 mt-1">
              {summary.penalties?.joursRetard || 0} jours de retard • {summary.penalties?.totalPenalties || 0} pénalité(s)
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">Cautions actives</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">
              {formatDH(summary.bonds?.montantCautionsActives || 0)}
            </p>
            <p className="text-xs text-blue-500 mt-1">
              {summary.bonds?.totalBonds || 0} caution(s) • Déf: {formatDH(summary.bonds?.cautionDefinitive || 0)}
            </p>
          </div>

          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">Retenue de garantie</span>
            </div>
            <p className="text-2xl font-bold text-amber-700">
              {formatDH(summary.retentions?.retenueEnCours || 0)}
            </p>
            <p className="text-xs text-amber-500 mt-1">
              Libérée: {formatDH(summary.retentions?.retenueLiberee || 0)}
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-purple-600" />
              <span className="text-xs font-medium text-purple-600 uppercase tracking-wide">Impact financier total</span>
            </div>
            <p className="text-2xl font-bold text-purple-700">
              {formatDH(
                (summary.penalties?.penalitesAppliquees || 0) +
                (summary.retentions?.retenueEnCours || 0)
              )}
            </p>
            <p className="text-xs text-purple-500 mt-1">
              Pénalités + Retenues en cours
            </p>
          </div>
        </div>
      )}

      {/* ═══ Tab Navigation ═══ */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4" aria-label="Onglets">
          {[
            { id: 'penalties' as ActiveTab, label: 'Pénalités', icon: AlertTriangle, count: penalties.length },
            { id: 'bonds' as ActiveTab, label: 'Cautions', icon: Shield, count: bonds.length },
            { id: 'retentions' as ActiveTab, label: 'Retenues', icon: Percent, count: retentions.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`inline-flex items-center justify-center w-5 h-5 text-xs rounded-full ${
                  activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ Penalties Tab ═══ */}
      {activeTab === 'penalties' && (
        <div className="space-y-4">
          {/* Header + Add button */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Pénalités de retard & malfaçons</h3>
              <p className="text-sm text-gray-500">CCAG-T Art. 60 — Taux 1/1000 par jour, plafond 10%</p>
            </div>
            <button
              onClick={() => setShowPenaltyForm(!showPenaltyForm)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
            >
              {showPenaltyForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showPenaltyForm ? 'Annuler' : 'Nouvelle pénalité'}
            </button>
          </div>

          {/* Create Penalty Form */}
          {showPenaltyForm && (
            <form onSubmit={handleCreatePenalty} className="bg-red-50 border border-red-200 rounded-xl p-6 space-y-4">
              <h4 className="font-semibold text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Calculer une pénalité
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de pénalité</label>
                  <select
                    value={penaltyForm.type}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                  >
                    {PENALTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date début</label>
                  <DateInput
                    value={penaltyForm.dateDebut}
                    onChange={(val) => setPenaltyForm({ ...penaltyForm, dateDebut: val })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date fin</label>
                  <DateInput
                    value={penaltyForm.dateFin}
                    onChange={(val) => setPenaltyForm({ ...penaltyForm, dateFin: val })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de jours</label>
                  <input
                    type="number"
                    min="0"
                    value={penaltyForm.nombreJours}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, nombreJours: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Taux / jour</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={penaltyForm.taux}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, taux: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                    required
                  />
                  <span className="text-xs text-gray-400">CCAG-T: 1/1000 = 0.001</span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base de calcul (DH)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={penaltyForm.baseCalcul}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, baseCalcul: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plafond (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={penaltyForm.plafondPourcentage}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, plafondPourcentage: parseFloat(e.target.value) || 10 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
              {/* Preview calculation */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-sm text-gray-600">
                  <strong>Aperçu :</strong> {penaltyForm.nombreJours} jours × {penaltyForm.taux} × {formatDH(penaltyForm.baseCalcul)} = {' '}
                  <span className="text-red-600 font-bold">
                    {formatDH(penaltyForm.nombreJours * penaltyForm.taux * penaltyForm.baseCalcul)}
                  </span>
                  {' '}(plafond: {formatDH(penaltyForm.baseCalcul * penaltyForm.plafondPourcentage / 100)})
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
                  <textarea
                    value={penaltyForm.motif}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, motif: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
                  <textarea
                    value={penaltyForm.observations}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, observations: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500"
                    rows={2}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || penaltyForm.nombreJours <= 0}
                  className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
                >
                  {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Calculer et enregistrer
                </button>
              </div>
            </form>
          )}

          {/* Penalties List */}
          {penalties.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Aucune pénalité enregistrée</p>
              <p className="text-gray-400 text-sm mt-1">Les pénalités seront calculées selon le CCAG-T</p>
            </div>
          ) : (
            <div className="space-y-3">
              {penalties.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="text-2xl">
                          {PENALTY_TYPES.find((t) => t.value === p.type)?.icon || '📋'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">
                              {PENALTY_TYPES.find((t) => t.value === p.type)?.label || p.type}
                            </span>
                            <StatusBadge status={p.statut} colors={PENALTY_STATUS_COLORS} />
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            {p.nombreJours} jours × {p.taux} × {formatDH(p.baseCalcul)}
                          </p>
                          {p.motif && <p className="text-sm text-gray-600 mt-1">{p.motif}</p>}
                          {p.dateDebut && (
                            <p className="text-xs text-gray-400 mt-1">
                              Du {formatDate(p.dateDebut)} au {formatDate(p.dateFin)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-red-600">{formatDH(p.montantApplique)}</p>
                        {p.montantPenalite !== p.montantApplique && (
                          <p className="text-xs text-gray-400">
                            Calculé: {formatDH(p.montantPenalite)} (plafonné à {p.plafondPourcentage}%)
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                      {p.statut === 'calculee' && (
                        <button
                          onClick={() => handleUpdatePenaltyStatus(p.id, 'notifiee')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 text-xs font-medium"
                        >
                          <FileText className="w-3 h-3" /> Notifier
                        </button>
                      )}
                      {p.statut === 'notifiee' && (
                        <>
                          <button
                            onClick={() => handleUpdatePenaltyStatus(p.id, 'appliquee')}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-xs font-medium"
                          >
                            <Check className="w-3 h-3" /> Appliquer
                          </button>
                          <button
                            onClick={() => handleUpdatePenaltyStatus(p.id, 'contestee')}
                            className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 text-xs font-medium"
                          >
                            <Ban className="w-3 h-3" /> Contester
                          </button>
                        </>
                      )}
                      {(p.statut === 'calculee' || p.statut === 'notifiee') && (
                        <button
                          onClick={() => handleUpdatePenaltyStatus(p.id, 'remise')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-xs font-medium"
                        >
                          <CheckCircle className="w-3 h-3" /> Remise gracieuse
                        </button>
                      )}
                      {(p.statut === 'calculee' || p.statut === 'notifiee') && (
                        <button
                          onClick={() => handleUpdatePenaltyStatus(p.id, 'annulee')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-xs font-medium"
                        >
                          <XCircle className="w-3 h-3" /> Annuler
                        </button>
                      )}
                      <div className="ml-auto">
                        <button
                          onClick={() => handleDeletePenalty(p.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Bonds Tab ═══ */}
      {activeTab === 'bonds' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Cautions & Garanties</h3>
              <p className="text-sm text-gray-500">Gestion des cautions bancaires et garanties du marché</p>
            </div>
            <button
              onClick={() => setShowBondForm(!showBondForm)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              {showBondForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showBondForm ? 'Annuler' : 'Nouvelle caution'}
            </button>
          </div>

          {/* Create Bond Form */}
          {showBondForm && (
            <form onSubmit={handleCreateBond} className="bg-blue-50 border border-blue-200 rounded-xl p-6 space-y-4">
              <h4 className="font-semibold text-blue-800 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Enregistrer une caution
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de caution</label>
                  <select
                    value={bondForm.type}
                    onChange={(e) => setBondForm({ ...bondForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {BOND_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pourcentage (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={bondForm.pourcentage}
                    onChange={(e) => setBondForm({ ...bondForm, pourcentage: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base de calcul (DH)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={bondForm.baseCalcul}
                    onChange={(e) => setBondForm({ ...bondForm, baseCalcul: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
              {/* Preview */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-sm text-gray-600">
                  <strong>Montant :</strong> {bondForm.pourcentage}% × {formatDH(bondForm.baseCalcul)} = {' '}
                  <span className="text-blue-600 font-bold">
                    {formatDH(bondForm.pourcentage / 100 * bondForm.baseCalcul)}
                  </span>
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organisme / Banque</label>
                  <input
                    type="text"
                    value={bondForm.organisme}
                    onChange={(e) => setBondForm({ ...bondForm, organisme: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Banque Populaire, Attijariwafa..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Référence</label>
                  <input
                    type="text"
                    value={bondForm.referenceOrganisme}
                    onChange={(e) => setBondForm({ ...bondForm, referenceOrganisme: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="Numéro de référence..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d'émission</label>
                  <DateInput
                    value={bondForm.dateEmission}
                    onChange={(val) => setBondForm({ ...bondForm, dateEmission: val })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d'expiration</label>
                  <DateInput
                    value={bondForm.dateExpiration}
                    onChange={(val) => setBondForm({ ...bondForm, dateExpiration: val })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
                  <input
                    type="text"
                    value={bondForm.observations}
                    onChange={(e) => setBondForm({ ...bondForm, observations: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || bondForm.pourcentage <= 0}
                  className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Enregistrer la caution
                </button>
              </div>
            </form>
          )}

          {/* Bonds List */}
          {bonds.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Aucune caution enregistrée</p>
              <p className="text-gray-400 text-sm mt-1">Ajoutez les cautions bancaires du marché</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bonds.map((b) => (
                <div key={b.id} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">
                        {BOND_TYPES.find((t) => t.value === b.type)?.icon || '📋'}
                      </span>
                      <div>
                        <span className="font-semibold text-gray-900 text-sm">
                          {BOND_TYPES.find((t) => t.value === b.type)?.label || b.type}
                        </span>
                        <StatusBadge status={b.statut} colors={BOND_STATUS_COLORS} />
                      </div>
                    </div>
                    <p className="text-lg font-bold text-blue-600">{formatDH(b.montant)}</p>
                  </div>

                  <div className="space-y-1 text-sm text-gray-600">
                    {b.pourcentage && (
                      <p><span className="text-gray-400">Taux:</span> {b.pourcentage}%</p>
                    )}
                    {b.organisme && (
                      <p className="flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-gray-400" />
                        {b.organisme} {b.referenceOrganisme && `(${b.referenceOrganisme})`}
                      </p>
                    )}
                    {b.dateEmission && (
                      <p className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        Du {formatDate(b.dateEmission)}
                        {b.dateExpiration && ` au ${formatDate(b.dateExpiration)}`}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    {b.statut === 'en_attente' && (
                      <button
                        onClick={() => handleUpdateBondStatus(b.id, 'active')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-xs font-medium"
                      >
                        <CheckCircle className="w-3 h-3" /> Activer
                      </button>
                    )}
                    {b.statut === 'active' && (
                      <button
                        onClick={() => handleUpdateBondStatus(b.id, 'liberee')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-xs font-medium"
                      >
                        <Check className="w-3 h-3" /> Libérer
                      </button>
                    )}
                    <div className="ml-auto">
                      <button
                        onClick={() => handleDeleteBond(b.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Retentions Tab ═══ */}
      {activeTab === 'retentions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Retenues de garantie</h3>
              <p className="text-sm text-gray-500">Suivi des retenues par décompte — taux standard 7%</p>
            </div>
            <button
              onClick={() => setShowRetentionForm(!showRetentionForm)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
            >
              {showRetentionForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showRetentionForm ? 'Annuler' : 'Nouvelle retenue'}
            </button>
          </div>

          {/* Create Retention Form */}
          {showRetentionForm && (
            <form onSubmit={handleCreateRetention} className="bg-amber-50 border border-amber-200 rounded-xl p-6 space-y-4">
              <h4 className="font-semibold text-amber-800 flex items-center gap-2">
                <Percent className="w-4 h-4" /> Enregistrer une retenue
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">N° Décompte</label>
                  <input
                    type="number"
                    min="1"
                    value={retentionForm.decomptNumero}
                    onChange={(e) => setRetentionForm({ ...retentionForm, decomptNumero: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montant du décompte (DH)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={retentionForm.montantDecompt}
                    onChange={(e) => setRetentionForm({ ...retentionForm, montantDecompt: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Taux de retenue (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={retentionForm.tauxRetenue}
                    onChange={(e) => setRetentionForm({ ...retentionForm, tauxRetenue: parseFloat(e.target.value) || 7 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>
              {/* Preview */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-sm text-gray-600">
                  <strong>Retenue :</strong> {retentionForm.tauxRetenue}% × {formatDH(retentionForm.montantDecompt)} = {' '}
                  <span className="text-amber-600 font-bold">
                    {formatDH(retentionForm.tauxRetenue / 100 * retentionForm.montantDecompt)}
                  </span>
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || retentionForm.montantDecompt <= 0}
                  className="flex items-center gap-2 px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
                >
                  {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Enregistrer la retenue
                </button>
              </div>
            </form>
          )}

          {/* Retentions List */}
          {retentions.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Percent className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Aucune retenue enregistrée</p>
              <p className="text-gray-400 text-sm mt-1">Les retenues sont calculées sur chaque décompte</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Décompte</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant décompte</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Taux</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Retenue</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cumulé</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Statut</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {retentions.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        DC N°{r.decomptNumero || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">
                        {formatDH(r.montantDecompt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">
                        {r.tauxRetenue}%
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-amber-600">
                        {formatDH(r.montantRetenue)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-amber-700">
                        {formatDH(r.montantCumule)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.liberee ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Libérée
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            Retenue
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-400">
                        {formatDate(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">Réglementation marocaine</p>
              <p>La retenue de garantie est fixée à 7% du montant de chaque décompte (art. 40 du CCAG-T).
              Elle est restituée dans un délai de 3 mois après la réception définitive des travaux,
              ou peut être remplacée par une caution bancaire de bonne exécution.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PenaltiesPanel;
