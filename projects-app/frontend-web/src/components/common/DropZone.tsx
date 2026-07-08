/**
 * DropZone Component
 * Reusable Drag & Drop file upload component
 * Supports: single/multiple files, file type filtering, visual feedback
 */

import { FC, useState, useRef, useCallback } from 'react';
import { Upload, File, Image, X, FileText } from 'lucide-react';

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string; // e.g., "image/*,.pdf"
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // in bytes
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  
  // Customization
  title?: string;
  subtitle?: string;
  icon?: 'upload' | 'image' | 'document' | 'mixed';
  compact?: boolean;
  
  // Show selected files
  showPreview?: boolean;
  selectedFiles?: File[];
  onRemoveFile?: (index: number) => void;
}

const DropZone: FC<DropZoneProps> = ({
  onFilesSelected,
  accept = '*',
  multiple = true,
  maxFiles = 50,
  maxSize = 100 * 1024 * 1024, // 100MB default
  disabled = false,
  children,
  className = '',
  title,
  subtitle,
  icon = 'upload',
  compact = false,
  showPreview = false,
  selectedFiles = [],
  onRemoveFile,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounterRef] = useState({ current: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file type
  const isValidType = (file: File): boolean => {
    if (accept === '*') return true;
    
    const acceptedTypes = accept.split(',').map(t => t.trim());
    
    return acceptedTypes.some(type => {
      if (type.startsWith('.')) {
        // Extension check
        return file.name.toLowerCase().endsWith(type.toLowerCase());
      } else if (type.endsWith('/*')) {
        // MIME type wildcard (e.g., image/*)
        const baseType = type.split('/')[0];
        return file.type.startsWith(baseType + '/');
      } else {
        // Exact MIME type
        return file.type === type;
      }
    });
  };

  // Process files
  const processFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    
    // Filter valid files
    const validFiles = files.filter(file => {
      // Check type
      if (!isValidType(file)) {
        console.warn(`File rejected (invalid type): ${file.name}`);
        return false;
      }
      
      // Check size
      if (file.size > maxSize) {
        console.warn(`File rejected (too large): ${file.name}`);
        return false;
      }
      
      return true;
    });

    // Limit number of files
    const limitedFiles = multiple 
      ? validFiles.slice(0, maxFiles)
      : validFiles.slice(0, 1);

    if (limitedFiles.length > 0) {
      onFilesSelected(limitedFiles);
    }

    // Show warning if some files were rejected
    if (validFiles.length < files.length) {
      const rejected = files.length - validFiles.length;
      alert(`${rejected} fichier(s) rejeté(s) (type invalide ou taille trop grande)`);
    }
  }, [accept, maxFiles, maxSize, multiple, onFilesSelected]);

  // Drag event handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (disabled) return;

    const { files } = e.dataTransfer;
    if (files && files.length > 0) {
      processFiles(files);
    }
  };

  // Click to select
  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    // Reset input
    e.target.value = '';
  };

  // Icon component
  const renderIcon = () => {
    const iconClass = compact ? 'w-8 h-8' : 'w-12 h-12';
    
    switch (icon) {
      case 'image':
        return (
          <div className={`${compact ? 'w-12 h-12' : 'w-16 h-16'} bg-blue-100 rounded-xl flex items-center justify-center`}>
            <Image className={`${iconClass} text-blue-600`} />
          </div>
        );
      case 'document':
        return (
          <div className={`${compact ? 'w-12 h-12' : 'w-16 h-16'} bg-amber-100 rounded-xl flex items-center justify-center`}>
            <FileText className={`${iconClass} text-amber-600`} />
          </div>
        );
      case 'mixed':
        return (
          <div className="flex gap-2">
            <div className={`${compact ? 'w-10 h-10' : 'w-12 h-12'} bg-red-100 rounded-xl flex items-center justify-center`}>
              <File className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-red-600`} />
            </div>
            <div className={`${compact ? 'w-10 h-10' : 'w-12 h-12'} bg-blue-100 rounded-xl flex items-center justify-center`}>
              <Image className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-blue-600`} />
            </div>
          </div>
        );
      default:
        return (
          <div className={`${compact ? 'w-12 h-12' : 'w-16 h-16'} bg-primary-100 rounded-xl flex items-center justify-center`}>
            <Upload className={`${iconClass} text-primary-600`} />
          </div>
        );
    }
  };

  // File type icon
  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className="w-4 h-4 text-blue-500" />;
    } else if (file.type === 'application/pdf') {
      return <File className="w-4 h-4 text-red-500" />;
    }
    return <FileText className="w-4 h-4 text-gray-500" />;
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className={className}>
      {/* Drop Zone */}
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl transition-all cursor-pointer
          ${compact ? 'p-4' : 'p-8'}
          ${isDragging 
            ? 'border-primary-500 bg-primary-50 scale-[1.02]' 
            : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
        />

        {children || (
          <div className="text-center">
            {/* Icon */}
            <div className="flex justify-center mb-3">
              {renderIcon()}
            </div>

            {/* Text */}
            <p className={`font-medium text-gray-700 ${compact ? 'text-sm' : ''}`}>
              {title || (isDragging ? 'Déposez les fichiers ici...' : 'Glissez-déposez vos fichiers ici')}
            </p>
            <p className={`text-gray-500 mt-1 ${compact ? 'text-xs' : 'text-sm'}`}>
              {subtitle || 'ou cliquez pour sélectionner'}
            </p>

            {/* File type hint */}
            {!compact && accept !== '*' && (
              <p className="text-xs text-gray-400 mt-2">
                Formats acceptés: {accept.replace(/\*/g, '').replace(/,/g, ', ')}
              </p>
            )}
          </div>
        )}

        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-primary-100/80 rounded-xl flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-12 h-12 text-primary-600 mx-auto mb-2 animate-bounce" />
              <p className="text-primary-700 font-medium">Déposez ici!</p>
            </div>
          </div>
        )}
      </div>

      {/* Selected Files Preview */}
      {showPreview && selectedFiles.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Fichiers sélectionnés ({selectedFiles.length})
          </p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-gray-50 rounded-lg p-2 group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {getFileIcon(file)}
                  <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                  <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
                </div>
                {onRemoveFile && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(index);
                    }}
                    className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DropZone;
