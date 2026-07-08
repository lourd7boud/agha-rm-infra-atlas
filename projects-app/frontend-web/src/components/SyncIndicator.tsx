import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, WifiOff, CheckCircle, AlertCircle, Loader, RefreshCw, Radio, Trash2 } from 'lucide-react';
import { SyncStatus } from '../hooks/useSyncManager';

interface SyncIndicatorProps {
  syncState: {
    status: SyncStatus;
    lastSyncTime: number | null;
    pendingOperations: number;
    error: string | null;
    realtimeConnected?: boolean;
  };
  onSync?: () => void;
  onClearPending?: () => Promise<any>;
}

const SyncIndicator: FC<SyncIndicatorProps> = ({ syncState, onSync, onClearPending }) => {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [clearing, setClearing] = useState(false);

  const getStatusIcon = () => {
    // Show realtime indicator when connected
    if (syncState.realtimeConnected || syncState.status === 'realtime') {
      return <Radio className="w-4 h-4 text-green-500 animate-pulse" />;
    }
    
    switch (syncState.status) {
      case 'offline':
        return <WifiOff className="w-4 h-4 text-red-500" />;
      case 'syncing':
      case 'pulling':
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'synced':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Wifi className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    if (syncState.realtimeConnected || syncState.status === 'realtime') {
      return t('sync.status.realtime', 'En direct');
    }
    return t(`sync.status.${syncState.status}`);
  };

  const getStatusColor = () => {
    if (syncState.realtimeConnected || syncState.status === 'realtime') {
      return 'bg-green-100 text-green-800 border-green-200';
    }
    
    switch (syncState.status) {
      case 'offline':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'syncing':
      case 'pulling':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'synced':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleClearPending = async () => {
    if (!onClearPending) return;
    setClearing(true);
    try {
      await onClearPending();
      setShowMenu(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50">
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow-sm ${getStatusColor()} cursor-pointer hover:shadow-md transition-shadow`}
        onClick={() => syncState.status === 'error' ? setShowMenu(!showMenu) : onSync?.()}
        title={syncState.status === 'error' ? t('sync.clickForOptions', 'Cliquer pour options') : t('sync.clickToSync', 'Cliquer pour synchroniser')}
      >
        {getStatusIcon()}
        <span className="text-sm font-medium">{getStatusText()}</span>
        {syncState.pendingOperations > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-white rounded-full">
            {syncState.pendingOperations}
          </span>
        )}
        {onSync && syncState.status !== 'syncing' && syncState.status !== 'pulling' && (
          <RefreshCw className="w-4 h-4 ml-1 opacity-60 hover:opacity-100" />
        )}
      </div>
      
      {/* Error message with clear option */}
      {syncState.error && (
        <div className="mt-2 p-2 text-xs text-red-700 bg-red-50 rounded-lg border border-red-200">
          <p>{syncState.error}</p>
          {onClearPending && syncState.pendingOperations > 0 && (
            <button
              onClick={handleClearPending}
              disabled={clearing}
              className="mt-2 flex items-center gap-1 px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded transition-colors disabled:opacity-50"
            >
              {clearing ? (
                <Loader className="w-3 h-3 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3" />
              )}
              {t('sync.clearPending', 'Effacer les opérations en attente')} ({syncState.pendingOperations})
            </button>
          )}
        </div>
      )}
      
      {/* Context menu for error state */}
      {showMenu && syncState.status === 'error' && (
        <div className="mt-2 p-2 bg-white rounded-lg border shadow-lg">
          <button
            onClick={() => { onSync?.(); setShowMenu(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <RefreshCw className="w-4 h-4" />
            {t('sync.retry', 'Réessayer la synchronisation')}
          </button>
          {onClearPending && (
            <button
              onClick={handleClearPending}
              disabled={clearing}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 rounded disabled:opacity-50"
            >
              {clearing ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {t('sync.clearAndRetry', 'Effacer et réessayer')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncIndicator;
