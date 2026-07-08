/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Index Management Page - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Admin page for managing revision indexes
 * - View all months
 * - Import from Excel
 * - Edit individual months
 * - Change status (provisoire/définitif)
 * - Audit log
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Upload,
  Download,
  Plus,
  Pencil,
  Trash2,
  Check,
  Clock,
  AlertCircle,
  FileSpreadsheet,
  History,
  Filter,
  RefreshCw
} from 'lucide-react';
import {
  listIndexes,
  downloadTemplate,
  deleteMonthIndexes,
  IndexMonth,
  getAuditLog,
  AuditLogEntry
} from '../../services/indexManagementService';
import EditIndexDialog from './EditIndexDialog';
import ImportExcelDialog from './ImportExcelDialog';

const IndexManagementPage: React.FC = () => {
  
  // State
  const [months, setMonths] = useState<IndexMonth[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'provisoire' | 'definitif'>('all');
  
  // Dialogs
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMonth, setEditMonth] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  
  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = {};
      if (selectedYear !== 'all') params.year = selectedYear;
      if (selectedStatus !== 'all') params.status = selectedStatus;
      
      const data = await listIndexes(params);
      setMonths(data.months);
      setAvailableYears(data.availableYears);
    } catch (err: any) {
      setError(err.message || 'Failed to load indexes');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedStatus]);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // Handlers
  const handleDownloadTemplate = async () => {
    try {
      await downloadTemplate();
    } catch (err: any) {
      alert('Failed to download template: ' + err.message);
    }
  };
  
  const handleDelete = async (monthDate: string) => {
    if (deleteConfirm !== monthDate) {
      setDeleteConfirm(monthDate);
      return;
    }
    
    try {
      await deleteMonthIndexes(monthDate);
      setDeleteConfirm(null);
      loadData();
    } catch (err: any) {
      alert('Failed to delete: ' + err.message);
    }
  };
  
  const handleViewAudit = async () => {
    try {
      const log = await getAuditLog({ limit: 50 });
      setAuditLog(log);
      setAuditDialogOpen(true);
    } catch (err: any) {
      alert('Failed to load audit log: ' + err.message);
    }
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' });
  };
  
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('fr-FR');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Gestion des Index
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Barème d'Indexation - Administration
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleViewAudit}
                className="btn-secondary flex items-center gap-2"
              >
                <History className="h-4 w-4" />
                Audit Log
              </button>
              <button
                onClick={handleDownloadTemplate}
                className="btn-secondary flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Template
              </button>
              <button
                onClick={() => setImportDialogOpen(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Import Excel
              </button>
              <button
                onClick={() => {
                  setEditMonth(null);
                  setEditDialogOpen(true);
                }}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Ajouter Mois
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Filtres:</span>
          </div>
          
          {/* Year filter */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="all">Toutes les années</option>
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          
          {/* Status filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="all">Tous les statuts</option>
            <option value="definitif">Définitif (*)</option>
            <option value="provisoire">Provisoire (**)</option>
          </select>
          
          <button
            onClick={loadData}
            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          
          <div className="ml-auto text-sm text-gray-500">
            {months.length} mois
          </div>
        </div>
        
        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}
        
        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Mois
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Index
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Mis à jour
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto text-gray-400" />
                    <p className="mt-2 text-gray-500">Chargement...</p>
                  </td>
                </tr>
              ) : months.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    Aucun index trouvé
                  </td>
                </tr>
              ) : (
                months.map((month) => (
                  <tr key={month.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-white">
                          {formatDate(month.monthDate)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        {month.indexCount} index
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {month.status === 'definitif' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          <Check className="h-3 w-3" />
                          Définitif (*)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <Clock className="h-3 w-3" />
                          Provisoire (**)
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {month.source || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDateTime(month.updatedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditMonth(month.monthDate);
                            setEditDialogOpen(true);
                          }}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          title="Modifier"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(month.monthDate)}
                          className={`p-1.5 rounded ${
                            deleteConfirm === month.monthDate
                              ? 'text-white bg-red-600 hover:bg-red-700'
                              : 'text-gray-500 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          title={deleteConfirm === month.monthDate ? 'Confirmer la suppression' : 'Supprimer'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Edit Dialog */}
      {editDialogOpen && (
        <EditIndexDialog
          month={editMonth}
          onClose={() => {
            setEditDialogOpen(false);
            setEditMonth(null);
          }}
          onSave={() => {
            setEditDialogOpen(false);
            setEditMonth(null);
            loadData();
          }}
        />
      )}
      
      {/* Import Dialog */}
      {importDialogOpen && (
        <ImportExcelDialog
          onClose={() => setImportDialogOpen(false)}
          onImport={() => {
            setImportDialogOpen(false);
            loadData();
          }}
        />
      )}
      
      {/* Audit Log Dialog */}
      {auditDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold">Audit Log</h2>
              </div>
              <button
                onClick={() => setAuditDialogOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(80vh-120px)]">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mois</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Utilisateur</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {formatDate(entry.monthDate)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.action === 'create' ? 'bg-green-100 text-green-800' :
                          entry.action === 'update' ? 'bg-blue-100 text-blue-800' :
                          entry.action === 'delete' ? 'bg-red-100 text-red-800' :
                          entry.action === 'import' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {entry.userEmail || '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {entry.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setAuditDialogOpen(false)}
                className="btn-secondary"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IndexManagementPage;
