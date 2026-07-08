import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './store/authStore';
import { useSyncManager } from './hooks/useSyncManager';
import { useAutoUpdater } from './hooks/useAutoUpdater';
import { isWeb, isElectron } from './utils/platform';

// Eagerly loaded pages (critical path)
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';

// Phase 2: Lazy-loaded pages (code splitting)
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const CreateProjectPage = lazy(() => import('./pages/CreateProjectPage'));
const EditProjectPage = lazy(() => import('./pages/EditProjectPage'));
const DelaisPage = lazy(() => import('./pages/DelaisPage'));
const BordereauPage = lazy(() => import('./pages/BordereauPage'));
const MetrePage = lazy(() => import('./pages/MetrePage'));
const PeriodeDecomptePage = lazy(() => import('./pages/PeriodeDecomptePage'));
const AttachementPage = lazy(() => import('./pages/AttachementPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const UsersManagementPage = lazy(() => import('./pages/UsersManagementPage'));
const TrashPage = lazy(() => import('./pages/TrashPage'));
const RevisionIndexesPage = lazy(() => import('./pages/RevisionIndexesPage'));
const IndexManagementPage = lazy(() => import('./pages/revision/IndexManagementPage'));
const ClientPortalPage = lazy(() => import('./pages/ClientPortalPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

// Components
import Layout from './components/Layout';
import SyncIndicator from './components/SyncIndicator';
import { UpdateNotification } from './components/UpdateNotification';

// Loading fallback for lazy pages
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
  </div>
);

function App() {
  useTranslation(); // Initialize i18n
  const { user, isInitialized, checkAuth } = useAuthStore();
  
  // 🔴 WEB = SERVER-FIRST: لا نستخدم Sync على المتصفح
  // 🔵 ELECTRON = OFFLINE-FIRST: Sync فقط على Electron
  const { syncState, sync, clearPendingOperations } = useSyncManager(
    isElectron() ? (user?.id || null) : null  // تعطيل Sync على Web
  );
  
  // 🔴 حالة الاتصال للـ Web (بديل بسيط عن syncState)
  const [webConnectionState, setWebConnectionState] = useState({
    isOnline: navigator.onLine,
    lastCheck: Date.now(),
  });
  
  // مراقبة حالة الاتصال على Web
  useEffect(() => {
    if (!isWeb()) return;
    
    console.log('🌐 [WEB] Server-First mode - No IndexedDB, No Sync Engine');
    
    const handleOnline = () => setWebConnectionState({ isOnline: true, lastCheck: Date.now() });
    const handleOffline = () => setWebConnectionState({ isOnline: false, lastCheck: Date.now() });
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  // Setup auto-updater (only works in Electron)
  useAutoUpdater();

  // 🔴 Web: Simple status function
  // 🔵 Electron: Full repair and sync functions
  useEffect(() => {
    if (isWeb()) {
      (window as any).btpStatus = () => ({
        mode: 'WEB SERVER-FIRST',
        online: webConnectionState.isOnline,
        message: 'Web mode - all data loaded directly from server, no local storage',
      });
      return () => { delete (window as any).btpStatus; };
    }
    
    // 🔵 ELECTRON: Expose sync and repair functions
    (window as any).btpSync = { 
      sync, 
      clearPendingOperations,
      status: () => ({
        mode: 'ELECTRON OFFLINE-FIRST',
        syncState,
        message: 'Electron mode - IndexedDB + Sync Engine',
      }),
    };
    
    return () => { delete (window as any).btpSync; };
  }, [webConnectionState, syncState, sync, clearPendingOperations]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 🔴 WEB = SERVER-FIRST: Pas de sync sur Web
  // 🔵 ELECTRON = OFFLINE-FIRST: Sync activé
  useEffect(() => {
    if (!isInitialized) {
      console.log('⏳ Waiting for auth to initialize...');
      return;
    }
    
    if (!user) {
      console.log('👤 No user, skipping sync');
      return;
    }
    
    console.log('✅ Auth initialized for user:', user.id);
    
    if (isWeb()) {
      console.log('🌐 [WEB] Server-First mode - No sync, no IndexedDB');
      return;
    }
    
    // 🔵 Electron only: Start sync
    console.log('🖥️ [ELECTRON] Offline-First mode - Starting sync...');
    
    const timer = setTimeout(() => {
      sync().catch((error) => {
        if (error.response?.status !== 401) {
          console.error('Sync error:', error);
        }
      });
    }, 300);
    
    return () => clearTimeout(timer);
  }, [isInitialized, user?.id, sync]);

  // 🔴 WEB: حالة بسيطة للاتصال بدلاً من sync
  // 🔵 ELECTRON: حالة sync الكاملة
  const effectiveSyncState = isWeb() 
    ? {
        status: webConnectionState.isOnline ? 'synced' as const : 'offline' as const,
        lastSyncTime: webConnectionState.lastCheck,
        pendingOperations: 0,
        error: webConnectionState.isOnline ? null : 'Mode hors ligne',
        lastPullCount: 0,
        realtimeConnected: false,
      }
    : syncState;

  return (
    <>
      {/* 🔴 على Web: إظهار مؤشر الاتصال فقط */}
      {/* 🔵 على Electron: إظهار مؤشر Sync الكامل */}
      <SyncIndicator 
        syncState={effectiveSyncState} 
        onSync={isElectron() ? sync : undefined}  // لا sync على Web
        onClearPending={isElectron() ? clearPendingOperations : undefined}
      />
      <UpdateNotification />
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal/:token" element={<ClientPortalPage />} />
        
        <Route
          path="/"
          element={
            user ? (
              <Layout>
                <DashboardPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects"
          element={
            user ? (
              <Layout>
                <ProjectsPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/new"
          element={
            user ? (
              <Layout>
                <CreateProjectPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:id"
          element={
            user ? (
              <Layout>
                <ProjectDetailPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:id/edit"
          element={
            user ? (
              <Layout>
                <EditProjectPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/delais"
          element={
            user ? (
              <Layout>
                <DelaisPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/reports"
          element={
            user ? (
              <Layout>
                <ReportsPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:projectId/bordereau"
          element={
            user ? (
              <Layout>
                <BordereauPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* Métré principal - utilise V3 avec structure hiérarchique */}
        <Route
          path="/projects/:projectId/metre"
          element={
            user ? (
              <Layout>
                <MetrePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* Alias pour /metres - redirige vers V3 */}
        <Route
          path="/projects/:projectId/metres"
          element={
            user ? (
              <Layout>
                <MetrePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* Alias metre-v3 - même chose que /metre */}
        <Route
          path="/projects/:projectId/metre-v3"
          element={
            user ? (
              <Layout>
                <MetrePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:projectId/metre/:periodeId"
          element={
            user ? (
              <Layout>
                <MetrePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* Redirect old decomptes routes to project page */}
        <Route
          path="/projects/:projectId/decompte"
          element={<Navigate to=".." replace />}
        />
        <Route
          path="/projects/:projectId/decomptes"
          element={<Navigate to=".." replace />}
        />
        
        <Route
          path="/projects/:projectId/decompte/:periodeId"
          element={
            user ? (
              <Layout>
                <PeriodeDecomptePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* Legacy routes - redirect to new pages */}
        <Route
          path="/projects/:projectId/periodes"
          element={
            user ? (
              <Navigate to={`/projects/${window.location.pathname.split('/')[2]}/metre`} replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:projectId/periodes/:periodeId/metre"
          element={
            user ? (
              <Layout>
                <MetrePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:projectId/periodes/:periodeId/decompte"
          element={
            user ? (
              <Layout>
                <PeriodeDecomptePage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/projects/:projectId/periodes/:periodeId/attachement"
          element={
            user ? (
              <Layout>
                <AttachementPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        {/* New direct attachement route */}
        <Route
          path="/projects/:projectId/attachement"
          element={
            user ? (
              <Layout>
                <AttachementPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/settings"
          element={
            user ? (
              <Layout>
                <SettingsPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/trash"
          element={
            user ? (
              <Layout>
                <TrashPage />
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route
          path="/admin"
          element={
            user?.role === 'super_admin' || user?.role === 'admin' ? (
              <Layout>
                <AdminDashboardPage />
              </Layout>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        
        <Route
          path="/admin/users"
          element={
            user?.role === 'super_admin' || user?.role === 'admin' ? (
              <Layout>
                <UsersManagementPage />
              </Layout>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        
        {/* ═══════════════════════════════════════════════════════════════════════
         * 📊 Price Revision (Phase 2: Input Only)
         * ═══════════════════════════════════════════════════════════════════════ */}
        <Route
          path="/admin/revision-indexes"
          element={
            user?.role === 'super_admin' ? (
              <Layout>
                <RevisionIndexesPage />
              </Layout>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        
        {/* ═══════════════════════════════════════════════════════════════════════
         * 📊 Index Management (Phase 4B: Admin)
         * ═══════════════════════════════════════════════════════════════════════ */}
        <Route
          path="/admin/index-management"
          element={
            user?.role === 'super_admin' || user?.role === 'admin' ? (
              <Layout>
                <IndexManagementPage />
              </Layout>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

export default App;
