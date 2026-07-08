import { create } from 'zustand';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

interface UpdateStore {
  // State
  isUpdateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  isUpdateDownloaded: boolean;
  error: string | null;
  currentVersion: string;
  
  // Actions
  setUpdateAvailable: (info: UpdateInfo) => void;
  setDownloading: (isDownloading: boolean) => void;
  setDownloadProgress: (progress: DownloadProgress) => void;
  setUpdateDownloaded: (info: { version: string }) => void;
  setError: (error: string | null) => void;
  setCurrentVersion: (version: string) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  // Initial state
  isUpdateAvailable: false,
  updateInfo: null,
  isDownloading: false,
  downloadProgress: null,
  isUpdateDownloaded: false,
  error: null,
  currentVersion: '',
  
  // Actions
  setUpdateAvailable: (info) => set({ 
    isUpdateAvailable: true, 
    updateInfo: info,
    error: null,
  }),
  
  setDownloading: (isDownloading) => set({ isDownloading }),
  
  setDownloadProgress: (progress) => set({ downloadProgress: progress }),
  
  setUpdateDownloaded: (_info) => set({ 
    isUpdateDownloaded: true, 
    isDownloading: false,
    downloadProgress: null,
  }),
  
  setError: (error) => set({ error, isDownloading: false }),
  
  setCurrentVersion: (version) => set({ currentVersion: version }),
  
  reset: () => set({
    isUpdateAvailable: false,
    updateInfo: null,
    isDownloading: false,
    downloadProgress: null,
    isUpdateDownloaded: false,
    error: null,
  }),
}));
