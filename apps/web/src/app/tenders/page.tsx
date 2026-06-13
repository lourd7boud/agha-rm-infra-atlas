import Link from 'next/link';
import {
  PIPELINE_STATES,
  TENDER_PROCEDURES,
  type PipelineState,
  type TenderProcedure,
} from '@atlas/contracts';
import { apiGet } from '@/lib/api';
import {
  PIPELINE_LABELS,
  PROCEDURE_LABELS,
  PROCEDURE_TONES,
  urgencyClasses,
} from '@/lib/labels';

interface Facet {
  key: string;
  label: string;
  count: number;
}

interface InventoryItem {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  procedureLabel: string;
  objet: string;
  estimationMad?: number;
  deadlineAt: string;
  pipelineState: PipelineState;
  daysLeft: number;
  region: string;
}

interface Inventory {
  total: number;
  filteredCount: number;
  returnedCount: number;
  facets: {
    procedures: Facet[];
    regions: Facet[];
    buyers: Facet[];
    states: Facet[];
  };
  items: InventoryItem[];
}

const FILTER_KEYS = ['procedure', 'buyer', 'region', 'state', 'q'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type ActiveFilters = Partial<Record<FilterKey, string>>;

const PROCEDURE_SET = new Set<string>(TENDER_PROCEDURES);
const STATE_SET = new Set<string>(PIPELINE_STATES);

/**
 * Collapses Next's searchParams to the single-valued filters we support.
 * procedure/state are narrowed against their unions so a stale or hand-edited
 * value degrades to "no filter" instead of a 400 from the API.
 */
function readFilters(
  sp: Record<string, string | string[] | undefined>,
): ActiveFilters {
  const filters: ActiveFilters = {};
  for (const key of FILTER_KEYS) {
    const raw = sp[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !value.trim()) continue;
    if (key === 'procedure' && !PROCEDURE_SET.has(value)) continue;
    if (key === 'state' && !STATE_SET.has(value)) continue;
    filters[key] = value;
  }
  return filters;
}

/** Builds a /tenders href that toggles one filter, preserving the rest. */
function toggleHref(
  active: ActiveFilters,
  key: FilterKey,
  value: string | null,
): string {
  const next: ActiveFilters = { ...active };
  if (value === null || next[key] === value) delete next[key];
  else next[key] = value;
  const qs = new URLSearchParams(next as Record<string, string>).toString();
  return qs ? `/tenders?${qs}` : '/tenders';
}

const FILTER_CHIP_LABELS: Record<FilterKey, string> = {
  procedure: 'Procédure',
  buyer: 'Acheteur',
  region: 'Région',
  state: 'État',
  q: 'Recherche',
};

function activeChipLabel(key: FilterKey, value: string): string {
  if (key === 'procedure') return PROCEDURE_LABELS[value as TenderProcedure] ?? value;
  if (key === 'state') return PIPELINE_LABELS[value as PipelineState]?.label ?? value;
  if (key === 'q') return `« ${value} »`;
  return value;
}

function FacetGroup({
  title,
  facets,
  filterKey,
  active,
}: {
  title: string;
  facets: Facet[];
  filterKey: FilterKey;
  active: ActiveFilters;
}) {
  if (facets.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        {title}
      </h3>
      <ul className="space-y-1">
        {facets.map((facet) => {
          const isActive = active[filterKey] === facet.key;
          return (
            <li key={facet.key}>
              <Link
                href={toggleHref(active, filterKey, facet.key)}
                aria-current={isActive ? 'true' : undefined}
                className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition ${
                  isActive
                    ? 'bg-slate-900 font-semibold text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">
                  {facet.label}
                  {isActive && (
                    <span className="sr-only"> (actif — cliquer pour retirer)</span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 font-mono text-xs tabular-nums ${
                    isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {facet.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const active = readFilters(await searchParams);
  const qs = new URLSearchParams(active as Record<string, string>).toString();
  const inventory = await apiGet<Inventory>(
    `/tender/inventory${qs ? `?${qs}` : ''}`,
  );

  const activeEntries = FILTER_KEYS.filter((key) => active[key]).map((key) => ({
    key,
    value: active[key] as string,
  }));
  const hasFilters = activeEntries.length > 0;
  const capped = inventory.returnedCount < inventory.filteredCount;
  const stateLabel = (key: string) =>
    PIPELINE_LABELS[key as PipelineState]?.label ?? key;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            Inventaire des marchés
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {inventory.total} appel(s) d&apos;offres au catalogue ·{' '}
            <span className="font-semibold text-slate-700">
              {inventory.filteredCount}
            </span>{' '}
            résultat(s) — triés par urgence
          </p>
        </div>
        <form
          action="/tenders"
          method="get"
          role="search"
          aria-label="Recherche dans l'inventaire des marchés"
          className="flex items-center gap-2"
        >
          {(['procedure', 'buyer', 'region', 'state'] as const).map((key) =>
            active[key] ? (
              <input key={key} type="hidden" name={key} value={active[key]} />
            ) : null,
          )}
          <input
            type="search"
            name="q"
            defaultValue={active.q ?? ''}
            aria-label="Rechercher un marché (référence, objet, acheteur)"
            placeholder="Rechercher (référence, objet, acheteur)…"
            className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
            Filtrer
          </button>
        </form>
      </div>

      {hasFilters && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Filtres actifs
          </span>
          {activeEntries.map(({ key, value }) => (
            <Link
              key={key}
              href={toggleHref(active, key, null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-700"
            >
              <span className="opacity-60">{FILTER_CHIP_LABELS[key]}:</span>
              {activeChipLabel(key, value)}
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
              <span className="sr-only">retirer ce filtre</span>
            </Link>
          ))}
          <Link
            href="/tenders"
            className="text-xs font-medium text-amber-700 hover:underline"
          >
            Tout réinitialiser
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:self-start">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Filtres
          </span>
          <FacetGroup
            title="Type de procédure"
            facets={inventory.facets.procedures}
            filterKey="procedure"
            active={active}
          />
          <FacetGroup
            title="Région"
            facets={inventory.facets.regions}
            filterKey="region"
            active={active}
          />
          <FacetGroup
            title="État"
            facets={inventory.facets.states.map((f) => ({
              ...f,
              label: stateLabel(f.key),
            }))}
            filterKey="state"
            active={active}
          />
          <FacetGroup
            title="Acheteur (jhat)"
            facets={inventory.facets.buyers}
            filterKey="buyer"
            active={active}
          />
        </aside>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Échéance</th>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Objet</th>
                <th className="px-4 py-3">Acheteur · Région</th>
                <th className="px-4 py-3">Procédure</th>
                <th className="px-4 py-3 text-right">Estimation</th>
                <th className="px-4 py-3">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inventory.items.map((tender) => {
                const state = PIPELINE_LABELS[tender.pipelineState];
                const overdue = tender.daysLeft < 0;
                return (
                  <tr key={tender.id} className="transition hover:bg-amber-50/50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
                          overdue
                            ? 'bg-slate-200 text-slate-500'
                            : urgencyClasses(tender.daysLeft)
                        }`}
                      >
                        {overdue ? 'Échu' : `J-${tender.daysLeft}`}
                      </span>
                      <div className="mt-1 text-xs text-slate-400">
                        {new Date(tender.deadlineAt).toLocaleDateString('fr-MA')}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      <Link
                        href={`/tenders/${tender.id}`}
                        className="underline-offset-2 hover:text-amber-700 hover:underline"
                      >
                        {tender.reference}
                      </Link>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-slate-600">
                      {tender.objet}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {tender.buyerName}
                      <div className="mt-0.5 text-xs text-slate-400">
                        {tender.region}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PROCEDURE_TONES[tender.procedure]}`}
                      >
                        {tender.procedureLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {tender.estimationMad != null
                        ? `${tender.estimationMad.toLocaleString('fr-MA')} MAD`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${state.classes}`}
                      >
                        {state.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {inventory.items.length === 0 && (
            <p className="p-10 text-center text-slate-400">
              {hasFilters
                ? 'Aucun marché ne correspond à ces filtres.'
                : 'Aucun appel d’offres détecté pour le moment.'}
            </p>
          )}
          {capped && (
            <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-400">
              Affichage limité aux {inventory.returnedCount} premiers sur{' '}
              {inventory.filteredCount} — affinez les filtres pour cibler.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
