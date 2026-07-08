/**
 * PhotosTab Component (V1)
 * Display and upload photos for a project
 * Server-first architecture
 */

import { FC, useState, useRef } from 'react';
import { Image, Upload, Trash2, Download, X, Loader2, ZoomIn } from 'lucide-react';
import { assetService, ProjectAsset } from '../../services/assetService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface PhotosTabProps {
  projectId: string;
  photos: ProjectAsset[];
  onRefresh: () => void;
}

const PhotosTab: FC<PhotosTabProps> = ({ projectId, photos, onRefresh }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<ProjectAsset | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleSelectFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Filter only images
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      alert('Veuillez sélectionner des fichiers image');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      await assetService.uploadPhotos(projectId, imageFiles, (progress) => {
        setUploadProgress(progress);
      });
      
      onRefresh();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Erreur lors du téléchargement des photos');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async (photo: ProjectAsset) => {
    if (!confirm('Supprimer cette photo ?')) return;

    setDeleting(photo.id);
    try {
      await assetService.deleteAsset(photo.id);
      onRefresh();
    } catch (error) {
      console.error('Delete error:', error);
      alert('Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = async (photo: ProjectAsset) => {
    try {
      const token = localStorage.getItem('auth_token');
      const url = assetService.getAssetUrl(photo.storagePath);
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = photo.originalName || photo.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
      const url = assetService.getAssetUrl(photo.storagePath);
      const link = document.createElement('a');
      link.href = url;
      link.download = photo.originalName || photo.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Empty state
  if (photos.length === 0 && !isUploading) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune photo</h3>
          <p className="text-gray-600 mb-6">
            Ajoutez des photos pour documenter l'avancement du projet
          </p>
          <button 
            onClick={handleSelectFiles}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <Image className="w-4 h-4" />
            Ajouter des photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Photos ({photos.length})
        </h2>
        <button
          onClick={handleSelectFiles}
          disabled={isUploading}
          className="btn btn-primary inline-flex items-center gap-2"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress}%
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Ajouter des photos
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
      </div>

      {/* Upload Progress */}
      {isUploading && (
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            <span className="text-blue-700 font-medium">Téléchargement en cours...</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Photo Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden"
          >
            <img
              src={assetService.getAssetUrl(photo.storagePath)}
              alt={photo.originalName}
              className="w-full h-full object-cover cursor-pointer transition-transform group-hover:scale-105"
              onClick={() => setSelectedPhoto(photo)}
              loading="lazy"
            />
            
            {/* Overlay with actions */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedPhoto(photo)}
                  className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                  title="Agrandir"
                >
                  <ZoomIn className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  onClick={() => handleDownload(photo)}
                  className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                  title="Télécharger"
                >
                  <Download className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  onClick={() => handleDelete(photo)}
                  disabled={deleting === photo.id}
                  className="p-2 bg-white rounded-full hover:bg-red-50 transition-colors"
                  title="Supprimer"
                >
                  {deleting === photo.id ? (
                    <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                  ) : (
                    <Trash2 className="w-5 h-5 text-red-500" />
                  )}
                </button>
              </div>
            </div>

            {/* File info */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-white text-xs truncate">{photo.originalName}</p>
              <p className="text-white/70 text-xs">
                {format(new Date(photo.createdAt), 'dd/MM/yyyy', { locale: fr })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox Modal */}
      {selectedPhoto && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          
          <img
            src={assetService.getAssetUrl(selectedPhoto.storagePath)}
            alt={selectedPhoto.originalName}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 rounded-lg px-4 py-2 text-white text-sm">
            {selectedPhoto.originalName} • {assetService.formatFileSize(selectedPhoto.fileSize)}
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotosTab;
