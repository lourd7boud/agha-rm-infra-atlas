import { FC, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  LogOut,
  Menu,
  Globe,
  Shield,
  Clock,
  Trash2,
  TrendingUp,
  Database,
  ChevronLeft,
  BarChart3,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useState } from 'react';
import { OfflineBanner } from './NetworkStatusIndicator';
import PresenceBar from './PresenceBar';

interface LayoutProps {
  children: ReactNode;
}

const Layout: FC<LayoutProps> = ({ children }) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const menuItems = [
    { path: '/', icon: LayoutDashboard, label: t('dashboard.title') },
    { path: '/projects', icon: FolderKanban, label: t('project.projects') },
    { path: '/reports', icon: BarChart3, label: 'Rapports' },
    { path: '/delais', icon: Clock, label: 'Gestion des Délais' },
    { path: '/trash', icon: Trash2, label: 'سلة المحذوفات' },
    { path: '/settings', icon: Settings, label: t('settings.title') },
  ];

  // Add admin menu item if user is super_admin
  if (user?.role === 'super_admin' || user?.role === 'admin') {
    menuItems.splice(2, 0, {
      path: '/admin',
      icon: Shield,
      label: 'Administration',
    });
    // إضافة رابط مؤشرات المراجعة
    menuItems.splice(3, 0, {
      path: '/admin/revision-indexes',
      icon: TrendingUp,
      label: 'Révision des Prix',
    });
    // إضافة رابط إدارة المؤشرات
    menuItems.splice(4, 0, {
      path: '/admin/index-management',
      icon: Database,
      label: 'Gestion des Index',
    });
  }

  const sidebarWidth = sidebarOpen ? 'w-64' : 'w-[72px]';

  return (
    <div className="h-screen bg-gray-100 flex overflow-hidden">
      {/* Sidebar — Fixed, full height, dark professional theme */}
      <aside
        className={`${sidebarWidth} fixed inset-y-0 left-0 z-30 flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 transition-all duration-300 ease-in-out`}
      >
        {/* Logo / Header */}
        <div className={`flex items-center h-16 px-4 ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
          {sidebarOpen && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-sky-500/20">
                <span className="text-white font-bold text-sm">B</span>
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-white leading-tight tracking-tight">BTP App</h1>
                <p className="text-[10px] text-slate-400 leading-none">Gestion de Projets</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title={sidebarOpen ? 'Réduire' : 'Étendre'}
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Divider */}
        <div className="mx-3 border-t border-white/10" />

        {/* Online Users Presence */}
        {sidebarOpen && (
          <div className="px-3 py-2">
            <PresenceBar />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-thin">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                title={!sidebarOpen ? item.label : undefined}
                className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-500/15 text-sky-400 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-sky-400 rounded-r-full" />
                )}
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                {sidebarOpen && (
                  <span className="truncate">{item.label}</span>
                )}
                {/* Tooltip when collapsed */}
                {!sidebarOpen && (
                  <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 border border-white/10">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="mx-3 border-t border-white/10" />

        {/* Bottom section */}
        <div className="p-3 space-y-3">
          {/* Language Selector */}
          {sidebarOpen ? (
            <div className="flex gap-1.5 px-1">
              {['fr', 'ar', 'en'].map((lng) => (
                <button
                  key={lng}
                  onClick={() => changeLanguage(lng)}
                  className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    i18n.language === lng
                      ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {lng.toUpperCase()}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                onClick={() => {
                  const langs = ['fr', 'ar', 'en'];
                  const idx = langs.indexOf(i18n.language);
                  changeLanguage(langs[(idx + 1) % langs.length]);
                }}
                title={`Langue: ${i18n.language.toUpperCase()}`}
                className="p-2 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              >
                <Globe className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* User Info */}
          <div className={`flex items-center gap-3 p-2 rounded-lg bg-white/5 ${!sidebarOpen ? 'justify-center' : ''}`}>
            <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 shadow-md">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>
            )}
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            title={!sidebarOpen ? t('auth.logout') : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-red-400/80 hover:text-red-400 hover:bg-red-500/10 ${!sidebarOpen ? 'justify-center' : ''}`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span>{t('auth.logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content — offset by sidebar width */}
      <main className={`flex-1 ${sidebarOpen ? 'ml-64' : 'ml-[72px]'} transition-all duration-300 overflow-auto flex flex-col`}>
        <OfflineBanner />
        <div className="p-8 flex-1">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
