/**
 * PhotosTab Component (V2) - With Albums Support & Drag-Drop
 * Display and upload photos organized in albums
 * Server-first architecture
 */

import { FC, useState, useRef, useEffect } from 'react';
import { 
  Image, Upload, Trash2, Download, Loader2, ZoomIn, 
  FolderPlus, Folder, FolderOpen, Check, Edit, ChevronLeft
} from 'lucide-react';
import { assetService, ProjectAsset } from '../../services/assetService';
import * as albumService from '../../services/albumService';
import { Album } from '../../services/albumService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DropZone from '../common/DropZone';
import PhotoLightbox from './PhotoLightbox';

interface PhotosTabProps {
  projectId: string;
  photos: ProjectAsset[];
  onRefresh: () => void;
}

const PhotosTab: FC<PhotosTabProps> = ({ projectId, photos, onRefresh }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Album states
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [showAlbumModal, setShowAlbumModal] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);
  const [albumForm, setAlbumForm] = useState({ name: '', description: '' });
  const [savingAlbum, setSavingAlbum] = useState(false);

  // Selection mode for moving photos
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [movingPhotos, setMovingPhotos] = useState(false);

  // Load albums
  useEffect(() => {
    loadAlbums();
  }, [projectId]);

  const loadAlbums = async () => {
    try {
      setLoadingAlbums(true);
      const data = await albumService.getAlbums(projectId);
      setAlbums(data);
    } catch (error) {
      console.error('Error loading albums:', error);
    } finally {
      setLoadingAlbums(false);
    }
  };

  // Filter photos by album
  const filteredPhotos = selectedAlbumId
    ? photos.filter(p => p.albumId === selectedAlbumId)
    : photos.filter(p => !p.albumId); // Photos without album

  // Count photos without album
  const unorganizedCount = photos.filter(p => !p.albumId).length;

  const handleSelectFiles = () => {
    fileInputRef.current?.click();
  };

  const handleDropFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      alert('Veuillez sélectionner des fichiers image');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      await assetService.uploadPhotos(projectId, imageFiles, (progress) => {
        setUploadProgress(progress);
      }, selectedAlbumId || undefined);
      
      onRefresh();
      loadAlbums();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Erreur lors du téléchargement des photos');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    await handleDropFiles(Array.from(files));
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (photo: ProjectAsset) => {
    if (!confirm('Supprimer cette photo ?')) return;

    setDeleting(photo.id);
    try {
      await assetService.deleteAsset(photo.id);
      onRefresh();
      loadAlbums();
    } catch (error) {
      console.error('Delete error:', error);
      alert('Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (photo: ProjectAsset) => {
    const url = assetService.getAssetUrl(photo.storagePath);
    const link = document.createElement('a');
    link.href = url;
    link.download = photo.originalName || photo.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Album CRUD
  const handleCreateAlbum = () => {
    setEditingAlbum(null);
    setAlbumForm({ name: '', description: '' });
    setShowAlbumModal(true);
  };

  const handleEditAlbum = (album: Album) => {
    setEditingAlbum(album);
    setAlbumForm({ name: album.name, description: album.description || '' });
    setShowAlbumModal(true);
  };

  const handleSaveAlbum = async () => {
    if (!albumForm.name.trim()) {
      alert('Le nom de l\'album est requis');
      return;
    }

    setSavingAlbum(true);
    try {
      if (editingAlbum) {
        await albumService.updateAlbum(editingAlbum.id, albumForm);
      } else {
        await albumService.createAlbum(projectId, albumForm);
      }
      setShowAlbumModal(false);
      loadAlbums();
    } catch (error) {
      console.error('Error saving album:', error);
      alert('Erreur lors de l\'enregistrement de l\'album');
    } finally {
      setSavingAlbum(false);
    }
  };

  const handleDeleteAlbum = async (album: Album) => {
    if (!confirm(`Supprimer l'album "${album.name}" ?\nLes photos ne seront pas supprimées.`)) return;

    try {
      await albumService.deleteAlbum(album.id);
      if (selectedAlbumId === album.id) {
        setSelectedAlbumId(null);
      }
      loadAlbums();
      onRefresh();
    } catch (error) {
      console.error('Error deleting album:', error);
      alert('Erreur lors de la suppression de l\'album');
    }
  };

  // Photo selection and moving
  const togglePhotoSelection = (photoId: string) => {
    const newSelection = new Set(selectedPhotoIds);
    if (newSelection.has(photoId)) {
      newSelection.delete(photoId);
    } else {
      newSelection.add(photoId);
    }
    setSelectedPhotoIds(newSelection);
  };

  const handleMovePhotos = async (targetAlbumId: string | null) => {
    if (selectedPhotoIds.size === 0) return;

    setMovingPhotos(true);
    try {
      await albumService.movePhotosToAlbum(targetAlbumId, Array.from(selectedPhotoIds));
      setShowMoveModal(false);
      setSelectionMode(false);
      setSelectedPhotoIds(new Set());
      onRefresh();
      loadAlbums();
    } catch (error) {
      console.error('Error moving photos:', error);
      alert('Erreur lors du déplacement des photos');
    } finally {
      setMovingPhotos(false);
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
  };

  // Get current view title
  const currentViewTitle = selectedAlbumId
    ? albums.find(a => a.id === selectedAlbumId)?.name || 'Album'
    : 'Toutes les photos';

  // Empty state
  if (photos.length === 0 && !isUploading && albums.length === 0 && !loadingAlbums) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune photo</h3>
          <p className="text-gray-600 mb-6">
            Ajoutez des photos pour documenter l'avancement du projet
          </p>
          
          {/* Drag & Drop Zone */}
          <DropZone
            onFilesSelected={handleDropFiles}
            accept="image/*"
            multiple={true}
            maxFiles={50}
            icon="image"
            title="Glissez-déposez vos photos ici"
            subtitle="ou cliquez pour sélectionner (JPG, PNG, WebP)"
            disabled={isUploading}
          />

          {/* Upload Progress */}
          {isUploading && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
                <span className="text-gray-700">Téléchargement en cours...</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden max-w-xs mx-auto">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-4">
            <button 
              onClick={handleCreateAlbum}
              className="btn btn-secondary inline-flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4" />
              Créer un album
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Albums Sidebar + Photos Grid Layout */}
      <div className="flex gap-4">
        {/* Albums Sidebar */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Albums</h3>
              <button
                onClick={handleCreateAlbum}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                title="Créer un album"
              >
                <FolderPlus className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {/* All Photos */}
              <button
                onClick={() => setSelectedAlbumId(null)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                  selectedAlbumId === null ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
              >
                <Image className={`w-5 h-5 ${selectedAlbumId === null ? 'text-blue-600' : 'text-gray-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${selectedAlbumId === null ? 'text-blue-700' : 'text-gray-900'}`}>
                    Non classées
                  </p>
                  <p className="text-xs text-gray-500">{unorganizedCount} photos</p>
                </div>
              </button>

              {/* Albums List */}
              {loadingAlbums ? (
                <div className="p-4 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                </div>
              ) : (
                albums.map((album) => (
                  <div
                    key={album.id}
                    className={`group flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer ${
                      selectedAlbumId === album.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    }`}
                    onClick={() => setSelectedAlbumId(album.id)}
                  >
                    {selectedAlbumId === album.id ? (
                      <FolderOpen className="w-5 h-5 text-blue-600" />
                    ) : (
                      <Folder className="w-5 h-5 text-gray-500" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selectedAlbumId === album.id ? 'text-blue-700' : 'text-gray-900'}`}>
                        {album.name}
                      </p>
                      <p className="text-xs text-gray-500">{album.photoCount} photos</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditAlbum(album); }}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Modifier"
                      >
                        <Edit className="w-4 h-4 text-gray-500" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteAlbum(album); }}
                        className="p-1 hover:bg-red-100 rounded"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {selectedAlbumId && (
                <button
                  onClick={() => setSelectedAlbumId(null)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-600" />
                </button>
              )}
              <h2 className="text-xl font-semibold text-gray-900">
                {currentViewTitle} ({filteredPhotos.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {selectionMode ? (
                <>
                  <span className="text-sm text-gray-600">
                    {selectedPhotoIds.size} sélectionnée(s)
                  </span>
                  <button
                    onClick={() => setShowMoveModal(true)}
                    disabled={selectedPhotoIds.size === 0}
                    className="btn btn-primary btn-sm"
                  >
                    Déplacer
                  </button>
                  <button
                    onClick={cancelSelection}
                    className="btn btn-secondary btn-sm"
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <>
                  {filteredPhotos.length > 0 && (
                    <button
                      onClick={() => setSelectionMode(true)}
                      className="btn btn-secondary btn-sm"
                    >
                      Sélectionner
                    </button>
                  )}
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
                        Ajouter
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
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
            <div className="bg-blue-50 rounded-lg p-4 mb-4">
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

          {/* Drag & Drop Zone when empty or uploading */}
          {filteredPhotos.length === 0 && !isUploading && (
            <DropZone
              onFilesSelected={handleDropFiles}
              accept="image/*"
              multiple={true}
              maxFiles={50}
              icon="image"
              title={selectedAlbumId ? 'Cet album est vide' : 'Aucune photo non classée'}
              subtitle="Glissez-déposez vos photos ici ou cliquez pour sélectionner"
              disabled={isUploading}
            />
          )}

          {/* Compact Drop Zone when has photos */}
          {filteredPhotos.length > 0 && !isUploading && (
            <DropZone
              onFilesSelected={handleDropFiles}
              accept="image/*"
              multiple={true}
              maxFiles={50}
              icon="image"
              compact={true}
              title="Ajouter plus de photos"
              subtitle="Glissez-déposez ou cliquez"
              disabled={isUploading}
              className="mb-4"
            />
          )}

          {/* Photo Grid */}
          {filteredPhotos.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className={`group relative aspect-square bg-gray-100 rounded-lg overflow-hidden ${
                    selectionMode ? 'cursor-pointer' : ''
                  } ${selectedPhotoIds.has(photo.id) ? 'ring-4 ring-blue-500' : ''}`}
                  onClick={selectionMode ? () => togglePhotoSelection(photo.id) : () => setLightboxIndex(filteredPhotos.indexOf(photo))}
                >
                  <img
                    src={assetService.getThumbnailUrl(photo.id, 'grid')}
                    alt={photo.originalName}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105 cursor-pointer"

                    loading="lazy"
                    onError={(e) => {
                      // Fallback to original if thumbnail fails
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.fallback) {
                        target.dataset.fallback = '1';
                        target.src = assetService.getAssetUrl(photo.storagePath);
                      }
                    }}
                  />
                  
                  {/* Selection Checkbox */}
                  {selectionMode && (
                    <div className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      selectedPhotoIds.has(photo.id) 
                        ? 'bg-blue-500 border-blue-500' 
                        : 'bg-white/80 border-gray-400'
                    }`}>
                      {selectedPhotoIds.has(photo.id) && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                  )}
                  
                  {/* Overlay with actions (only when not in selection mode) */}
                  {!selectionMode && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setLightboxIndex(filteredPhotos.indexOf(photo)); }}
                          className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                          title="Agrandir"
                        >
                          <ZoomIn className="w-5 h-5 text-gray-700" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(photo); }}
                          className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                          title="Télécharger"
                        >
                          <Download className="w-5 h-5 text-gray-700" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(photo); }}
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
                  )}

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
          )}
        </div>
      </div>

      {/* PhotoLightbox */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={filteredPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDownload={handleDownload}
        />
      )}

      {/* Album Create/Edit Modal */}
      {showAlbumModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingAlbum ? 'Modifier l\'album' : 'Nouvel album'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de l'album *
                </label>
                <input
                  type="text"
                  value={albumForm.name}
                  onChange={(e) => setAlbumForm({ ...albumForm, name: e.target.value })}
                  className="input w-full"
                  placeholder="Ex: Photos du chantier"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={albumForm.description}
                  onChange={(e) => setAlbumForm({ ...albumForm, description: e.target.value })}
                  className="input w-full"
                  rows={3}
                  placeholder="Description optionnelle..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAlbumModal(false)}
                className="btn btn-secondary"
                disabled={savingAlbum}
              >
                Annuler
              </button>
              <button
                onClick={handleSaveAlbum}
                disabled={savingAlbum || !albumForm.name.trim()}
                className="btn btn-primary"
              >
                {savingAlbum ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : editingAlbum ? (
                  'Enregistrer'
                ) : (
                  'Créer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Photos Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Déplacer {selectedPhotoIds.size} photo(s) vers
            </h3>
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {/* Option: No album */}
              <button
                onClick={() => handleMovePhotos(null)}
                disabled={movingPhotos}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-100 transition-colors ${
                  !selectedAlbumId ? 'bg-gray-100' : ''
                }`}
              >
                <Image className="w-5 h-5 text-gray-500" />
                <span className="text-sm font-medium">Non classées</span>
              </button>
              
              {/* Albums */}
              {albums.map((album) => (
                <button
                  key={album.id}
                  onClick={() => handleMovePhotos(album.id)}
                  disabled={movingPhotos || album.id === selectedAlbumId}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-100 transition-colors ${
                    album.id === selectedAlbumId ? 'opacity-50' : ''
                  }`}
                >
                  <Folder className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium">{album.name}</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowMoveModal(false)}
                className="btn btn-secondary"
                disabled={movingPhotos}
              >
                Annuler
              </button>
            </div>

            {movingPhotos && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotosTab;
