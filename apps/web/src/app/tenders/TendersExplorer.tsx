'use client';

import { useCallback, useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { PIPELINE_LABELS, PROCEDURE_LABELS } from '@/lib/labels';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import type { TenderInventory, TenderItem } from '@/lib/tenders';
import { DataTable, type SortKey, type SortState } from './DataTable';
import { DetailDrawer } from './DetailDrawer';
import {
  EMPTY_FILTERS,
  FilterSidebar,
  type FilterState,
} from './FilterSidebar';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function cmpNum(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1; // missing values sort first (asc); last (desc)
  if (b === undefined) return 1;
  return a - b;
}

function primaryCompare(a: TenderItem, b: TenderItem, key: SortKey): number {
  switch (key) {
    case 'deadline':
      return new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime();
    case 'publication':
      return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
    case 'budget':
      return cmpNum(a.estimationMad, b.estimationMad);
    case 'caution':
      return cmpNum(a.cautionProvisoireMad, b.cautionProvisoireMad);
    case 'lots':
      return a.lotCount - b.lotCount;
    case 'buyer':
      return a.buyerName.localeCompare(b.buyerName, 'fr');
    case 'objet':
      return a.objet.localeCompare(b.objet, 'fr');
    case 'category':
      return a.category.localeCompare(b.category, 'fr');
    case 'secteur':
      return a.secteur.localeCompare(b.secteur, 'fr');
    case 'region':
      return a.region.localeCompare(b.region, 'fr');
    case 'ville':
      // The "Lieu d'exécution" column prefers the precise portal location.
      return (a.location ?? a.ville ?? '').localeCompare(
        b.location ?? b.ville ?? '',
        'fr',
      );
    default:
      return 0;
  }
}

function matchesFilters(item: TenderItem, f: FilterState): boolean {
  if (f.statut === 'en_cours' && item.daysLeft < 0) return false;
  if (f.statut === 'echus' && item.daysLeft >= 0) return false;
  if (f.procedures.length && !f.procedures.includes(item.procedure)) return false;
  if (f.categories.length && !f.categories.includes(item.category)) return false;
  if (f.secteurs.length && !f.secteurs.includes(item.secteur)) return false;
  if (f.regions.length && !f.regions.includes(item.region)) return false;
  if (f.buyers.length && !f.buyers.includes(item.buyerName)) return false;
  if (f.states.length && !f.states.includes(item.pipelineState)) return false;
  if (f.budgetOnly && item.estimationMad == null) return false;
  if (f.cautionOnly && item.cautionProvisoireMad == null) return false;
  if (f.search.trim()) {
    const needle = norm(f.search);
    const hay = norm(
      `${item.reference} ${item.objet} ${item.buyerName} ${item.region} ${
        item.ville ?? ''
      } ${item.location ?? ''} ${item.secteur}`,
    );
    if (!hay.includes(needle)) return false;
  }
  return true;
}

interface ActiveChip {
  group: keyof FilterState;
  key: string;
  label: string;
}

export function TendersExplorer({ inventory }: { inventory: TenderInventory }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortState>({ key: 'deadline', dir: 'asc' });
  const [selected, setSelected] = useState<TenderItem | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const visible = useMemo(() => {
    const filtered = inventory.items.filter((i) => matchesFilters(i, filters));
    return [...filtered].sort((a, b) => {
      const primary = primaryCompare(a, b, sort.key) * (sort.dir === 'asc' ? 1 : -1);
      return primary || a.reference.localeCompare(b.reference);
    });
  }, [inventory.items, filters, sort]);

  const patch = (p: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...p }));
  const reset = () => setFilters(EMPTY_FILTERS);
  const closeDrawer = useCallback(() => setSelected(null), []);

  // The API caps the catalogue payload; warn when not everything is loaded.
  const capped = inventory.items.length < inventory.total;

  const onSortChange = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );

  const chips = useMemo<ActiveChip[]>(() => {
    const out: ActiveChip[] = [];
    const push = (group: keyof FilterState, keys: string[], label: (k: string) => string) => {
      for (const k of keys) out.push({ group, key: k, label: label(k) });
    };
    push('procedures', filters.procedures, (k) => PROCEDURE_LABELS[k as TenderProcedure] ?? k);
    push('categories', filters.categories, (k) => k);
    push('secteurs', filters.secteurs, (k) => k);
    push('regions', filters.regions, (k) => k);
    push('buyers', filters.buyers, (k) => k);
    push('states', filters.states, (k) => PIPELINE_LABELS[k as PipelineState]?.label ?? k);
    return out;
  }, [filters]);

  const removeChip = (chip: ActiveChip) => {
    const current = filters[chip.group];
    if (Array.isArray(current)) {
      patch({ [chip.group]: current.filter((v) => v !== chip.key) } as Partial<FilterState>);
    }
  };

  const hasChips = chips.length > 0 || filters.budgetOnly || filters.cautionOnly;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight">
            Inventaire des marchés
          </h1>
          <p className="mt-1 text-sm text-muted">
            {inventory.total} appel(s) d&apos;offres au catalogue ·{' '}
            <span className="font-semibold text-ink">{visible.length}</span> affiché(s)
          </p>
          {capped && (
            <p className="mt-1 text-xs text-ochre-deep">
              Catalogue volumineux : {inventory.items.length} dossiers les plus urgents
              chargés sur {inventory.total}. Affinez la recherche pour cibler les autres.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink"
        >
          <Icon name="filter" size={15} />
          {showFilters ? 'Cacher les filtres' : 'Afficher les filtres'}
        </button>
      </div>

      {hasChips && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={`${chip.group}:${chip.key}`}
              type="button"
              onClick={() => removeChip(chip)}
              className="inline-flex items-center gap-1.5 rounded-full bg-cyan-soft px-3 py-1 text-xs font-medium text-ink transition hover:bg-cyan-soft/70"
            >
              {chip.label}
              <Icon name="close" size={12} className="text-muted" />
            </button>
          ))}
          {filters.budgetOnly && (
            <button
              type="button"
              onClick={() => patch({ budgetOnly: false })}
              className="inline-flex items-center gap-1.5 rounded-full bg-cyan-soft px-3 py-1 text-xs font-medium text-ink"
            >
              Budget estimé
              <Icon name="close" size={12} className="text-muted" />
            </button>
          )}
          {filters.cautionOnly && (
            <button
              type="button"
              onClick={() => patch({ cautionOnly: false })}
              className="inline-flex items-center gap-1.5 rounded-full bg-cyan-soft px-3 py-1 text-xs font-medium text-ink"
            >
              Caution requise
              <Icon name="close" size={12} className="text-muted" />
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-cyan hover:underline"
          >
            Tout réinitialiser
          </button>
        </div>
      )}

      <div
        className={`grid gap-5 ${
          showFilters ? 'lg:grid-cols-[17rem_1fr]' : 'grid-cols-1'
        }`}
      >
        {showFilters && (
          <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <FilterSidebar
              facets={inventory.facets}
              value={filters}
              onChange={patch}
              onReset={reset}
            />
          </aside>
        )}

        <div className="min-w-0 rounded-xl border border-line bg-paper-2 shadow-card">
          <DataTable
            items={visible}
            sort={sort}
            onSortChange={onSortChange}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
          {visible.length === 0 && (
            <p className="p-10 text-center text-muted">
              Aucun marché ne correspond à ces filtres.
            </p>
          )}
        </div>
      </div>

      <DetailDrawer item={selected} onClose={closeDrawer} />
    </div>
  );
}
