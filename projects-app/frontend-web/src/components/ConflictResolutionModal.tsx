/**
 * Conflict Resolution Modal Component
 * 
 * Displays sync conflicts and allows users to resolve them
 * by choosing local, remote, or merged data.
 */

import React, { useState } from 'react';
import { X, AlertTriangle, Check, RefreshCw, ArrowLeft, ArrowRight, Merge } from 'lucide-react';

interface ConflictData {
  id: string;
  entity: string;
  entityId: string;
  localData: any;
  remoteData: any;
  conflictType: string;
  createdAt: string;
}

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: ConflictData[];
  onResolve: (conflictId: string, resolution: 'local_wins' | 'remote_wins' | 'merged', mergedData?: any) => Promise<void>;
}

// Helper to format entity names
const formatEntityName = (entity: string): string => {
  const names: Record<string, string> = {
    project: 'Projet',
    bordereau: 'Bordereau',
    periode: 'Période',
    metre: 'Métré',
    decompt: 'Décompte',
    attachment: 'Pièce jointe',
    photo: 'Photo',
    pv: 'PV',
  };
  return names[entity] || entity;
};

// Helper to format field names
const formatFieldName = (field: string): string => {
  const names: Record<string, string> = {
    objet: 'Objet',
    montant: 'Montant',
    status: 'Statut',
    progress: 'Progression',
    marcheNo: 'N° Marché',
    annee: 'Année',
    designation: 'Désignation',
    quantite: 'Quantité',
    prixUnitaire: 'Prix Unitaire',
    dateDebut: 'Date Début',
    dateFin: 'Date Fin',
    updatedAt: 'Dernière modification',
  };
  return names[field] || field;
};

// Helper to format values
const formatValue = (value: any): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'number') {
    if (value >= 1000) return value.toLocaleString('fr-FR');
    return value.toString();
  }
  return String(value);
};

// Get changed fields between two objects
const getChangedFields = (local: any, remote: any): string[] => {
  const allKeys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  const changed: string[] = [];
  
  for (const key of allKeys) {
    if (key.startsWith('_') || key === 'id' || key === 'updatedAt' || key === 'createdAt') continue;
    
    const localVal = JSON.stringify(local?.[key]);
    const remoteVal = JSON.stringify(remote?.[key]);
    
    if (localVal !== remoteVal) {
      changed.push(key);
    }
  }
  
  return changed;
};

