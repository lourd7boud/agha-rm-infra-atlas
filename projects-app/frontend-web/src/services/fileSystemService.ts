/**
 * File System Service
 * Gère la création et l'organisation des dossiers de projets
 */

export interface StorageConfig {
  type: 'local' | 'onedrive' | 'google-drive' | 'custom';
  basePath: string;
  onedrivePath?: string;
  googleDrivePath?: string;
  customPath?: string;
}

export interface ProjectFolderStructure {
  root: string;
  bordereau: string;
  metre: string;
  decomptes: string;
  attachements: string;
  photos: string;
  pv: string;
  documents: string;
}

// Clé de stockage pour la configuration
const STORAGE_CONFIG_KEY = 'app_storage_config';

// Structure par défaut des dossiers d'un projet
const PROJECT_SUBFOLDERS = [
  'Bordereau',
  'Métré', 
  'Décomptes',
  'Attachements',
  'Photos',
  'PV',
  'Documents'
];

// Export for use in folder creation
export { PROJECT_SUBFOLDERS };

/**
 * Obtenir la configuration de stockage
 */
export const getStorageConfig = (): StorageConfig => {
  const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
  if (saved) {
    return JSON.parse(saved);
  }
  // Configuration par défaut
  return {
    type: 'local',
    basePath: 'MesProjetsBTP',
  };
};

/**
 * Sauvegarder la configuration de stockage
 */
export const saveStorageConfig = (config: StorageConfig): void => {
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
};

/**
 * Générer le chemin du dossier projet
 */
