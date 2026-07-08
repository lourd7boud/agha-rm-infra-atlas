import { FC, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProjects } from '../hooks/useUnifiedData';
import { apiService } from '../services/apiService';
import { isWeb } from '../utils/platform';
import AlertsPanel, { Alert } from '../components/dashboard/AlertsPanel';
import AnalyticsPanel from '../components/dashboard/AnalyticsPanel';
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  TrendingUp,
  Plus,
  AlertTriangle,
  DollarSign,
  FileText,
  AlertCircle,
  Timer,
  Target,
  Zap,
  Shield,
  Receipt,
  Loader2,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { differenceInDays, addMonths } from 'date-fns';

// Types pour les statistiques
interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalBudget: number;
  totalRealized: number;
  averageProgress: number;
  projectsNeedingDecompte: number;
  upcomingDeadlines: number;
}

const DashboardPage: FC = () => {
  useTranslation(); // Initialize translations
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Server-first data loading
  const { projects, isLoading, error, refresh } = useProjects(user?.id || null);
  
  // Online status for Web
  const isOnline = navigator.onLine;
  const canModify = isOnline || !isWeb();
  const cannotModifyReason = !isOnline && isWeb() ? 'Non disponible hors ligne' : null;

  // 🌐 Web: تحميل bordereaux و decompts من API لكل المشاريع
  const [bordereaux, setBordereaux] = useState<any[]>([]);
  const [decompts, setDecompts] = useState<any[]>([]);
  
  useEffect(() => {
    const loadAllData = async () => {
      if (!projects?.length) {
        setBordereaux([]);
        setDecompts([]);
        return;
      }
      
      const allBordereaux: any[] = [];
      const allDecompts: any[] = [];
      
      try {
        // تحميل بالتوازي لكل المشاريع
        await Promise.all(projects.map(async (project) => {
          const cleanId = project.id?.replace('project:', '') || project.id;
          
          try {
            const bRes = await apiService.getBordereaux(cleanId);
            const bData = bRes.data || bRes;
            if (Array.isArray(bData)) {
              allBordereaux.push(...bData.map(b => ({ ...b, projectId: project.id })));
            }
          } catch (e) { /* No bordereau */ }
          
          try {
            const dRes = await apiService.getDecompts(cleanId);
            const dData = dRes.data || dRes;
            if (Array.isArray(dData)) {
              allDecompts.push(...dData.map(d => ({ ...d, projectId: project.id })));
            }
          } catch (e) { /* No decompts */ }
        }));
        
        setBordereaux(allBordereaux.filter(b => !b.deletedAt));
        setDecompts(allDecompts.filter(d => !d.deletedAt));
      } catch (err) {
        console.error('Failed to load bordereaux/decompts:', err);
      }
    };
    
    loadAllData();
  }, [projects]);

  // Calculer les statistiques
  const stats = useMemo<DashboardStats>(() => {
    if (!projects) {
      return {
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        totalBudget: 0,
        totalRealized: 0,
        averageProgress: 0,
        projectsNeedingDecompte: 0,
        upcomingDeadlines: 0,
      };
    }

    const activeProjects = projects.filter((p) => p.status === 'active');
    const completedProjects = projects.filter((p) => p.status === 'completed');
    
    // Calculer le budget total = somme des montants TTC de tous les bordereaux
    // Pour chaque projet, on calcule le montant TTC depuis les lignes du bordereau
    let totalBudget = 0;
    let totalRealized = 0;
    
    for (const project of projects) {
      // تطبيع معرف المشروع للمقارنة
      const cleanProjectId = project.id?.replace('project:', '') || project.id;
      
      // Budget: calculer depuis les bordereaux du projet
      const projectBordereaux = bordereaux?.filter((b: any) => {
        const bProjectId = (b.projectId || b.project_id)?.replace('project:', '') || b.projectId;
        return bProjectId === cleanProjectId || b.projectId === project.id;
      }) || [];
      const projectBudgetTTC = projectBordereaux.reduce((sum: number, b: any) => {
        if (!b.lignes) return sum;
        const montantHT = b.lignes.reduce((s: number, l: any) => {
          return s + (Number(l.quantite || 0) * Number(l.prixUnitaire || l.prix_unitaire || 0));
        }, 0);
        return sum + (montantHT * 1.2); // TTC = HT × 1.2
      }, 0);
      totalBudget += projectBudgetTTC;
      
      // Réalisé: prendre le dernier décompte (cumulatif) du projet
      const projectDecompts = decompts?.filter((d: any) => {
        const dProjectId = (d.projectId || d.project_id)?.replace('project:', '') || d.projectId;
        return dProjectId === cleanProjectId || d.projectId === project.id;
      }) || [];
      
      // ⚠️ FIX: Prendre uniquement le dernier décompte (les décomptes sont cumulatifs)
      // 🔧 FIX: قد تكون هناك ديكونتات مكررة بنفس الرقم - نختار الذي يحتوي على قيم
      if (projectDecompts.length > 0) {
        const maxNumero = Math.max(...projectDecompts.map((d: any) => d.numero || 0));
        const decomptesWithMaxNumero = projectDecompts.filter((d: any) => d.numero === maxNumero);
        
        // اختيار الديكونت الذي يحتوي على قيم (ليس فارغاً)
        const dernierDecompte = decomptesWithMaxNumero.reduce((best: any, d: any) => {
          const dValue = Number(d.totalGeneralTtc || d.totalTtc || d.montantTotal || d.montantCumule || 0);
          const bestValue = Number(best?.totalGeneralTtc || best?.totalTtc || best?.montantTotal || best?.montantCumule || 0);
          return dValue > bestValue ? d : best;
        }, decomptesWithMaxNumero[0]);
        
        // Utiliser totalGeneralTtc > totalTtc > montantTotal > montantCumule comme fallback
        const projectRealizedTTC = Number(
          dernierDecompte?.totalGeneralTtc || 
          dernierDecompte?.totalTtc || 
          dernierDecompte?.montantTotal ||
          dernierDecompte?.montantCumule ||
          0
        );
        totalRealized += projectRealizedTTC;
      }
    }

    // Calculer la progression = (Réalisé / Budget) × 100
    const progressPercent = totalBudget > 0 
      ? Math.round((totalRealized / totalBudget) * 100)
      : 0;

    // Projets qui ont besoin d'un nouveau décompte
    const needDecompte = activeProjects.filter((p) => {
      const cleanPId = p.id?.replace('project:', '') || p.id;
      const projectDecompts = decompts?.filter((d: any) => {
        const dPId = (d.projectId || d.project_id)?.replace('project:', '') || d.projectId;
        return dPId === cleanPId || d.projectId === p.id;
      }) || [];
      if (projectDecompts.length === 0) return true;
      const lastDecompte = projectDecompts.sort((a: any, b: any) => 
        new Date(b.createdAt || b.created_at).getTime() - new Date(a.createdAt || a.created_at).getTime()
      )[0];
      return differenceInDays(new Date(), new Date(lastDecompte.createdAt || lastDecompte.created_at)) > 30;
    });

    // Deadlines à venir
    const upcomingDeadlines = activeProjects.filter((p) => {
      if (!p.osc || !p.delaisExecution) return false;
      const endDate = addMonths(new Date(p.osc), p.delaisExecution);
      const daysRemaining = differenceInDays(endDate, new Date());
      return daysRemaining <= 30 && daysRemaining >= 0;
    });

    return {
      totalProjects: projects.length,
      activeProjects: activeProjects.length,
      completedProjects: completedProjects.length,
      totalBudget,
      totalRealized,
      averageProgress: progressPercent, // Maintenant c'est le % de réalisation financière
      projectsNeedingDecompte: needDecompte.length,
      upcomingDeadlines: upcomingDeadlines.length,
    };
  }, [projects, decompts, bordereaux]);

  // Générer les alertes intelligentes
  const alerts = useMemo<Alert[]>(() => {
    if (!projects) return [];

    const alertsList: Alert[] = [];
    const today = new Date();

    projects.forEach((project) => {
      const projectId = project.id.replace('project:', '');
      const marcheNo = project.marcheNo || '';
      const projectName = project.objet || '';
      
      // 1. Alerte: Délai dépassé
      if (project.status === 'active' && project.osc && project.delaisExecution) {
        const endDate = addMonths(new Date(project.osc), project.delaisExecution);
        const daysOverdue = differenceInDays(today, endDate);
        
        if (daysOverdue > 0) {
          alertsList.push({
            id: `overdue-${project.id}`,
            type: 'critical',
            category: 'deadline',
            icon: AlertTriangle,
            title: `Délai dépassé de ${daysOverdue} jours`,
            description: `${project.objet} (${marcheNo})`,
            detail: `Date fin prévue dépassée`,
            action: { label: 'Voir', path: `/projects/${projectId}` },
            projectId: project.id,
            projectName,
            marcheNo,
            priority: 1,
            daysValue: daysOverdue,
          });
        } else if (daysOverdue > -30) {
          alertsList.push({
            id: `deadline-${project.id}`,
            type: 'warning',
            category: 'deadline',
            icon: Timer,
            title: `Fin de délai dans ${Math.abs(daysOverdue)} jours`,
            description: `${project.objet} (${marcheNo})`,
            detail: `Échéance proche`,
            action: { label: 'Voir', path: `/projects/${projectId}` },
            projectId: project.id,
            projectName,
            marcheNo,
            priority: 2,
            daysValue: daysOverdue,
          });
        }
      }

      // 2. Alerte: Projet sans décompte
      if (project.status === 'active') {
        const projectDecompts = decompts?.filter((d) => d.projectId === project.id) || [];
        
        if (projectDecompts.length === 0) {
          const daysSinceCreation = differenceInDays(today, new Date(project.createdAt));
          if (daysSinceCreation > 15) {
            alertsList.push({
              id: `no-decompte-${project.id}`,
              type: 'warning',
              category: 'finance',
              icon: DollarSign,
              title: 'Aucun décompte créé',
              description: `${project.objet}`,
              detail: `Créé il y a ${daysSinceCreation} jours sans décompte`,
              action: { label: 'Créer', path: `/projects/${projectId}` },
              projectId: project.id,
              projectName,
              marcheNo,
              priority: 2,
            });
          }
        } else {
          const lastDecompte = projectDecompts.sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          const daysSinceLastDecompte = differenceInDays(today, new Date(lastDecompte.createdAt));
          
          if (daysSinceLastDecompte > 30) {
            alertsList.push({
              id: `old-decompte-${project.id}`,
              type: 'info',
              category: 'finance',
              icon: Receipt,
              title: `Dernier décompte il y a ${daysSinceLastDecompte}j`,
              description: `${project.objet}`,
              detail: `Pensez à créer un nouveau décompte`,
              action: { label: 'Nouveau', path: `/projects/${projectId}` },
              projectId: project.id,
              projectName,
              marcheNo,
              priority: 3,
            });
          }
        }
      }

      // 3. Alerte: Fin de garantie proche
      if (project.dateReceptionProvisoire && !project.dateReceptionDefinitive) {
        const recepDate = new Date(project.dateReceptionProvisoire);
        const garantieEndDate = addMonths(recepDate, 12);
        const daysToGarantie = differenceInDays(garantieEndDate, today);
        
        if (daysToGarantie <= 30 && daysToGarantie >= 0) {
          alertsList.push({
            id: `garantie-${project.id}`,
            type: 'warning',
            category: 'warranty',
            icon: Shield,
            title: `Fin garantie dans ${daysToGarantie}j`,
            description: `${project.objet}`,
            detail: `Planifier la réception définitive`,
            action: { label: 'Planifier', path: `/projects/${projectId}/edit` },
            projectId: project.id,
            projectName,
            marcheNo,
            priority: 2,
            daysValue: -daysToGarantie,
          });
        }
      }

      // 4. Alerte: Projet sans bordereau
      if (project.status === 'active') {
        const cleanPId = project.id?.replace('project:', '') || project.id;
        const projectBordereaux = bordereaux?.filter((b: any) => {
          const bPId = (b.projectId || b.project_id)?.replace('project:', '') || b.projectId;
          return bPId === cleanPId || b.projectId === project.id;
        }) || [];
        if (projectBordereaux.length === 0) {
          alertsList.push({
            id: `no-bordereau-${project.id}`,
            type: 'critical',
            category: 'document',
            icon: FileText,
            title: 'Bordereau manquant',
            description: `${project.objet}`,
            detail: `Le bordereau des prix est obligatoire`,
            action: { label: 'Créer', path: `/projects/${projectId}` },
            projectId: project.id,
            projectName,
            marcheNo,
            priority: 1,
          });
        }
      }
    });

    return alertsList.sort((a, b) => a.priority - b.priority);
  }, [projects, decompts, bordereaux]);

  // Projets nécessitant une action
  const projectsNeedingAction = useMemo(() => {
    if (!projects) return [];
    
    return projects
      .filter((p) => p.status === 'active')
      .map((p) => {
        const cleanPId = p.id?.replace('project:', '') || p.id;
        const projectDecompts = decompts?.filter((d: any) => {
          const dPId = (d.projectId || d.project_id)?.replace('project:', '') || d.projectId;
          return dPId === cleanPId || d.projectId === p.id;
        }) || [];
        const lastDecompte = projectDecompts.sort((a: any, b: any) => 
          new Date(b.createdAt || b.created_at).getTime() - new Date(a.createdAt || a.created_at).getTime()
        )[0];
        
        // Calculer le montant TTC depuis le bordereau
        const projectBordereaux = bordereaux?.filter((b: any) => {
          const bPId = (b.projectId || b.project_id)?.replace('project:', '') || b.projectId;
          return bPId === cleanPId || b.projectId === p.id;
        }) || [];
        const montantTTC = projectBordereaux.reduce((sum: number, b: any) => {
          if (!b.lignes) return sum;
          const montantHT = b.lignes.reduce((s: number, l: any) => s + ((l.quantite || 0) * (l.prixUnitaire || l.prix_unitaire || 0)), 0);
          return sum + montantHT * 1.2; // HT * 1.2 = TTC (TVA 20%)
        }, 0);
        
        // Calculer le montant réalisé depuis le DERNIER décompte (cumulatif)
        // ⚠️ FIX: Ne pas sommer tous les décomptes - prendre uniquement le dernier
        // 🔧 FIX: قد تكون هناك ديكونتات مكررة بنفس الرقم - نختار الذي يحتوي على قيم
        let montantRealise = 0;
        if (projectDecompts.length > 0) {
          const maxNumero = Math.max(...projectDecompts.map((d: any) => d.numero || 0));
          const decomptesWithMaxNumero = projectDecompts.filter((d: any) => d.numero === maxNumero);
          
          // اختيار الديكونت الذي يحتوي على قيم (ليس فارغاً)
          const dernierDecompte = decomptesWithMaxNumero.reduce((best: any, d: any) => {
            const dValue = Number(d.totalGeneralTtc || d.totalTtc || d.montantTotal || d.montantCumule || 0);
            const bestValue = Number(best?.totalGeneralTtc || best?.totalTtc || best?.montantTotal || best?.montantCumule || 0);
            return dValue > bestValue ? d : best;
          }, decomptesWithMaxNumero[0]);
          
          montantRealise = Number(
            dernierDecompte?.totalGeneralTtc || 
            dernierDecompte?.totalTtc || 
            dernierDecompte?.montantTotal ||
            dernierDecompte?.montantCumule ||
            0
          );
        }
        
        let urgency = 'normal';
        let reason = '';
        
        if (p.osc && p.delaisExecution) {
          const endDate = addMonths(new Date(p.osc), p.delaisExecution);
          const daysRemaining = differenceInDays(endDate, new Date());
          
          if (daysRemaining < 0) {
            urgency = 'critical';
            reason = `Retard ${Math.abs(daysRemaining)}j`;
          } else if (daysRemaining < 15) {
            urgency = 'high';
            reason = `${daysRemaining}j restants`;
          } else if (daysRemaining < 30) {
            urgency = 'medium';
            reason = `${daysRemaining}j restants`;
          }
        }
        
        // Extraire le numéro pour le tri
        const marcheNum = parseInt(p.marcheNo.split('/')[0]) || 999;
        
        return { ...p, lastDecompte, urgency, reason, montantTTC, montantRealise, marcheNum };
      })
      // Trier par N° Marché (numéro) croissant
      .sort((a, b) => a.marcheNum - b.marcheNum);
      // 🆕 عرض جميع المشاريع بدون حد
  }, [projects, decompts, bordereaux]);

  // Show loading state on Web when fetching from server
  if (isLoading && isWeb()) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600">Chargement des données depuis le serveur...</p>
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
    <div className="space-y-6">
      {/* Offline warning banner for Web */}
      {!isOnline && isWeb() && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
          <WifiOff className="w-5 h-5 text-yellow-600" />
          <div>
            <p className="font-medium text-yellow-800">Mode hors ligne</p>
            <p className="text-sm text-yellow-700">Les modifications sont désactivées. Reconnectez-vous pour continuer.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-gray-600 mt-1">
            Bienvenue, {user?.firstName} ! Voici l'état de vos projets.
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
              Nouveau projet
            </Link>
          ) : (
            <button 
              disabled 
              className="btn btn-primary flex items-center gap-2 opacity-50 cursor-not-allowed"
              title={cannotModifyReason || 'Non disponible hors ligne'}
            >
              <WifiOff className="w-5 h-5" />
              Nouveau projet
            </button>
          )}
        </div>
      </div>

      {/* Centre de notifications intelligent */}
      <AlertsPanel alerts={alerts} />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500 rounded-xl text-white">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-blue-700">Total projets</p>
              <p className="text-2xl font-bold text-blue-900">{stats.totalProjects}</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500 rounded-xl text-white">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-green-700">En cours</p>
              <p className="text-2xl font-bold text-green-900">{stats.activeProjects}</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500 rounded-xl text-white">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-purple-700">Progression</p>
              <p className="text-2xl font-bold text-purple-900">{stats.averageProgress}%</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-500 rounded-xl text-white">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-orange-700">Budget</p>
              <p className="text-xl font-bold text-orange-900">
                {isNaN(stats.totalBudget) || stats.totalBudget === 0 ? '0' : (stats.totalBudget / 1000000).toFixed(1)}M
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Indicateurs rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3 py-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.upcomingDeadlines}</p>
            <p className="text-xs text-gray-500">Délais proches</p>
          </div>
        </div>

        <div className="card flex items-center gap-3 py-3">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Receipt className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.projectsNeedingDecompte}</p>
            <p className="text-xs text-gray-500">Besoins décompte</p>
          </div>
        </div>

        <div className="card flex items-center gap-3 py-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.completedProjects}</p>
            <p className="text-xs text-gray-500">Terminés</p>
          </div>
        </div>

        <div className="card flex items-center gap-3 py-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <DollarSign className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {isNaN(stats.totalRealized) || stats.totalRealized === 0 ? '0' : (stats.totalRealized / 1000000).toFixed(1)}M
            </p>
            <p className="text-xs text-gray-500">Réalisé</p>
          </div>
        </div>
      </div>

      {/* Analytics Panel */}
      <AnalyticsPanel 
        projects={projects || []} 
        decompts={decompts} 
        bordereaux={bordereaux} 
      />

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Projets prioritaires */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Mes projets
            </h2>
            <Link to="/projects" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Voir tout
            </Link>
          </div>

          {!projects || projects.length === 0 ? (
            <div className="text-center py-8">
              <FolderKanban className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-3">Aucun projet</p>
              <Link to="/projects/new" className="btn btn-primary btn-sm inline-flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Créer un projet
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-blue-50 border-y border-blue-200">
                    <th className="py-2 px-3 text-left font-semibold text-blue-900">N° Marché</th>
                    <th className="py-2 px-3 text-left font-semibold text-blue-900">Objet</th>
                    <th className="py-2 px-3 text-left font-semibold text-blue-900">CT</th>
                    <th className="py-2 px-3 text-left font-semibold text-blue-900">Titulaire du marché</th>
                    <th className="py-2 px-3 text-right font-semibold text-blue-900">Montant marché DH</th>
                    <th className="py-2 px-3 text-center font-semibold text-blue-900">Délai du marché</th>
                  </tr>
                </thead>
                <tbody>
                  {projectsNeedingAction.map((project, index) => (
                    <tr
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id.replace('project:', '')}`)}
                      className={`border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      <td className="py-3 px-3 font-medium text-gray-900">{project.marcheNo}</td>
                      <td className="py-3 px-3 text-gray-700 max-w-xs">
                        <p className="line-clamp-2">{project.objet}</p>
                      </td>
                      <td className="py-3 px-3 text-gray-600">{project.commune || '-'}</td>
                      <td className="py-3 px-3 text-gray-600">{project.societe || '-'}</td>
                      <td className="py-3 px-3 text-right font-medium text-gray-900">
                        {project.montantTTC > 0 ? project.montantTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="py-3 px-3 text-center text-gray-600">
                        {project.delaisExecution ? `${String(project.delaisExecution).padStart(2, '0')} Mois` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Résumé financier */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Résumé financier</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Budget total</span>
                <span className="font-medium">{(stats.totalBudget / 1000000).toFixed(2)} M DH</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Montant réalisé</span>
                <span className="font-medium">{(stats.totalRealized / 1000000).toFixed(2)} M DH</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 rounded-full" 
                  style={{ width: `${stats.totalBudget > 0 ? (stats.totalRealized / stats.totalBudget) * 100 : 0}%` }} 
                />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Reste à réaliser</span>
                <span className="font-medium text-orange-600">
                  {((stats.totalBudget - stats.totalRealized) / 1000000).toFixed(2)} M DH
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Taux de réalisation</span>
                <span className={`font-bold ${
                  stats.totalBudget > 0 && (stats.totalRealized / stats.totalBudget) >= 0.7 
                    ? 'text-green-600' 
                    : stats.totalBudget > 0 && (stats.totalRealized / stats.totalBudget) >= 0.4 
                    ? 'text-yellow-600' 
                    : 'text-red-600'
                }`}>
                  {stats.totalBudget > 0 ? ((stats.totalRealized / stats.totalBudget) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>

            {/* Mini chart - répartition par statut */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm text-gray-600 mb-2">Répartition des projets</p>
              <div className="flex gap-1 h-3 rounded-full overflow-hidden">
                {stats.activeProjects > 0 && (
                  <div 
                    className="bg-green-500" 
                    style={{ width: `${(stats.activeProjects / stats.totalProjects) * 100}%` }}
                    title={`En cours: ${stats.activeProjects}`}
                  />
                )}
                {stats.completedProjects > 0 && (
                  <div 
                    className="bg-blue-500" 
                    style={{ width: `${(stats.completedProjects / stats.totalProjects) * 100}%` }}
                    title={`Terminés: ${stats.completedProjects}`}
                  />
                )}
                {(stats.totalProjects - stats.activeProjects - stats.completedProjects) > 0 && (
                  <div 
                    className="bg-gray-300" 
                    style={{ width: `${((stats.totalProjects - stats.activeProjects - stats.completedProjects) / stats.totalProjects) * 100}%` }}
                    title="Autres"
                  />
                )}
              </div>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  En cours ({stats.activeProjects})
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Terminés ({stats.completedProjects})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
