/**
 * AlertsPanel — Professional Smart Notifications System
 * 
 * Features:
 * - Priority-based tabs: Critique / Avertissement / Info
 * - Animated counters with pulsing badges
 * - Filter by category (deadline, finance, documents)
 * - Expandable alert cards with project details
 * - "Mark as seen" / dismiss functionality
 * - Smooth expand/collapse animations
 * - Summary bar with priority breakdown
 * - Click to navigate to project
 * - Responsive grid layout
 */

import { FC, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, BellRing, AlertTriangle, AlertOctagon, Info,
  ChevronDown, ChevronUp, Clock, FileText,
  DollarSign, Shield, Filter,
  Flame, CheckCircle2,
  Building2, ArrowRight, X
} from 'lucide-react';

export interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: 'deadline' | 'finance' | 'document' | 'warranty';
  icon: FC<{ className?: string }>;
  title: string;
  description: string;
  detail?: string;
  action?: {
    label: string;
    path: string;
  };
  projectId?: string;
  projectName?: string;
  marcheNo?: string;
  priority: number;
  daysValue?: number; // days overdue, remaining, etc.
}

interface AlertsPanelProps {
  alerts: Alert[];
}

// Priority tab config
const TABS = [
  { key: 'all' as const, label: 'Tout', icon: Bell },
  { key: 'critical' as const, label: 'Critique', icon: AlertOctagon },
  { key: 'warning' as const, label: 'Attention', icon: AlertTriangle },
  { key: 'info' as const, label: 'Info', icon: Info },
] as const;

type TabKey = typeof TABS[number]['key'];

