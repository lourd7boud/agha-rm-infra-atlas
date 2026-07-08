/**
 * AvenantsTab — Contract Amendments Management
 * نظام تدبير ملاحق العقود
 * 
 * Full-featured avenant management:
 * - List all avenants with status badges
 * - Create/Edit avenant form with financial calculations
 * - Bordereau line modifications tracking
 * - Prix nouveaux (new price items)
 * - Financial impact summary card
 * - Status workflow transitions
 * - Timeline view of contract evolution
 */

import { FC, useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { Avenant, AvenantModification, AvenantPrixNouveau, AvenantSummary } from '../../db/database';
import {
  Plus, FileText, Edit2, Trash2, Check, X, Clock,
  TrendingUp, TrendingDown, DollarSign, Calendar, ChevronDown, ChevronUp,
  FileCheck, Send, Ban, ArrowRight, Shield, Hash, Layers, Eye
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';
import DateInput from '../ui/DateInput';

interface AvenantsTabProps {
  projectId: string;
  projectMontant: number;
  projectDelais?: number;
  bordereauLignes?: Array<{
    id: string;
    numero: number;
    designation: string;
    unite: string;
    quantite: number;
    prixUnitaire: number;
    montant: number;
  }>;
}

const safeDateFormat = (dateStr: string | undefined | null, fmt: string = 'dd/MM/yyyy'): string => {
  if (!dateStr) return '-';
  try {
    const d = parseISO(dateStr);
    return isValid(d) ? format(d, fmt, { locale: fr }) : '-';
  } catch { return '-'; }
};

const formatMontant = (val: number): string => {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

const getStatutBadge = (statut: string) => {
  switch (statut) {
    case 'brouillon':
      return { bg: 'bg-gray-100 text-gray-700 border-gray-300', icon: <Edit2 className="w-3 h-3" />, label: 'Brouillon' };
    case 'en_attente':
      return { bg: 'bg-amber-100 text-amber-700 border-amber-300', icon: <Clock className="w-3 h-3" />, label: 'En attente' };
    case 'approuve':
      return { bg: 'bg-emerald-100 text-emerald-700 border-emerald-300', icon: <Check className="w-3 h-3" />, label: 'Approuvé' };
    case 'rejete':
      return { bg: 'bg-red-100 text-red-700 border-red-300', icon: <X className="w-3 h-3" />, label: 'Rejeté' };
    case 'annule':
      return { bg: 'bg-gray-100 text-gray-500 border-gray-300', icon: <Ban className="w-3 h-3" />, label: 'Annulé' };
    default:
      return { bg: 'bg-gray-100 text-gray-700 border-gray-300', icon: <FileText className="w-3 h-3" />, label: statut };
  }
};

const getTypeBadge = (type: string) => {
  switch (type) {
    case 'modification':
      return { bg: 'bg-blue-100 text-blue-700', label: 'Modification' };
    case 'prix_nouveaux':
      return { bg: 'bg-purple-100 text-purple-700', label: 'Prix Nouveaux' };
    case 'mixte':
      return { bg: 'bg-indigo-100 text-indigo-700', label: 'Mixte' };
    case 'diminution':
      return { bg: 'bg-orange-100 text-orange-700', label: 'Diminution' };
    default:
      return { bg: 'bg-gray-100 text-gray-700', label: type };
  }
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
const AvenantsTab: FC<AvenantsTabProps> = ({ projectId, projectMontant }) => {
  const [avenants, setAvenants] = useState<Avenant[]>([]);
  const [summary, setSummary] = useState<AvenantSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAvenant, setEditingAvenant] = useState<Avenant | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    objet: '',
    reference: '',
    dateAvenant: '',
    dateNotification: '',
    dateApprobation: '',
    montantAvenant: 0,
    delaisSupplementaire: 0,
    typeAvenant: 'modification' as 'modification' | 'prix_nouveaux' | 'mixte' | 'diminution',
    motif: '',
    modifications: [] as AvenantModification[],
    prixNouveaux: [] as AvenantPrixNouveau[],
    observations: '',
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [avenantsRes, summaryRes] = await Promise.all([
        apiService.getAvenants(projectId),
        apiService.getAvenantSummary(projectId),
      ]);
      if (avenantsRes.success) setAvenants(avenantsRes.data || []);
      if (summaryRes.success) setSummary(summaryRes.data);
    } catch (err) {
      console.error('Error loading avenants:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormData({
      objet: '', reference: '', dateAvenant: '', dateNotification: '',
      dateApprobation: '', montantAvenant: 0, delaisSupplementaire: 0,
      typeAvenant: 'modification', motif: '', modifications: [],
      prixNouveaux: [], observations: '',
    });
    setEditingAvenant(null);
    setShowForm(false);
  };

  const handleEdit = (avenant: Avenant) => {
    setFormData({
      objet: avenant.objet || '',
      reference: avenant.reference || '',
      dateAvenant: avenant.dateAvenant ? avenant.dateAvenant.split('T')[0] : '',
      dateNotification: avenant.dateNotification ? avenant.dateNotification.split('T')[0] : '',
      dateApprobation: avenant.dateApprobation ? avenant.dateApprobation.split('T')[0] : '',
      montantAvenant: avenant.montantAvenant || 0,
      delaisSupplementaire: avenant.delaisSupplementaire || 0,
      typeAvenant: avenant.typeAvenant || 'modification',
      motif: avenant.motif || '',
      modifications: avenant.modifications || [],
      prixNouveaux: avenant.prixNouveaux || [],
      observations: avenant.observations || '',
    });
    setEditingAvenant(avenant);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      if (editingAvenant) {
        await apiService.updateAvenant(editingAvenant.id, formData);
      } else {
        await apiService.createAvenant({ ...formData, projectId });
      }
      resetForm();
      loadData();
    } catch (err) {
      console.error('Error saving avenant:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteAvenant(id);
      setDeleteConfirm(null);
      loadData();
    } catch (err) {
      console.error('Error deleting avenant:', err);
    }
  };

  const handleStatusChange = async (avenant: Avenant, newStatut: string) => {
    try {
      await apiService.updateAvenant(avenant.id, { statut: newStatut });
      loadData();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // Add a new prix nouveau line
  const addPrixNouveau = () => {
    const newItem: AvenantPrixNouveau = {
      id: `pn-${Date.now()}`,
      numero: formData.prixNouveaux.length + 1,
      designation: '',
      unite: '',
      quantite: 0,
      prixUnitaire: 0,
      montant: 0,
    };
    setFormData(prev => ({
      ...prev,
      prixNouveaux: [...prev.prixNouveaux, newItem],
    }));
  };

  const updatePrixNouveau = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const updated = [...prev.prixNouveaux];
      (updated[index] as any)[field] = value;
      if (field === 'quantite' || field === 'prixUnitaire') {
        updated[index].montant = (updated[index].quantite || 0) * (updated[index].prixUnitaire || 0);
      }
      return { ...prev, prixNouveaux: updated };
    });
  };

  const removePrixNouveau = (index: number) => {
    setFormData(prev => ({
      ...prev,
      prixNouveaux: prev.prixNouveaux.filter((_, i) => i !== index),
    }));
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — SUMMARY CARD
  // ═══════════════════════════════════════════════════════════════════
  const renderSummary = () => {
    if (!summary) return null;
    const isPositive = summary.totalMontantAvenants >= 0;
    
    return (
      <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Situation Contractuelle
          </h3>
          <span className="text-xs text-slate-500">
            {summary.nombreAvenants} avenant{summary.nombreAvenants !== 1 ? 's' : ''} • 
            {summary.nombreApprouves} approuvé{summary.nombreApprouves !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Montant Initial */}
          <div className="bg-white rounded-lg p-3 border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Montant Initial</p>
            <p className="text-lg font-bold text-slate-800">{formatMontant(summary.montantInitial)}</p>
            <p className="text-xs text-slate-400">DH</p>
          </div>
          
          {/* Total Avenants */}
          <div className={`bg-white rounded-lg p-3 border ${isPositive ? 'border-emerald-200' : 'border-red-200'}`}>
            <p className="text-xs text-slate-500 mb-1">Total Avenants</p>
            <p className={`text-lg font-bold flex items-center gap-1 ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isPositive ? '+' : ''}{formatMontant(summary.totalMontantAvenants)}
            </p>
            <p className={`text-xs ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
              {summary.variationTotale > 0 ? '+' : ''}{summary.variationTotale.toFixed(2)}%
            </p>
          </div>
          
          {/* Montant Actuel */}
          <div className="bg-white rounded-lg p-3 border border-blue-200">
            <p className="text-xs text-slate-500 mb-1">Montant Actuel</p>
            <p className="text-lg font-bold text-blue-700">{formatMontant(summary.montantActuel)}</p>
            <p className="text-xs text-blue-500">DH</p>
          </div>
          
          {/* Délais */}
          <div className="bg-white rounded-lg p-3 border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Délais</p>
            <p className="text-lg font-bold text-slate-800">{summary.delaisActuel} <span className="text-sm font-normal">jours</span></p>
            {summary.totalDelaisSup > 0 && (
              <p className="text-xs text-amber-600">+{summary.totalDelaisSup}j supplémentaires</p>
            )}
          </div>
        </div>

        {/* Contract Evolution Bar */}
        <div className="mt-4 bg-white rounded-lg p-3 border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Évolution du marché</span>
            <span>{formatMontant(summary.montantActuel)} DH</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-blue-500 rounded-l-full"
              style={{ width: `${Math.min(100, (summary.montantInitial / Math.max(summary.montantActuel, summary.montantInitial)) * 100)}%` }}
            />
            {summary.totalMontantAvenants > 0 && (
              <div 
                className="h-full bg-emerald-400"
                style={{ width: `${Math.min(100, (summary.totalMontantAvenants / Math.max(summary.montantActuel, summary.montantInitial)) * 100)}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-blue-500" />
              <span className="text-slate-500">Initial</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-emerald-400" />
              <span className="text-slate-500">Avenants</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — AVENANT FORM
  // ═══════════════════════════════════════════════════════════════════
  const renderForm = () => {
    if (!showForm) return null;

    const estimatedMontantTotal = (summary?.montantActuel || projectMontant) + formData.montantAvenant;
    const variationPct = projectMontant > 0 ? (formData.montantAvenant / projectMontant) * 100 : 0;

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 flex items-center justify-between">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {editingAvenant ? `Modifier Avenant N°${editingAvenant.numero}` : 'Nouvel Avenant'}
          </h3>
          <button onClick={resetForm} className="text-white/80 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-5 space-y-5">
          {/* Row 1: Object + Type */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Objet de l'avenant *</label>
              <input
                type="text"
                value={formData.objet}
                onChange={e => setFormData(p => ({ ...p, objet: e.target.value }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                placeholder="Ex: Augmentation des quantités de fondation..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select
                value={formData.typeAvenant}
                onChange={e => setFormData(p => ({ ...p, typeAvenant: e.target.value as any }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              >
                <option value="modification">Modification</option>
                <option value="prix_nouveaux">Prix Nouveaux</option>
                <option value="mixte">Mixte</option>
                <option value="diminution">Diminution</option>
              </select>
            </div>
          </div>

          {/* Row 2: Reference + Dates */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Référence</label>
              <input
                type="text"
                value={formData.reference}
                onChange={e => setFormData(p => ({ ...p, reference: e.target.value }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                placeholder="REF-AV-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date avenant</label>
              <DateInput
                value={formData.dateAvenant}
                onChange={val => setFormData(p => ({ ...p, dateAvenant: val }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date notification</label>
              <DateInput
                value={formData.dateNotification}
                onChange={val => setFormData(p => ({ ...p, dateNotification: val }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date approbation</label>
              <DateInput
                value={formData.dateApprobation}
                onChange={val => setFormData(p => ({ ...p, dateApprobation: val }))}
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Row 3: Financial Impact */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-blue-600" />
              Impact Financier
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Montant de l'avenant (DH)</label>
                <input
                  type="number"
                  value={formData.montantAvenant}
                  onChange={e => setFormData(p => ({ ...p, montantAvenant: parseFloat(e.target.value) || 0 }))}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  step="0.01"
                />
                {formData.montantAvenant !== 0 && (
                  <p className={`text-xs mt-1 ${formData.montantAvenant > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {variationPct > 0 ? '+' : ''}{variationPct.toFixed(2)}% du montant initial
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Délais supplémentaire (jours)</label>
                <input
                  type="number"
                  value={formData.delaisSupplementaire}
                  onChange={e => setFormData(p => ({ ...p, delaisSupplementaire: parseInt(e.target.value) || 0 }))}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>
              <div className="flex items-center">
                <div className="bg-white rounded-lg p-3 border border-blue-200 w-full">
                  <p className="text-xs text-slate-500">Nouveau montant estimé</p>
                  <p className="text-lg font-bold text-blue-700">
                    {formatMontant(estimatedMontantTotal)} <span className="text-xs font-normal">DH</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Row 4: Motif */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Motif / Justification</label>
            <textarea
              value={formData.motif}
              onChange={e => setFormData(p => ({ ...p, motif: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              placeholder="Justification technique ou réglementaire..."
            />
          </div>

          {/* Row 5: Prix Nouveaux */}
          {(formData.typeAvenant === 'prix_nouveaux' || formData.typeAvenant === 'mixte') && (
            <div className="border border-purple-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Prix Nouveaux
                </h4>
                <button
                  onClick={addPrixNouveau}
                  className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-lg hover:bg-purple-200 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Ajouter
                </button>
              </div>
              
              {formData.prixNouveaux.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-3">Aucun prix nouveau ajouté</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 px-2">
                    <div className="col-span-1">N°</div>
                    <div className="col-span-4">Désignation</div>
                    <div className="col-span-1">Unité</div>
                    <div className="col-span-2">Quantité</div>
                    <div className="col-span-2">P.U. (DH)</div>
                    <div className="col-span-1">Montant</div>
                    <div className="col-span-1"></div>
                  </div>
                  {formData.prixNouveaux.map((pn, idx) => (
                    <div key={pn.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-1">
                        <input
                          type="number"
                          value={pn.numero}
                          onChange={e => updatePrixNouveau(idx, 'numero', parseInt(e.target.value) || 0)}
                          className="w-full rounded border-slate-300 text-xs py-1 px-1"
                        />
                      </div>
                      <div className="col-span-4">
                        <input
                          type="text"
                          value={pn.designation}
                          onChange={e => updatePrixNouveau(idx, 'designation', e.target.value)}
                          className="w-full rounded border-slate-300 text-xs py-1"
                          placeholder="Désignation..."
                        />
                      </div>
                      <div className="col-span-1">
                        <input
                          type="text"
                          value={pn.unite}
                          onChange={e => updatePrixNouveau(idx, 'unite', e.target.value)}
                          className="w-full rounded border-slate-300 text-xs py-1"
                          placeholder="ml"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={pn.quantite}
                          onChange={e => updatePrixNouveau(idx, 'quantite', parseFloat(e.target.value) || 0)}
                          className="w-full rounded border-slate-300 text-xs py-1"
                          step="0.01"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={pn.prixUnitaire}
                          onChange={e => updatePrixNouveau(idx, 'prixUnitaire', parseFloat(e.target.value) || 0)}
                          className="w-full rounded border-slate-300 text-xs py-1"
                          step="0.01"
                        />
                      </div>
                      <div className="col-span-1 text-xs font-medium text-slate-700 text-right">
                        {formatMontant(pn.montant)}
                      </div>
                      <div className="col-span-1 text-right">
                        <button onClick={() => removePrixNouveau(idx)} className="text-red-400 hover:text-red-600">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end px-2 pt-2 border-t border-purple-200">
                    <span className="text-sm font-semibold text-purple-700">
                      Total: {formatMontant(formData.prixNouveaux.reduce((s, p) => s + p.montant, 0))} DH
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Observations */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Observations</label>
            <textarea
              value={formData.observations}
              onChange={e => setFormData(p => ({ ...p, observations: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              placeholder="Notes complémentaires..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={!formData.objet.trim()}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              {editingAvenant ? 'Mettre à jour' : 'Créer l\'avenant'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — AVENANT CARD (List mode)
  // ═══════════════════════════════════════════════════════════════════
  const renderAvenantCard = (avenant: Avenant) => {
    const statutBadge = getStatutBadge(avenant.statut);
    const typeBadge = getTypeBadge(avenant.typeAvenant);
    const isExpanded = expandedId === avenant.id;
    const isPositive = avenant.montantAvenant >= 0;

    return (
      <div key={avenant.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:border-slate-300 transition-all">
        {/* Main Row */}
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  Avenant N°{avenant.numero}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statutBadge.bg}`}>
                  {statutBadge.icon} {statutBadge.label}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.bg}`}>
                  {typeBadge.label}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-1">{avenant.objet}</p>
              {avenant.dateAvenant && (
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {safeDateFormat(avenant.dateAvenant)}
                  {avenant.reference && <span className="ml-2">• Réf: {avenant.reference}</span>}
                </p>
              )}
            </div>
            
            {/* Financial Impact */}
            <div className="text-right ml-4">
              <p className={`text-lg font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                {isPositive ? '+' : ''}{formatMontant(avenant.montantAvenant)}
              </p>
              <p className="text-xs text-slate-400">DH</p>
              <p className={`text-xs ${avenant.pourcentageVariation >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {avenant.pourcentageVariation >= 0 ? '+' : ''}{(avenant.pourcentageVariation || 0).toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1">
              {/* Status transitions */}
              {avenant.statut === 'brouillon' && (
                <button
                  onClick={() => handleStatusChange(avenant, 'en_attente')}
                  className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Soumettre
                </button>
              )}
              {avenant.statut === 'en_attente' && (
                <>
                  <button
                    onClick={() => handleStatusChange(avenant, 'approuve')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center gap-1"
                  >
                    <FileCheck className="w-3 h-3" /> Approuver
                  </button>
                  <button
                    onClick={() => handleStatusChange(avenant, 'rejete')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Rejeter
                  </button>
                </>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpandedId(isExpanded ? null : avenant.id)}
                className="text-xs px-2.5 py-1 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center gap-1"
              >
                <Eye className="w-3 h-3" />
                {isExpanded ? 'Masquer' : 'Détails'}
                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {avenant.statut !== 'approuve' && (
                <>
                  <button
                    onClick={() => handleEdit(avenant)}
                    className="text-xs px-2.5 py-1 rounded-lg text-blue-600 hover:bg-blue-50 flex items-center gap-1"
                  >
                    <Edit2 className="w-3 h-3" /> Modifier
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(avenant.id)}
                    className="text-xs px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-50 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Montant avant</p>
                <p className="font-medium">{formatMontant(avenant.montantInitial)} DH</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Montant après</p>
                <p className="font-medium text-blue-700">{formatMontant(avenant.montantNouveau)} DH</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Délais supp.</p>
                <p className="font-medium">{avenant.delaisSupplementaire || 0} jours</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Nouveau délai</p>
                <p className="font-medium">{avenant.nouveauDelais || '-'} jours</p>
              </div>
            </div>
            
            {avenant.motif && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Motif</p>
                <p className="text-sm text-slate-700 bg-white rounded-lg p-2 border border-slate-200">{avenant.motif}</p>
              </div>
            )}

            {/* Prix Nouveaux */}
            {avenant.prixNouveaux && avenant.prixNouveaux.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Prix Nouveaux ({avenant.prixNouveaux.length})</p>
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-purple-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-purple-700">N°</th>
                        <th className="px-2 py-1.5 text-left text-purple-700">Désignation</th>
                        <th className="px-2 py-1.5 text-center text-purple-700">U</th>
                        <th className="px-2 py-1.5 text-right text-purple-700">Qté</th>
                        <th className="px-2 py-1.5 text-right text-purple-700">P.U.</th>
                        <th className="px-2 py-1.5 text-right text-purple-700">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {avenant.prixNouveaux.map((pn, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1">{pn.numero}</td>
                          <td className="px-2 py-1">{pn.designation}</td>
                          <td className="px-2 py-1 text-center">{pn.unite}</td>
                          <td className="px-2 py-1 text-right">{pn.quantite}</td>
                          <td className="px-2 py-1 text-right">{formatMontant(pn.prixUnitaire)}</td>
                          <td className="px-2 py-1 text-right font-medium">{formatMontant(pn.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modifications */}
            {avenant.modifications && avenant.modifications.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Modifications ({avenant.modifications.length})</p>
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-blue-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-blue-700">Désignation</th>
                        <th className="px-2 py-1.5 text-center text-blue-700">Action</th>
                        <th className="px-2 py-1.5 text-right text-blue-700">Ancien</th>
                        <th className="px-2 py-1.5 text-right text-blue-700">Nouveau</th>
                        <th className="px-2 py-1.5 text-right text-blue-700">Différence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {avenant.modifications.map((mod, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1">{mod.designation}</td>
                          <td className="px-2 py-1 text-center capitalize">{mod.action?.replace(/_/g, ' ')}</td>
                          <td className="px-2 py-1 text-right">{mod.ancienneQuantite || mod.ancienPrix || '-'}</td>
                          <td className="px-2 py-1 text-right">{mod.nouvelleQuantite || mod.nouveauPrix || '-'}</td>
                          <td className={`px-2 py-1 text-right font-medium ${(mod.montantDifference || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatMontant(mod.montantDifference || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {avenant.observations && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Observations</p>
                <p className="text-sm text-slate-600 bg-white rounded p-2 border border-slate-200">{avenant.observations}</p>
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-slate-400 pt-2">
              {avenant.dateNotification && <span>Notification: {safeDateFormat(avenant.dateNotification)}</span>}
              {avenant.dateApprobation && <span>Approbation: {safeDateFormat(avenant.dateApprobation)}</span>}
              <span>Créé le: {safeDateFormat(avenant.createdAt, 'dd/MM/yyyy HH:mm')}</span>
            </div>
          </div>
        )}

        {/* Delete Confirmation */}
        {deleteConfirm === avenant.id && (
          <div className="border-t border-red-200 bg-red-50 p-3 flex items-center justify-between">
            <p className="text-sm text-red-700">Supprimer cet avenant ?</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="text-xs px-3 py-1 text-slate-600 hover:bg-white rounded">
                Non
              </button>
              <button onClick={() => handleDelete(avenant.id)} className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">
                Oui, supprimer
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — TIMELINE VIEW
  // ═══════════════════════════════════════════════════════════════════
  const renderTimeline = () => (
    <div className="relative pl-8 space-y-6">
      {/* Initial contract */}
      <div className="relative">
        <div className="absolute -left-8 top-0 w-6 h-6 rounded-full bg-blue-600 border-4 border-blue-200 flex items-center justify-center">
          <Shield className="w-3 h-3 text-white" />
        </div>
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
          <p className="text-sm font-bold text-blue-800">Marché Initial</p>
          <p className="text-lg font-bold text-blue-700">{formatMontant(projectMontant)} DH</p>
        </div>
      </div>

      {/* Avenants */}
      {avenants.map((avenant) => {
        const statutBadge = getStatutBadge(avenant.statut);
        const isPositive = avenant.montantAvenant >= 0;
        return (
          <div key={avenant.id} className="relative">
            <div className="absolute -left-8 top-0 w-0.5 h-full bg-slate-300 -translate-x-[0.5px]" style={{ left: '11px', top: '-24px' }} />
            <div className={`absolute -left-8 top-0 w-6 h-6 rounded-full flex items-center justify-center border-4 ${
              avenant.statut === 'approuve' ? 'bg-emerald-600 border-emerald-200' :
              avenant.statut === 'en_attente' ? 'bg-amber-500 border-amber-200' :
              avenant.statut === 'rejete' ? 'bg-red-500 border-red-200' :
              'bg-slate-400 border-slate-200'
            }`}>
              <span className="text-white text-xs font-bold">{avenant.numero}</span>
            </div>
            <div className="bg-white rounded-lg p-3 border border-slate-200 hover:border-slate-300 transition-all cursor-pointer"
                 onClick={() => setExpandedId(expandedId === avenant.id ? null : avenant.id)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">Avenant N°{avenant.numero}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${statutBadge.bg}`}>
                      {statutBadge.icon} {statutBadge.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{avenant.objet}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isPositive ? '+' : ''}{formatMontant(avenant.montantAvenant)} DH
                  </p>
                  {avenant.dateAvenant && (
                    <p className="text-xs text-slate-400">{safeDateFormat(avenant.dateAvenant)}</p>
                  )}
                </div>
              </div>
              {expandedId === avenant.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  <div className="grid grid-cols-3 gap-2">
                    <div><span className="text-slate-400">Avant:</span> {formatMontant(avenant.montantInitial)} DH</div>
                    <div><span className="text-slate-400">Après:</span> {formatMontant(avenant.montantNouveau)} DH</div>
                    <div><span className="text-slate-400">Variation:</span> {(avenant.pourcentageVariation || 0).toFixed(2)}%</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Current total */}
      {summary && (
        <div className="relative">
          <div className="absolute -left-8 top-0 w-6 h-6 rounded-full bg-indigo-600 border-4 border-indigo-200 flex items-center justify-center">
            <ArrowRight className="w-3 h-3 text-white" />
          </div>
          <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
            <p className="text-sm font-bold text-indigo-800">Montant Actuel du Marché</p>
            <p className="text-lg font-bold text-indigo-700">{formatMontant(summary.montantActuel)} DH</p>
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Avenants
          {avenants.length > 0 && (
            <span className="text-sm font-normal text-slate-400">({avenants.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          {avenants.length > 0 && (
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                Liste
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'timeline' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                Timeline
              </button>
            </div>
          )}
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nouvel Avenant
          </button>
        </div>
      </div>

      {/* Summary Card */}
      {renderSummary()}

      {/* Form */}
      {renderForm()}

      {/* Content */}
      {avenants.length === 0 && !showForm ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-lg font-medium text-slate-600">Aucun avenant</p>
          <p className="text-sm text-slate-400 mt-1">Ce marché n'a pas encore de ملاحق (avenants)</p>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="mt-4 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Créer le premier avenant
          </button>
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-3">
          {avenants.map(renderAvenantCard)}
        </div>
      ) : (
        renderTimeline()
      )}
    </div>
  );
};

export default AvenantsTab;