export const generateProjectFolderPath = (
  annee: string,
  marcheNo: string
): string => {
  // Format: ANNEE/NUMERO_MARCHE (ex: 2025/12-2025-dpa-ta)
  const cleanMarcheNo = marcheNo.replace(/\//g, '-').replace(/\s+/g, '-');
  return `${annee}/${cleanMarcheNo}`;
};

/**
 * Obtenir la structure complète des dossiers d'un projet
 */
export const getProjectFolderStructure = (
  projectPath: string
): ProjectFolderStructure => {
  const config = getStorageConfig();
  const basePath = config.basePath;
  const root = `${basePath}/${projectPath}`;
  
  return {
    root,
    bordereau: `${root}/Bordereau`,
    metre: `${root}/Métré`,
    decomptes: `${root}/Décomptes`,
    attachements: `${root}/Attachements`,
    photos: `${root}/Photos`,
    pv: `${root}/PV`,
    documents: `${root}/Documents`,
  };
};

/**
 * Créer la structure de dossiers pour un projet
 * Retourne les chemins créés
 */
export const createProjectFolders = async (
  annee: string,
  marcheNo: string
): Promise<ProjectFolderStructure> => {
  const config = getStorageConfig();
  const projectPath = generateProjectFolderPath(annee, marcheNo);
  const structure = getProjectFolderStructure(projectPath);
  
  // Selon le type de stockage, utiliser différentes méthodes
  switch (config.type) {
    case 'local':
      await createLocalFolders(structure);
      break;
    case 'onedrive':
      await createOneDriveFolders(structure);
      break;
    case 'google-drive':
      await createGoogleDriveFolders(structure);
      break;
    default:
      await createLocalFolders(structure);
  }
  
  return structure;
};

/**
 * Créer les dossiers localement (utilise File System Access API si disponible)
 */
const createLocalFolders = async (structure: ProjectFolderStructure): Promise<void> => {
  // Vérifier si l'API File System Access est disponible
  if ('showDirectoryPicker' in window) {
    try {
      // L'API est disponible, on peut créer les dossiers
      console.log('📁 File System Access API disponible');
      // Note: La création effective se fera quand l'utilisateur choisira un dossier
    } catch (error) {
      console.warn('Impossible de créer les dossiers locaux:', error);
    }
  } else {
    console.log('📁 File System Access API non disponible, utilisation du mode fallback');
  }
  
  // Enregistrer la structure dans localStorage pour référence
  const projectFolders = JSON.parse(localStorage.getItem('project_folders') || '{}');
  projectFolders[structure.root] = {
    structure,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem('project_folders', JSON.stringify(projectFolders));
  
  console.log('✅ Structure de dossiers enregistrée:', structure);
};

/**
 * Créer les dossiers sur OneDrive (placeholder)
 */
const createOneDriveFolders = async (structure: ProjectFolderStructure): Promise<void> => {
  // TODO: Implémenter l'intégration OneDrive avec Microsoft Graph API
  console.log('📁 OneDrive folders (à implémenter):', structure);
  await createLocalFolders(structure); // Fallback
};

/**
 * Créer les dossiers sur Google Drive (placeholder)
 */
const createGoogleDriveFolders = async (structure: ProjectFolderStructure): Promise<void> => {
  // TODO: Implémenter l'intégration Google Drive
  console.log('📁 Google Drive folders (à implémenter):', structure);
  await createLocalFolders(structure); // Fallback
};

/**
 * Ouvrir le dossier d'un projet
 */
export const openProjectFolder = async (folderPath: string): Promise<void> => {
  const config = getStorageConfig();
  const fullPath = `${config.basePath}/${folderPath}`;
  
  // Pour Electron, on peut ouvrir le dossier directement
  if (window.electronAPI?.openFolder) {
    await window.electronAPI.openFolder(fullPath);
    return;
  }
  
  // Pour le web, afficher le chemin
  alert(`Chemin du dossier:\n${fullPath}\n\nCopiez ce chemin pour accéder au dossier.`);
};

/**
 * Sauvegarder un fichier dans le dossier approprié
 */
export const saveFileToProjectFolder = async (
  projectPath: string,
  category: keyof Omit<ProjectFolderStructure, 'root'>,
  fileName: string,
  content: Blob | string
): Promise<string> => {
  const structure = getProjectFolderStructure(projectPath);
  const targetFolder = structure[category];
  const filePath = `${targetFolder}/${fileName}`;
  
  // Si File System Access API est disponible
  if ('showSaveFilePicker' in window) {
    try {
      const options = {
        suggestedName: fileName,
        types: [{
          description: 'Fichier',
          accept: { '*/*': [] as string[] },
        }],
      };
      
      const handle = await (window as any).showSaveFilePicker(options);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      
      console.log('✅ Fichier sauvegardé:', filePath);
      return filePath;
    } catch (error) {
      console.warn('Sauvegarde annulée ou erreur:', error);
    }
  }
  
  // Fallback: téléchargement classique
  const blob = content instanceof Blob ? content : new Blob([content]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  
  return filePath;
};

/**
 * Obtenir le handle du dossier de base (pour File System Access API)
 */
let baseFolderHandle: FileSystemDirectoryHandle | null = null;
let electronBaseFolderPath: string | null = null;

// Check if running in Electron
const isElectron = (): boolean => {
  return !!(window as any).electronAPI?.isElectron || !!(window as any).electron?.isElectron;
};

// Get Electron API
const getElectronAPI = () => {
  return (window as any).electronAPI || (window as any).electron;
};

export const selectBaseFolder = async (): Promise<string | null> => {
  // For Electron: use native dialog
  if (isElectron()) {
    const electronAPI = getElectronAPI();
    if (electronAPI?.selectFolder) {
      try {
        const result = await electronAPI.selectFolder();
        if (result.success && result.folderPath) {
          electronBaseFolderPath = result.folderPath;
          
          const config = getStorageConfig();
          config.basePath = result.folderPath;
          config.customPath = result.folderPath;
          saveStorageConfig(config);
          
          localStorage.setItem('base_folder_name', result.folderPath);
          localStorage.setItem('base_folder_path', result.folderPath);
          
          console.log('✅ [Electron] Dossier de base sélectionné:', result.folderPath);
          return result.folderPath;
        }
        return null;
      } catch (error) {
        console.warn('[Electron] Sélection de dossier annulée:', error);
        return null;
      }
    }
  }
  
  // For Web: use File System Access API
  if (!('showDirectoryPicker' in window)) {
    alert('Votre navigateur ne supporte pas la sélection de dossiers. Utilisez Chrome, Edge ou Opera.');
    return null;
  }
  
  try {
    baseFolderHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
    });
    
    if (baseFolderHandle) {
      const config = getStorageConfig();
      config.basePath = baseFolderHandle.name;
      saveStorageConfig(config);
      
      // Stocker le handle pour réutilisation
      localStorage.setItem('base_folder_name', baseFolderHandle.name);
      
      console.log('✅ Dossier de base sélectionné:', baseFolderHandle.name);
      return baseFolderHandle.name;
    }
    return null;
  } catch (error) {
    console.warn('Sélection de dossier annulée:', error);
    return null;
  }
};

/**
 * Get base folder path (for Electron)
 */
export const getBaseFolderPath = (): string | null => {
  // First check memory
  if (electronBaseFolderPath) return electronBaseFolderPath;
  
  // Then check localStorage
  const saved = localStorage.getItem('base_folder_path');
  if (saved) {
    electronBaseFolderPath = saved;
    return saved;
  }
  
  return null;
};

/**
 * Créer un sous-dossier dans le dossier de base
 */
export const createSubfolder = async (
  path: string
): Promise<FileSystemDirectoryHandle | null> => {
  if (!baseFolderHandle) {
    console.warn('Aucun dossier de base sélectionné');
    return null;
  }
  
  try {
    const parts = path.split('/').filter(p => p);
    let currentHandle = baseFolderHandle;
    
    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }
    
    return currentHandle;
  } catch (error) {
    console.error('Erreur création sous-dossier:', error);
    return null;
  }
};

