/**
 * PDFViewer Component (V2)
 * Display PDF files inline without downloading
 * Uses embed tag for better compatibility with CSP
 * Enhanced for Electron desktop app compatibility
 */

import { FC, useState, useEffect } from 'react';
import { 
  X, 
  Maximize2, 
  Minimize2, 
  Download, 
  ExternalLink,
  Loader2,
  FileText,
  AlertCircle
} from 'lucide-react';

interface PDFViewerProps {
  url: string;
  fileName: string;
  onClose: () => void;
  onDownload?: () => void;
}

const PDFViewer: FC<PDFViewerProps> = ({ url, fileName, onClose, onDownload }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // Fetch PDF with Bearer token for reliable authenticated access
  useEffect(() => {
    // Always fetch with auth token to avoid cookie-only dependency
    if (url.startsWith('http') || url.startsWith('/')) {
      const token = localStorage.getItem('auth_token');
      const fetchUrl = url.startsWith('/') ? `${window.location.origin}${url}` : url;
      
      fetch(fetchUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include', // Also send cookie as fallback
      })
        .then(response => {
          if (!response.ok) throw new Error('Failed to fetch PDF');
          return response.blob();
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          setPdfBlobUrl(blobUrl);
          setIsLoading(false);
        })
        .catch(() => {
          // Fallback: try direct URL (relies on cookie)
          setPdfBlobUrl(url);
          setIsLoading(false);
        });
    } else {
      // Blob URL or other scheme
      setPdfBlobUrl(url);
    }

    // Cleanup blob URL on unmount
    return () => {
      if (pdfBlobUrl && pdfBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [url]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const openInNewTab = () => {
    window.open(url, '_blank');
  };

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  // Modal container classes
  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-50 bg-black'
    : 'fixed inset-4 md:inset-8 lg:inset-12 z-50 bg-white rounded-2xl shadow-2xl overflow-hidden';

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* PDF Viewer Modal */}
      <div className={containerClasses}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isFullscreen ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <FileText className={`w-5 h-5 flex-shrink-0 ${isFullscreen ? 'text-red-400' : 'text-red-500'}`} />
            <h3 className={`font-medium truncate ${isFullscreen ? 'text-white' : 'text-gray-900'}`}>
              {fileName}
            </h3>
          </div>

          <div className="flex items-center gap-1">
            {/* Open in new tab */}
            <button
              onClick={openInNewTab}
              className={`p-2 rounded-lg transition-colors ${isFullscreen ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink className="w-5 h-5" />
            </button>

            {/* Download */}
            {onDownload && (
              <button
                onClick={onDownload}
                className={`p-2 rounded-lg transition-colors ${isFullscreen ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
                title="Télécharger"
              >
                <Download className="w-5 h-5" />
              </button>
            )}

            {/* Toggle Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className={`p-2 rounded-lg transition-colors ${isFullscreen ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
              title={isFullscreen ? 'Réduire' : 'Plein écran'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${isFullscreen ? 'hover:bg-red-600 text-gray-300 hover:text-white' : 'hover:bg-red-100 text-gray-600 hover:text-red-600'}`}
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PDF Content */}
        <div className={`relative ${isFullscreen ? 'h-[calc(100vh-56px)]' : 'h-[calc(100%-56px)]'} bg-gray-200`}>
          {/* Loading state */}
          {isLoading && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
              <div className="text-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
                <p className="text-gray-600">Chargement du document...</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
              <div className="text-center max-w-md px-4">
                <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Aperçu non disponible
                </h3>
                <p className="text-gray-600 mb-4">
                  Le navigateur ne peut pas afficher ce PDF en aperçu. Veuillez l'ouvrir dans un nouvel onglet ou le télécharger.
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={openInNewTab}
                    className="btn btn-primary inline-flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Ouvrir dans un onglet
                  </button>
                  {onDownload && (
                    <button
                      onClick={onDownload}
                      className="btn btn-outline inline-flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Télécharger
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PDF embed - uses blob URL for Electron compatibility */}
          {pdfBlobUrl && !hasError && (
            <object
              data={pdfBlobUrl}
              type="application/pdf"
              className="w-full h-full"
              onLoad={handleLoad}
              onError={handleError}
            >
              {/* Fallback: iframe for browsers that don't support object */}
              <iframe
                src={pdfBlobUrl}
                className="w-full h-full border-0"
                title={fileName}
                onLoad={handleLoad}
                onError={handleError}
              />
            </object>
          )}
        </div>
      </div>
    </>
  );
};

export default PDFViewer;
