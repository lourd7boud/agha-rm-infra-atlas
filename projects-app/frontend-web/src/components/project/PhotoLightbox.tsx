/**
 * PhotoLightbox — Advanced Photo Viewer
 * 
 * Features:
 * - Navigate between photos (← → arrows + buttons + touch swipe)
 * - Zoom in/out (scroll wheel, double-click, buttons)
 * - Pan/drag when zoomed
 * - Keyboard navigation (Escape, ←, →, +, -, 0)
 * - Photo counter (3/44)
 * - Direct download button
 * - Thumbnail strip at bottom
 * - Loading spinner with progressive load
 * - Smooth CSS transitions
 * - Touch gesture support (swipe, pinch-zoom)
 */

import { FC, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Download, Loader2
} from 'lucide-react';
import { assetService, ProjectAsset } from '../../services/assetService';

interface PhotoLightboxProps {
  photos: ProjectAsset[];
  initialIndex: number;
  onClose: () => void;
  onDownload?: (photo: ProjectAsset) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;
const SWIPE_THRESHOLD = 50;

const PhotoLightbox: FC<PhotoLightboxProps> = ({ photos, initialIndex, onClose, onDownload }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; time: number } | null>(null);
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [pinchZoomStart, setPinchZoomStart] = useState(1);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTapRef = useRef<number>(0);

  const currentPhoto = photos[currentIndex];

  // Preload adjacent images
  useEffect(() => {
    const preload = (index: number) => {
      if (index >= 0 && index < photos.length) {
        const img = new Image();
        img.src = assetService.getAssetUrl(photos[index].storagePath);
      }
    };
    preload(currentIndex + 1);
    preload(currentIndex - 1);
  }, [currentIndex, photos]);

