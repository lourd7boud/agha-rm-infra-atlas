import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus, Trash2, ChevronRight, ChevronDown, GripVertical,
  Calendar, Clock, AlertTriangle, CheckCircle2,
  Milestone, FolderOpen, ListTodo, ZoomIn, ZoomOut,
  Save, Edit3, X, ArrowRight
} from 'lucide-react';
import { apiService } from '../../services/apiService';
import DateInput from '../ui/DateInput';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface GanttTask {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  type: 'phase' | 'lot' | 'task' | 'milestone';
  dateDebut: string;
  dateFin: string;
  dureeJours: number;
  progress: number;
  color: string | null;
  sortOrder: number;
  statut: 'planifie' | 'en_cours' | 'termine' | 'en_retard' | 'suspendu';
  responsable: string | null;
  coutPrevu: number;
  coutReel: number;
  childrenCount: number;
  createdAt: string;
}

interface Dependency {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'FF' | 'SS' | 'SF';
  lagDays: number;
}

interface GanttStats {
  totalTasks: number;
  totalPhases: number;
  totalLots: number;
  totalMilestones: number;
  planifiees: number;
  enCours: number;
  terminees: number;
  enRetard: number;
  suspendues: number;
  avgProgress: number;
  dateDebutMin: string | null;
  dateFinMax: string | null;
  totalCoutPrevu: number;
  totalCoutReel: number;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const STATUT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  planifie: { label: 'Planifié', color: 'text-gray-600', bg: 'bg-gray-100' },
  en_cours: { label: 'En cours', color: 'text-blue-600', bg: 'bg-blue-100' },
  termine: { label: 'Terminé', color: 'text-green-600', bg: 'bg-green-100' },
  en_retard: { label: 'En retard', color: 'text-red-600', bg: 'bg-red-100' },
  suspendu: { label: 'Suspendu', color: 'text-orange-600', bg: 'bg-orange-100' },
};

const TYPE_CONFIG: Record<string, { label: string; icon: typeof FolderOpen; color: string }> = {
  phase: { label: 'Phase', icon: FolderOpen, color: '#6366f1' },
  lot: { label: 'Lot', icon: ListTodo, color: '#0ea5e9' },
  task: { label: 'Tâche', icon: Calendar, color: '#10b981' },
  milestone: { label: 'Jalon', icon: Milestone, color: '#f59e0b' },
};

const DAY_WIDTH_OPTIONS = [20, 30, 40, 60];

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════
function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

type TreeTask = GanttTask & { children: TreeTask[]; depth: number };

