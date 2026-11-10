'use client';

import { fmtMetreMoney } from '@/lib/metre-workspace';

export type MetreFilter = 'all' | 'started' | 'empty' | 'overrun';
export interface MetreIndexArticle {
  key: string; numero: number; designation: string; unite: string;
  current: number; percent: number; overrun: boolean; count: number;
}

export function MetreWorkspaceSummary({ amount, measured, total, measures, warnings }: {
  amount: number; measured: number; total: number; measures: number; warnings: number;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-[1.4fr_1fr_1fr]">
      <div className="bg-paper-2 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Montant de la période HT</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-ink">{fmtMetreMoney(amount)} <span className="text-xs font-medium text-muted">MAD</span></p>
        <p className="mt-1 text-[11px] text-muted">Estimation avant révision, TVA et retenue</p>
      </div>
      <div className="bg-paper-2 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Prix renseignés</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{measured} <span className="text-sm font-medium text-faint">/ {total}</span></p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-cyan transition-all" style={{ width: `${total ? measured / total * 100 : 0}%` }} /></div>
      </div>
      <div className="bg-paper-2 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Mesures de la période</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{measures}</p>
        <p className={`mt-1 text-[11px] ${warnings ? 'text-ochre' : 'text-muted'}`}>{warnings ? `${warnings} prix en dépassement à vérifier` : 'Quantités et montants recalculés à la saisie'}</p>
      </div>
    </div>
  );
}

const FILTERS: { id: MetreFilter; label: string }[] = [
  { id: 'all', label: 'Tous les prix' }, { id: 'started', label: 'Renseignés' },
  { id: 'empty', label: 'À renseigner' }, { id: 'overrun', label: 'Dépassements' },
];

export function MetreToolbar({ query, onQuery, filter, onFilter, counts, onExpand, onCollapse, shown }: {
  query: string; onQuery: (value: string) => void; filter: MetreFilter;
  onFilter: (value: MetreFilter) => void; counts: Record<MetreFilter, number>;
  onExpand: () => void; onCollapse: () => void; shown: number;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex w-full min-w-0 flex-none items-center gap-2 rounded-lg border border-line bg-paper px-3 text-muted focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/15 sm:w-auto sm:flex-1">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input aria-label="Rechercher un prix" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Rechercher un prix, une désignation, une unité…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint" />
          {query && <button type="button" aria-label="Effacer la recherche" onClick={() => onQuery('')} className="px-1 text-muted">×</button>}
        </label>
        <div className="flex items-center gap-1 text-xs font-semibold text-muted">
          <button type="button" onClick={onExpand} className="rounded-md px-2 py-2 hover:bg-sand hover:text-cyan">Tout déplier</button>
          <span aria-hidden="true" className="text-line">/</span>
          <button type="button" onClick={onCollapse} className="rounded-md px-2 py-2 hover:bg-sand hover:text-cyan">Tout replier</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrer les prix">
        {FILTERS.map(({ id, label }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => onFilter(id)} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${filter === id ? 'bg-cyan-soft text-cyan' : 'text-muted hover:bg-sand'}`}>{label} <span className="ml-1.5 font-mono opacity-70">{counts[id]}</span></button>)}
        <span className="ml-auto pl-2 text-[11px] text-faint" role="status">{shown} prix affiché(s)</span>
      </div>
    </div>
  );
}

export function MetreArticleIndex({ articles, onSelect }: { articles: MetreIndexArticle[]; onSelect: (key: string) => void }) {
  return (
    <aside className="hidden self-stretch xl:block">
      <nav aria-label="Index des prix" className="sticky top-24 overflow-hidden rounded-xl border border-line bg-paper-2">
        <div className="border-b border-line px-4 py-3"><h2 className="text-xs font-bold text-ink">Bordereau des prix</h2><p className="mt-1 text-[11px] text-faint">Accès rapide aux mesures</p></div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {articles.map((article) => <button key={article.key} type="button" onClick={() => onSelect(article.key)} className="group mb-1 w-full rounded-lg p-2.5 text-left transition hover:bg-sand focus-visible:outline-2 focus-visible:outline-cyan">
            <div className="flex gap-2.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold ${article.overrun ? 'bg-ochre-soft text-ochre' : article.count ? 'bg-cyan-soft text-cyan' : 'bg-sand text-muted'}`}>{article.numero}</span>
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[11px] font-medium leading-relaxed text-ink-2 group-hover:text-cyan" title={article.designation}>{article.designation}</p><p className="mt-1 text-[10px] text-faint">{article.count} mesure(s) · {article.unite}</p></div>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-sand"><div className={`h-full rounded-full ${article.overrun ? 'bg-ochre' : 'bg-cyan/60'}`} style={{ width: `${Math.max(0, Math.min(100, article.percent))}%` }} /></div>
          </button>)}
          {!articles.length && <p className="p-3 text-xs text-muted">Aucun prix correspondant.</p>}
        </div>
      </nav>
    </aside>
  );
}
