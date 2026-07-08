import { FC, useState } from 'react';
import DateInput from '../components/ui/DateInput';
import { Project, ArretTravaux } from '../db/database';
import { db } from '../db/database';
import { Link } from 'react-router-dom';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Plus,
  X,
  Save,
  Pause,
  Play,
  FileText,
} from 'lucide-react';
import { format, differenceInDays, addMonths, addDays, parseISO, isValid } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { useAuthStore } from '../store/authStore';
import { isWeb } from '../utils/platform';
import { apiService } from '../services/apiService';
import { useProjects } from '../hooks/useUnifiedData';

// حساب إجمالي أيام التوقف
const calculateTotalArretDays = (arrets: ArretTravaux[] | undefined): number => {
  if (!arrets || arrets.length === 0) return 0;
  
  return arrets.reduce((total, arret) => {
    if (arret.dateArret && arret.dateReprise) {
      const start = parseISO(arret.dateArret);
      const end = parseISO(arret.dateReprise);
      if (isValid(start) && isValid(end)) {
        return total + differenceInDays(end, start);
      }
    }
    return total;
  }, 0);
};

// حساب معلومات الآجال
const calculateDelaiInfo = (project: Project): { status: DelaiStatus; message?: string; oscDate?: Date; delaiMois?: number; delaiJours?: number; joursArret?: number; dateFinInitiale?: Date; dateFinEffective?: Date; joursEcoules?: number; joursRestants?: number; pourcentage?: number; delaiTotal?: number } => {
  const today = new Date();
  
  // تاريخ البدء (OSC)
  const oscDate = project.osc ? parseISO(project.osc) : null;
  if (!oscDate || !isValid(oscDate)) {
    return { status: 'no-data', message: 'Date OSC non définie' };
  }
  
  // مدة الإنجاز بالأيام
  const delaiMois = project.delaisExecution || 0;
  if (delaiMois === 0) {
    return { status: 'no-data', message: 'Délai non défini' };
  }
  
  const delaiJours = delaiMois * 30; // تقريبي
  
  // حساب أيام التوقف
  const joursArret = calculateTotalArretDays(project.arrets);
  
  // تاريخ الانتهاء المتوقع (مع احتساب التوقفات)
  const dateFinInitiale = addMonths(oscDate, delaiMois);
  const dateFinEffective = addDays(dateFinInitiale, joursArret);
  
  // الأيام المنقضية
  const joursEcoules = differenceInDays(today, oscDate);
  
  // الأيام المتبقية
  const joursRestants = differenceInDays(dateFinEffective, today);
  
  // النسبة المئوية
  const delaiTotal = delaiJours + joursArret;
  const pourcentage = Math.min(100, Math.max(0, (joursEcoules / delaiTotal) * 100));
  
  // تحديد الحالة
  let status: 'normal' | 'warning' | 'critical' | 'completed' | 'overdue';
  if (project.dateReceptionDefinitive || project.dateReceptionProvisoire) {
    status = 'completed';
  } else if (joursRestants < 0) {
    status = 'overdue';
  } else if (joursRestants <= 15) {
    status = 'critical';
  } else if (joursRestants <= 30) {
    status = 'warning';
  } else {
    status = 'normal';
  }
  
  return {
    status,
    oscDate,
    delaiMois,
    delaiJours,
    joursArret,
    dateFinInitiale,
    dateFinEffective,
    joursEcoules,
    joursRestants,
    pourcentage,
    delaiTotal,
  };
};

// أنواع الحالات
type DelaiStatus = 'normal' | 'warning' | 'critical' | 'completed' | 'overdue' | 'no-data';