function buildTree(tasks: GanttTask[]): TreeTask[] {
  const map = new Map<string, TreeTask>();
  const roots: TreeTask[] = [];

  tasks.forEach(t => map.set(t.id, { ...t, children: [], depth: 0 }));

  map.forEach(t => {
    if (t.parentId && map.has(t.parentId)) {
      const parent = map.get(t.parentId)!;
      parent.children.push(t);
      t.depth = parent.depth + 1;
    } else {
      roots.push(t);
    }
  });

  // Flatten tree for display
  const flat: TreeTask[] = [];
  function walk(nodes: TreeTask[], depth: number) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    nodes.forEach(n => {
      n.depth = depth;
      flat.push(n);
      if (n.children.length > 0) walk(n.children, depth + 1);
    });
  }
  walk(roots, 0);
  return flat;
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════
export default function GanttPanel({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [stats, setStats] = useState<GanttStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<GanttTask | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [dayWidth, setDayWidth] = useState(30);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '', description: '', type: 'task' as string,
    dateDebut: '', dateFin: '', progress: 0,
    color: '', statut: 'planifie', responsable: '',
    coutPrevu: 0, coutReel: 0, parentId: '' as string
  });

  const chartRef = useRef<HTMLDivElement>(null);

  // ─── Load data ───
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [tasksRes, statsRes] = await Promise.all([
        apiService.getGanttTasks(projectId),
        apiService.getGanttStats(projectId)
      ]);
      setTasks(tasksRes.data.tasks || []);
      setDependencies(tasksRes.data.dependencies || []);
      setStats(statsRes.data || null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur de chargement';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Tree / timeline computation ───
  const treeData = useMemo(() => buildTree(tasks), [tasks]);

  const visibleTasks = useMemo(() => {
    const visible: typeof treeData = [];
    const hiddenParents = new Set<string>();

    treeData.forEach(t => {
      if (t.parentId && hiddenParents.has(t.parentId)) {
        hiddenParents.add(t.id);
        return;
      }
      if (t.parentId && collapsedIds.has(t.parentId)) {
        hiddenParents.add(t.id);
        return;
      }
      visible.push(t);
    });
    return visible;
  }, [treeData, collapsedIds]);

  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    if (tasks.length === 0) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = addDays(start, 90);
      return {
        timelineStart: start,
        timelineEnd: end,
        totalDays: 90
      };
    }
    const dates = tasks.flatMap(t => [new Date(t.dateDebut), new Date(t.dateFin)]);
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    // Add padding
    const start = addDays(minDate, -7);
    const end = addDays(maxDate, 14);
    return {
      timelineStart: start,
      timelineEnd: end,
      totalDays: daysBetween(start.toISOString(), end.toISOString())
    };
  }, [tasks]);

  // ─── Months for header ───
  const months = useMemo(() => {
    const result: { label: string; days: number; startDay: number }[] = [];
    let current = new Date(timelineStart);
    while (current < timelineEnd) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const effectiveStart = current > monthStart ? current : monthStart;
      const effectiveEnd = monthEnd < timelineEnd ? monthEnd : timelineEnd;
      const startDay = daysBetween(timelineStart.toISOString(), effectiveStart.toISOString());
      const days = daysBetween(effectiveStart.toISOString(), effectiveEnd.toISOString()) + 1;
      result.push({
        label: effectiveStart.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        days,
        startDay
      });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
    return result;
  }, [timelineStart, timelineEnd]);

  // ─── CRUD handlers ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        projectId,
        parentId: formData.parentId || null,
        name: formData.name,
        description: formData.description || null,
        type: formData.type,
        dateDebut: formData.dateDebut,
        dateFin: formData.dateFin,
        progress: formData.progress,
        color: formData.color || null,
        statut: formData.statut,
        responsable: formData.responsable || null,
        coutPrevu: formData.coutPrevu,
        coutReel: formData.coutReel
      };

      if (editingTask) {
        await apiService.updateGanttTask(editingTask.id, payload);
      } else {
        await apiService.createGanttTask(payload);
      }

      setShowForm(false);
      setEditingTask(null);
      resetForm();
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      setError(msg);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette tâche et ses sous-tâches ?')) return;
    try {
      await apiService.deleteGanttTask(id);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      setError(msg);
    }
  };

  const handleProgressChange = async (taskId: string, newProgress: number) => {
    try {
      await apiService.updateGanttTask(taskId, { progress: newProgress });
      await loadData();
    } catch {
      // silent
    }
  };

  const handleStatusChange = async (taskId: string, newStatut: string) => {
    try {
      await apiService.updateGanttTask(taskId, { statut: newStatut });
      await loadData();
    } catch {
      // silent
    }
  };

  const startEdit = (task: GanttTask) => {
    setFormData({
      name: task.name,
      description: task.description || '',
      type: task.type,
      dateDebut: task.dateDebut?.split('T')[0] || '',
      dateFin: task.dateFin?.split('T')[0] || '',
      progress: task.progress,
      color: task.color || '',
      statut: task.statut,
      responsable: task.responsable || '',
      coutPrevu: task.coutPrevu || 0,
      coutReel: task.coutReel || 0,
      parentId: task.parentId || ''
    });
    setEditingTask(task);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      name: '', description: '', type: 'task',
      dateDebut: '', dateFin: '', progress: 0,
      color: '', statut: 'planifie', responsable: '',
      coutPrevu: 0, coutReel: 0, parentId: ''
    });
  };

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Zoom ───
  const zoomIn = () => {
    const idx = DAY_WIDTH_OPTIONS.indexOf(dayWidth);
    if (idx < DAY_WIDTH_OPTIONS.length - 1) setDayWidth(DAY_WIDTH_OPTIONS[idx + 1]);
  };
  const zoomOut = () => {
    const idx = DAY_WIDTH_OPTIONS.indexOf(dayWidth);
    if (idx > 0) setDayWidth(DAY_WIDTH_OPTIONS[idx - 1]);
  };

  // ─── Bar position calc ───
  const getBarPosition = (task: GanttTask) => {
    const start = daysBetween(timelineStart.toISOString(), task.dateDebut);
    const duration = daysBetween(task.dateDebut, task.dateFin) + 1;
    return {
      left: start * dayWidth,
      width: Math.max(duration * dayWidth, task.type === 'milestone' ? 16 : dayWidth)
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement du planning...</span>
      </div>
    );
  }

  const parentOptions = tasks.filter(t => t.type === 'phase' || t.type === 'lot');
  const ROW_HEIGHT = 40;

  return (
    <div className="space-y-4">
      {/* ─── Error ─── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── Stats Cards ─── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Tâches" value={stats.totalTasks} icon={ListTodo} color="indigo" />
          <StatCard label="En cours" value={stats.enCours} icon={Clock} color="blue" />
          <StatCard label="Terminées" value={stats.terminees} icon={CheckCircle2} color="green" />
          <StatCard label="En retard" value={stats.enRetard} icon={AlertTriangle} color="red" />
          <StatCard label="Avancement" value={`${Math.round(Number(stats.avgProgress))}%`} icon={Calendar} color="purple" />
          <StatCard label="Coût prévu" value={formatCurrency(stats.totalCoutPrevu)} icon={Save} color="amber" />
        </div>
      )}

      {/* ─── Toolbar ─── */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-lg p-3">
        <button
          onClick={() => { resetForm(); setEditingTask(null); setShowForm(!showForm); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouvelle tâche
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={zoomOut} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Zoom -">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400 min-w-[40px] text-center">{dayWidth}px</span>
          <button onClick={zoomIn} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Zoom +">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <button onClick={loadData} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Rafraîchir">
          <Save className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Task Form ─── */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="font-semibold text-gray-900">
            {editingTask ? `Modifier: ${editingTask.name}` : 'Nouvelle tâche'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
              <input
                type="text" required value={formData.name}
                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Ex: Gros œuvre, Terrassement..."
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option value="phase">Phase</option>
                <option value="lot">Lot</option>
                <option value="task">Tâche</option>
                <option value="milestone">Jalon</option>
              </select>
            </div>

            {/* Parent */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Parent</label>
              <select
                value={formData.parentId}
                onChange={e => setFormData(p => ({ ...p, parentId: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Racine —</option>
                {parentOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Date début */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date début *</label>
              <DateInput
                required value={formData.dateDebut}
                onChange={val => setFormData(p => ({ ...p, dateDebut: val }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Date fin */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date fin *</label>
              <DateInput
                required value={formData.dateFin}
                onChange={val => setFormData(p => ({ ...p, dateFin: val }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Statut */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
              <select
                value={formData.statut}
                onChange={e => setFormData(p => ({ ...p, statut: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(STATUT_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            {/* Progress */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Avancement: {formData.progress}%</label>
              <input
                type="range" min="0" max="100" step="5" value={formData.progress}
                onChange={e => setFormData(p => ({ ...p, progress: Number(e.target.value) }))}
                className="w-full"
              />
            </div>

            {/* Responsable */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Responsable</label>
              <input
                type="text" value={formData.responsable}
                onChange={e => setFormData(p => ({ ...p, responsable: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="Nom du responsable"
              />
            </div>

            {/* Couleur */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Couleur</label>
              <input
                type="color" value={formData.color || '#6366f1'}
                onChange={e => setFormData(p => ({ ...p, color: e.target.value }))}
                className="w-full h-[34px] border border-gray-300 rounded-lg cursor-pointer"
              />
            </div>

            {/* Coût prévu */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Coût prévu (DH)</label>
              <input
                type="number" min="0" step="1000" value={formData.coutPrevu}
                onChange={e => setFormData(p => ({ ...p, coutPrevu: Number(e.target.value) }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Coût réel */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Coût réel (DH)</label>
              <input
                type="number" min="0" step="1000" value={formData.coutReel}
                onChange={e => setFormData(p => ({ ...p, coutReel: Number(e.target.value) }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                value={formData.description} rows={2}
                onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="Description optionnelle..."
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              {editingTask ? 'Modifier' : 'Créer'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingTask(null); resetForm(); }}
              className="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* ─── Gantt Chart ─── */}
      {tasks.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Aucune tâche planifiée</p>
          <p className="text-gray-400 text-xs mt-1">Créez des phases, lots et tâches pour visualiser le planning</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex">
            {/* ─── Left Panel: Task List ─── */}
            <div className="w-[350px] min-w-[350px] border-r border-gray-200 flex flex-col">
              {/* Header */}
              <div className="flex items-center h-[60px] px-3 border-b border-gray-200 bg-gray-50">
                <span className="text-xs font-semibold text-gray-600 uppercase">Tâches</span>
                <span className="ml-auto text-xs text-gray-400">{visibleTasks.length} / {tasks.length}</span>
              </div>

              {/* Task rows */}
              <div className="overflow-y-auto" style={{ maxHeight: `${Math.min(visibleTasks.length * ROW_HEIGHT, 600)}px` }}>
                {visibleTasks.map(task => {
                  const TypeIcon = TYPE_CONFIG[task.type]?.icon || ListTodo;
                  const hasChildren = task.childrenCount > 0 || task.children.length > 0;
                  const isCollapsed = collapsedIds.has(task.id);
                  const isSelected = selectedTask === task.id;
                  const statutCfg = STATUT_CONFIG[task.statut] || STATUT_CONFIG.planifie;

                  return (
                    <div
                      key={task.id}
                      className={`flex items-center border-b border-gray-100 hover:bg-indigo-50/50 cursor-pointer transition-colors group ${
                        isSelected ? 'bg-indigo-50' : ''
                      }`}
                      style={{ height: ROW_HEIGHT, paddingLeft: `${task.depth * 20 + 8}px` }}
                      onClick={() => setSelectedTask(task.id === selectedTask ? null : task.id)}
                    >
                      {/* Collapse toggle */}
                      {hasChildren ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                          className="p-0.5 text-gray-400 hover:text-gray-600"
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      ) : (
                        <GripVertical className="w-3.5 h-3.5 text-gray-300" />
                      )}

                      {/* Type icon */}
                      <TypeIcon className="w-3.5 h-3.5 ml-1 flex-shrink-0" style={{ color: task.color || TYPE_CONFIG[task.type]?.color }} />

                      {/* Name */}
                      <span className={`ml-1.5 text-xs truncate flex-1 ${
                        task.type === 'phase' || task.type === 'lot' ? 'font-semibold text-gray-900' : 'text-gray-700'
                      }`} title={task.name}>
                        {task.name}
                      </span>

                      {/* Status badge */}
                      <span className={`px-1.5 py-0.5 text-[10px] rounded ${statutCfg.bg} ${statutCfg.color} mr-1`}>
                        {task.progress}%
                      </span>

                      {/* Actions */}
                      <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(task); }}
                          className="p-0.5 text-gray-400 hover:text-indigo-600"
                          title="Modifier"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                          className="p-0.5 text-gray-400 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ─── Right Panel: Gantt Bars ─── */}
            <div className="flex-1 overflow-x-auto" ref={chartRef}>
              {/* Timeline header */}
              <div className="sticky top-0 bg-gray-50 border-b border-gray-200" style={{ height: 60 }}>
                {/* Months row */}
                <div className="flex h-[30px] border-b border-gray-100">
                  {months.map((m, i) => (
                    <div
                      key={i}
                      className="text-[10px] font-medium text-gray-600 border-r border-gray-100 flex items-center justify-center"
                      style={{ width: m.days * dayWidth, minWidth: m.days * dayWidth }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
                {/* Days row (if zoomed enough) */}
                {dayWidth >= 30 && (
                  <div className="flex h-[30px]">
                    {Array.from({ length: totalDays }, (_, i) => {
                      const d = addDays(timelineStart, i);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = d.toDateString() === new Date().toDateString();
                      return (
                        <div
                          key={i}
                          className={`text-[9px] flex items-center justify-center border-r border-gray-50 ${
                            isToday ? 'bg-indigo-100 text-indigo-700 font-bold' :
                            isWeekend ? 'bg-gray-100 text-gray-400' : 'text-gray-400'
                          }`}
                          style={{ width: dayWidth, minWidth: dayWidth }}
                        >
                          {dayWidth >= 40 ? d.getDate() : (d.getDate() % 5 === 0 || d.getDate() === 1 ? d.getDate() : '')}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bars area */}
              <div
                className="relative"
                style={{
                  width: totalDays * dayWidth,
                  height: visibleTasks.length * ROW_HEIGHT,
                }}
              >
                {/* Today line */}
                {(() => {
                  const todayOffset = daysBetween(timelineStart.toISOString(), new Date().toISOString());
                  if (todayOffset >= 0 && todayOffset <= totalDays) {
                    return (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                        style={{ left: todayOffset * dayWidth }}
                      >
                        <div className="absolute -top-0.5 -left-1.5 w-3 h-3 bg-red-400 rounded-full" />
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Weekend stripes */}
                {Array.from({ length: totalDays }, (_, i) => {
                  const d = addDays(timelineStart, i);
                  if (d.getDay() === 0 || d.getDay() === 6) {
                    return (
                      <div
                        key={`we-${i}`}
                        className="absolute top-0 bottom-0 bg-gray-50/70"
                        style={{ left: i * dayWidth, width: dayWidth }}
                      />
                    );
                  }
                  return null;
                })}

                {/* Row backgrounds */}
                {visibleTasks.map((_, i) => (
                  <div
                    key={`row-${i}`}
                    className={`absolute left-0 right-0 border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-25'}`}
                    style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  />
                ))}

                {/* Task bars */}
                {visibleTasks.map((task, i) => {
                  const { left, width } = getBarPosition(task);
                  const barColor = task.color || TYPE_CONFIG[task.type]?.color || '#6366f1';
                  const isSelected = selectedTask === task.id;

                  if (task.type === 'milestone') {
                    return (
                      <div
                        key={task.id}
                        className={`absolute flex items-center justify-center cursor-pointer transition-transform ${isSelected ? 'scale-125' : 'hover:scale-110'}`}
                        style={{
                          left: left + width / 2 - 8,
                          top: i * ROW_HEIGHT + ROW_HEIGHT / 2 - 8,
                          width: 16,
                          height: 16,
                        }}
                        onClick={() => setSelectedTask(task.id === selectedTask ? null : task.id)}
                        title={`${task.name} — ${formatDate(task.dateDebut)}`}
                      >
                        <div
                          className="w-full h-full rotate-45"
                          style={{ backgroundColor: barColor }}
                        />
                      </div>
                    );
                  }

                  const isGroup = task.type === 'phase' || task.type === 'lot';

                  return (
                    <div
                      key={task.id}
                      className={`absolute cursor-pointer transition-all ${isSelected ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
                      style={{
                        left,
                        top: i * ROW_HEIGHT + (isGroup ? 12 : 8),
                        width,
                        height: isGroup ? 16 : 24,
                        borderRadius: isGroup ? 2 : 4,
                        backgroundColor: isGroup ? 'transparent' : `${barColor}20`,
                        borderLeft: isGroup ? `3px solid ${barColor}` : 'none',
                        borderRight: isGroup ? `3px solid ${barColor}` : 'none',
                        borderTop: isGroup ? `3px solid ${barColor}` : 'none',
                      }}
                      onClick={() => setSelectedTask(task.id === selectedTask ? null : task.id)}
                      title={`${task.name}\n${formatDate(task.dateDebut)} → ${formatDate(task.dateFin)}\nAvancement: ${task.progress}%`}
                    >
                      {!isGroup && (
                        <>
                          {/* Full bar background */}
                          <div
                            className="absolute inset-0 rounded"
                            style={{ backgroundColor: `${barColor}30`, border: `1px solid ${barColor}50` }}
                          />
                          {/* Progress fill */}
                          <div
                            className="absolute top-0 left-0 bottom-0 rounded-l"
                            style={{
                              width: `${task.progress}%`,
                              backgroundColor: barColor,
                              opacity: 0.7,
                              borderRadius: task.progress >= 100 ? 4 : '4px 0 0 4px'
                            }}
                          />
                          {/* Label */}
                          {width > 60 && (
                            <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-gray-800 truncate z-10">
                              {task.name}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Dependency arrows */}
                <svg className="absolute inset-0 pointer-events-none" style={{ width: totalDays * dayWidth, height: visibleTasks.length * ROW_HEIGHT }}>
                  {dependencies.map(dep => {
                    const predIdx = visibleTasks.findIndex(t => t.id === dep.predecessorId);
                    const succIdx = visibleTasks.findIndex(t => t.id === dep.successorId);
                    if (predIdx === -1 || succIdx === -1) return null;

                    const pred = visibleTasks[predIdx];
                    const succ = visibleTasks[succIdx];
                    const predPos = getBarPosition(pred);
                    const succPos = getBarPosition(succ);

                    const x1 = predPos.left + predPos.width;
                    const y1 = predIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const x2 = succPos.left;
                    const y2 = succIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                    const midX = x1 + 10;

                    return (
                      <g key={dep.id}>
                        <path
                          d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                          fill="none"
                          stroke="#94a3b8"
                          strokeWidth={1.5}
                          strokeDasharray={dep.type !== 'FS' ? '4 2' : 'none'}
                        />
                        {/* Arrow head */}
                        <polygon
                          points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
                          fill="#94a3b8"
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* ─── Selected Task Details ─── */}
          {selectedTask && (() => {
            const task = tasks.find(t => t.id === selectedTask);
            if (!task) return null;
            const statutCfg = STATUT_CONFIG[task.statut] || STATUT_CONFIG.planifie;
            return (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-xs rounded ${statutCfg.bg} ${statutCfg.color}`}>
                        {statutCfg.label}
                      </span>
                      <span className="text-xs text-gray-400 uppercase">{TYPE_CONFIG[task.type]?.label}</span>
                      <h4 className="font-semibold text-gray-900">{task.name}</h4>
                    </div>
                    {task.description && <p className="text-sm text-gray-600 mb-2">{task.description}</p>}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(task.dateDebut)} <ArrowRight className="w-3 h-3" /> {formatDate(task.dateFin)}
                      </span>
                      <span>{task.dureeJours} jours</span>
                      {task.responsable && <span>Resp: {task.responsable}</span>}
                      {task.coutPrevu > 0 && <span>Prévu: {formatCurrency(task.coutPrevu)}</span>}
                      {task.coutReel > 0 && <span>Réel: {formatCurrency(task.coutReel)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {/* Progress slider */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Avancement:</span>
                      <input
                        type="range" min="0" max="100" step="5"
                        value={task.progress}
                        onChange={(e) => handleProgressChange(task.id, Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-xs font-medium w-8">{task.progress}%</span>
                    </div>
                    {/* Quick status change */}
                    <select
                      value={task.statut}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1"
                    >
                      {Object.entries(STATUT_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: React.ElementType; color: string
}) {
  const colorClasses: Record<string, { bg: string; icon: string; text: string }> = {
    indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-500', text: 'text-indigo-700' },
    blue: { bg: 'bg-blue-50', icon: 'text-blue-500', text: 'text-blue-700' },
    green: { bg: 'bg-green-50', icon: 'text-green-500', text: 'text-green-700' },
    red: { bg: 'bg-red-50', icon: 'text-red-500', text: 'text-red-700' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-500', text: 'text-purple-700' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-500', text: 'text-amber-700' },
  };
  const c = colorClasses[color] || colorClasses.indigo;

  return (
    <div className={`${c.bg} rounded-lg p-3 flex items-center gap-2`}>
      <Icon className={`w-5 h-5 ${c.icon}`} />
      <div>
        <p className="text-[10px] text-gray-500 uppercase">{label}</p>
        <p className={`text-sm font-bold ${c.text}`}>{value}</p>
      </div>
    </div>
  );
}

function formatCurrency(amount: number | string) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!n || n === 0) return '0 DH';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M DH`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K DH`;
  return `${n.toFixed(0)} DH`;
}