  // Auto-hide controls after 3s
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (zoom <= 1) setShowControls(false);
    }, 3000);
  }, [zoom]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [resetControlsTimer]);

  // Scroll thumbnail strip to center current
  useEffect(() => {
    if (thumbnailStripRef.current) {
      const strip = thumbnailStripRef.current;
      const thumb = strip.children[currentIndex] as HTMLElement;
      if (thumb) {
        const scrollLeft = thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2;
        strip.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }
  }, [currentIndex]);

  // Prevent body scroll
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = originalOverflow; };
  }, []);

  // Navigation
  const goTo = useCallback((index: number) => {
    if (index < 0 || index >= photos.length || index === currentIndex) return;
    setIsTransitioning(true);
    setIsLoading(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTimeout(() => {
      setCurrentIndex(index);
      setIsTransitioning(false);
    }, 150);
  }, [currentIndex, photos.length]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Zoom
  const zoomTo = useCallback((newZoom: number, centerX?: number, centerY?: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    if (clamped === 1) {
      setPan({ x: 0, y: 0 });
    } else if (centerX !== undefined && centerY !== undefined && containerRef.current) {
      // Zoom toward the point
      const rect = containerRef.current.getBoundingClientRect();
      const cx = centerX - rect.left - rect.width / 2;
      const cy = centerY - rect.top - rect.height / 2;
      const factor = clamped / zoom;
      setPan(prev => ({
        x: cx - factor * (cx - prev.x),
        y: cy - factor * (cy - prev.y),
      }));
    }
    setZoom(clamped);
  }, [zoom]);

  const handleZoomIn = useCallback(() => zoomTo(zoom + ZOOM_STEP), [zoom, zoomTo]);
  const handleZoomOut = useCallback(() => zoomTo(zoom - ZOOM_STEP), [zoom, zoomTo]);
  const handleResetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': goPrev(); break;
        case 'ArrowRight': goNext(); break;
        case '+': case '=': handleZoomIn(); break;
        case '-': handleZoomOut(); break;
        case '0': handleResetZoom(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goNext, goPrev, handleZoomIn, handleZoomOut, handleResetZoom]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomTo(zoom + delta, e.clientX, e.clientY);
    resetControlsTimer();
  }, [zoom, zoomTo, resetControlsTimer]);

  // Double click to zoom
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (zoom > 1) {
      handleResetZoom();
    } else {
      zoomTo(2.5, e.clientX, e.clientY);
    }
    resetControlsTimer();
  }, [zoom, zoomTo, handleResetZoom, resetControlsTimer]);

  // Mouse drag for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ x: pan.x, y: pan.y });
  }, [zoom, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    resetControlsTimer();
    setPan({
      x: panStart.x + (e.clientX - dragStart.x),
      y: panStart.y + (e.clientY - dragStart.y),
    });
  }, [isDragging, dragStart, panStart, resetControlsTimer]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch handlers for swipe & pinch
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      setInitialPinchDistance(getTouchDistance(e.touches));
      setPinchZoomStart(zoom);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      setTouchStart({ x: touch.clientX, y: touch.clientY, time: Date.now() });
      if (zoom > 1) {
        setIsDragging(true);
        setDragStart({ x: touch.clientX, y: touch.clientY });
        setPanStart({ x: pan.x, y: pan.y });
      }
    }
  }, [zoom, pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistance) {
      // Pinch zoom
      const dist = getTouchDistance(e.touches);
      const scale = dist / initialPinchDistance;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomTo(pinchZoomStart * scale, midX, midY);
    } else if (e.touches.length === 1 && isDragging && zoom > 1) {
      const touch = e.touches[0];
      setPan({
        x: panStart.x + (touch.clientX - dragStart.x),
        y: panStart.y + (touch.clientY - dragStart.y),
      });
    }
  }, [initialPinchDistance, pinchZoomStart, isDragging, zoom, dragStart, panStart, zoomTo]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Double tap detection
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      if (zoom > 1) {
        handleResetZoom();
      } else {
        zoomTo(2.5, touch.clientX, touch.clientY);
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }

    // Swipe detection (only when not zoomed)
    if (touchStart && zoom <= 1 && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      const dt = Date.now() - touchStart.time;

      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        if (dx > 0) goPrev();
        else goNext();
      }
    }

    setInitialPinchDistance(null);
    setIsDragging(false);
    setTouchStart(null);
  }, [touchStart, zoom, goPrev, goNext, handleResetZoom, zoomTo]);

  // Download
  const handleDownload = useCallback(() => {
    if (onDownload) {
      onDownload(currentPhoto);
    } else {
      const a = document.createElement('a');
      a.href = assetService.getAssetUrl(currentPhoto.storagePath);
      a.download = currentPhoto.originalName;
      a.click();
    }
  }, [currentPhoto, onDownload]);

  // Container click => close (only if clicking backdrop, not image)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onClose();
    }
  }, [onClose]);

  const imageTransform = useMemo(() => {
    return `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }, [pan.x, pan.y, zoom]);

  return (
    <div className="fixed inset-0 z-[60] bg-black" style={{ touchAction: 'none' }}>
      {/* Top bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-white/90 text-sm font-medium">
            {currentIndex + 1} / {photos.length}
          </span>
          <span className="text-white/50 text-sm hidden sm:inline truncate max-w-[300px]">
            {currentPhoto.originalName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button
            onClick={handleZoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
            title="Zoom arrière (−)"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-xs font-mono min-w-[48px] text-center"
            title="Réinitialiser (0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
            title="Zoom avant (+)"
          >
            <ZoomIn className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/20 mx-1" />

          {/* Download */}
          <button
            onClick={handleDownload}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Télécharger"
          >
            <Download className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/20 mx-1" />

          {/* Close */}
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Fermer (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onClick={handleBackdropClick}
        onMouseMove={(e) => { handleMouseMove(e); resetControlsTimer(); }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={(e) => { handleTouchStart(e); resetControlsTimer(); }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="w-10 h-10 text-white/60 animate-spin" />
          </div>
        )}

        {/* Image */}
        <img
          ref={imageRef}
          src={assetService.getAssetUrl(currentPhoto.storagePath)}
          alt={currentPhoto.originalName}
          className={`max-w-[90vw] max-h-[80vh] object-contain select-none ${
            isTransitioning ? 'opacity-0' : 'opacity-100'
          }`}
          style={{
            transform: imageTransform,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out, opacity 0.15s ease',
            willChange: 'transform',
          }}
          draggable={false}
          onLoad={() => setIsLoading(false)}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
        />
      </div>

      {/* Previous button */}
      {currentIndex > 0 && (
        <button
          onClick={goPrev}
          className={`absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 p-2 sm:p-3 bg-black/40 hover:bg-black/60 text-white rounded-full transition-all duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          title="Précédent (←)"
        >
          <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7" />
        </button>
      )}

      {/* Next button */}
      {currentIndex < photos.length - 1 && (
        <button
          onClick={goNext}
          className={`absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 p-2 sm:p-3 bg-black/40 hover:bg-black/60 text-white rounded-full transition-all duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          title="Suivant (→)"
        >
          <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7" />
        </button>
      )}

      {/* Bottom info + thumbnail strip */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* File info */}
        <div className="text-center mb-2 px-4">
          <p className="text-white/90 text-sm truncate sm:hidden">
            {currentPhoto.originalName}
          </p>
          <p className="text-white/50 text-xs">
            {assetService.formatFileSize(currentPhoto.fileSize)}
            {currentPhoto.metadata?.width && currentPhoto.metadata?.height && (
              <> • {currentPhoto.metadata.width}×{currentPhoto.metadata.height}</>
            )}
          </p>
        </div>

        {/* Thumbnail strip */}
        {photos.length > 1 && (
          <div
            ref={thumbnailStripRef}
            className="flex gap-1 px-4 pb-3 overflow-x-auto scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => goTo(index)}
                className={`flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden transition-all duration-200 ${
                  index === currentIndex
                    ? 'ring-2 ring-white opacity-100 scale-105'
                    : 'opacity-50 hover:opacity-80'
                }`}
              >
                <img
                  src={assetService.getThumbnailUrl(photo.id, 'grid')}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (!target.dataset.fallback) {
                      target.dataset.fallback = '1';
                      target.src = assetService.getAssetUrl(photo.storagePath);
                    }
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoLightbox;
