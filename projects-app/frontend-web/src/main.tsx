import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './utils/logger';
import './i18n';
import './index.css';

// Install global error tracking (unhandled errors + promise rejections)
installGlobalErrorHandlers();

// SECURITY: Only expose debug utilities in development mode
if (import.meta.env.DEV && typeof window !== 'undefined') {
  import('./db/database').then(({ db, forceFullSync, purgeSoftDeleted, getSyncStats }) => {
    (window as any).dbUtils = { db, forceFullSync, purgeSoftDeleted, getSyncStats };
    console.log('🔧 [DEV] dbUtils exposed on window.');
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
