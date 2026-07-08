import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, TrendingUp, DollarSign, FolderKanban,
  Clock, Activity, FileText, AlertTriangle, Briefcase,
  FileSignature, PieChart, ArrowUpRight, ArrowDownRight,
  Calendar, RefreshCw, ChevronRight, FileSpreadsheet, FileDown
} from 'lucide-react';
import { exportDelaisExcel, exportDelaisPDF } from '../utils/delaisExport';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RechartsPie, Pie, Cell,
  Legend, AreaChart, Area
} from 'recharts';
import { apiService } from '../services/apiService';

// ═══════════════════════════════════════════════════════════════
// Cross-Project Reports Page — التقارير الشاملة
// Multi-project analytics, financial comparisons, KPIs
// ═══════════════════════════════════════════════════════════════

type ReportTab = 'overview' | 'financial' | 'deadlines' | 'activity';

const STATUS_COLORS: Record<string, string> = {
  active: '#3B82F6',
  en_cours: '#3B82F6',
  draft: '#9CA3AF',
  completed: '#10B981',
  termine: '#10B981',
  suspendu: '#F59E0B',
  planifie: '#8B5CF6',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  en_cours: 'En cours',
  draft: 'Brouillon',
  completed: 'Terminé',
  termine: 'Terminé',
  suspendu: 'Suspendu',
  planifie: 'Planifié',
};

const ReportsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [loading, setLoading] = useState(true);
  const [globalData, setGlobalData] = useState<any>(null);
  const [financialData, setFinancialData] = useState<any[]>([]);
  const [deadlinesData, setDeadlinesData] = useState<any[]>([]);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [globalRes, financialRes, deadlinesRes, activityRes] = await Promise.all([
        apiService.getGlobalReport(),
        apiService.getFinancialReport(),
        apiService.getDeadlinesReport(),
        apiService.getActivityReport(),
      ]);
      setGlobalData(globalRes.data);
      setFinancialData(financialRes.data || []);
      setDeadlinesData(deadlinesRes.data || []);
      setActivityData(activityRes.data || []);
    } catch (err) {
      console.error('Error loading reports:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatCurrency = (v: number | string | undefined) => {
    const num = typeof v === 'string' ? parseFloat(v) : (v || 0);
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)} M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)} K`;
    return num.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  };

  const formatFullCurrency = (v: number | string | undefined) => {
    const num = typeof v === 'string' ? parseFloat(v) : (v || 0);
    return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR');
  };

  const tabs = [
    { id: 'overview' as ReportTab, label: 'Vue d\'ensemble', icon: PieChart },
    { id: 'financial' as ReportTab, label: 'Finances', icon: DollarSign },
    { id: 'deadlines' as ReportTab, label: 'Délais', icon: Clock },
    { id: 'activity' as ReportTab, label: 'Activité récente', icon: Activity },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Chargement des rapports...</p>
        </div>
      </div>
    );
  }

  const stats = globalData?.globalStats || {};
  const projects = globalData?.projects || [];
  const monthlyTrend = globalData?.monthlyTrend || [];
  const statusDist = globalData?.statusDistribution || {};
  const budgetDist = globalData?.budgetDistribution || [];

  // Prepare chart data
  const statusPieData = Object.entries(statusDist).map(([key, value]) => ({
    name: STATUS_LABELS[key] || key,
    value: value as number,
    color: STATUS_COLORS[key] || '#9CA3AF',
  }));

  const budgetBarData = budgetDist.map((p: any) => ({
    name: p.objet.length > 20 ? p.objet.substring(0, 20) + '...' : p.objet,
    montant: Number(p.montant),
    realise: Number(p.realise),
    avancement: p.avancement,
  }));

  const trendLineData = monthlyTrend.map((m: any) => ({
    mois: m.mois,
    montant: Number(m.montantMois) || 0,
    decompts: Number(m.nbDecompts) || 0,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-blue-600" />
            Rapports Multi-Projets
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Analyse globale de {stats.totalProjects || 0} projets
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ OVERVIEW TAB ═══════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              icon={<FolderKanban className="w-5 h-5 text-blue-600" />}
              label="Total Projets"
              value={stats.totalProjects}
              sub={`${stats.activeProjects} actifs · ${stats.completedProjects} terminés`}
              bgColor="bg-blue-50"
            />
            <KPICard
              icon={<DollarSign className="w-5 h-5 text-green-600" />}
              label="Budget Total"
              value={`${formatCurrency(stats.totalBudget)} DH`}
              sub={`Réalisé: ${formatCurrency(stats.totalRealise)} DH`}
              bgColor="bg-green-50"
            />
            <KPICard
              icon={<TrendingUp className="w-5 h-5 text-purple-600" />}
              label="Taux de Réalisation"
              value={`${stats.tauxRealisation}%`}
              sub={`${stats.totalDecomptes} décomptes émis`}
              bgColor="bg-purple-50"
            />
            <KPICard
              icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
              label="Avenants / Pénalités"
              value={`${formatCurrency(stats.totalAvenants)} DH`}
              sub={`Pénalités: ${formatCurrency(stats.totalPenalites)} DH`}
              bgColor="bg-amber-50"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Distribution Pie */}
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-blue-500" />
                Répartition par statut
              </h3>
              {statusPieData.length > 0 ? (
                <div className="flex items-center">
                  <ResponsiveContainer width="50%" height={200}>
                    <RechartsPie>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        paddingAngle={3}
                      >
                        {statusPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RechartsPie>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {statusPieData.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-gray-600">{entry.name}</span>
                        <span className="font-semibold text-gray-800">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8">Aucune donnée</p>
              )}
            </div>

            {/* Monthly Trend */}
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Évolution mensuelle (12 mois)
              </h3>
              {trendLineData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trendLineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip
                      formatter={(value: any) => [`${formatFullCurrency(value)} DH`, 'Montant']}
                    />
                    <Area
                      type="monotone"
                      dataKey="montant"
                      stroke="#3B82F6"
                      fill="#DBEAFE"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-400 text-center py-8">Aucune donnée de décomptes</p>
              )}
            </div>
          </div>

          {/* Budget Distribution Bar Chart */}
          {budgetBarData.length > 0 && (
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-500" />
                Comparatif Budget vs Réalisé (Top 10)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={budgetBarData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                  <Tooltip
                    formatter={(value: any) => [`${formatFullCurrency(value)} DH`]}
                  />
                  <Legend />
                  <Bar dataKey="montant" name="Budget" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="realise" name="Réalisé" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Project List Summary */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-blue-500" />
              Synthèse des projets
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-2">Projet</th>
                    <th className="text-right py-2 px-2">Montant</th>
                    <th className="text-right py-2 px-2">Réalisé</th>
                    <th className="text-center py-2 px-2">Avancement</th>
                    <th className="text-center py-2 px-2">DC</th>
                    <th className="text-center py-2 px-2">AV</th>
                    <th className="text-center py-2 px-2">ODS</th>
                    <th className="text-center py-2 px-2">Statut</th>
                    <th className="text-center py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p: any) => {
                    const montant = Number(p.montant) || 0;
                    const realise = Number(p.montantRealise) || 0;
                    const pct = montant > 0 ? Math.round((realise / montant) * 100) : 0;
                    return (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-800 truncate max-w-[200px]">{p.objet}</div>
                          <div className="text-xs text-gray-400">{p.marcheNo}</div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-gray-700">
                          {formatFullCurrency(montant)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-gray-700">
                          {formatFullCurrency(realise)}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-gray-600">{pct}%</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center text-gray-600">{p.nbDecomptes || 0}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{p.nbAvenants || 0}</td>
                        <td className="py-2 px-2 text-center text-gray-600">{p.nbOds || 0}</td>
                        <td className="py-2 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: (STATUS_COLORS[p.status] || '#9CA3AF') + '20',
                              color: STATUS_COLORS[p.status] || '#9CA3AF',
                            }}
                          >
                            {STATUS_LABELS[p.status] || p.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Link
                            to={`/projects/${p.id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ FINANCIAL TAB ═══════════════════ */}
      {activeTab === 'financial' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              Analyse financière détaillée
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-2">Projet</th>
                    <th className="text-right py-2 px-2">Montant Marché</th>
                    <th className="text-right py-2 px-2">Avenants</th>
                    <th className="text-right py-2 px-2">Montant Actualisé</th>
                    <th className="text-right py-2 px-2">Cumulé</th>
                    <th className="text-right py-2 px-2">TTC</th>
                    <th className="text-right py-2 px-2">Pénalités</th>
                    <th className="text-center py-2 px-2">Réalisation</th>
                  </tr>
                </thead>
                <tbody>
                  {financialData.map((p: any) => {
                    const montant = Number(p.montantMarche) || 0;
                    const cumule = Number(p.montantCumule) || 0;
                    const pct = montant > 0 ? Math.round((cumule / montant) * 100) : 0;
                    return (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.objet}</div>
                          <div className="text-xs text-gray-400">{p.marcheNo}</div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{formatFullCurrency(montant)}</td>
                        <td className="py-2 px-2 text-right font-mono text-purple-600">
                          {Number(p.totalAvenants) > 0 ? `+${formatFullCurrency(p.totalAvenants)}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-medium">
                          {formatFullCurrency(p.montantActualise)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-blue-700">
                          {formatFullCurrency(cumule)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {formatFullCurrency(p.totalTtc)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-red-600">
                          {Number(p.totalPenalites) > 0 ? formatFullCurrency(p.totalPenalites) : '—'}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`font-semibold ${pct >= 80 ? 'text-green-600' : pct >= 40 ? 'text-blue-600' : 'text-gray-600'}`}>
                            {pct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {financialData.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-gray-50">
                      <td className="py-2 px-2">TOTAL</td>
                      <td className="py-2 px-2 text-right font-mono">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.montantMarche) || 0), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-purple-700">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.totalAvenants) || 0), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.montantActualise) || 0), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-blue-700">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.montantCumule) || 0), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.totalTtc) || 0), 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-red-700">
                        {formatFullCurrency(financialData.reduce((s: number, p: any) => s + (Number(p.totalPenalites) || 0), 0))}
                      </td>
                      <td className="py-2 px-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Financial bar chart comparison */}
          {financialData.length > 0 && (
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4">Comparaison Budget / Réalisé / Pénalités</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart
                  data={financialData.slice(0, 8).map((p: any) => ({
                    name: (p.objet || '').substring(0, 18) + (p.objet?.length > 18 ? '...' : ''),
                    budget: Number(p.montantMarche),
                    realise: Number(p.montantCumule),
                    penalites: Number(p.totalPenalites),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip formatter={(v: any) => [`${formatFullCurrency(v)} DH`]} />
                  <Legend />
                  <Bar dataKey="budget" name="Budget" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="realise" name="Réalisé" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="penalites" name="Pénalités" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ DEADLINES TAB ═══════════════════ */}
      {activeTab === 'deadlines' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                Suivi des délais
              </h3>
              {deadlinesData.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setExporting('excel');
                      try { await exportDelaisExcel(deadlinesData); }
                      catch (e) { console.error('Export Excel error:', e); }
                      finally { setExporting(null); }
                    }}
                    disabled={!!exporting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    {exporting === 'excel' ? (
                      <div className="w-3.5 h-3.5 border-2 border-green-300 border-t-green-600 rounded-full animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                    Exporter Excel
                  </button>
                  <button
                    onClick={async () => {
                      setExporting('pdf');
                      try { await exportDelaisPDF(deadlinesData); }
                      catch (e) { console.error('Export PDF error:', e); }
                      finally { setExporting(null); }
                    }}
                    disabled={!!exporting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {exporting === 'pdf' ? (
                      <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                    Exporter PDF
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {deadlinesData.map((p: any) => {
                const jours = Number(p.joursRestants) || 0;
                const isOverdue = jours <= 0 && (p.status === 'active' || p.status === 'en_cours');
                const isUrgent = jours > 0 && jours <= 30;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl border ${
                      isOverdue ? 'border-red-200 bg-red-50' :
                      isUrgent ? 'border-amber-200 bg-amber-50' :
                      'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Link to={`/projects/${p.id}`} className="font-medium text-gray-800 hover:text-blue-600">
                            {p.objet}
                          </Link>
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: (STATUS_COLORS[p.status] || '#9CA3AF') + '20',
                              color: STATUS_COLORS[p.status] || '#9CA3AF',
                            }}
                          >
                            {STATUS_LABELS[p.status] || p.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          {p.marcheNo && <span>{p.marcheNo}</span>}
                          {p.dateCommencement && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Début: {formatDate(p.dateCommencement)}
                            </span>
                          )}
                          {p.delaisExecution && (
                            <span>Délai: {p.delaisExecution} mois</span>
                          )}
                          {p.dateFinPrevue && (
                            <span>Fin prévue: {formatDate(p.dateFinPrevue)}</span>
                          )}
                          {Number(p.nbArrets) > 0 && (
                            <span className="text-amber-600">
                              {p.nbArrets} arrêt(s)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        {p.dateCommencement && p.delaisExecution ? (
                          isOverdue ? (
                            <div className="flex items-center gap-1 text-red-600 font-semibold">
                              <ArrowDownRight className="w-4 h-4" />
                              <span>En retard</span>
                            </div>
                          ) : (
                            <div className={`flex items-center gap-1 font-semibold ${isUrgent ? 'text-amber-600' : 'text-green-600'}`}>
                              <ArrowUpRight className="w-4 h-4" />
                              <span>{Math.round(jours)}j restants</span>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-gray-400">Dates non définies</span>
                        )}
                        {p.dateReceptionProvisoire && (
                          <div className="text-xs text-green-600 mt-1">
                            RP: {formatDate(p.dateReceptionProvisoire)}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Timeline bar */}
                    {p.dateCommencement && p.delaisExecution && (
                      <div className="mt-2">
                        <TimelineBar
                          start={p.dateCommencement}
                          delaiMois={p.delaisExecution}
                          achevementTravaux={p.achevementTravaux}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {deadlinesData.length === 0 && (
                <p className="text-gray-400 text-center py-8">Aucun projet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ ACTIVITY TAB ═══════════════════ */}
      {activeTab === 'activity' && (
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            Activité récente (tous projets)
          </h3>
          <div className="space-y-2">
            {activityData.map((item: any, i: number) => {
              const typeIcons: Record<string, typeof FileText> = {
                decompt: FileText,
                avenant: Briefcase,
                ods: FileSignature,
                penalite: AlertTriangle,
              };
              const typeColors: Record<string, string> = {
                decompt: 'text-blue-600 bg-blue-50',
                avenant: 'text-purple-600 bg-purple-50',
                ods: 'text-amber-600 bg-amber-50',
                penalite: 'text-red-600 bg-red-50',
              };
              const typeLabels: Record<string, string> = {
                decompt: 'Décompte',
                avenant: 'Avenant',
                ods: 'ODS',
                penalite: 'Pénalité',
              };
              const Icon = typeIcons[item.type] || FileText;
              const color = typeColors[item.type] || 'text-gray-600 bg-gray-50';

              return (
                <div key={`${item.type}-${item.id}-${i}`} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50">
                  <div className={`p-2 rounded-lg ${color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400 uppercase">
                        {typeLabels[item.type] || item.type}
                      </span>
                      {item.statut && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500">
                          {item.statut}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Link
                        to={`/projects/${item.projectId}`}
                        className="text-xs text-blue-600 hover:underline truncate"
                      >
                        {item.projectName}
                      </Link>
                      {item.montant && Number(item.montant) > 0 && (
                        <span className="text-xs text-gray-500">{formatFullCurrency(item.montant)} DH</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap">
                    {formatDate(item.createdAt)}
                  </div>
                </div>
              );
            })}
            {activityData.length === 0 && (
              <p className="text-gray-400 text-center py-8">Aucune activité récente</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ────────────────────────────────

const KPICard: React.FC<{ icon: React.ReactNode; label: string; value: string | number; sub: string; bgColor: string }> = (
  { icon, label, value, sub, bgColor }
) => (
  <div className={`${bgColor} rounded-xl p-4 border`}>
    <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500">{label}</span></div>
    <div className="text-xl font-bold text-gray-800">{value}</div>
    <div className="text-xs text-gray-500 mt-1">{sub}</div>
  </div>
);

const TimelineBar: React.FC<{ start: string; delaiMois: number; achevementTravaux?: string }> = (
  { start, delaiMois }
) => {
  const startDate = new Date(start);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + delaiMois);
  const now = new Date();
  const totalMs = endDate.getTime() - startDate.getTime();
  const elapsedMs = now.getTime() - startDate.getTime();
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100)) : 0;

  return (
    <div className="w-full bg-gray-200 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all ${
          pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500'
        }`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
};

export default ReportsPage;
