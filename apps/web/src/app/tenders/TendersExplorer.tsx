'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import {
  PAGE_SIZE,
  buildInventoryQuery,
  inventoryKey,
  type InventoryParams,
} from './tenders-query';

const SEEN_KEY = 'atlas.tenders.seen.v1';

/** Poll cadence for the live silent refresh (ms). React Query re-runs the CURRENT
 *  page query on this cadence — correct with pagination and far simpler than the
 *  old `?since=` delta merge. 60 s keeps the table fresh without hammering. */
const LIVE_POLL_MS = 60_000;

/** Export ceiling. The list is now paginated (24 rows/page) so "the current set"
 *  can't be exported from the loaded page alone; CSV re-fetches up to this many
 *  rows of the ACTIVE filtered set (server cap is 100/page — see note below). */
const EXPORT_LIMIT = 100;

/** Read-tracking via localStorage — Nouveaux vs Déjà vu without server round-trip. */
function useSeenIds(): {
  markSeen: (id: string) => void;
  isSeen: (id: string) => boolean;
} {
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      if (raw) setSeen(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore quota / privacy-mode failures */
    }
  }, []);
  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        window.localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const isSeen = useCallback((id: string) => seen.has(id), [seen]);
  return { markSeen, isSeen };
}

/** Debounce a value (search text) so we don't refetch on every keystroke. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Convert a row to a single CSV cell, escaping commas/quotes/newlines. */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(items: readonly TenderItem[], filename: string): void {
  const cols: ReadonlyArray<[label: string, get: (i: TenderItem) => unknown]> = [
    ['Référence', (i) => i.reference],
    ['Acheteur', (i) => i.buyerName],
    ['Objet', (i) => i.objet],
    ['Procédure', (i) => i.procedureLabel],
    ['Catégorie', (i) => i.category],
    ['Secteur', (i) => i.secteur],
    ['Région', (i) => i.region],
    ['Lieu d\'exécution', (i) => i.location ?? i.ville ?? ''],
    ['Date publication', (i) => i.publishedAt],
    ['Date limite', (i) => i.deadlineAt],
    ['Budget (MAD)', (i) => i.estimationMad ?? ''],
    ['Caution (MAD)', (i) => i.cautionProvisoireMad ?? ''],
    ['Lots', (i) => i.lotCount],
    ['Statut', (i) => i.lifecycleLabel],
    ['Fournisseur retenu', (i) => i.winner?.bidderName ?? ''],
    ['Montant attribution (MAD)', (i) => i.winner?.amountMad ?? ''],
    ['URL portail', (i) => i.sourceUrl ?? ''],
  ];
  const header = cols.map(([h]) => csvCell(h)).join(',');
  const rows = items.map((i) => cols.map(([, get]) => csvCell(get(i))).join(','));
  // BOM so Excel auto-detects UTF-8 (French accents) on open.
  const blob = new Blob(['﻿', [header, ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ActiveChip {
  group: keyof FilterState;
  key: string;
  label: string;
}

interface PreloadedList {
  id: string;
  name: string;
  tenderIds: string[];
}
interface PreloadedSearch {
  id: string;
  name: string;
  filters: unknown;
}

/** Defensively coerce server JSON to a valid FilterState — old saved searches
 *  may miss new fields; missing fields fall back to EMPTY_FILTERS defaults. */
function hydrateFilters(input: unknown): FilterState {
  if (!input || typeof input !== 'object') return EMPTY_FILTERS;
  const f = input as Partial<FilterState>;
  return { ...EMPTY_FILTERS, ...f };
}

/** Seed FilterState from `?q=…&region=…&procedure=…&buyer=…&lifecycle=…` URL params. */
function filtersFromUrl(url: Record<string, string>): FilterState {
  const next: FilterState = { ...EMPTY_FILTERS };
  if (url.q) next.search = url.q;
  if (url.region) next.regions = [url.region];
  if (url.procedure) next.procedures = [url.procedure];
  if (url.buyer) next.buyers = [url.buyer];
  if (
    url.lifecycle === 'en_cours' ||
    url.lifecycle === 'cloture' ||
    url.lifecycle === 'attribue' ||
    url.lifecycle === 'infructueux'
  ) {
    next.statut =
      url.lifecycle === 'en_cours'
        ? 'en_cours'
        : url.lifecycle === 'cloture'
          ? 'clotures'
          : 'resultats';
  }
  return next;
}

const SORT_PARAM = 'sort';
const DIR_PARAM = 'dir';
const PAGE_PARAM = 'page';

/** Fetch one inventory page from the Next proxy. Throws on non-2xx so React
 *  Query surfaces the error state (the caller degrades to the previous page). */
async function fetchInventory(qs: string): Promise<TenderInventory> {
  const res = await fetch(`/api/tender/inventory?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`inventory HTTP ${res.status}`);
  return (await res.json()) as TenderInventory;
}

export function TendersExplorer({
  initialInventory,
  initialParams,
  preloadedList,
  preloadedSearch,
  initialFromUrl,
}: {
  /** SSR-fetched first page — hydrates React Query so the table paints instantly. */
  initialInventory: TenderInventory;
  /** The exact params the SSR page fetched with — its cache key must match ours. */
  initialParams: { sort: SortState; page: number };
  preloadedList?: PreloadedList | null;
  preloadedSearch?: PreloadedSearch | null;
  /** Filter seeds from URL query params (`?q=…&region=…`). Wins over EMPTY_FILTERS
   *  but loses to preloadedSearch which represents a richer saved filter set. */
  initialFromUrl?: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>(() => {
    if (preloadedSearch) return hydrateFilters(preloadedSearch.filters);
    if (initialFromUrl && Object.keys(initialFromUrl).length > 0) {
      return filtersFromUrl(initialFromUrl);
    }
    return EMPTY_FILTERS;
  });
  // Publication DESC default — newest postings on top (datao parity). Seeded from
  // the same value the SSR page fetched with so the initial cache key matches.
  const [sort, setSort] = useState<SortState>(initialParams.sort);
  const [page, setPage] = useState(initialParams.page);
  // Raw search drives the input; the debounced value drives the query so we
  // don't refetch on every keystroke.
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebounced(searchInput, 300);

  const [selected, setSelected] = useState<TenderItem | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { markSeen, isSeen } = useSeenIds();

  const offset = page * PAGE_SIZE;
  const queryParams = useMemo<InventoryParams>(
    () => ({ filters, sort, offset, search: debouncedSearch }),
    [filters, sort, offset, debouncedSearch],
  );
  const qs = useMemo(() => buildInventoryQuery(queryParams).toString(), [queryParams]);

  // Does this query match exactly what the SSR page pre-fetched? Only then may
  // we hand React Query the SSR payload as initialData (otherwise stale rows).
  const initialQs = useMemo(
    () =>
      buildInventoryQuery({
        filters:
          preloadedSearch
            ? hydrateFilters(preloadedSearch.filters)
            : initialFromUrl && Object.keys(initialFromUrl).length > 0
              ? filtersFromUrl(initialFromUrl)
              : EMPTY_FILTERS,
        sort: initialParams.sort,
        offset: initialParams.page * PAGE_SIZE,
        search: initialFromUrl?.q ?? '',
      }).toString(),
    [preloadedSearch, initialFromUrl, initialParams.sort, initialParams.page],
  );

  const { data, isFetching, isError, isPlaceholderData } = useQuery({
    queryKey: inventoryKey(queryParams),
    queryFn: () => fetchInventory(qs),
    placeholderData: keepPreviousData,
    // Silent live refresh on the current page (replaces the old ?since= merge).
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: false,
    initialData: qs === initialQs ? initialInventory : undefined,
  });

  // Fall back to the SSR payload for the very first paint / hard errors so the
  // table never renders empty while a background fetch is in flight.
  const inventory = data ?? initialInventory;

  // ── URL-as-state ─────────────────────────────────────────────────────────
  // Reflect filters/sort/page in the URL (router.replace, no history spam) so a
  // refresh or shared link restores the same view. `?list=`/`?savedSearch=` are
  // preserved untouched. `unseenOnly` stays out of the URL (client-only).
  useEffect(() => {
    const next = new URLSearchParams();
    const keep = searchParams.get('list');
    const keepSearch = searchParams.get('savedSearch');
    if (keep) next.set('list', keep);
    if (keepSearch) next.set('savedSearch', keepSearch);
    if (debouncedSearch.trim()) next.set('q', debouncedSearch.trim());
    if (filters.regions.length === 1) next.set('region', filters.regions[0]);
    if (filters.procedures.length === 1) next.set('procedure', filters.procedures[0]);
    if (filters.buyers.length === 1) next.set('buyer', filters.buyers[0]);
    if (filters.statut !== 'tous') next.set('lifecycle', filters.statut);
    if (sort.key !== 'publication' || sort.dir !== 'desc') {
      next.set(SORT_PARAM, sort.key);
      next.set(DIR_PARAM, sort.dir);
    }
    if (page > 0) next.set(PAGE_PARAM, String(page));
    const qsNext = next.toString();
    const current = searchParams.toString();
    if (qsNext !== current) {
      router.replace(qsNext ? `/tenders?${qsNext}` : '/tenders', { scroll: false });
    }
    // Intentionally excludes searchParams/router from deps — we only react to our
    // own state; reading searchParams inside is fine (it's stable per render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, page, debouncedSearch]);

  // Any filter/sort/search change resets to page 0 (datao behaviour).
  const resetPage = useCallback(() => setPage(0), []);

  const patch = useCallback(
    (p: Partial<FilterState>) => {
      setFilters((prev) => ({ ...prev, ...p }));
      // Keep the search input in sync when a filter patch touches `search`
      // (e.g. sidebar search box) so the debounce still governs the query.
      if (typeof p.search === 'string') setSearchInput(p.search);
      resetPage();
    },
    [resetPage],
  );
  const reset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    resetPage();
  }, [resetPage]);

  const closeDrawer = useCallback(() => setSelected(null), []);

  const onSortChange = useCallback(
    (key: SortKey) => {
      setSort((prev) =>
        prev.key === key
          ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: 'asc' },
      );
      resetPage();
    },
    [resetPage],
  );

  // Saved-list scope — the inventory endpoint has no `ids` filter, so a `?list=`
  // deep-link is applied client-side over the current page (fast Set lookup). It
  // can hide rows within a page; that's the accepted trade-off for preserving the
  // feature without inventing a new API param.
  const listScope = useMemo(
    () => (preloadedList ? new Set(preloadedList.tenderIds) : null),
    [preloadedList],
  );

  // Client-only filters applied over the CURRENT page only, never sent to the
  // server: `unseenOnly` (localStorage read-tracking is per-browser) and the
  // saved-list scope above. Both can hide rows within a page — the accepted
  // trade-off for keeping these purely client-side under server pagination.
  const pageItems = useMemo(() => {
    let items = inventory.items;
    if (listScope) items = items.filter((i) => listScope.has(i.id));
    if (filters.unseenOnly) items = items.filter((i) => !isSeen(i.id));
    return items;
  }, [inventory.items, listScope, filters.unseenOnly, isSeen]);

  // Keep the open drawer's base item in sync with live refetches (e.g. a budget
  // lands while the user reads the dossier) without reopening it.
  const liveSelected = useMemo(
    () =>
      selected
        ? inventory.items.find((i) => i.id === selected.id) ?? selected
        : null,
    [selected, inventory.items],
  );

  // ── Pager maths ────────────────────────────────────────────────────────────
  const filteredCount = inventory.filteredCount;
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const rangeStart = filteredCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + inventory.items.length, filteredCount);
  const canPrev = page > 0;
  const canNext = offset + inventory.items.length < filteredCount;

  const goPage = useCallback(
    (p: number) => {
      setPage(Math.max(0, Math.min(p, pageCount - 1)));
      if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
    },
    [pageCount],
  );

  // ── Active-filter chips ─────────────────────────────────────────────────────
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

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const exportQs = buildInventoryQuery({
        ...queryParams,
        offset: 0,
        limit: EXPORT_LIMIT,
      }).toString();
      const inv = await fetchInventory(exportQs);
      const rows = filters.unseenOnly
        ? inv.items.filter((i) => !isSeen(i.id))
        : inv.items;
      downloadCsv(rows, `atlas-marches-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      window.alert("L'export a échoué — réessayez dans un instant.");
    } finally {
      setExporting(false);
    }
  }, [queryParams, filters.unseenOnly, isSeen]);

  const onSave = useCallback(async () => {
    const name = window.prompt('Nom de la recherche :');
    if (!name?.trim()) return;
    const res = await fetch('/api/tender/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), filters: { ...filters, search: searchInput } }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      window.alert(`Erreur : HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
    } else {
      window.alert(`Recherche « ${name.trim()} » sauvegardée.`);
    }
  }, [filters, searchInput]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight">
            {preloadedList
              ? `Liste : ${preloadedList.name}`
              : preloadedSearch
                ? `Recherche : ${preloadedSearch.name}`
                : 'Inventaire des marchés'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {preloadedList
              ? `${preloadedList.tenderIds.length} appel(s) dans la liste`
              : `${inventory.total} appel(s) d'offres au catalogue`}{' '}
            · <span className="font-semibold text-ink">{filteredCount}</span>{' '}
            correspondant(s)
            {isFetching && !isPlaceholderData && (
              <span className="ml-2 text-xs text-faint">actualisation…</span>
            )}
            {(preloadedList || preloadedSearch) && (
              <>
                {' '}
                ·{' '}
                <a href="/tenders" className="text-cyan hover:underline">
                  retour à tout le catalogue
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink"
            title="Sauvegarder le jeu de filtres courant"
          >
            <Icon name="check" size={15} />
            Sauvegarder
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || filteredCount === 0}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            title={`Exporter jusqu'à ${EXPORT_LIMIT} ligne(s) du jeu filtré en CSV`}
          >
            <Icon name="download" size={15} />
            {exporting ? 'Export…' : 'Exporter CSV'}
          </button>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink"
          >
            <Icon name="filter" size={15} />
            {showFilters ? 'Cacher les filtres' : 'Afficher les filtres'}
          </button>
        </div>
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
              value={{ ...filters, search: searchInput }}
              onChange={patch}
              onReset={reset}
            />
          </aside>
        )}

        <div className="min-w-0">
          <div className="rounded-xl border border-line bg-paper-2 shadow-card">
            <DataTable
              items={pageItems}
              sort={sort}
              onSortChange={onSortChange}
              selectedId={selected?.id ?? null}
              onSelect={(item) => {
                markSeen(item.id);
                setSelected(item);
              }}
              isSeen={isSeen}
            />
            {pageItems.length === 0 && (
              <p className="p-10 text-center text-muted">
                {isError
                  ? 'Erreur de chargement — réessayez.'
                  : 'Aucun marché ne correspond à ces filtres.'}
              </p>
            )}
          </div>

          {/* Pager — Précédent / Suivant + range + page numbers. */}
          {filteredCount > 0 && (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
              aria-label="Pagination"
            >
              <p className="text-sm text-muted">
                <span className="font-semibold text-ink">
                  {rangeStart}–{rangeEnd}
                </span>{' '}
                sur {filteredCount}
                {(filters.unseenOnly || listScope) && (
                  <span className="ml-1 text-xs text-faint">
                    ({listScope ? 'liste' : 'non vus'} — filtré sur cette page)
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goPage(page - 1)}
                  disabled={!canPrev}
                  className="flex items-center gap-1 rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                  Précédent
                </button>
                <span className="px-2 text-sm tabular-nums text-muted">
                  Page <span className="font-semibold text-ink">{page + 1}</span>{' '}
                  / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goPage(page + 1)}
                  disabled={!canNext}
                  className="flex items-center gap-1 rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-sand hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Suivant
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>

      <DetailDrawer item={liveSelected} onClose={closeDrawer} />
    </div>
  );
}
