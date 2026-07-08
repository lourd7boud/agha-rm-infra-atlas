/**
 * Platform Detection Utility
 * 
 * Determines if running in Electron (offline-first) or Web (server-first)
 */

/**
 * Check if running in Electron environment
 */
export const isElectron = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.navigator.userAgent.includes('Electron') || 
         window.location.protocol === 'app:' ||
         (window as any).electron !== undefined ||
         (window as any).electronAPI !== undefined;
};

/**
 * Check if running in Web browser (not Electron)
 */
export const isWeb = (): boolean => !isElectron();

/**
 * Web mode = server-first (no offline data display)
 * Electron mode = offline-first (can work without server)
 */
export const isServerFirst = (): boolean => isWeb();

/**
 * Check if offline operations are allowed
 * - Web: NO - must be online to create/edit
 * - Electron: YES - can work offline
 */
export const canWorkOffline = (): boolean => isElectron();

/**
 * Check if cache should be used for display
 * - Web: NO - always fetch from server
 * - Electron: YES - use cache when offline
 */
export const useCacheForDisplay = (): boolean => isElectron();

console.log(`🖥️ Platform: ${isElectron() ? 'Electron (offline-first)' : 'Web (server-first)'}`);
