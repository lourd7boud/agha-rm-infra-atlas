/**
 * Network Status Indicator Component
 * 
 * Displays current network and sync status with visual indicators.
 * Shows: Online/Offline/Syncing status + pending changes count.
 */

import React from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus';

interface NetworkStatusIndicatorProps {
  showLabel?: boolean;
  showPendingCount?: boolean;
  compact?: boolean;
  className?: string;
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({
  showLabel = true,
  showPendingCount = true,
  compact = false,
  className = '',
}) => {
  const { 
    networkStatus, 
    status: syncStatus, 
    pendingCount, 
    conflictCount,
  } = useSyncStatus();

  // Determine display status
  const getStatusInfo = () => {
    if (syncStatus === 'syncing') {
      return {
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-100',
        borderColor: 'border-yellow-300',
        icon: '🔄',
        label: 'Synchronisation...',
        pulse: true,
      };
    }
    
    if (networkStatus === 'offline') {
      return {
        color: 'text-red-500',
        bgColor: 'bg-red-100',
        borderColor: 'border-red-300',
        icon: '🔴',
        label: 'Hors ligne',
        pulse: false,
      };
    }
    
    if (syncStatus === 'error') {
      return {
        color: 'text-orange-500',
        bgColor: 'bg-orange-100',
        borderColor: 'border-orange-300',
        icon: '⚠️',
        label: 'Erreur sync',
        pulse: false,
      };
    }
    
    if (conflictCount > 0) {
      return {
        color: 'text-purple-500',
        bgColor: 'bg-purple-100',
        borderColor: 'border-purple-300',
        icon: '⚡',
        label: 'Conflits',
        pulse: true,
      };
    }
    
    if (pendingCount > 0) {
      return {
        color: 'text-blue-500',
        bgColor: 'bg-blue-100',
        borderColor: 'border-blue-300',
        icon: '📤',
        label: 'En attente',
        pulse: false,
      };
    }
    
    return {
      color: 'text-green-500',
      bgColor: 'bg-green-100',
      borderColor: 'border-green-300',
      icon: '🟢',
      label: 'En ligne',
      pulse: false,
    };
  };

  const statusInfo = getStatusInfo();

  if (compact) {
    return (
      <div 
        className={`flex items-center gap-1 ${className}`}
        title={`${statusInfo.label}${pendingCount > 0 ? ` - ${pendingCount} en attente` : ''}`}
      >
        <span className={`${statusInfo.pulse ? 'animate-pulse' : ''}`}>
          {statusInfo.icon}
        </span>
        {showPendingCount && pendingCount > 0 && (
          <span className={`text-xs font-medium ${statusInfo.color}`}>
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full border
        ${statusInfo.bgColor} ${statusInfo.borderColor}
        ${className}
      `}
    >
      {/* Status Icon */}
      <span className={`${statusInfo.pulse ? 'animate-pulse' : ''}`}>
        {statusInfo.icon}
      </span>

      {/* Label */}
      {showLabel && (
        <span className={`text-sm font-medium ${statusInfo.color}`}>
          {statusInfo.label}
        </span>
      )}

      {/* Pending Count Badge */}
      {showPendingCount && pendingCount > 0 && (
        <span 
          className={`
            px-1.5 py-0.5 text-xs font-bold rounded-full
            ${statusInfo.bgColor} ${statusInfo.color}
          `}
        >
          {pendingCount}
        </span>
      )}

      {/* Conflict Badge */}
      {conflictCount > 0 && (
        <span 
          className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-purple-200 text-purple-700"
          title={`${conflictCount} conflits à résoudre`}
        >
          ⚡{conflictCount}
        </span>
      )}
    </div>
  );
};

/**
 * Offline Banner Component
 * 
 * Shows a banner at the top when offline.
 */
export const OfflineBanner: React.FC = () => {
  const { networkStatus, pendingCount } = useSyncStatus();

  if (networkStatus !== 'offline') return null;

  return (
    <div className="bg-yellow-500 text-yellow-900 px-4 py-2 text-center text-sm font-medium">
      <span className="mr-2">📡</span>
      Vous êtes hors ligne. 
      {pendingCount > 0 && (
        <span className="ml-1">
          {pendingCount} modification{pendingCount > 1 ? 's' : ''} en attente de synchronisation.
        </span>
      )}
    </div>
  );
};

/**
 * Sync Status Badge for items
 * 
 * Small badge to show sync status of individual items.
 */
interface SyncBadgeProps {
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  size?: 'sm' | 'md';
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({ status, size = 'sm' }) => {
  const config = {
    pending: { icon: '⏳', color: 'text-yellow-500', title: 'En attente de sync' },
    syncing: { icon: '🔄', color: 'text-blue-500', title: 'Synchronisation...' },
    synced: { icon: '✓', color: 'text-green-500', title: 'Synchronisé' },
    failed: { icon: '✗', color: 'text-red-500', title: 'Échec de sync' },
    conflict: { icon: '⚡', color: 'text-purple-500', title: 'Conflit' },
  };

  const { icon, color, title } = config[status];
  const sizeClass = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span 
      className={`${sizeClass} ${color} ${status === 'syncing' ? 'animate-spin' : ''}`}
      title={title}
    >
      {icon}
    </span>
  );
};

export default NetworkStatusIndicator;
