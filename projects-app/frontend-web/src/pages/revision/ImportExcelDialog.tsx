/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Import Excel Dialog - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Dialog for importing indexes from Excel file
 * - Drag and drop upload
 * - Preview before import
 * - Update existing option
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useCallback } from 'react';
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  Check,
  AlertCircle,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import {
  downloadTemplate,
  importFromExcel,
  ImportResult
} from '../../services/indexManagementService';

interface ImportExcelDialogProps {
  onClose: () => void;
  onImport: () => void;
}

const ImportExcelDialog: React.FC<ImportExcelDialogProps> = ({ onClose, onImport }) => {
  // State
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);
  
  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls')) {
        setFile(droppedFile);
        setError(null);
        setResult(null);
      } else {
        setError('Seuls les fichiers Excel (.xlsx, .xls) sont acceptés');
      }
    }
  }, []);
  
  // Handle file select
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
    }
  };
  
  // Handle download template
  const handleDownloadTemplate = async () => {
    try {
      await downloadTemplate();
    } catch (err: any) {
      setError('Échec du téléchargement: ' + err.message);
    }
  };
  
  // Handle import
  const handleImport = async () => {
    if (!file) return;
    
    try {
      setImporting(true);
      setError(null);
      
      const importResult = await importFromExcel(file, updateExisting);
      setResult(importResult);
      
      // Auto-close if no errors and something was imported
      if (importResult.errors.length === 0 && (importResult.imported > 0 || importResult.updated > 0)) {
        setTimeout(() => {
          onImport();
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message || 'Échec de l\'import');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Import Excel
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          {/* Template download */}
          <div className="mb-4">
            <button
              onClick={handleDownloadTemplate}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <Download className="h-4 w-4" />
              Télécharger le template Excel
            </button>
          </div>
          
          {/* Drop zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-colors
              ${dragActive 
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' 
                : file
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
              }
            `}
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileSpreadsheet className="h-12 w-12 text-green-600" />
                <p className="font-medium text-gray-900 dark:text-white">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                  }}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Supprimer
                </button>
              </div>
            ) : (
              <>
                <FileSpreadsheet className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-300 mb-2">
                  Glissez-déposez votre fichier Excel ici
                </p>
                <p className="text-sm text-gray-500 mb-3">ou</p>
                <label className="btn-secondary cursor-pointer">
                  Parcourir
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </>
            )}
          </div>
          
          {/* Options */}
          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="rounded text-primary-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Mettre à jour les mois existants
              </span>
            </label>
          </div>
          
          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          
          {/* Result */}
          {result && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                Résultat de l'import
              </h3>
              <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{result.imported}</div>
                  <div className="text-gray-500">Importés</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{result.updated}</div>
                  <div className="text-gray-500">Mis à jour</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">{result.skipped}</div>
                  <div className="text-gray-500">Ignorés</div>
                </div>
              </div>
              
              {result.errors.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">Erreurs ({result.errors.length})</span>
                  </div>
                  <ul className="text-xs text-yellow-600 dark:text-yellow-500 space-y-1 max-h-24 overflow-auto">
                    {result.errors.map((err, i) => (
                      <li key={i}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {result.errors.length === 0 && (result.imported > 0 || result.updated > 0) && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="h-5 w-5" />
                  <span>Import réussi! Fermeture automatique...</span>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="btn-primary flex items-center gap-2"
            >
              {importing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Importer
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportExcelDialog;
