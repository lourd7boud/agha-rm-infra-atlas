import type { SortState } from './DataTable';
import type { FilterState } from './FilterSidebar';

/** One datao-style page — the server default and our fixed page size. */
export const PAGE_SIZE = 24;

/** Server-supported sort dimensions (mirrors the core inventorySortSchema). The
 *  DataTable exposes a couple more visual sort keys; those map onto these. */
export type ServerSort = 'publication' | 'deadline' | 'estimation' | 'buyer' | 'daysLeft';

/** Maps a DataTable SortState onto the 5 server-sortable dimensions. Only these
 *  keys are sortable server-side; the DataTable only offers these as sortable. */
export function serverSort(sort: SortState): { sort: ServerSort; dir: 'asc' | 'desc' } {
  const key: ServerSort =
    sort.key === 'budget'
      ? 'estimation'
      : sort.key === 'deadline'
        ? 'deadline'
        : sort.key === 'buyer'
          ? 'buyer'
          : 'publication';
  return { sort: key, dir: sort.dir };
}

/** Maps the client's lifecycle tab onto the server `lifecycles` multi-select. */
function lifecyclesFromStatut(statut: FilterState['statut']): string[] {
  switch (statut) {
    case 'en_cours':
      return ['en_cours'];
    case 'clotures':
      return ['cloture'];
    case 'resultats':
      return ['attribue', 'infructueux'];
    default:
      return [];
  }
}

export interface InventoryParams {
  filters: FilterState;
  sort: SortState;
  offset: number;
  /** Debounced search text (drives the server `q` param). */
  search: string;
  /** Row count for this page (defaults to PAGE_SIZE; export uses a larger cap). */
  limit?: number;
}

/**
 * Builds the /api/tender/inventory query string from the active filters/sort/
 * page. Arrays are comma-joined; empty values are omitted. This is the SINGLE
 * source of truth for the request shape — both the SSR page and the client
 * useQuery call it so their cache keys line up and hydration hits.
 *
 * NOTE: `unseenOnly` is intentionally NOT forwarded — it is a client-only filter
 * over the already-loaded page (localStorage-backed read tracking).
 */
export function buildInventoryQuery({
  filters,
  sort,
  offset,
  search,
  limit = PAGE_SIZE,
}: InventoryParams): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));

  const { sort: sKey, dir } = serverSort(sort);
  qs.set('sort', sKey);
  qs.set('dir', dir);

  const q = search.trim();
  if (q) qs.set('q', q);

  const multi: Array<[key: string, values: string[]]> = [
    ['procedures', filters.procedures],
    ['categories', filters.categories],
    ['secteurs', filters.secteurs],
    ['regions', filters.regions],
    ['buyers', filters.buyers],
    ['states', filters.states],
    ['lifecycles', lifecyclesFromStatut(filters.statut)],
  ];
  for (const [key, values] of multi) {
    if (values.length > 0) qs.set(key, values.join(','));
  }

  if (filters.bpuOnly) qs.set('bpuOnly', 'true');
  if (filters.budgetOnly) qs.set('budgetOnly', 'true');
  if (filters.cautionOnly) qs.set('cautionOnly', 'true');

  return qs;
}

/** Stable React Query key. Identical params ⇒ identical querystring ⇒ cache hit,
 *  which is what lets the SSR `initialData` hydrate the first client render. */
export function inventoryKey(params: InventoryParams): readonly unknown[] {
  return ['inventory', buildInventoryQuery(params).toString()];
}