const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  isOpen,
  onClose,
  conflicts,
  onResolve,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isResolving, setIsResolving] = useState(false);
  const [mergedData, setMergedData] = useState<any>(null);
  const [showMergeEditor, setShowMergeEditor] = useState(false);

  if (!isOpen || conflicts.length === 0) return null;

  const currentConflict = conflicts[currentIndex];
  const changedFields = getChangedFields(currentConflict.localData, currentConflict.remoteData);

  const handleResolve = async (resolution: 'local_wins' | 'remote_wins' | 'merged') => {
    setIsResolving(true);
    try {
      await onResolve(
        currentConflict.id, 
        resolution, 
        resolution === 'merged' ? mergedData : undefined
      );
      
      // Move to next conflict or close
      if (currentIndex < conflicts.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onClose();
      }
    } catch (error) {
      console.error('Error resolving conflict:', error);
    } finally {
      setIsResolving(false);
    }
  };

  const initMergedData = () => {
    // Start with remote data as base, then allow user to pick fields
    setMergedData({ ...currentConflict.remoteData });
    setShowMergeEditor(true);
  };

  const updateMergedField = (field: string, useLocal: boolean) => {
    setMergedData((prev: any) => ({
      ...prev,
      [field]: useLocal ? currentConflict.localData[field] : currentConflict.remoteData[field],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="text-lg font-semibold text-amber-900">
                Conflit de synchronisation
              </h2>
              <p className="text-sm text-amber-700">
                {conflicts.length > 1 
                  ? `${currentIndex + 1} sur ${conflicts.length} conflits` 
                  : 'Un conflit a été détecté'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Entity Info */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Type:</span> {formatEntityName(currentConflict.entity)}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">ID:</span> {currentConflict.entityId}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Conflit:</span> {currentConflict.conflictType || 'Modification simultanée'}
            </p>
          </div>

          {!showMergeEditor ? (
            /* Comparison View */
            <div className="grid grid-cols-2 gap-4">
              {/* Local Version */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-blue-50 p-3 border-b border-blue-200">
                  <h3 className="font-medium text-blue-900 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Version locale (votre appareil)
                  </h3>
                </div>
                <div className="p-3 space-y-2">
                  {changedFields.map((field) => (
                    <div key={field} className="text-sm">
                      <span className="font-medium text-gray-600">
                        {formatFieldName(field)}:
                      </span>
                      <div className="mt-1 p-2 bg-blue-50 rounded text-blue-800 font-mono text-xs break-all">
                        {formatValue(currentConflict.localData?.[field])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Remote Version */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-green-50 p-3 border-b border-green-200">
                  <h3 className="font-medium text-green-900 flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Version serveur (autre appareil)
                  </h3>
                </div>
                <div className="p-3 space-y-2">
                  {changedFields.map((field) => (
                    <div key={field} className="text-sm">
                      <span className="font-medium text-gray-600">
                        {formatFieldName(field)}:
                      </span>
                      <div className="mt-1 p-2 bg-green-50 rounded text-green-800 font-mono text-xs break-all">
                        {formatValue(currentConflict.remoteData?.[field])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Merge Editor */
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-purple-50 p-3 border-b border-purple-200">
                <h3 className="font-medium text-purple-900 flex items-center gap-2">
                  <Merge className="w-4 h-4" />
                  Fusion manuelle - Choisissez pour chaque champ
                </h3>
              </div>
              <div className="p-3 space-y-4">
                {changedFields.map((field) => (
                  <div key={field} className="border rounded p-3">
                    <p className="font-medium text-gray-700 mb-2">
                      {formatFieldName(field)}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateMergedField(field, true)}
                        className={`p-2 rounded text-xs font-mono text-left ${
                          JSON.stringify(mergedData?.[field]) === JSON.stringify(currentConflict.localData?.[field])
                            ? 'bg-blue-100 border-2 border-blue-500'
                            : 'bg-gray-50 border border-gray-200 hover:bg-blue-50'
                        }`}
                      >
                        <span className="block text-blue-600 font-sans text-xs mb-1">Local:</span>
                        {formatValue(currentConflict.localData?.[field])}
                      </button>
                      <button
                        onClick={() => updateMergedField(field, false)}
                        className={`p-2 rounded text-xs font-mono text-left ${
                          JSON.stringify(mergedData?.[field]) === JSON.stringify(currentConflict.remoteData?.[field])
                            ? 'bg-green-100 border-2 border-green-500'
                            : 'bg-gray-50 border border-gray-200 hover:bg-green-50'
                        }`}
                      >
                        <span className="block text-green-600 font-sans text-xs mb-1">Serveur:</span>
                        {formatValue(currentConflict.remoteData?.[field])}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex items-center justify-between">
          {/* Navigation */}
          <div className="flex items-center gap-2">
            {conflicts.length > 1 && (
              <>
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  ← Précédent
                </button>
                <button
                  onClick={() => setCurrentIndex(Math.min(conflicts.length - 1, currentIndex + 1))}
                  disabled={currentIndex === conflicts.length - 1}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  Suivant →
                </button>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {showMergeEditor ? (
              <>
                <button
                  onClick={() => setShowMergeEditor(false)}
                  className="px-4 py-2 text-sm border rounded hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  onClick={() => handleResolve('merged')}
                  disabled={isResolving}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isResolving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Appliquer la fusion
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleResolve('local_wins')}
                  disabled={isResolving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Garder local
                </button>
                <button
                  onClick={() => handleResolve('remote_wins')}
                  disabled={isResolving}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Garder serveur
                </button>
                <button
                  onClick={initMergedData}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
                >
                  <Merge className="w-4 h-4" />
                  Fusionner
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolutionModal;
