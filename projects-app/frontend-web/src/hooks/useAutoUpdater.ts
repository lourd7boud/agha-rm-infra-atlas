import { useEffect } from 'react';
import { useUpdateStore } from '../store/updateStore';

/**
 * Hook to setup Electron auto-updater listeners
 * Should be used once at the app root level
 */
export function useAutoUpdater() {
  const {
    setUpdateAvailable,
    setDownloadProgress,
    setUpdateDownloaded,
    setError,
    setCurrentVersion,
  } = useUpdateStore();

  useEffect(() => {
    // Check if running in Electron
    if (!window.electron) {
      console.log('Not running in Electron, auto-updater disabled');
      return;
    }

    // Get current app version
    window.electron.getAppVersion().then((version) => {
      setCurrentVersion(version);
      console.log('Current app version:', version);
    });

    // Setup update listeners
    const unsubscribeUpdateAvailable = window.electron.onUpdateAvailable((info) => {
      console.log('Update available:', info);
      setUpdateAvailable(info);
    });

    const unsubscribeUpdateNotAvailable = window.electron.onUpdateNotAvailable((info) => {
      console.log('No updates available, current version:', info.version);
    });

    const unsubscribeDownloadProgress = window.electron.onDownloadProgress((progress) => {
      console.log('Download progress:', progress.percent + '%');
      setDownloadProgress(progress);
    });

    const unsubscribeUpdateDownloaded = window.electron.onUpdateDownloaded((info) => {
      console.log('Update downloaded:', info.version);
      setUpdateDownloaded(info);
    });

    const unsubscribeUpdateError = window.electron.onUpdateError((error) => {
      console.error('Update error:', error.message);
      setError(error.message);
    });

    // Cleanup listeners on unmount
    return () => {
      unsubscribeUpdateAvailable();
      unsubscribeUpdateNotAvailable();
      unsubscribeDownloadProgress();
      unsubscribeUpdateDownloaded();
      unsubscribeUpdateError();
    };
  }, [setUpdateAvailable, setDownloadProgress, setUpdateDownloaded, setError, setCurrentVersion]);
}