/**
 * Exporter un fichier vers le dossier du projet
 */
export const exportToProjectFolder = async (
  projectPath: string,
  category: keyof Omit<ProjectFolderStructure, 'root'>,
  fileName: string,
  blob: Blob
): Promise<boolean> => {
  const categoryFolder = category === 'bordereau' ? 'Bordereau' : 
    category === 'metre' ? 'Métré' :
    category === 'decomptes' ? 'Décomptes' :
    category === 'attachements' ? 'Attachements' :
    category === 'photos' ? 'Photos' :
    category === 'pv' ? 'PV' : 'Documents';
  
  const targetPath = `${projectPath}/${categoryFolder}`;
  
  // For Electron: use native file system
  if (isElectron()) {
    const electronAPI = getElectronAPI();
    const basePath = getBaseFolderPath();
    
    if (basePath && electronAPI?.saveToPath) {
      try {
        // Construct full path: basePath/projectPath/categoryFolder/fileName
        const fullPath = `${basePath}/${targetPath}/${fileName}`;
        const data = new Uint8Array(await blob.arrayBuffer());
        
        const result = await electronAPI.saveToPath(data, fullPath);
        if (result.success) {
          console.log('✅ [Electron] Fichier exporté:', fullPath);
          return true;
        }
      } catch (error) {
        console.warn('[Electron] Erreur export vers dossier:', error);
      }
    }
    
    // Fallback: use save dialog
    if (electronAPI?.saveFile) {
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        const result = await electronAPI.saveFile(data, fileName);
        if (result.success) {
          console.log('✅ [Electron] Fichier sauvegardé via dialog:', result.filePath);
          return true;
        }
      } catch (error) {
        console.warn('[Electron] Erreur sauvegarde:', error);
      }
    }
  }
  
  // For Web: use File System Access API if available
  if (baseFolderHandle) {
    try {
      const folderHandle = await createSubfolder(targetPath);
      if (folderHandle) {
        const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        console.log('✅ Fichier exporté:', `${targetPath}/${fileName}`);
        return true;
      }
    } catch (error) {
      console.warn('Erreur export vers dossier:', error);
    }
  }
  
  // Fallback: téléchargement classique
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  
  return true;
};

/**
 * Créer la structure de dossiers pour un projet (Electron uniquement)
 */
export const createProjectFolderStructure = async (projectPath: string): Promise<boolean> => {
  if (!isElectron()) {
    console.log('createProjectFolderStructure: Non-Electron, skipping');
    return false;
  }
  
  const electronAPI = getElectronAPI();
  const basePath = getBaseFolderPath();
  
  if (!basePath || !electronAPI?.saveToPath) {
    console.warn('No base folder selected or Electron API not available');
    return false;
  }
  
  try {
    // Create a placeholder file in each subfolder to ensure folders are created
    for (const subfolder of PROJECT_SUBFOLDERS) {
      const placeholderPath = `${basePath}/${projectPath}/${subfolder}/.gitkeep`;
      const data = new Uint8Array(0);
      await electronAPI.saveToPath(data, placeholderPath);
    }
    
    console.log('✅ [Electron] Structure de dossiers créée:', `${basePath}/${projectPath}`);
    return true;
  } catch (error) {
    console.error('[Electron] Erreur création structure dossiers:', error);
    return false;
  }
};

// Note: ElectronAPI types are declared in src/types/electron.d.ts
