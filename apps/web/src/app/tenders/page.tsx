import { apiGet } from '@/lib/api';
import { isRedirectError } from '@/lib/next-redirect';
import type { TenderInventory } from '@/lib/tenders';
import { TendersExplorer } from './TendersExplorer';
import { TendersQueryProvider } from './Providers';
import type { SortKey, SortState } from './DataTable';
import { PAGE_SIZE } from './tenders-query';

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
 * Marchés Publics — datao-style catalogue with SERVER-SIDE pagination. The FIRST
 * page (24 rows) is fetched server-side (auth happens here) with the URL's active
 * filters/sort, then handed to a React-Query-driven client explorer that pages,
 * filters, sorts and searches entirely against the server — the browser only ever
 * holds one ~24-row page. When `?list=<id>` or `?savedSearch=<id>` is present the
 * corresponding scope/filter is preloaded server-side and applied on mount.
 */
/** Server-side filter URL params honored by /tender/inventory — listed
 *  explicitly so we never forward unknown keys (avoids accidental injection
 *  into the backend query string). */
const FORWARDED_PARAMS = ['q', 'region', 'procedure', 'buyer', 'lifecycle', 'state'] as const;
type ForwardedKey = (typeof FORWARDED_PARAMS)[number];

const SORTABLE_KEYS: readonly SortKey[] = ['publication', 'deadline', 'budget', 'buyer'];

/** Parse the URL sort/dir/page params into the same SortState + page the client
 *  seeds with, so the SSR fetch's params line up with React Query's first key. */
function parsePaging(sp: Record<string, string | undefined>): {
  sort: SortState;
  page: number;
} {
  const rawKey = sp.sort;
  const key =
    rawKey && SORTABLE_KEYS.includes(rawKey as SortKey)
      ? (rawKey as SortKey)
      : 'publication';
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';
  const pageNum = Number.parseInt(sp.page ?? '0', 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 0;
  return { sort: { key, dir }, page };
}

/** Maps the client lifecycle tab value carried in `?lifecycle=` onto the server
 *  `lifecycles` multi-select (attribue+infructueux both mean "Résultats"). */
function serverLifecycles(lifecycle: string | undefined): string | undefined {
  switch (lifecycle) {
    // Explicit "Tous" — the only way to see the full catalogue; no lifecycle filter.
    case 'tous':
      return undefined;
    case 'cloture':
    case 'clotures':
      return 'cloture';
    case 'resultats':
    case 'attribue':
    case 'infructueux':
      return 'attribue,infructueux';
    // Absent (or en_cours) ⇒ the DEFAULT view is En cours, so /tenders opens on the
    // open consultations, and the SSR fetch matches the client's default filter.
    case 'en_cours':
    default:
      return 'en_cours';
  }
}

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<
    { list?: string; savedSearch?: string; sort?: string; dir?: string; page?: string } & Partial<
      Record<ForwardedKey, string>
    >
  >;
}) {
  const sp = await searchParams;
  const { list, savedSearch } = sp;
  const paging = parsePaging(sp);

  // Build the /tender/inventory query for the FIRST page only (server-side
  // pagination — 24 rows). Single-value URL filters map onto the multi-select
  // params the client also uses so the SSR payload matches the first client key.
  const apiQs = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(paging.page * PAGE_SIZE),
    sort: paging.sort.key === 'budget' ? 'estimation' : paging.sort.key,
    dir: paging.sort.dir,
  });
  if (typeof sp.q === 'string' && sp.q.trim()) apiQs.set('q', sp.q.trim());
  if (typeof sp.region === 'string' && sp.region.trim()) apiQs.set('regions', sp.region.trim());
  if (typeof sp.procedure === 'string' && sp.procedure.trim())
    apiQs.set('procedures', sp.procedure.trim());
  if (typeof sp.buyer === 'string' && sp.buyer.trim()) apiQs.set('buyers', sp.buyer.trim());
  if (typeof sp.state === 'string' && sp.state.trim()) apiQs.set('states', sp.state.trim());
  const lifecycles = serverLifecycles(sp.lifecycle);
  if (lifecycles) apiQs.set('lifecycles', lifecycles);

  const [inventory, preloadedList, preloadedSearch] = await Promise.all([
    // A starved core (batch pressure, cold cache) must degrade to a friendly
    // retry panel — never the naked Next.js "Application error" page.
    apiGet<TenderInventory>(`/tender/inventory?${apiQs.toString()}`).catch(
      // An expired session must redirect to /login (re-auth), NOT be swallowed
      // into the degrade panel — only a genuine fetch failure returns null.
      (error) => {
        if (isRedirectError(error)) throw error;
        return null;
      },
    ),
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
  if (!inventory) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-ink">
          Catalogue momentanément indisponible
        </h1>
        <p className="mt-2 text-sm text-muted">
          Le serveur met plus de temps que prévu à répondre. Les données sont
          intactes — réessayez dans quelques secondes.
        </p>
        <a
          href="/tenders"
          className="mt-6 inline-block rounded-md bg-cyan px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
        >
          Réessayer
        </a>
      </div>
    );
  }
  // Seed the explorer's filter state from URL params (so the search box shows
  // "boudnib" when you land on /tenders?q=boudnib).
  const initialFromUrl: Record<string, string> = {};
  for (const k of FORWARDED_PARAMS) {
    const v = sp[k];
    if (typeof v === 'string' && v.trim()) initialFromUrl[k] = v;
  }
  return (
    <TendersQueryProvider>
      <TendersExplorer
        initialInventory={inventory}
        initialParams={paging}
        preloadedList={preloadedList}
        preloadedSearch={preloadedSearch}
        initialFromUrl={initialFromUrl}
      />
    </TendersQueryProvider>
  );
}
