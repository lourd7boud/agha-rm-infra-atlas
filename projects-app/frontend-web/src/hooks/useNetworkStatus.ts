/**
 * Network Status Hook
 * 
 * Monitors network connectivity and provides status to components.
 * Works with both Web (navigator.onLine) and Electron (IPC events).
 */

import { useState, useEffect, useCallback } from 'react';
import { NetworkStatus, isElectron } from '../services/sync/types';

interface UseNetworkStatusReturn {
  isOnline: boolean;
  status: NetworkStatus;
  lastChecked: number | null;
  checkNow: () => Promise<boolean>;
}

// API health check URL
const HEALTH_CHECK_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/health`
  : `${import.meta.env.BASE_URL}api/health`;

/**
 * Check actual connectivity by making a request
 */
async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(HEALTH_CHECK_URL, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Hook for monitoring network status
 */
export function useNetworkStatus(): UseNetworkStatusReturn {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [status, setStatus] = useState<NetworkStatus>('checking');
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  // Check connectivity
  const checkNow = useCallback(async (): Promise<boolean> => {
    setStatus('checking');
    const online = await checkConnectivity();
    setIsOnline(online);
    setStatus(online ? 'online' : 'offline');
    setLastChecked(Date.now());
    return online;
  }, []);

  useEffect(() => {
    // Initial check
    checkNow();

    // Browser events
    const handleOnline = () => {
      console.log('[Network] Browser reports online');
      checkNow(); // Verify with actual request
    };

    const handleOffline = () => {
      console.log('[Network] Browser reports offline');
      setIsOnline(false);
      setStatus('offline');
      setLastChecked(Date.now());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Electron events
    let unsubscribe: (() => void) | undefined;
    
    if (isElectron() && window.electronAPI?.onNetworkChange) {
      unsubscribe = window.electronAPI.onNetworkChange((online: boolean) => {
        console.log('[Network] Electron reports:', online ? 'online' : 'offline');
        if (online) {
          checkNow();
        } else {
          setIsOnline(false);
          setStatus('offline');
          setLastChecked(Date.now());
        }
      });
    }

    // Periodic check every 30 seconds
    const intervalId = setInterval(() => {
      if (navigator.onLine) {
        checkNow();
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (unsubscribe) unsubscribe();
      clearInterval(intervalId);
    };
  }, [checkNow]);

  return { isOnline, status, lastChecked, checkNow };
}

export default useNetworkStatus;
