/**
 * Desktop File Service
 * 
 * Handles file save/open operations.
 * Uses native dialogs on Electron, browser download on Web.
 */

import { isElectron } from '../services/sync/types';

// ============================================
// Types
// ============================================

export interface SaveFileResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

// ============================================
// File Filters
// ============================================

export const FILE_FILTERS: { [key: string]: FileFilter } = {
  pdf: { name: 'PDF Documents', extensions: ['pdf'] },
  excel: { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
  word: { name: 'Word Documents', extensions: ['docx', 'doc'] },
  image: { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] },
  all: { name: 'All Files', extensions: ['*'] },
};

// ============================================
// Save File Functions
// ============================================

/**
 * Save a file with native dialog (Electron) or browser download (Web)
 */
export async function saveFile(
  data: Uint8Array | Blob | ArrayBuffer,
  fileName: string,
  _options?: {
    filters?: FileFilter[];
    defaultPath?: string;
  }
): Promise<SaveFileResult> {
  // Convert data to Uint8Array if needed
  const uint8Data = await toUint8Array(data);

  // Check if running in Electron
  if (isElectron() && window.electronAPI?.saveFile) {
    try {
      const result = await window.electronAPI.saveFile(uint8Data, fileName);
      
      if (result.success && result.filePath) {
        console.log(`[DesktopFile] File saved to: ${result.filePath}`);
        return result;
      }
      
      if (result.canceled) {
        console.log('[DesktopFile] Save canceled by user');
        return { success: false, canceled: true };
      }
      
      return { success: false, error: result.error || 'Unknown error' };
    } catch (error: any) {
      console.error('[DesktopFile] Error saving file:', error);
      return { success: false, error: error.message };
    }
  }

  // Fallback: Browser download
  return browserDownload(uint8Data, fileName);
}

/**
 * Save a PDF file specifically
 */
export async function savePDF(
  pdfData: Uint8Array | Blob | ArrayBuffer,
  fileName: string
): Promise<SaveFileResult> {
  // Ensure .pdf extension
  const pdfFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  
  return saveFile(pdfData, pdfFileName, {
    filters: [FILE_FILTERS.pdf, FILE_FILTERS.all],
  });
}

/**
 * Save an Excel file specifically
 */
export async function saveExcel(
  excelData: Uint8Array | Blob | ArrayBuffer,
  fileName: string
): Promise<SaveFileResult> {
  // Ensure .xlsx extension
  const excelFileName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  
  return saveFile(excelData, excelFileName, {
    filters: [FILE_FILTERS.excel, FILE_FILTERS.all],
  });
}

/**
 * Save file to a specific path (Electron only, no dialog)
 */
export async function saveToPath(
  data: Uint8Array | Blob | ArrayBuffer,
  filePath: string
): Promise<SaveFileResult> {
  const uint8Data = await toUint8Array(data);

  if (isElectron() && window.electronAPI?.saveToPath) {
    try {
      const result = await window.electronAPI.saveToPath(uint8Data, filePath);
      
      if (result.success) {
        console.log(`[DesktopFile] File saved to path: ${filePath}`);
      }
      
      return result;
    } catch (error: any) {
      console.error('[DesktopFile] Error saving to path:', error);
      return { success: false, error: error.message };
    }
  }

  // Not supported in Web
  console.warn('[DesktopFile] saveToPath not available in Web mode');
  return { success: false, error: 'Not supported in Web mode' };
}

// ============================================
// Open File Functions
// ============================================

/**
 * Open a file in the default application
 */
export async function openFile(filePath: string): Promise<boolean> {
  if (isElectron() && window.electronAPI?.openFile) {
    try {
      const result = await window.electronAPI.openFile(filePath);
      return result.success;
    } catch (error) {
      console.error('[DesktopFile] Error opening file:', error);
      return false;
    }
  }

  console.warn('[DesktopFile] openFile not available in Web mode');
  return false;
}

/**
 * Show file in folder/explorer
 */
export async function showInFolder(filePath: string): Promise<boolean> {
  if (isElectron() && window.electronAPI?.showInFolder) {
    try {
      const result = await window.electronAPI.showInFolder(filePath);
      return result.success;
    } catch (error) {
      console.error('[DesktopFile] Error showing in folder:', error);
      return false;
    }
  }

  console.warn('[DesktopFile] showInFolder not available in Web mode');
  return false;
}

/**
 * Select a folder using native dialog
 */
export async function selectFolder(): Promise<string | null> {
  if (isElectron() && window.electronAPI?.selectFolder) {
    try {
      const result = await window.electronAPI.selectFolder();
      
      if (result.success && result.folderPath) {
        return result.folderPath;
      }
      
      return null;
    } catch (error) {
      console.error('[DesktopFile] Error selecting folder:', error);
      return null;
    }
  }

  console.warn('[DesktopFile] selectFolder not available in Web mode');
  return null;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Convert various data types to Uint8Array
 */
async function toUint8Array(data: Uint8Array | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  
  if (data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  
  throw new Error('Unsupported data type');
}

/**
 * Browser download fallback
 */
function browserDownload(data: Uint8Array, fileName: string): SaveFileResult {
  try {
    // Create blob (convert Uint8Array to regular array for compatibility)
    const blob = new Blob([new Uint8Array(data)], { type: getMimeType(fileName) });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    console.log(`[DesktopFile] Browser download triggered: ${fileName}`);
    return { success: true, filePath: fileName };
  } catch (error: any) {
    console.error('[DesktopFile] Browser download error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get MIME type from filename
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    txt: 'text/plain',
    json: 'application/json',
  };
  
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Check if running in desktop mode with file system access
 */
export function hasFileSystemAccess(): boolean {
  return isElectron() && !!window.electronAPI?.saveFile;
}

/**
 * Get the suggested save path for project files
 */
export function getProjectFilePath(
  projectName: string,
  fileName: string,
  folder: 'decomptes' | 'metres' | 'attachements' | 'pv' | 'photos' = 'decomptes'
): string {
  // Sanitize project name for filesystem
  const safeName = projectName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  
  return `BTP_Projects/${safeName}/${folder}/${fileName}`;
}
