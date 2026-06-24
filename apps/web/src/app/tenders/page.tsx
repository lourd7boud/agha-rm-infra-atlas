import { apiGet } from '@/lib/api';
import type { TenderInventory } from '@/lib/tenders';
import { TendersExplorer } from './TendersExplorer';

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

/**
 * Marchés Publics — datao-style catalogue. The whole active inventory is
 * fetched server-side (auth happens here) and handed to a client explorer that
 * does instant search / multi-facet filtering / sorting / resizable columns and
 * a click-to-open detail drawer. When `?list=<id>` or `?savedSearch=<id>` is in
 * the URL, the corresponding scope/filter is preloaded server-side and applied
 * on mount — this is what makes the dedicated /tenders/lists and
 * /tenders/searches pages "openable" with one click.
 */
export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; savedSearch?: string }>;
}) {
  const { list, savedSearch } = await searchParams;
  const [inventory, preloadedList, preloadedSearch] = await Promise.all([
    apiGet<TenderInventory>('/tender/inventory?limit=1000'),
    list
      ? apiGet<{ tenderIds: string[] }>(`/tender/lists/${list}/tenders`)
          .then(async (r) => {
            const all = await apiGet<Array<{ id: string; name: string }>>(
              '/tender/lists',
            );
            const meta = all.find((l) => l.id === list);
            return {
              id: list,
              name: meta?.name ?? 'Liste',
              tenderIds: r.tenderIds,
            } satisfies PreloadedList;
          })
          .catch(() => null)
      : null,
    savedSearch
      ? apiGet<Array<{ id: string; name: string; filters: unknown }>>(
          '/tender/saved-searches',
        )
          .then((all) => {
            const found = all.find((s) => s.id === savedSearch);
            return found
              ? ({
                  id: found.id,
                  name: found.name,
                  filters: found.filters,
                } satisfies PreloadedSearch)
              : null;
          })
          .catch(() => null)
      : null,
  ]);
  return (
    <TendersExplorer
      inventory={inventory}
      preloadedList={preloadedList}
      preloadedSearch={preloadedSearch}
    />
  );
}
