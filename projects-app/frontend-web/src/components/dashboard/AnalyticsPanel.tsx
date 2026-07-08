/**
 * AnalyticsPanel — Advanced Charts & Analytics for Dashboard
 * لوحة التحليلات البيانية المتقدمة
 * 
 * Features:
 * - Budget vs Réalisé bar chart per project
 * - Project status distribution pie chart
 * - Monthly financial evolution line chart (Courbe en S)
 * - Budget allocation by project radar/bar
 * - Responsive, collapsible, professional design
 */

import { FC, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart,
  Line,
} from 'recharts';
import {
  BarChart3, PieChart as PieChartIcon, TrendingUp, Activity,
  Maximize2, Minimize2
} from 'lucide-react';

interface ProjectData {
  id: string;
  objet: string;
  marcheNo: string;
  montant: number;
  status: string;
  progress: number;
  osc?: string;
  delaisExecution?: number;
  commune?: string;
  societe?: string;
}

interface DecomptData {
  id: string;
  projectId: string;
  numero: number;
  totalGeneralTtc?: number;
  totalTtc?: number;
  montantTotal?: number;
  montantCumule?: number;
  createdAt: string;
}

interface BordData {
  projectId: string;
  lignes?: Array<{ quantite?: number; prixUnitaire?: number; prix_unitaire?: number }>;
}

interface AnalyticsPanelProps {
  projects: ProjectData[];
  decompts: DecomptData[];
  bordereaux: BordData[];
}

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#d946ef'
];

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  completed: '#3b82f6',
  draft: '#f59e0b',
  archived: '#94a3b8',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'En cours',
  completed: 'Terminé',
  draft: 'Brouillon',
  archived: 'Archivé',
};

const formatMontant = (val: number): string => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return val.toFixed(0);
};

const formatTooltipValue = (val: number): string => {
  return new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val) + ' DH';
};

