/**
 * WorkflowPanel — Approval & Visa Circuit UI
 * لوحة سير عمل الموافقات والتأشيرات
 *
 * Features:
 * - Submit documents for approval with multi-step chains
 * - Visual step tracker (stepper) for each request
 * - Approve/reject/return with comments
 * - Priority badges and due date indicators
 * - History/audit trail per request
 * - Stats summary header
 */

import { FC, useState, useEffect, useCallback } from 'react';
import DateInput from '../ui/DateInput';
import { apiService } from '../../services/apiService';
import { ApprovalRequest, ApprovalStats } from '../../db/database';
import {
  CheckCircle2, XCircle, Clock, Send, ChevronDown,
  ChevronRight, MessageSquare, RotateCcw, Ban, Shield,
  Timer, TrendingUp, FileCheck, Loader2, Plus, X,
  ArrowRight, History, AlertCircle, Zap
} from 'lucide-react';

interface WorkflowPanelProps {
  projectId: string;
}

const DOC_TYPES = [
  { value: 'decompt', label: 'Décompte' },
  { value: 'avenant', label: 'Avenant' },
  { value: 'pv', label: 'Procès Verbal' },
  { value: 'attachement', label: 'Attachement' },
  { value: 'ods', label: 'Ordre de Service' },
  { value: 'autre', label: 'Autre' },
];

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  urgente: { label: 'Urgente', color: 'text-red-700', bg: 'bg-red-100' },
  haute: { label: 'Haute', color: 'text-orange-700', bg: 'bg-orange-100' },
  normal: { label: 'Normal', color: 'text-blue-700', bg: 'bg-blue-100' },
  basse: { label: 'Basse', color: 'text-slate-600', bg: 'bg-slate-100' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  en_attente: { label: 'En attente', color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
  en_cours: { label: 'En cours', color: 'text-blue-700', bg: 'bg-blue-100', icon: Timer },
  approuve: { label: 'Approuvé', color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2 },
  rejete: { label: 'Rejeté', color: 'text-red-700', bg: 'bg-red-100', icon: XCircle },
  annule: { label: 'Annulé', color: 'text-slate-600', bg: 'bg-slate-100', icon: Ban },
};

const formatDate = (d?: string) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatMontant = (val?: number) => {
  if (!val) return '-';
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + ' DH';
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
const WorkflowPanel: FC<WorkflowPanelProps> = ({ projectId }) => {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [stats, setStats] = useState<ApprovalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filter
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [reqRes, statsRes] = await Promise.all([
        apiService.getApprovalsByProject(projectId),
        apiService.getApprovalStats(),
      ]);
      setRequests(reqRes.data || []);
      setStats(statsRes.data || null);
    } catch (err: any) {
      setError(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRequests = statusFilter === 'all'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  // ═══════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════
  const handleApprove = async (id: string, comment: string) => {
    try {
      setActionLoading(id);
      await apiService.approveStep(id, { comment: comment || undefined });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string, comment: string, returnToStep?: number) => {
    if (!comment.trim()) {
      alert('Un commentaire est requis pour le rejet');
      return;
    }
    try {
      setActionLoading(id);
      await apiService.rejectStep(id, { comment, returnToStep: returnToStep || undefined });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Annuler cette demande de validation ?')) return;
    try {
      setActionLoading(id);
      await apiService.cancelApproval(id);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={Clock} label="En attente" value={Number(stats.pendingCount)} color="amber" />
          <StatCard icon={CheckCircle2} label="Approuvés" value={Number(stats.approvedCount)} color="green" />
          <StatCard icon={XCircle} label="Rejetés" value={Number(stats.rejectedCount)} color="red" />
          <StatCard icon={Zap} label="Urgentes" value={Number(stats.urgentCount)} color="orange" />
          <StatCard icon={TrendingUp} label="Montant en attente" value={formatMontant(Number(stats.pendingAmount))} color="blue" isText />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Circuit de Validation
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 rounded-full text-slate-500">
            {requests.length} demandes
          </span>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {showCreateForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreateForm ? 'Fermer' : 'Nouvelle demande'}
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <CreateRequestForm
          projectId={projectId}
          onCreated={() => { setShowCreateForm(false); loadData(); }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Filter */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
        {[
          { v: 'all', l: 'Toutes' },
          { v: 'en_attente', l: 'En attente' },
          { v: 'en_cours', l: 'En cours' },
          { v: 'approuve', l: 'Approuvés' },
          { v: 'rejete', l: 'Rejetés' },
        ].map(f => (
          <button
            key={f.v}
            onClick={() => setStatusFilter(f.v)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              statusFilter === f.v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={loadData} className="ml-auto text-red-600 hover:text-red-800 text-xs font-medium">Réessayer</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin mr-2" />
          <span className="text-sm text-slate-500">Chargement...</span>
        </div>
      )}

      {/* Request List */}
      {!loading && filteredRequests.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-xl">
          <FileCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Aucune demande de validation</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Soumettre un document
          </button>
        </div>
      )}

      {!loading && filteredRequests.length > 0 && (
        <div className="space-y-3">
          {filteredRequests.map(req => (
            <RequestCard
              key={req.id}
              request={req}
              expanded={expandedId === req.id}
              onToggle={() => setExpandedId(expandedId === req.id ? null : req.id)}
              onApprove={handleApprove}
              onReject={handleReject}
              onCancel={handleCancel}
              actionLoading={actionLoading === req.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════════
const StatCard: FC<{ icon: any; label: string; value: number | string; color: string; isText?: boolean }> = ({
  icon: Icon, label, value, color, isText
}) => {
  const colors: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${colors[color] || ''}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className={`${isText ? 'text-sm' : 'text-xl'} font-bold text-slate-800`}>{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// CREATE REQUEST FORM
// ═══════════════════════════════════════════════════════════════════════
const CreateRequestForm: FC<{
  projectId: string;
  onCreated: () => void;
  onCancel: () => void;
}> = ({ projectId, onCreated, onCancel }) => {
  const [form, setForm] = useState({
    documentType: 'decompt',
    documentReference: '',
    priority: 'normal',
    dueDate: '',
    note: '',
    montant: '',
  });
  const [steps, setSteps] = useState([
    { stepOrder: 1, stepLabel: 'Visa Ingénieur', role: 'ingenieur' },
    { stepOrder: 2, stepLabel: 'Approbation Chef Service', role: 'chef_service' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const addStep = () => {
    setSteps([...steps, {
      stepOrder: steps.length + 1,
      stepLabel: '',
      role: '',
    }]);
  };

  const removeStep = (idx: number) => {
    const newSteps = steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }));
    setSteps(newSteps);
  };

  const updateStep = (idx: number, field: string, val: string) => {
    const newSteps = [...steps];
    (newSteps[idx] as any)[field] = val;
    setSteps(newSteps);
  };

  const handleSubmit = async () => {
    if (!form.documentReference.trim()) {
      alert('Référence du document requise');
      return;
    }
    if (steps.some(s => !s.stepLabel.trim())) {
      alert('Toutes les étapes doivent avoir un libellé');
      return;
    }

    try {
      setSubmitting(true);
      await apiService.createApprovalRequest({
        projectId,
        documentType: form.documentType,
        documentId: projectId, // Use project ID as placeholder — real doc ID would come from document selection
        documentReference: form.documentReference,
        priority: form.priority,
        dueDate: form.dueDate || null,
        note: form.note || null,
        montant: form.montant ? parseFloat(form.montant) : null,
        steps,
      });
      onCreated();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 animate-in">
      <h3 className="text-sm font-bold text-indigo-800 mb-4 flex items-center gap-2">
        <Send className="w-4 h-4" />
        Soumettre une demande de validation
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* Doc Type */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Type de document *</label>
          <select
            value={form.documentType}
            onChange={e => setForm({ ...form, documentType: e.target.value })}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          >
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Reference */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Référence *</label>
          <input
            type="text"
            value={form.documentReference}
            onChange={e => setForm({ ...form, documentReference: e.target.value })}
            placeholder="Décompte N°3, Avenant N°1..."
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Priorité</label>
          <select
            value={form.priority}
            onChange={e => setForm({ ...form, priority: e.target.value })}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          >
            <option value="basse">Basse</option>
            <option value="normal">Normal</option>
            <option value="haute">Haute</option>
            <option value="urgente">Urgente</option>
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date limite</label>
          <DateInput
            value={form.dueDate}
            onChange={value => setForm({ ...form, dueDate: value })}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          />
        </div>

        {/* Montant */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Montant (DH)</label>
          <input
            type="number"
            value={form.montant}
            onChange={e => setForm({ ...form, montant: e.target.value })}
            placeholder="500000"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          />
        </div>

        {/* Note */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
          <input
            type="text"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            placeholder="Observations..."
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          />
        </div>
      </div>

      {/* Steps */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-slate-700">Étapes de validation</label>
          <button
            onClick={addStep}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Ajouter
          </button>
        </div>
        <div className="space-y-2">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center shrink-0">
                {step.stepOrder}
              </span>
              <input
                type="text"
                value={step.stepLabel}
                onChange={e => updateStep(idx, 'stepLabel', e.target.value)}
                placeholder="Libellé de l'étape..."
                className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-300"
              />
              <input
                type="text"
                value={step.role}
                onChange={e => updateStep(idx, 'role', e.target.value)}
                placeholder="Rôle..."
                className="w-32 text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-300"
              />
              {steps.length > 1 && (
                <button onClick={() => removeStep(idx)} className="text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium"
        >
          Annuler
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Soumettre
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// REQUEST CARD
// ═══════════════════════════════════════════════════════════════════════
const RequestCard: FC<{
  request: ApprovalRequest;
  expanded: boolean;
  onToggle: () => void;
  onApprove: (id: string, comment: string) => void;
  onReject: (id: string, comment: string, returnToStep?: number) => void;
  onCancel: (id: string) => void;
  actionLoading: boolean;
}> = ({ request, expanded, onToggle, onApprove, onReject, onCancel, actionLoading }) => {
  const [comment, setComment] = useState('');
  const statusCfg = STATUS_CONFIG[request.status] || STATUS_CONFIG.en_attente;
  const priorityCfg = PRIORITY_CONFIG[request.priority] || PRIORITY_CONFIG.normal;
  const StatusIcon = statusCfg.icon;
  const isActive = request.status === 'en_attente' || request.status === 'en_cours';

  return (
    <div className={`bg-white rounded-xl border ${isActive ? 'border-indigo-200' : 'border-slate-200'} overflow-hidden transition-all`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        {/* Status icon */}
        <div className={`p-1.5 rounded-lg ${statusCfg.bg}`}>
          <StatusIcon className={`w-4 h-4 ${statusCfg.color}`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">
              {request.documentReference || `${request.documentType} #${request.id.substring(0, 8)}`}
            </span>
            {/* Doc type badge */}
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium uppercase">
              {DOC_TYPES.find(t => t.value === request.documentType)?.label || request.documentType}
            </span>
            {/* Priority badge */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityCfg.bg} ${priorityCfg.color}`}>
              {priorityCfg.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
            <span>Étape {request.currentStep}/{request.totalSteps}</span>
            <span>{formatDate(request.submittedAt)}</span>
            {request.montant && <span>{formatMontant(Number(request.montant))}</span>}
          </div>
        </div>

        {/* Status badge */}
        <span className={`text-xs font-medium px-2 py-1 rounded-lg ${statusCfg.bg} ${statusCfg.color}`}>
          {statusCfg.label}
        </span>

        {/* Expand */}
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4">
          {/* Step Tracker */}
          <div>
            <h4 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5" />
              Progression du circuit
            </h4>
            <StepTracker steps={request.steps || []} currentStep={request.currentStep} />
          </div>

          {/* Note */}
          {request.note && (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Note du demandeur
              </p>
              <p className="text-sm text-slate-700">{request.note}</p>
            </div>
          )}

          {/* History */}
          {request.history && request.history.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Historique
              </h4>
              <div className="space-y-1.5">
                {request.history.map(h => (
                  <div key={h.id} className="flex items-start gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      h.action === 'approved' ? 'bg-green-500' :
                      h.action === 'rejected' ? 'bg-red-500' :
                      h.action === 'cancelled' ? 'bg-slate-400' :
                      'bg-blue-500'
                    }`} />
                    <span className="text-slate-600">
                      <strong>{h.actorName || 'Système'}</strong>
                      {' '}{h.action === 'submitted' && 'a soumis la demande'}
                      {h.action === 'approved' && 'a approuvé'}
                      {h.action === 'rejected' && 'a rejeté'}
                      {h.action === 'cancelled' && 'a annulé'}
                      {h.action === 'returned' && 'a renvoyé'}
                      {h.comment && <span className="text-slate-400"> — {h.comment}</span>}
                    </span>
                    <span className="text-slate-400 ml-auto shrink-0">{formatDate(h.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {isActive && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Commentaire (requis pour rejet)..."
                  className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { onApprove(request.id, comment); setComment(''); }}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approuver étape {request.currentStep}
                </button>
                <button
                  onClick={() => { onReject(request.id, comment); setComment(''); }}
                  disabled={actionLoading || !comment.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Rejeter
                </button>
                {request.currentStep > 1 && (
                  <button
                    onClick={() => { onReject(request.id, comment || 'Renvoyé pour correction', 1); setComment(''); }}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Renvoyer étape 1
                  </button>
                )}
                <button
                  onClick={() => onCancel(request.id)}
                  disabled={actionLoading}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-red-600"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// STEP TRACKER (Visual Stepper)
// ═══════════════════════════════════════════════════════════════════════
const StepTracker: FC<{ steps: any[]; currentStep: number }> = ({ steps, currentStep }) => {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, idx) => {
        const isActive = step.stepOrder === currentStep;
        const isDone = step.status === 'approuve';
        const isRejected = step.status === 'rejete';
        const isLast = idx === steps.length - 1;

        let bg = 'bg-slate-200 text-slate-400';
        let ringColor = '';
        if (isDone) bg = 'bg-green-500 text-white';
        else if (isRejected) bg = 'bg-red-500 text-white';
        else if (isActive) { bg = 'bg-indigo-500 text-white'; ringColor = 'ring-2 ring-indigo-300'; }

        return (
          <div key={step.id || idx} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${bg} ${ringColor}`}>
                {isDone ? <CheckCircle2 className="w-4 h-4" /> :
                 isRejected ? <XCircle className="w-4 h-4" /> :
                 step.stepOrder}
              </div>
              <div className="mt-1 max-w-[80px] text-center">
                <p className={`text-[10px] font-medium leading-tight ${isActive ? 'text-indigo-700' : isDone ? 'text-green-700' : 'text-slate-500'}`}>
                  {step.stepLabel}
                </p>
                {step.decidedByName && (
                  <p className="text-[9px] text-slate-400 mt-0.5 truncate">{step.decidedByName}</p>
                )}
              </div>
            </div>
            {!isLast && (
              <div className={`w-8 h-0.5 mx-1 mt-[-16px] ${isDone ? 'bg-green-400' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default WorkflowPanel;
