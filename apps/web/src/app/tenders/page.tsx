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
/** Server-side filter URL params honored by /tender/inventory — listed
 *  explicitly so we never forward unknown keys (avoids accidental injection
 *  into the backend query string). */
const FORWARDED_PARAMS = ['q', 'region', 'procedure', 'buyer', 'lifecycle', 'state'] as const;
type ForwardedKey = (typeof FORWARDED_PARAMS)[number];

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<
    { list?: string; savedSearch?: string } & Partial<Record<ForwardedKey, string>>
  >;
}) {
  const sp = await searchParams;
  const { list, savedSearch } = sp;
  // Build /tender/inventory query string from whitelisted URL params so the
  // server applies any filter at the source. Limit 5000 covers the current
  // ~4260-row catalogue (datao parity). If the catalogue grows past 5000 the
  // backend will silently truncate again — raise the cap in
  // apps/core/src/modules/tender/tender.module.ts (inventoryQuerySchema) and
  // here together.
  const apiQs = new URLSearchParams({ limit: '5000' });
  for (const k of FORWARDED_PARAMS) {
    const v = sp[k];
    if (typeof v === 'string' && v.trim()) apiQs.set(k, v);
  }
  const [inventory, preloadedList, preloadedSearch] = await Promise.all([
    apiGet<TenderInventory>(`/tender/inventory?${apiQs.toString()}`),
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
  // Seed the explorer's filter state from URL params (so the search box shows
  // "boudnib" when you land on /tenders?q=boudnib).
  const initialFromUrl: Record<string, string> = {};
  for (const k of FORWARDED_PARAMS) {
    const v = sp[k];
    if (typeof v === 'string' && v.trim()) initialFromUrl[k] = v;
  }
  return (
    <TendersExplorer
      inventory={inventory}
      preloadedList={preloadedList}
      preloadedSearch={preloadedSearch}
      initialFromUrl={initialFromUrl}
    />
  );
}
