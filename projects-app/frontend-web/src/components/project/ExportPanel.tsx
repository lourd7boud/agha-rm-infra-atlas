import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, FileSpreadsheet, Table, Receipt,
  FileText, BarChart3, RefreshCw, CheckCircle,
  AlertCircle, X, ArrowDownToLine, Loader2
} from 'lucide-react';
import { apiService } from '../../services/apiService';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ExportItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  available: boolean;
  url: string;
}

interface ExportPanelProps {
  projectId: string;
  marcheNo?: string;
}

// ═══════════════════════════════════════════════════════════════
// Icon mapping
// ═══════════════════════════════════════════════════════════════

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  'table': Table,
  'bar-chart': BarChart3,
  'file-text': FileText,
  'receipt': Receipt,
};

const EXPORT_COLORS: Record<string, { bg: string; border: string; icon: string; hover: string }> = {
  bordereau: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600', hover: 'hover:bg-emerald-100' },
  situation: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', hover: 'hover:bg-blue-100' },
  recapitulatif: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', hover: 'hover:bg-purple-100' },
  decompt: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', hover: 'hover:bg-amber-100' },
};

function getExportColor(id: string) {
  if (id.startsWith('decompt')) return EXPORT_COLORS.decompt;
  return EXPORT_COLORS[id] || EXPORT_COLORS.recapitulatif;
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

const ExportPanel: React.FC<ExportPanelProps> = ({ projectId, marcheNo }) => {
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const loadExports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiService.getAvailableExports(projectId);
      setExports(result.data || []);
    } catch (err: any) {
      console.error('Error loading exports:', err);
      setError(err.response?.data?.error || 'Erreur de chargement des exports');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadExports();
  }, [loadExports]);

  const handleDownload = async (item: ExportItem) => {
    if (!item.available || downloading) return;
    try {
      setDownloading(item.id);
      setError(null);

      // Build filename
      const prefix = item.id.startsWith('decompt') ? `Decompte` : item.id.charAt(0).toUpperCase() + item.id.slice(1);
      const filename = `${prefix}_${marcheNo || 'PROJ'}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      await apiService.downloadExport(item.url, filename);

      setDownloaded((prev) => new Set([...prev, item.id]));
      setTimeout(() => {
        setDownloaded((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }, 3000);
    } catch (err: any) {
      console.error('Download error:', err);
      setError(`Erreur téléchargement: ${item.label}`);
    } finally {
      setDownloading(null);
    }
  };

  // ─── Loading ──────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Chargement des exports disponibles...</span>
      </div>
    );
  }

  // Separate by type
  const mainExports = exports.filter((e) => !e.id.startsWith('decompt-'));
  const decomptExports = exports.filter((e) => e.id.startsWith('decompt-'));

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            Export Excel — Documents du marché
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Téléchargez les documents professionnels au format Excel avec formules et mise en page
          </p>
        </div>
        <button
          onClick={loadExports}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      {/* ═══ Main Exports ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {mainExports.map((item) => {
          const colors = getExportColor(item.id);
          const IconComponent = ICON_MAP[item.icon] || FileText;
          const isDownloading = downloading === item.id;
          const isDownloaded = downloaded.has(item.id);

          return (
            <button
              key={item.id}
              onClick={() => handleDownload(item)}
              disabled={!item.available || !!downloading}
              className={`relative group text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                item.available
                  ? `${colors.bg} ${colors.border} ${colors.hover} cursor-pointer shadow-sm hover:shadow-md`
                  : 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-60'
              }`}
            >
              {/* Success badge */}
              {isDownloaded && (
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg animate-bounce">
                  <CheckCircle className="w-4 h-4 text-white" />
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-lg ${item.available ? colors.bg : 'bg-gray-100'}`}>
                  {isDownloading ? (
                    <Loader2 className={`w-6 h-6 ${colors.icon} animate-spin`} />
                  ) : (
                    <IconComponent className={`w-6 h-6 ${item.available ? colors.icon : 'text-gray-400'}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                </div>
              </div>

              {item.available && (
                <div className="flex items-center gap-1 mt-3 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowDownToLine className={`w-3.5 h-3.5 ${colors.icon}`} />
                  <span className={colors.icon}>Télécharger .xlsx</span>
                </div>
              )}

              {!item.available && (
                <p className="text-xs text-gray-400 mt-3">Données insuffisantes</p>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ Décomptes Exports ═══ */}
      {decomptExports.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-amber-600" />
            Décomptes provisoires ({decomptExports.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {decomptExports.map((item) => {
              const isDownloading = downloading === item.id;
              const isDownloaded = downloaded.has(item.id);

              return (
                <button
                  key={item.id}
                  onClick={() => handleDownload(item)}
                  disabled={!item.available || !!downloading}
                  className="relative group flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-all text-left"
                >
                  {isDownloaded && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-3 h-3 text-white" />
                    </div>
                  )}

                  <div className="p-2 bg-amber-50 rounded-lg flex-shrink-0">
                    {isDownloading ? (
                      <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                    ) : (
                      <Receipt className="w-5 h-5 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                  <Download className="w-4 h-4 text-gray-400 group-hover:text-amber-600 transition-colors flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <FileSpreadsheet className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <p className="font-medium mb-1">Exports professionnels</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-blue-600">
            <li><strong>Bordereau des Prix</strong> — Détail estimatif avec formules Excel (Qté × PU)</li>
            <li><strong>Situation des Travaux</strong> — Quantités par période avec % réalisation</li>
            <li><strong>Récapitulatif</strong> — Multi-feuilles: fiche projet + décomptes + pénalités</li>
            <li><strong>Décomptes</strong> — Chaque décompte avec calculs TTC et net à payer</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ExportPanel;
