/**
 * Album Service - API calls for photo albums
 */
import { apiService } from './apiService';

export interface Album {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  coverPhotoId?: string;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlbumRequest {
  name: string;
  description?: string;
}

export interface UpdateAlbumRequest {
  name?: string;
  description?: string;
  coverPhotoId?: string;
}

export interface MovePhotosRequest {
  photoIds: string[];
}

/**
 * Get all albums for a project
 */
export const getAlbums = async (projectId: string): Promise<Album[]> => {
  const response = await apiService.get(`/albums/project/${projectId}`);
  return response?.data || [];
};

/**
 * Create a new album
 */
export const createAlbum = async (projectId: string, data: CreateAlbumRequest): Promise<Album> => {
  const response = await apiService.post(`/albums/project/${projectId}`, data);
  return response?.data;
};

/**
 * Update an album
 */
export const updateAlbum = async (albumId: string, data: UpdateAlbumRequest): Promise<Album> => {
  const response = await apiService.put(`/albums/${albumId}`, data);
  return response?.data;
};

/**
 * Delete an album
 */
export const deleteAlbum = async (albumId: string): Promise<void> => {
  await apiService.delete(`/albums/${albumId}`);
};

/**
 * Move photos to an album (or remove from album if albumId is null)
 */
export const movePhotosToAlbum = async (albumId: string | null, photoIds: string[]): Promise<{ message: string; updatedCount: number }> => {
  const endpoint = albumId ? `/albums/${albumId}/photos` : `/albums/null/photos`;
  const response = await apiService.post(endpoint, { photoIds });
  return response?.data;
};
