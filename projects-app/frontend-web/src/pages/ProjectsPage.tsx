import { FC, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProjects } from '../hooks/useUnifiedData';
import { apiService } from '../services/apiService';
import { isWeb } from '../utils/platform';
import {
  Plus,
  Search,
  FolderKanban,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  Archive,
  LayoutGrid,
  List,
  FileText,
  TrendingUp,
  Loader2,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';

const ProjectsPage: FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [assistanceFilter, setAssistanceFilter] = useState<string>('all');
  const [maitreOeuvreFilter, setMaitreOeuvreFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Server-first data loading
  const { projects, isLoading, error, refresh } = useProjects(user?.id || null);
  
  // Online status for Web
  const isOnline = navigator.onLine;
  const canModify = isOnline || !isWeb();
  const cannotModifyReason = !isOnline && isWeb() ? 'Non disponible hors ligne' : null;

  // 🌐 Web: تحميل bordereaux من API لكل المشاريع
  const [bordereaux, setBordereaux] = useState<any[]>([]);
  // 🆕 تحميل decompts لحساب Avancement
  const [decompts, setDecompts] = useState<any[]>([]);
  
  useEffect(() => {
    const loadBordereaux = async () => {
      if (!projects?.length) {
        setBordereaux([]);
        return;
      }
      
      const allBordereaux: any[] = [];
      
      await Promise.all(projects.map(async (project) => {
        const cleanId = project.id?.replace('project:', '') || project.id;
        try {
          const res = await apiService.getBordereaux(cleanId);
          const data = res.data || res;
          if (Array.isArray(data)) {
            allBordereaux.push(...data.map(b => ({ ...b, projectId: project.id })));
          }
        } catch (e) { /* No bordereau */ }
      }));
      
      setBordereaux(allBordereaux.filter(b => !b.deletedAt));
    };
    
    loadBordereaux();
  }, [projects]);

  // 🆕 تحميل decompts لكل المشاريع
  useEffect(() => {
    const loadDecompts = async () => {
      if (!projects?.length) {
        setDecompts([]);
        return;
      }
      
      const allDecompts: any[] = [];
      
      await Promise.all(projects.map(async (project) => {
        const cleanId = project.id?.replace('project:', '') || project.id;
        try {
          const res = await apiService.getDecompts(cleanId);
          const data = res.data || res;
          if (Array.isArray(data)) {
            allDecompts.push(...data.map(d => ({ ...d, projectId: project.id })));
          }
        } catch (e) { /* No decompts */ }
      }));
      
      setDecompts(allDecompts.filter(d => !d.deletedAt));
    };
    
    loadDecompts();
  }, [projects]);

  // Helper pour calculer le montant TTC d'un projet
  const getProjectMontantTTC = (projectId: string): number => {
    if (!bordereaux?.length) return 0;
    // تطبيع المعرفات للمقارنة
    const cleanProjectId = projectId?.replace('project:', '') || projectId;
    const bordereau = bordereaux.find((b) => {
      const bProjectId = (b.projectId || b.project_id)?.replace('project:', '') || b.projectId;
      return bProjectId === cleanProjectId || b.projectId === projectId;
    });
    if (!bordereau || !bordereau.lignes) return 0;
    const montantHT = bordereau.lignes.reduce((sum: number, ligne: any) => sum + ((ligne.quantite || 0) * (ligne.prixUnitaire || ligne.prix_unitaire || 0)), 0);
    return montantHT * 1.2; // +20% TVA
  };

  // 🆕 Helper pour calculer l'avancement d'un projet (من آخر ديكونت)
  const getProjectProgress = (projectId: string): number => {
    const montantTTC = getProjectMontantTTC(projectId);
    if (montantTTC === 0) return 0;
    
    // تطبيع المعرفات للمقارنة
    const cleanProjectId = projectId?.replace('project:', '') || projectId;
    
    // إيجاد ديكونتات هذا المشروع
    const projectDecompts = decompts.filter((d) => {
      const dProjectId = (d.projectId || d.project_id)?.replace('project:', '') || d.projectId;
      return dProjectId === cleanProjectId || d.projectId === projectId;
    });
    
    if (projectDecompts.length === 0) return 0;
    
    // إيجاد آخر ديكونت (الأعلى رقماً)
    const dernierDecompte = projectDecompts.reduce((latest: any, d: any) => {
      if (!latest || d.numero > latest.numero) return d;
      return latest;
    }, projectDecompts[0]);
    
    // استخدام totalGeneralTtc أو totalTtc (camelCase من Backend)
    const totalGeneralTTC = Number(dernierDecompte?.totalGeneralTtc || dernierDecompte?.totalTtc || 0);
    
    if (totalGeneralTTC === 0) return 0;
    
    const progress = (totalGeneralTTC / montantTTC) * 100;
    return Math.min(Math.round(progress * 10) / 10, 100); // تقريب لرقم واحد بعد الفاصلة، حد أقصى 100%
  };
  // Obtenir les années uniques
  const uniqueYears = Array.from(new Set(projects?.map((p) => p.annee) || [])).sort().reverse();

  // Obtenir les Assistance Technique uniques
  const uniqueAssistance = Array.from(
    new Set(projects?.map((p) => p.assistanceTechnique).filter(Boolean) || [])
  ).sort();

  // Obtenir les Maître d'Oeuvre uniques
  const uniqueMaitreOeuvre = Array.from(
    new Set(projects?.map((p) => p.maitreOeuvre).filter(Boolean) || [])
  ).sort();

  // 🆕 استخراج الرقم الأول من رقم المشروع للترتيب (مثل 12/2025/DPA/TA -> 12)
  const extractFirstNumber = (marcheNo: string): number => {
    const match = marcheNo?.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const filteredProjects = projects?.filter((p) => {
    const matchesSearch =
      p.objet.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.marcheNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.societe?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesYear = yearFilter === 'all' || p.annee === yearFilter;
    const matchesAssistance = assistanceFilter === 'all' || p.assistanceTechnique === assistanceFilter;
    const matchesMaitreOeuvre = maitreOeuvreFilter === 'all' || p.maitreOeuvre === maitreOeuvreFilter;
    return matchesSearch && matchesStatus && matchesYear && matchesAssistance && matchesMaitreOeuvre;
  })?.sort((a, b) => {
    // 🆕 ترتيب تصاعدي حسب الرقم الأول من رقم المشروع (1, 3, 23...)
    return extractFirstNumber(a.marcheNo) - extractFirstNumber(b.marcheNo);
  });

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!user || !confirm('Êtes-vous sûr de vouloir supprimer ce projet?')) return;

    try {
      const cleanId = projectId?.replace('project:', '') || projectId;
      await apiService.deleteProject(cleanId);
      // Rafraîchir la liste
      refresh();
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Erreur lors de la suppression du projet');
    }
  };

  // Statistiques
  const stats = {
    total: filteredProjects?.length || 0,
    active: filteredProjects?.filter((p) => p.status === 'active').length || 0,
    completed: filteredProjects?.filter((p) => p.status === 'completed').length || 0,
    draft: filteredProjects?.filter((p) => p.status === 'draft').length || 0,
    totalBudget: filteredProjects?.reduce((sum, p) => sum + getProjectMontantTTC(p.id), 0) || 0,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Clock className="w-4 h-4" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'archived':
        return <Archive className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-700';
      case 'completed':
        return 'bg-blue-100 text-blue-700';
      case 'archived':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-yellow-100 text-yellow-700';
    }
  };

  // Show loading state on Web when fetching from server
  if (isLoading && isWeb()) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600">Chargement des projets depuis le serveur...</p>
      </div>
    );
  }

  // Show error state on Web when offline
  if (error && isWeb()) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <WifiOff className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-red-600 font-medium mb-2">{error}</p>
        <button 
          onClick={() => refresh()}
          className="btn btn-primary flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('project.projects')}</h1>
          <p className="text-gray-600 mt-1">
            {stats.total} {stats.total > 1 ? 'projets' : 'projet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button 
            onClick={() => refresh()}
            disabled={isLoading}
            className="btn btn-secondary flex items-center gap-2"
            title="Rafraîchir depuis le serveur"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          
          {/* New project button - disabled if offline on Web */}
          {canModify ? (
            <Link to="/projects/new" className="btn btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t('project.newProject')}
            </Link>
          ) : (
            <button 
              disabled 
              className="btn btn-primary flex items-center gap-2 opacity-50 cursor-not-allowed"
              title={cannotModifyReason || 'Non disponible hors ligne'}
            >
              <WifiOff className="w-5 h-5" />
              {t('project.newProject')}
            </button>
          )}
        </div>
      </div>

      {/* Offline warning banner for Web */}
      {!isOnline && isWeb() && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <WifiOff className="w-5 h-5 text-yellow-600" />
          <div>
            <p className="font-medium text-yellow-800">Mode hors ligne</p>
            <p className="text-sm text-yellow-700">Les modifications sont désactivées. Reconnectez-vous pour continuer.</p>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              <p className="text-xs text-gray-600">Total</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-600 rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
              <p className="text-xs text-gray-600">Actifs</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
              <p className="text-xs text-gray-600">Terminés</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.draft}</p>
              <p className="text-xs text-gray-600">Brouillons</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">
                {(stats.totalBudget / 1000000).toFixed(1)}M
              </p>
              <p className="text-xs text-gray-600">MAD</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher (Objet, Marché, Société...)"
              className="input pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="input md:w-48"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">{t('project.status.draft')}</option>
            <option value="active">{t('project.status.active')}</option>
            <option value="completed">{t('project.status.completed')}</option>
            <option value="archived">{t('project.status.archived')}</option>
          </select>

          <select
            className="input md:w-32"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          >
            <option value="all">Toutes</option>
            {uniqueYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          {/* Filtre Assistance Technique */}
          {uniqueAssistance.length > 0 && (
            <select
              className="input md:w-48"
              value={assistanceFilter}
              onChange={(e) => setAssistanceFilter(e.target.value)}
              title="Filtrer par Assistance Technique"
            >
              <option value="all">Assistance Tech.</option>
              {uniqueAssistance.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {/* Filtre Maître d'Oeuvre */}
          {uniqueMaitreOeuvre.length > 0 && (
            <select
              className="input md:w-48"
              value={maitreOeuvreFilter}
              onChange={(e) => setMaitreOeuvreFilter(e.target.value)}
              title="Filtrer par Maître d'Oeuvre"
            >
              <option value="all">Maître d'Oeuvre</option>
              {uniqueMaitreOeuvre.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg border ${
                viewMode === 'grid'
                  ? 'bg-primary-50 border-primary-500 text-primary-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg border ${
                viewMode === 'list'
                  ? 'bg-primary-50 border-primary-500 text-primary-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Projects */}
      {!filteredProjects || filteredProjects.length === 0 ? (
        <div className="card text-center py-12">
          <FolderKanban className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">
            {searchTerm || statusFilter !== 'all' || yearFilter !== 'all'
              ? 'Aucun résultat trouvé'
              : 'Aucun projet pour le moment'}
          </p>
          {!searchTerm && statusFilter === 'all' && yearFilter === 'all' && (
            <Link to="/projects/new" className="btn btn-primary inline-flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t('project.newProject')}
            </Link>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            // Normalize ID - remove prefix if exists
            const projectId = project.id.includes(':') ? project.id.split(':').pop() : project.id;
            return (
            <div key={project.id} className="card hover:shadow-lg transition-shadow relative group">
              <Link to={`/projects/${projectId}`} className="block">
                <div className="flex items-start justify-between mb-4">
                  {/* 🆕 رقم المشروع يظهر في الأعلى كعنوان رئيسي */}
                  <h3 className="font-bold text-lg text-primary-700 flex-1 pr-2">
                    {project.marcheNo}
                  </h3>
                  <span
                    className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full flex-shrink-0 ${getStatusColor(
                      project.status
                    )}`}
                  >
                    {getStatusIcon(project.status)}
                    {t(`project.status.${project.status}`)}
                  </span>
                </div>

                {/* 🆕 الاسم (Objet) يظهر تحت رقم المشروع */}
                <p className="text-sm text-gray-700 mb-3 line-clamp-2 font-medium">
                  {project.objet}
                </p>

                <div className="space-y-2 text-sm text-gray-600 mb-4">
                  <div className="flex justify-between">
                    <span>Marché:</span>
                    <span className="font-medium">{project.marcheNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Année:</span>
                    <span className="font-medium">{project.annee}</span>
                  </div>
                  {project.societe && (
                    <div className="flex justify-between">
                      <span>Société:</span>
                      <span className="font-medium truncate ml-2">{project.societe}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Montant (TTC):</span>
                    <span className="font-medium text-primary-600">
                      {getProjectMontantTTC(project.id).toLocaleString('fr-MA', { minimumFractionDigits: 2 })} MAD
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Créé le:</span>
                    <span>{format(new Date(project.createdAt), 'dd/MM/yyyy')}</span>
                  </div>
                </div>

                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                    <span>{t('project.progress')}</span>
                    <span className="font-medium">{getProjectProgress(project.id)}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all"
                      style={{ width: `${getProjectProgress(project.id)}%` }}
                    />
                  </div>
                </div>
              </Link>

              {/* Actions */}
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/projects/${projectId}`);
                  }}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-primary-50 text-primary-600"
                  title="Voir"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="p-2 bg-white rounded-lg shadow-md hover:bg-red-50 text-red-600"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  {/* 🆕 رقم المشروع أولاً */}
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">N° Marché</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Objet</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Année</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Montant (TTC)</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Statut</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Avancement
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project) => {
                  const projectId = project.id.includes(':') ? project.id.split(':').pop() : project.id;
                  return (
                  <tr
                    key={project.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/projects/${projectId}`)}
                  >
                    {/* 🆕 رقم المشروع أولاً بخط عريض */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-primary-700">{project.marcheNo}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{project.objet}</div>
                      {project.societe && (
                        <div className="text-xs text-gray-500">{project.societe}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{project.annee}</td>
                    <td className="py-3 px-4 text-sm font-medium text-primary-600">
                      {getProjectMontantTTC(project.id).toLocaleString('fr-MA', { minimumFractionDigits: 2 })} MAD
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                          project.status
                        )}`}
                      >
                        {getStatusIcon(project.status)}
                        {t(`project.status.${project.status}`)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500"
                            style={{ width: `${getProjectProgress(project.id)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 w-10">{getProjectProgress(project.id)}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/projects/${projectId}`);
                          }}
                          className="p-1.5 hover:bg-primary-50 text-primary-600 rounded"
                          title="Voir"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(project.id, e)}
                          className="p-1.5 hover:bg-red-50 text-red-600 rounded"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
