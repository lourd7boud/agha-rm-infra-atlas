/**
 * DocumentsTab Component (V2)
 * Upload and display documents for a project
 * Server-first architecture
 * V2: Added inline PDF viewer & Drag-Drop support
 */

import { FC, useState } from 'react';
import { Trash2, Download, Loader2, FileText, File, FileSpreadsheet, FileImage, Eye } from 'lucide-react';
import { assetService, ProjectAsset } from '../../services/assetService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import PDFViewer from './PDFViewer';
import DropZone from '../common/DropZone';

interface DocumentsTabProps {
  projectId: string;
  documents: ProjectAsset[];
  onRefresh: () => void;
}

// Get icon based on mime type
const getFileIcon = (mimeType: string) => {
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet;
  if (mimeType.includes('image')) return FileImage;
  if (mimeType.includes('word') || mimeType.includes('document')) return FileText;
  return File;
};

// Get color based on mime type
const getFileColor = (mimeType: string) => {
  if (mimeType.includes('pdf')) return 'bg-red-100 text-red-600';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'bg-green-100 text-green-600';
  if (mimeType.includes('image')) return 'bg-purple-100 text-purple-600';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'bg-blue-100 text-blue-600';
  return 'bg-gray-100 text-gray-600';
};

const DocumentsTab: FC<DocumentsTabProps> = ({ projectId, documents, onRefresh }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewingPDF, setViewingPDF] = useState<ProjectAsset | null>(null);

  const handleDropFiles = async (files: File[]) => {
    if (files.length === 0) return;

    // Upload files one by one
    setIsUploading(true);
    setUploadProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        await assetService.uploadDocument(projectId, files[i], (progress) => {
          // Calculate overall progress
          const overallProgress = ((i * 100) + progress) / files.length;
          setUploadProgress(Math.round(overallProgress));
        });
      }
      onRefresh();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Erreur lors du téléchargement des documents');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (doc: ProjectAsset) => {
    if (!confirm('Supprimer ce document ?')) return;

    setDeleting(doc.id);
    try {
      await assetService.deleteAsset(doc.id);
      onRefresh();
    } catch (error) {
      console.error('Delete error:', error);
      alert('Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = async (doc: ProjectAsset) => {
    try {
      // Use fetch with Bearer token for reliable authenticated download
      const token = localStorage.getItem('auth_token');
      const url = assetService.getAssetUrl(doc.storagePath);
      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include', // Also send cookie as fallback
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = doc.originalName || doc.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
      // Fallback: direct link (relies on cookie)
      const url = assetService.getAssetUrl(doc.storagePath);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.originalName || doc.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleView = (doc: ProjectAsset) => {
    // If PDF, open inline viewer
    if (doc.mimeType.includes('pdf')) {
      setViewingPDF(doc);
    } else {
      // For other files, open in new tab
      const url = assetService.getAssetUrl(doc.storagePath);
      window.open(url, '_blank');
    }
  };

  const handleClosePDFViewer = () => {
    setViewingPDF(null);
  };

  // Empty state
  if (documents.length === 0 && !isUploading) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun document</h3>
          <p className="text-gray-600 mb-6">
            Attachez vos factures, plans, et autres documents importants
          </p>
          
          {/* Drag & Drop Zone */}
          <DropZone
            onFilesSelected={handleDropFiles}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.png,.jpg,.jpeg"
            multiple={true}
            maxFiles={20}
            icon="document"
            title="Glissez-déposez vos documents ici"
            subtitle="PDF, Word, Excel, Images, DWG"
            disabled={isUploading}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact Drop Zone */}
      <DropZone
        onFilesSelected={handleDropFiles}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.png,.jpg,.jpeg"
        multiple={true}
        maxFiles={20}
        icon="document"
        compact={true}
        title="Ajouter des documents"
        subtitle="Glissez-déposez ou cliquez pour sélectionner"
        disabled={isUploading}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Documents ({documents.length})
        </h2>
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

      {/* Documents List */}
      <div className="space-y-2">
        {documents.map((doc) => {
          const FileIcon = getFileIcon(doc.mimeType);
          const colorClass = getFileColor(doc.mimeType);
          
          return (
            <div
              key={doc.id}
              className="card hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={`w-12 h-12 ${colorClass} rounded-xl flex items-center justify-center flex-shrink-0`}>
                    <FileIcon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 
                      className="font-medium text-gray-900 truncate cursor-pointer hover:text-primary-600"
                      onClick={() => handleView(doc)}
                      title={doc.originalName}
                    >
                      {doc.originalName}
                    </h3>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span>{assetService.formatFileSize(doc.fileSize)}</span>
                      <span>•</span>
                      <span>{format(new Date(doc.createdAt), 'dd/MM/yyyy', { locale: fr })}</span>
                      {doc.createdByName && (
                        <>
                          <span>•</span>
                          <span>{doc.createdByName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {/* View button - especially for PDFs */}
                  {doc.mimeType.includes('pdf') && (
                    <button
                      onClick={() => handleView(doc)}
                      className="p-2 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Afficher le PDF"
                    >
                      <Eye className="w-5 h-5 text-blue-600" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(doc)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Télécharger"
                  >
                    <Download className="w-5 h-5 text-gray-600" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={deleting === doc.id}
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer"
                  >
                    {deleting === doc.id ? (
                      <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5 text-red-500" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PDF Viewer Modal */}
      {viewingPDF && (
        <PDFViewer
          url={assetService.getAssetUrl(viewingPDF.storagePath)}
          fileName={viewingPDF.originalName}
          onClose={handleClosePDFViewer}
          onDownload={() => handleDownload(viewingPDF)}
        />
      )}
    </div>
  );
};

export default DocumentsTab;
