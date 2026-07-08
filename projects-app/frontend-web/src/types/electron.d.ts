// TypeScript declarations for Electron API
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

interface ElectronAPI {
  // Platform Info
  isElectron?: boolean;
  platform?: 'win32' | 'darwin' | 'linux';
  
  // App info
  getAppVersion: () => Promise<string>;
  getAppPath: (name: string) => Promise<string>;
  getVersion?: () => Promise<string>;
  getAppInfo?: () => Promise<{
    version: string;
    platform: string;
    arch: string;
    electron: string;
    node: string;
    isPackaged: boolean;
  }>;
  
  // File System Operations
  saveFile?: (data: Uint8Array, defaultName: string) => Promise<{
    success: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  saveToPath?: (data: Uint8Array, filePath: string) => Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }>;
  openFile?: (filePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  showInFolder?: (filePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  selectFolder?: () => Promise<{
    success: boolean;
    folderPath?: string;
    canceled?: boolean;
    error?: string;
  }>;

  // Shell Operations
  openExternal?: (url: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  openFolder?: (path: string) => Promise<void>;

  // Clipboard Operations
  copyToClipboard?: (text: string) => Promise<{ success: boolean }>;
  readFromClipboard?: () => Promise<string>;

  // Network
  onNetworkChange?: (callback: (isOnline: boolean) => void) => () => void;
  onNavigate?: (callback: (path: string) => void) => () => void;
  
  // Update functions
  checkForUpdates: () => Promise<{ success?: boolean; error?: string; updateInfo?: any }>;
  downloadUpdate: () => Promise<{ success?: boolean; error?: string }>;
  installUpdate: () => Promise<void>;
  
  // Update event listeners
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void;
  onUpdateError: (callback: (error: { message: string }) => void) => () => void;
  onUpdateChecking?: (callback: () => void) => () => void;
  onUpdateProgress?: (callback: (progress: { percent: number }) => void) => () => void;
}

interface Window {
  electron?: ElectronAPI;
  electronAPI?: ElectronAPI;
}