// ألوان الحالات
const statusColors: Record<DelaiStatus, { bg: string; text: string; border: string; progress: string }> = {
  'normal': { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', progress: 'bg-green-500' },
  'warning': { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200', progress: 'bg-yellow-500' },
  'critical': { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', progress: 'bg-red-500' },
  'completed': { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200', progress: 'bg-gray-500' },
  'overdue': { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', progress: 'bg-purple-500' },
  'no-data': { bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-100', progress: 'bg-gray-300' },
};

const statusLabels: Record<DelaiStatus, string> = {
  'normal': 'En cours',
  'warning': 'Alerte',
  'critical': 'Critique',
  'completed': 'Terminé',
  'overdue': 'Dépassé',
  'no-data': 'Non configuré',
};

const statusIcons: Record<DelaiStatus, typeof Clock> = {
  'normal': Clock,
  'warning': AlertTriangle,
  'critical': XCircle,
  'completed': CheckCircle2,
  'overdue': AlertTriangle,
  'no-data': Clock,
};

const DelaisPage: FC = () => {
  const { user } = useAuthStore();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // جلب جميع المشاريع باستخدام unified hooks
  const { projects, isLoading, refresh } = useProjects(user?.id || null);

  // إحصائيات
  const stats = projects?.reduce((acc: Record<string, number>, project: any) => {
    const info = calculateDelaiInfo(project);
    acc[info.status] = (acc[info.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // 🆕 استخراج الرقم الأول من رقم المشروع للترتيب
  const extractFirstNumber = (marcheNo: string): number => {
    const match = marcheNo?.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  // تصفية المشاريع مع الترتيب
  const filteredProjects = projects?.filter((project: any) => {
    if (filterStatus === 'all') return true;
    const info = calculateDelaiInfo(project);
    return info.status === filterStatus;
  })?.sort((a: any, b: any) => {
    // ترتيب تصاعدي حسب الرقم الأول من رقم المشروع
    return extractFirstNumber(a.marcheNo) - extractFirstNumber(b.marcheNo);
  }) || [];

  // إضافة توقف جديد
  const handleAddArret = async (projectId: string, arret: Omit<ArretTravaux, 'id'>) => {
    const project = projects?.find((p: any) => p.id === projectId);
    if (!project || !user) return;

    const newArret: ArretTravaux = {
      id: uuidv4(),
      ...arret,
    };

    const updatedArrets = [...(project.arrets || []), newArret];
    
    if (isWeb()) {
      // 🌐 Web: API directe
      try {
        await apiService.updateProject(projectId.replace('project:', ''), {
          arrets: updatedArrets,
        });
        refresh();
      } catch (error) {
        console.error('Error updating project:', error);
      }
    } else {
      // 🖥️ Electron: IndexedDB
      await db.projects.update(projectId, {
        arrets: updatedArrets,
        updatedAt: new Date().toISOString(),
      });
    }

    // تحديث المشروع المحدد
    if (selectedProject?.id === projectId) {
      setSelectedProject({ ...selectedProject, arrets: updatedArrets });
    }
  };

  // حذف توقف
  const handleDeleteArret = async (projectId: string, arretId: string) => {
    const project = projects?.find((p: any) => p.id === projectId);
    if (!project || !user) return;

    const updatedArrets = ((project as any).arrets || []).filter((a: any) => a.id !== arretId);
    
    if (isWeb()) {
      // 🌐 Web: API directe
      try {
        await apiService.updateProject(projectId.replace('project:', ''), {
          arrets: updatedArrets,
        });
        refresh();
      } catch (error) {
        console.error('Error updating project:', error);
      }
    } else {
      // 🖥️ Electron: IndexedDB
      await db.projects.update(projectId, {
        arrets: updatedArrets,
        updatedAt: new Date().toISOString(),
      });
    }

    if (selectedProject?.id === projectId) {
      setSelectedProject({ ...selectedProject, arrets: updatedArrets });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gestion des Délais</h1>
          <p className="text-gray-600 mt-1">
            Suivi des délais d'exécution de tous les projets
          </p>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
            <Clock className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.normal || 0}</p>
            <p className="text-sm text-gray-500">En cours</p>
          </div>
        </div>
        
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.warning || 0}</p>
            <p className="text-sm text-gray-500">Alerte</p>
          </div>
        </div>
        
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
            <XCircle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.critical || 0}</p>
            <p className="text-sm text-gray-500">Critique</p>
          </div>
        </div>
        
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.overdue || 0}</p>
            <p className="text-sm text-gray-500">Dépassé</p>
          </div>
        </div>
        
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-gray-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.completed || 0}</p>
            <p className="text-sm text-gray-500">Terminés</p>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-4">
        <select
          className="input w-48"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">Tous les projets</option>
          <option value="normal">En cours</option>
          <option value="warning">Alerte</option>
          <option value="critical">Critique</option>
          <option value="overdue">Dépassé</option>
          <option value="completed">Terminés</option>
          <option value="no-data">Non configuré</option>
        </select>
        <span className="text-gray-500">
          {filteredProjects.length} projet(s)
        </span>
      </div>

      {/* Liste des projets */}
      <div className="space-y-4">
        {filteredProjects.map((project) => {
          const info = calculateDelaiInfo(project);
          const colors = statusColors[info.status];
          const StatusIcon = statusIcons[info.status];
          
          return (
            <div key={project.id} className="card p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    {/* 🆕 رقم المشروع يظهر في الأعلى كعنوان رئيسي */}
                    <h3 className="text-lg font-bold text-primary-700">{project.marcheNo}</h3>
                    <span className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${colors.bg} ${colors.text}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusLabels[info.status]}
                    </span>
                  </div>
                  {/* 🆕 الاسم (Objet) يظهر تحت رقم المشروع */}
                  <p className="text-sm text-gray-700 font-medium mb-1">{project.objet}</p>
                  <p className="text-sm text-gray-500">
                    Marché N° {project.marcheNo} • {project.societe || 'Société non définie'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedProject(project)}
                    className="btn btn-secondary btn-sm flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Détails
                  </button>
                  <Link
                    to={`/projects/${project.id.replace('project:', '')}`}
                    className="btn btn-secondary btn-sm flex items-center gap-1"
                  >
                    <FileText className="w-4 h-4" />
                    Projet
                  </Link>
                </div>
              </div>

              {info.status !== 'no-data' && typeof info.pourcentage === 'number' && (
                <>
                  {/* Barre de progression */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">Progression</span>
                      <span className="font-medium">{Math.round(info.pourcentage)}%</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors.progress} transition-all duration-300`}
                        style={{ width: `${Math.min(100, info.pourcentage)}%` }}
                      />
                    </div>
                  </div>

                  {/* Informations */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Début (OSC)</p>
                      <p className="font-medium">
                        {info.oscDate ? format(info.oscDate, 'dd/MM/yyyy') : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Délai</p>
                      <p className="font-medium">{info.delaiMois} mois</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Jours d'arrêt</p>
                      <p className="font-medium text-orange-600">{info.joursArret} j</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Fin prévue</p>
                      <p className="font-medium">
                        {info.dateFinEffective ? format(info.dateFinEffective, 'dd/MM/yyyy') : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Reste</p>
                      <p className={`font-bold ${(info.joursRestants ?? 0) < 0 ? 'text-purple-600' : (info.joursRestants ?? 0) <= 15 ? 'text-red-600' : (info.joursRestants ?? 0) <= 30 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {(info.joursRestants ?? 0) < 0 ? `${Math.abs(info.joursRestants ?? 0)}j de retard` : `${info.joursRestants ?? 0} jours`}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {info.status === 'no-data' && (
                <p className="text-gray-400 text-sm italic">{info.message}</p>
              )}
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="card p-12 text-center">
            <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Aucun projet trouvé</p>
          </div>
        )}
      </div>

      {/* Modal détails */}
      {selectedProject && (
        <ProjectDelaiModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onAddArret={handleAddArret}
          onDeleteArret={handleDeleteArret}
        />
      )}
    </div>
  );
};

// Modal des détails du projet
interface ProjectDelaiModalProps {
  project: Project;
  onClose: () => void;
  onAddArret: (projectId: string, arret: Omit<ArretTravaux, 'id'>) => Promise<void>;
  onDeleteArret: (projectId: string, arretId: string) => Promise<void>;
}

const ProjectDelaiModal: FC<ProjectDelaiModalProps> = ({
  project,
  onClose,
  onAddArret,
  onDeleteArret,
}) => {
  const [showAddArret, setShowAddArret] = useState(false);
  const [newArret, setNewArret] = useState({
    dateArret: '',
    dateReprise: '',
    motif: '',
  });

  const info = calculateDelaiInfo(project);
  const colors = statusColors[info.status];

  const handleSubmitArret = async () => {
    if (!newArret.dateArret || !newArret.motif) return;
    
    await onAddArret(project.id, {
      dateArret: newArret.dateArret,
      dateReprise: newArret.dateReprise || undefined,
      motif: newArret.motif,
    });
    
    setNewArret({ dateArret: '', dateReprise: '', motif: '' });
    setShowAddArret(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Détails du Délai</h2>
              <p className="text-gray-500">{project.objet}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Récapitulatif */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Délai contractuel</p>
              <p className="text-xl font-bold">{info.delaiMois || 0} mois</p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <p className="text-sm text-orange-600">Jours d'arrêt</p>
              <p className="text-xl font-bold text-orange-700">{info.joursArret || 0} jours</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600">Délai effectif</p>
              <p className="text-xl font-bold text-blue-700">{info.delaiTotal || 0} jours</p>
            </div>
            <div className={`p-4 rounded-lg ${colors.bg}`}>
              <p className={`text-sm ${colors.text}`}>Jours restants</p>
              <p className={`text-xl font-bold ${colors.text}`}>
                {info.joursRestants !== undefined ? (info.joursRestants < 0 ? `${Math.abs(info.joursRestants)} retard` : info.joursRestants) : '-'}
              </p>
            </div>
          </div>

          {/* Timeline visuel */}
          {info.status !== 'no-data' && info.oscDate && info.dateFinEffective && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-4">Timeline</h3>
              <div className="relative">
                <div className="h-2 bg-gray-200 rounded-full">
                  <div
                    className={`h-full ${colors.progress} rounded-full`}
                    style={{ width: `${Math.min(100, info.pourcentage || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>OSC: {format(info.oscDate, 'dd/MM/yyyy')}</span>
                  <span>Fin: {format(info.dateFinEffective, 'dd/MM/yyyy')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Historique des arrêts */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Historique des Arrêts</h3>
              <button
                onClick={() => setShowAddArret(true)}
                className="btn btn-primary btn-sm flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Ajouter un arrêt
              </button>
            </div>

            {/* Formulaire d'ajout */}
            {showAddArret && (
              <div className="p-4 bg-blue-50 rounded-lg mb-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date d'arrêt (OSA) *
                    </label>
                    <DateInput
                      className="input"
                      value={newArret.dateArret}
                      onChange={(val) => setNewArret({ ...newArret, dateArret: val })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date de reprise (OSR)
                    </label>
                    <DateInput
                      className="input"
                      value={newArret.dateReprise}
                      onChange={(val) => setNewArret({ ...newArret, dateReprise: val })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Motif *
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Ex: Vague de froid"
                      value={newArret.motif}
                      onChange={(e) => setNewArret({ ...newArret, motif: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowAddArret(false)}
                    className="btn btn-secondary btn-sm"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSubmitArret}
                    className="btn btn-primary btn-sm flex items-center gap-1"
                    disabled={!newArret.dateArret || !newArret.motif}
                  >
                    <Save className="w-4 h-4" />
                    Enregistrer
                  </button>
                </div>
              </div>
            )}

            {/* Liste des arrêts */}
            {project.arrets && project.arrets.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">N°</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Arrêt (OSA)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Reprise (OSR)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Durée</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Motif</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {project.arrets.map((arret, index) => {
                      const duree = arret.dateArret && arret.dateReprise
                        ? differenceInDays(parseISO(arret.dateReprise), parseISO(arret.dateArret))
                        : null;
                      
                      return (
                        <tr key={arret.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">{index + 1}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className="flex items-center gap-1 text-red-600">
                              <Pause className="w-3 h-3" />
                              {arret.dateArret ? format(parseISO(arret.dateArret), 'dd/MM/yyyy') : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {arret.dateReprise ? (
                              <span className="flex items-center gap-1 text-green-600">
                                <Play className="w-3 h-3" />
                                {format(parseISO(arret.dateReprise), 'dd/MM/yyyy')}
                              </span>
                            ) : (
                              <span className="text-orange-500 italic">En cours</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">
                            {duree !== null ? `${duree} jours` : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm">{arret.motif}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => onDeleteArret(project.id, arret.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                              title="Supprimer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Pause className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Aucun arrêt enregistré</p>
              </div>
            )}
          </div>

          {/* Dates importantes */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Dates importantes</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Ordre de Service (OSC)</p>
                <p className="font-medium">
                  {project.osc ? format(parseISO(project.osc), 'dd/MM/yyyy') : 'Non défini'}
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Réception Provisoire</p>
                <p className="font-medium">
                  {project.dateReceptionProvisoire 
                    ? format(parseISO(project.dateReceptionProvisoire), 'dd/MM/yyyy') 
                    : 'Non défini'}
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Réception Définitive</p>
                <p className="font-medium">
                  {project.dateReceptionDefinitive 
                    ? format(parseISO(project.dateReceptionDefinitive), 'dd/MM/yyyy') 
                    : 'Non défini'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default DelaisPage;