// Category filter config
const CATEGORIES = [
  { key: 'all' as const, label: 'Tous', icon: Filter },
  { key: 'deadline' as const, label: 'Délais', icon: Clock },
  { key: 'finance' as const, label: 'Finance', icon: DollarSign },
  { key: 'document' as const, label: 'Documents', icon: FileText },
  { key: 'warranty' as const, label: 'Garantie', icon: Shield },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

const AlertsPanel: FC<AlertsPanelProps> = ({ alerts }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Filter alerts
  const visibleAlerts = useMemo(() => {
    let filtered = alerts.filter(a => !dismissedIds.has(a.id));
    if (activeTab !== 'all') filtered = filtered.filter(a => a.type === activeTab);
    if (activeCategory !== 'all') filtered = filtered.filter(a => a.category === activeCategory);
    return filtered;
  }, [alerts, activeTab, activeCategory, dismissedIds]);

  // Counts per type
  const counts = useMemo(() => ({
    all: alerts.filter(a => !dismissedIds.has(a.id)).length,
    critical: alerts.filter(a => !dismissedIds.has(a.id) && a.type === 'critical').length,
    warning: alerts.filter(a => !dismissedIds.has(a.id) && a.type === 'warning').length,
    info: alerts.filter(a => !dismissedIds.has(a.id) && a.type === 'info').length,
  }), [alerts, dismissedIds]);

  const dismiss = useCallback((id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  }, []);

  const dismissAll = useCallback(() => {
    setDismissedIds(new Set(alerts.map(a => a.id)));
  }, [alerts]);

  if (alerts.length === 0) return null;

  const criticalCount = counts.critical;
  const hasUrgent = criticalCount > 0;

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden transition-all duration-300 ${
      hasUrgent ? 'border-red-200 bg-white' : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Animated bell */}
          <div className="relative">
            {hasUrgent ? (
              <BellRing className="w-5 h-5 text-red-500 animate-[wiggle_1s_ease-in-out_infinite]" />
            ) : (
              <Bell className="w-5 h-5 text-gray-600" />
            )}
            {counts.all > 0 && (
              <span className={`absolute -top-2 -right-2 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 ${
                hasUrgent
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-blue-500 text-white'
              }`}>
                {counts.all}
              </span>
            )}
          </div>
          
          <h2 className="text-base font-semibold text-gray-900">
            Centre de notifications
          </h2>

          {/* Priority pills summary */}
          {!isExpanded && (
            <div className="hidden sm:flex items-center gap-2 ml-2">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  <Flame className="w-3 h-3" /> {criticalCount} critique{criticalCount > 1 ? 's' : ''}
                </span>
              )}
              {counts.warning > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  {counts.warning} avertissement{counts.warning > 1 ? 's' : ''}
                </span>
              )}
              {counts.info > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {counts.info} info{counts.info > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isExpanded && counts.all > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); dismissAll(); }}
              className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer px-2 py-1 hover:bg-gray-100 rounded transition-colors"
            >
              Tout masquer
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {/* Summary Bar */}
          <div className="px-5 py-3 bg-gray-50/80 border-b border-gray-100">
            <div className="flex items-center justify-between">
              {/* Priority Tabs */}
              <div className="flex items-center gap-1">
                {TABS.map(tab => {
                  const count = counts[tab.key];
                  const isActive = activeTab === tab.key;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                        isActive
                          ? tab.key === 'critical'
                            ? 'bg-red-500 text-white shadow-sm'
                            : tab.key === 'warning'
                            ? 'bg-amber-500 text-white shadow-sm'
                            : tab.key === 'info'
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'bg-gray-800 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <TabIcon className="w-3.5 h-3.5" />
                      {tab.label}
                      {count > 0 && (
                        <span className={`ml-0.5 min-w-[16px] h-4 rounded-full text-[10px] flex items-center justify-center px-1 ${
                          isActive ? 'bg-white/25' : 'bg-gray-200 text-gray-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Category Filter */}
              <div className="hidden md:flex items-center gap-1">
                {CATEGORIES.map(cat => {
                  const isActive = activeCategory === cat.key;
                  const CatIcon = cat.icon;
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setActiveCategory(cat.key)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all ${
                        isActive
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <CatIcon className="w-3 h-3" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Alerts List */}
          <div className="max-h-[400px] overflow-y-auto px-5 py-3" style={{ scrollbarWidth: 'thin' }}>
            {visibleAlerts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-400" />
                <p className="text-sm font-medium text-gray-500">Aucune alerte dans cette catégorie</p>
                <p className="text-xs text-gray-400 mt-1">Tout est en ordre !</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Individual Alert Card ───────────────────────────────────────────

interface AlertCardProps {
  alert: Alert;
  onDismiss: (id: string) => void;
}

const AlertCard: FC<AlertCardProps> = ({ alert, onDismiss }) => {
  const Icon = alert.icon;

  const typeStyles = {
    critical: {
      bg: 'bg-red-50 hover:bg-red-100/80',
      border: 'border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      badge: 'bg-red-500',
      text: 'text-red-900',
      subtext: 'text-red-600',
      progress: 'bg-red-400',
    },
    warning: {
      bg: 'bg-amber-50 hover:bg-amber-100/80',
      border: 'border-amber-200',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      badge: 'bg-amber-500',
      text: 'text-amber-900',
      subtext: 'text-amber-600',
      progress: 'bg-amber-400',
    },
    info: {
      bg: 'bg-blue-50 hover:bg-blue-100/80',
      border: 'border-blue-200',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      badge: 'bg-blue-500',
      text: 'text-blue-900',
      subtext: 'text-blue-600',
      progress: 'bg-blue-400',
    },
  };

  const s = typeStyles[alert.type];

  // Urgency indicator for deadline alerts
  const urgencyBar = alert.daysValue !== undefined && alert.category === 'deadline';
  const urgencyPercent = alert.daysValue !== undefined 
    ? Math.min(100, Math.max(5, alert.daysValue > 0 ? Math.min(100, alert.daysValue * 3.3) : 100 + alert.daysValue * 3.3))
    : 0;

  return (
    <div
      className={`group relative flex items-start gap-3 p-3.5 rounded-xl border ${s.bg} ${s.border} transition-all duration-200`}
    >
      {/* Priority indicator line */}
      <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${s.badge}`} />

      {/* Icon */}
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${s.iconBg} flex items-center justify-center ml-2`}>
        <Icon className={`w-4.5 h-4.5 ${s.iconColor}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${s.text} leading-tight`}>
              {alert.title}
            </p>
            {alert.marcheNo && (
              <div className="flex items-center gap-1.5 mt-1">
                <Building2 className={`w-3 h-3 ${s.subtext} opacity-60`} />
                <span className={`text-xs font-medium ${s.subtext}`}>
                  {alert.marcheNo}
                </span>
              </div>
            )}
            {alert.detail && (
              <p className={`text-xs mt-1 ${s.subtext} opacity-70 truncate`}>
                {alert.detail}
              </p>
            )}
          </div>

          {/* Days badge */}
          {alert.daysValue !== undefined && alert.category === 'deadline' && (
            <div className={`flex-shrink-0 px-2 py-1 rounded-lg text-white text-xs font-bold ${s.badge}`}>
              {alert.daysValue > 0 ? `+${alert.daysValue}j` : `${alert.daysValue}j`}
            </div>
          )}
        </div>

        {/* Urgency bar for deadline alerts */}
        {urgencyBar && (
          <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${s.progress} transition-all duration-500`}
              style={{ width: `${urgencyPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center gap-1 flex-shrink-0 self-center">
        {alert.action && (
          <Link
            to={alert.action.path}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${s.iconColor} bg-white border ${s.border} hover:shadow-sm transition-all`}
          >
            {alert.action.label}
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
          className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-white opacity-0 group-hover:opacity-100 transition-all"
          title="Masquer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default AlertsPanel;
export type { Alert as SmartAlert };
