import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Activity, Shield, ArrowLeft, AlertCircle, RefreshCw,
  Wifi, WifiOff, FolderOpen, Clock,
  UserCheck
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiService } from '../services/apiService';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  onlineUsers: number;
  trialUsers: number;
  expiredTrials: number;
  totalAdmins: number;
  totalProjects: number;
  recentLogins: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    lastLogin: string;
  }>;
}

interface AuditLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
}

interface OnlineUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  currentPage?: string;
  currentActivity?: string;
  projectName?: string;
  lastHeartbeat: string;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsResult, logsResult, onlineResult] = await Promise.all([
        apiService.getAdminStats(),
        apiService.getAuditLogs({ limit: 15 }),
        apiService.getOnlineUsers(),
      ]);

      // Map backend response shape to frontend DashboardStats
      const raw = statsResult.data;
      setStats({
        totalUsers: raw?.users?.total ?? 0,
        activeUsers: raw?.users?.active ?? 0,
        onlineUsers: raw?.online ?? 0,
        trialUsers: raw?.users?.trial ?? 0,
        expiredTrials: raw?.users?.expired ?? 0,
        totalAdmins: (raw?.users?.admins ?? 0) + (raw?.users?.superAdmins ?? 0),
        totalProjects: raw?.projects?.total ?? 0,
        recentLogins: raw?.recentLogins ?? [],
      });
      setAuditLogs(logsResult.data || []);
      setOnlineUsers(onlineResult.data || []);
    } catch (err: any) {
      console.error('Error loading dashboard:', err);
      setError(err.response?.data?.error?.message || err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.role !== 'super_admin' && currentUser?.role !== 'admin') {
      navigate('/');
      return;
    }
    loadDashboardData();

    // Auto-refresh every 30s
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, [currentUser, navigate, loadDashboardData]);

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      create_user: 'Utilisateur créé',
      update_user: 'Utilisateur modifié',
      disable_user: 'Utilisateur désactivé',
      enable_user: 'Utilisateur activé',
      delete_user: 'Utilisateur supprimé',
      extend_trial: 'Essai prolongé',
      update_role: 'Rôle modifié',
      login: 'Connexion',
      logout: 'Déconnexion',
      add_project_member: 'Membre ajouté au projet',
      remove_project_member: 'Membre retiré du projet',
    };
    return labels[action] || action;
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatTimeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'à l\'instant';
    if (mins < 60) return `il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    return formatDate(d);
  };

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
        <span className="ml-3 text-gray-600">Chargement du tableau de bord...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Header ─── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate('/')} className="p-2 hover:bg-gray-100 rounded-lg">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">Tableau de bord Admin</h1>
                  <p className="text-sm text-gray-500">Vue d'ensemble du système</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={loadDashboardData} className="p-2 hover:bg-gray-100 rounded-lg" title="Rafraîchir">
                <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => navigate('/admin/users')} className="btn btn-primary flex items-center gap-2">
                <Users className="w-4 h-4" />
                Gérer les utilisateurs
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={loadDashboardData} className="ml-auto text-red-600 hover:text-red-800 underline text-xs">Réessayer</button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ─── Stats Grid ─── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard title="Total Utilisateurs" value={stats?.totalUsers || 0} icon={Users} color="blue" />
          <StatCard title="Actifs" value={stats?.activeUsers || 0} icon={UserCheck} color="green" />
          <StatCard title="En Ligne" value={stats?.onlineUsers || 0} icon={Wifi} color="emerald" pulse />
          <StatCard title="Administrateurs" value={stats?.totalAdmins || 0} icon={Shield} color="purple" />
          <StatCard title="Projets" value={stats?.totalProjects || 0} icon={FolderOpen} color="indigo" />
          <StatCard title="Essais Expirés" value={stats?.expiredTrials || 0} icon={AlertCircle} color="red" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ─── Online Users ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-green-500" />
                <h2 className="text-sm font-semibold text-gray-900">Utilisateurs en ligne</h2>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {onlineUsers.length}
              </span>
            </div>
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {onlineUsers.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <WifiOff className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Aucun utilisateur en ligne</p>
                </div>
              ) : (
                onlineUsers.map(user => (
                  <div key={user.id} className="px-5 py-3 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                          {user.firstName?.[0]}{user.lastName?.[0]}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {user.firstName} {user.lastName}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {user.currentActivity || user.currentPage || 'Naviguer'}
                          {user.projectName && <span className="text-blue-600"> · {user.projectName}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-400">{formatTimeAgo(user.lastHeartbeat)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ─── Recent Activity ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 lg:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Activité Récente</h2>
            </div>
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {auditLogs.length === 0 ? (
                <div className="px-5 py-12 text-center text-gray-400 text-sm">
                  Aucune activité récente
                </div>
              ) : (
                auditLogs.map(log => (
                  <div key={log.id} className="px-5 py-3 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {log.userEmail}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full whitespace-nowrap">
                            {getActionLabel(log.action)}
                          </span>
                        </div>
                        {log.details && (
                          <div className="text-xs text-gray-500 truncate">
                            {log.details.email && <span>→ {log.details.email}</span>}
                            {log.details.role && <span className="ml-2">Rôle: {log.details.role}</span>}
                            {log.details.reason && <span className="ml-2">Motif: {log.details.reason}</span>}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 whitespace-nowrap">
                        {formatTimeAgo(log.createdAt)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── Recent Logins ─── */}
        {stats?.recentLogins && stats.recentLogins.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Dernières Connexions</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100">
              {stats.recentLogins.map(login => (
                <div key={login.id} className="bg-white px-5 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                    {login.firstName?.[0]}{login.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {login.firstName} {login.lastName}
                    </div>
                    <div className="text-xs text-gray-500">{login.lastLogin ? formatTimeAgo(login.lastLogin) : '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Stat Card
// ═══════════════════════════════════════════════════════════════

function StatCard({ title, value, icon: Icon, color, pulse }: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  pulse?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    purple: 'bg-purple-100 text-purple-600',
    indigo: 'bg-indigo-100 text-indigo-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color] || colorMap.blue}`}>
          <Icon className="w-5 h-5" />
        </div>
        {pulse && value > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{title}</p>
    </div>
  );
}
