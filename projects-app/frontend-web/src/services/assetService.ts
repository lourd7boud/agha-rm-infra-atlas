/**
 * Asset Service (Unified V1)
 * Single service for all project assets: photos, PV, documents
 * Server-first architecture - no IndexedDB
 */

import { apiService } from './apiService';

export type AssetType = 'photo' | 'pv' | 'document';

export interface ProjectAsset {
  id: string;
  projectId: string;
  type: AssetType;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdBy: string;
  createdByName?: string;
  metadata: Record<string, any>;
  albumId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AssetCounts {
  photos: number;
  pv: number;
  documents: number;
}

export interface CreatePVData {
  pvType: string;
  date: string;
  observations?: string;
  participants?: string[];
}

class AssetService {
  // Note: apiService already has /api as baseURL, so we just use /assets
  private baseUrl = '/assets';

  /**
   * List all assets for a project (optionally filter by type)
   */
  async listAssets(projectId: string, type?: AssetType): Promise<ProjectAsset[]> {
    try {
      const params = type ? `?type=${type}` : '';
      const response = await apiService.get(`${this.baseUrl}/project/${projectId}${params}`);
      return response?.data || [];
    } catch (error) {
      console.error('Error listing assets:', error);
      return [];
    }
  }

  /**
   * Get photos for a project
   */
  async getPhotos(projectId: string): Promise<ProjectAsset[]> {
    return this.listAssets(projectId, 'photo');
  }

  /**
   * Get PVs for a project
   */
  async getPVs(projectId: string): Promise<ProjectAsset[]> {
    return this.listAssets(projectId, 'pv');
  }

  /**
   * Get documents for a project
   */
  async getDocuments(projectId: string): Promise<ProjectAsset[]> {
    return this.listAssets(projectId, 'document');
  }

  /**
   * Get asset counts by type
   */
  async getAssetCounts(projectId: string): Promise<AssetCounts> {
    try {
      const response = await apiService.get(`${this.baseUrl}/project/${projectId}/counts`);
      return response?.data || { photos: 0, pv: 0, documents: 0 };
    } catch (error) {
      console.error('Error getting asset counts:', error);
      return { photos: 0, pv: 0, documents: 0 };
    }
  }

  /**
   * Upload multiple photos
   */
  async uploadPhotos(
    projectId: string,
    files: File[],
    onProgress?: (progress: number) => void,
    albumId?: string
  ): Promise<ProjectAsset[]> {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });
    
    // Add album ID if provided
    if (albumId) {
      formData.append('albumId', albumId);
    }

    try {
      const response = await apiService.postFormData(
        `${this.baseUrl}/project/${projectId}/photos`,
        formData,
        onProgress
      );
      return response?.data || [];
    } catch (error) {
      console.error('Error uploading photos:', error);
      throw error;
    }
  }

  /**
   * Upload a single document
   */
  async uploadDocument(
    projectId: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<ProjectAsset> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'document');

    try {
      const response = await apiService.postFormData(
        `${this.baseUrl}/project/${projectId}/upload`,
        formData,
        onProgress
      );
      return response?.data;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  }

  /**
   * Create a PV (generates PDF on server)
   */
  async createPV(projectId: string, data: CreatePVData): Promise<ProjectAsset> {
    try {
      const response = await apiService.post(`${this.baseUrl}/project/${projectId}/pv`, data);
      return response?.data;
    } catch (error) {
      console.error('Error creating PV:', error);
      throw error;
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(assetId: string): Promise<void> {
    try {
      await apiService.delete(`${this.baseUrl}/${assetId}`);
    } catch (error) {
      console.error('Error deleting asset:', error);
      throw error;
    }
  }

  /**
   * Get full URL for an asset
   */
  getAssetUrl(storagePath: string): string {
    // If already a full URL, return as-is
    if (storagePath.startsWith('http')) {
      return storagePath;
    }
    
    // Ensure path starts with /
    const normalizedPath = storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
    
    // For Electron, use the API URL from electronAPI
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      const electronApiUrl = (window as any).electronAPI.apiUrl || 'https://marocinfra.com';
      // Remove duplicate /uploads if present
      const cleanPath = normalizedPath.replace(/^\/+uploads\/+uploads/, '/uploads');
      return `${electronApiUrl}${cleanPath}`;
    }
    
    // For web, use the current origin + mount base (e.g. '/projects')
    if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
      const base = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
      return `${window.location.origin}${base}${normalizedPath}`;
    }
    
    // Fallback for SSR or other contexts
    return normalizedPath;
  }

  /**
   * Get thumbnail URL for an image asset (much smaller, faster loading)
   * Uses the API endpoint which generates/caches WebP thumbnails
   * @param assetId - The asset UUID
   * @param size - 'grid' (400px) or 'preview' (800px)
   */
  getThumbnailUrl(assetId: string, size: 'grid' | 'preview' = 'grid'): string {
    const mount = ((import.meta as any).env?.BASE_URL || '/');
    const basePath = `${mount}api/assets/${assetId}/thumbnail?size=${size}`;
    
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      const electronApiUrl = (window as any).electronAPI.apiUrl || 'https://marocinfra.com';
      return `${electronApiUrl}${basePath}`;
    }
    
    if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
      return `${window.location.origin}${basePath}`;
    }
    
    return basePath;
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const assetService = new AssetService();