// Custom tooltip component
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 max-w-xs">
      <p className="text-sm font-semibold text-slate-800 mb-1 line-clamp-2">{label}</p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-600">{entry.name}:</span>
          <span className="font-medium text-slate-800">{formatTooltipValue(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
const AnalyticsPanel: FC<AnalyticsPanelProps> = ({ projects, decompts, bordereaux }) => {
  const [expanded, setExpanded] = useState(true);
  const [activeChart, setActiveChart] = useState<'budget' | 'status' | 'evolution' | 'progress'>('budget');

  // ═══════════════════════════════════════════════════════════════════
  // DATA PREPARATIONS
  // ═══════════════════════════════════════════════════════════════════

  // 1. Budget vs Réalisé per project
  const budgetData = useMemo(() => {
    if (!projects?.length) return [];

    return projects
      .filter(p => p.status === 'active' || p.status === 'completed')
      .map(project => {
        const cleanId = project.id?.replace('project:', '') || project.id;
        
        // Budget TTC from bordereau
        const projectBords = bordereaux?.filter((b: any) => {
          const bPId = (b.projectId || '')?.replace('project:', '') || '';
          return bPId === cleanId || b.projectId === project.id;
        }) || [];
        
        const budgetTTC = projectBords.reduce((sum: number, b: any) => {
          if (!b.lignes) return sum;
          const montantHT = b.lignes.reduce((s: number, l: any) =>
            s + (Number(l.quantite || 0) * Number(l.prixUnitaire || l.prix_unitaire || 0)), 0);
          return sum + montantHT * 1.2;
        }, 0);

        // Réalisé from last décompte
        const projectDecs = decompts?.filter((d: any) => {
          const dPId = (d.projectId || '')?.replace('project:', '') || '';
          return dPId === cleanId || d.projectId === project.id;
        }) || [];

        let realise = 0;
        if (projectDecs.length > 0) {
          const maxNum = Math.max(...projectDecs.map(d => d.numero || 0));
          const lastDec = projectDecs.filter(d => d.numero === maxNum)
            .reduce((best: any, d: any) => {
              const dVal = Number(d.totalGeneralTtc || d.totalTtc || d.montantTotal || d.montantCumule || 0);
              const bVal = Number(best?.totalGeneralTtc || best?.totalTtc || best?.montantTotal || best?.montantCumule || 0);
              return dVal > bVal ? d : best;
            }, projectDecs.filter(d => d.numero === maxNum)[0]);
          realise = Number(lastDec?.totalGeneralTtc || lastDec?.totalTtc || lastDec?.montantTotal || lastDec?.montantCumule || 0);
        }

        // Short label from marcheNo
        const shortLabel = project.marcheNo?.split('/')[0] || project.marcheNo || '?';

        return {
          name: shortLabel,
          fullName: project.objet,
          budget: Math.round(budgetTTC),
          realise: Math.round(realise),
          reste: Math.round(Math.max(0, budgetTTC - realise)),
          pct: budgetTTC > 0 ? Math.round((realise / budgetTTC) * 100) : 0,
        };
      })
      .filter(d => d.budget > 0)
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 12);
  }, [projects, decompts, bordereaux]);

  // 2. Status distribution
  const statusData = useMemo(() => {
    if (!projects?.length) return [];
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      const s = p.status || 'draft';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([status, count]) => ({
      name: STATUS_LABELS[status] || status,
      value: count,
      color: STATUS_COLORS[status] || '#94a3b8',
    }));
  }, [projects]);

  // 3. Financial evolution (Courbe en S style)
  const evolutionData = useMemo(() => {
    if (!decompts?.length) return [];

    // Group by month
    const monthly: Record<string, { budget: number; realise: number }> = {};
    
    // Total budget for reference line
    const totalBudget = budgetData.reduce((s, d) => s + d.budget, 0);

    decompts.forEach(d => {
      const date = d.createdAt || '';
      if (!date) return;
      const monthKey = date.substring(0, 7); // YYYY-MM
      if (!monthly[monthKey]) monthly[monthKey] = { budget: totalBudget, realise: 0 };
      
      const val = Number(d.totalGeneralTtc || d.totalTtc || d.montantTotal || d.montantCumule || 0);
      monthly[monthKey].realise += val;
    });

    // Sort and accumulate
    const sorted = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
    
    let cumulRealise = 0;
    return sorted.map(([month, data]) => {
      cumulRealise += data.realise;
      const [y, m] = month.split('-');
      const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      return {
        name: `${monthNames[parseInt(m) - 1]} ${y.substring(2)}`,
        budget: totalBudget,
        realise: Math.round(cumulRealise),
      };
    });
  }, [decompts, budgetData]);

  // 4. Project progress radial
  const progressData = useMemo(() => {
    if (!projects?.length) return [];
    return projects
      .filter(p => p.status === 'active')
      .map((p, i) => {
        const cleanId = p.id?.replace('project:', '') || p.id;
        const projectBords = bordereaux?.filter((b: any) => {
          const bPId = (b.projectId || '')?.replace('project:', '') || '';
          return bPId === cleanId || b.projectId === p.id;
        }) || [];
        const budgetTTC = projectBords.reduce((sum: number, b: any) => {
          if (!b.lignes) return sum;
          const ht = b.lignes.reduce((s: number, l: any) =>
            s + (Number(l.quantite || 0) * Number(l.prixUnitaire || l.prix_unitaire || 0)), 0);
          return sum + ht * 1.2;
        }, 0);

        const projectDecs = decompts?.filter((d: any) => {
          const dPId = (d.projectId || '')?.replace('project:', '') || '';
          return dPId === cleanId || d.projectId === p.id;
        }) || [];

        let realise = 0;
        if (projectDecs.length > 0) {
          const maxNum = Math.max(...projectDecs.map(d => d.numero || 0));
          const lastDec = projectDecs.filter(d => d.numero === maxNum)
            .reduce((best: any, d: any) => {
              const dVal = Number(d.totalGeneralTtc || d.totalTtc || d.montantTotal || d.montantCumule || 0);
              const bVal = Number(best?.totalGeneralTtc || best?.totalTtc || best?.montantTotal || best?.montantCumule || 0);
              return dVal > bVal ? d : best;
            }, projectDecs.filter(d => d.numero === maxNum)[0]);
          realise = Number(lastDec?.totalGeneralTtc || lastDec?.totalTtc || lastDec?.montantTotal || lastDec?.montantCumule || 0);
        }

        const pct = budgetTTC > 0 ? Math.round((realise / budgetTTC) * 100) : 0;
        const short = p.marcheNo?.split('/')[0] || p.marcheNo || '?';

        return {
          name: short,
          fullName: p.objet,
          value: Math.min(pct, 100),
          fill: COLORS[i % COLORS.length],
        };
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [projects, decompts, bordereaux]);

  // ═══════════════════════════════════════════════════════════════════
  // CHART TABS
  // ═══════════════════════════════════════════════════════════════════
  const chartTabs = [
    { id: 'budget' as const, label: 'Budget vs Réalisé', icon: BarChart3 },
    { id: 'status' as const, label: 'Répartition', icon: PieChartIcon },
    { id: 'evolution' as const, label: 'Courbe en S', icon: TrendingUp },
    { id: 'progress' as const, label: 'Progression', icon: Activity },
  ];

  if (!projects?.length) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-slate-200 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          Analyse & Indicateurs
        </h2>
        <button className="text-slate-400 hover:text-slate-600">
          {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="p-5">
          {/* Chart Tabs */}
          <div className="flex items-center gap-1 mb-4 bg-slate-100 rounded-lg p-1">
            {chartTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveChart(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeChart === tab.id
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Chart Content */}
          <div className="h-[320px]">
            {/* 1. Budget vs Réalisé */}
            {activeChart === 'budget' && (
              budgetData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgetData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      angle={-35}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={formatMontant}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      wrapperStyle={{ fontSize: 12 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Bar 
                      dataKey="budget" 
                      name="Budget TTC" 
                      fill="#3b82f6" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                    <Bar 
                      dataKey="realise" 
                      name="Réalisé TTC" 
                      fill="#10b981" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Aucune donnée financière disponible
                </div>
              )
            )}

            {/* 2. Status Distribution */}
            {activeChart === 'status' && (
              statusData.length > 0 ? (
                <div className="flex items-center h-full">
                  <div className="w-1/2 h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={index} fill={entry.color} stroke="white" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number, name: string) => [`${value} projets`, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-1/2 space-y-3 pl-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Répartition par statut</h3>
                    {statusData.map((item, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="text-sm text-slate-600">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{item.value}</span>
                          <span className="text-xs text-slate-400">
                            ({(projects.length > 0 ? (item.value / projects.length * 100) : 0).toFixed(0)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Total</span>
                        <span className="font-bold text-slate-800">{projects.length} projets</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Aucun projet
                </div>
              )
            )}

            {/* 3. Financial Evolution (Courbe en S) */}
            {activeChart === 'evolution' && (
              evolutionData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={evolutionData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                    <defs>
                      <linearGradient id="colorRealise" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={formatMontant}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      wrapperStyle={{ fontSize: 12 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Line 
                      type="stepAfter"
                      dataKey="budget" 
                      name="Budget Total" 
                      stroke="#3b82f6" 
                      strokeDasharray="8 4"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area 
                      type="monotone"
                      dataKey="realise" 
                      name="Réalisé Cumulé" 
                      stroke="#10b981" 
                      strokeWidth={2.5}
                      fill="url(#colorRealise)"
                      dot={{ fill: '#10b981', r: 4, strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Aucun décompte enregistré pour afficher l'évolution
                </div>
              )
            )}

            {/* 4. Project Progress */}
            {activeChart === 'progress' && (
              progressData.length > 0 ? (
                <div className="h-full overflow-y-auto pr-2 space-y-2.5">
                  {progressData.map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-12 text-xs font-medium text-slate-600 text-right shrink-0">{item.name}</div>
                      <div className="flex-1 relative">
                        <div className="h-7 bg-slate-100 rounded-lg overflow-hidden">
                          <div
                            className="h-full rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
                            style={{
                              width: `${Math.max(item.value, 5)}%`,
                              backgroundColor: item.fill,
                              opacity: 0.85,
                            }}
                          >
                            {item.value >= 15 && (
                              <span className="text-xs font-bold text-white">{item.value}%</span>
                            )}
                          </div>
                        </div>
                        {item.value < 15 && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-600">
                            {item.value}%
                          </span>
                        )}
                      </div>
                      <div className="w-28 text-xs text-slate-500 truncate shrink-0" title={item.fullName}>
                        {item.fullName?.substring(0, 20)}...
                      </div>
                    </div>
                  ))}
                  {progressData.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                      Aucun projet actif avec données de progression
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Aucune donnée de progression disponible
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
