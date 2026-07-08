/**
 * useProjectRealtime Hook
 * 
 * Hook for subscribing to realtime updates for a specific project
 * Automatically subscribes/unsubscribes when projectId changes
 */

import { useEffect, useRef } from 'react';
import { realtimeSync } from '../services/realtimeSync';

export function useProjectRealtime(projectId: string | undefined): void {
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    // Clean ID
    const cleanId = projectId.includes(':') ? projectId.split(':').pop()! : projectId;

    // Don't re-subscribe if already subscribed to same project
    if (subscribedRef.current === cleanId) return;

    // Unsubscribe from previous project
    if (subscribedRef.current) {
      realtimeSync.unsubscribeFromProject(subscribedRef.current);
    }

    // Subscribe to new project
    realtimeSync.subscribeToProject(cleanId);
    subscribedRef.current = cleanId;
    console.log('📢 Subscribed to project realtime:', cleanId);

    return () => {
      if (subscribedRef.current) {
        realtimeSync.unsubscribeFromProject(subscribedRef.current);
        console.log('📢 Unsubscribed from project realtime:', subscribedRef.current);
        subscribedRef.current = null;
      }
    };
  }, [projectId]);
}

export default useProjectRealtime;
