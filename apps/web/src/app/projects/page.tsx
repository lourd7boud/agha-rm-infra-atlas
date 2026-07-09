// Projets & Marchés BTP — the portfolio. Server Component: filters live in the
// URL (GET form), data comes from /api/btp/projects in one call.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtDate, fmtMad, PROJECT_STATUS_BADGES, type BtpPortfolio } from '@/lib/btp';
import { Pager } from '@/components/ui/Pager';

export const metadata = { title: 'Projets BTP — ATLAS' };

const PAGE_SIZE = 24;

type Search = Promise<Record<string, string | undefined>>;

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const s = query.toString();
  return s ? `?${s}` : '';
}

export default async function ProjectsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const filters = {
    search: params.search ?? '',
    statut: params.statut ?? '',
    annee: params.annee ?? '',
    at: params.at ?? '',
    moe: params.moe ?? '',
  };
  const portfolio = await apiGet<BtpPortfolio>(
    `/btp/projects${buildQuery({ ...filters, page: String(page), limit: String(PAGE_SIZE) })}`,
  );
  const { stats, facets } = portfolio;

  const kpis = [
    { label: 'Marchés', value: String(stats.total), accent: 'border-l-cyan' },
    { label: 'Actifs', value: String(stats.actifs), accent: 'border-l-cyan' },
    { label: 'Terminés', value: String(stats.termines), accent: 'border-l-emerald' },
    { label: 'En préparation', value: String(stats.brouillons), accent: 'border-l-ochre' },
    { label: 'Montant total (TTC)', value: fmtMad(stats.montantTotalMad), accent: 'border-l-teal' },
  ];

  return (
    <div className="px-6 py-8 lg:px-10">
      {/* En-tête */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">
            Gestion de projets
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Marchés de travaux</h1>
          <p className="mt-1 text-sm text-muted">
            Bordereau → métré → décompte : la chaîne d&apos;exécution, automatisée.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/projects/delais"
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            Gestion des délais
          </Link>
          <Link
            href="/projects/indexes"
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-cyan hover:text-cyan"
          >
            Index BTP
          </Link>
          <Link
            href="/projects/corbeille"
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-clay hover:text-clay"
          >
            Corbeille
          </Link>
          <Link
            href="/projects/new"
            className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90"
          >
            + Nouveau marché
          </Link>
        </div>
      </div>

      {/* KPI */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className={`rounded-xl border border-line border-l-2 ${kpi.accent} bg-paper-2 px-4 py-3 shadow-sm`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">
              {kpi.label}
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <form
        method="GET"
        className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm"
      >
        <input
          type="search"
          name="search"
          defaultValue={filters.search}
          placeholder="Objet, marché, société…"
          className="min-w-56 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan"
        />
        <select
          name="statut"
          defaultValue={filters.statut}
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-muted focus:border-cyan"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(PROJECT_STATUS_BADGES).map(([value, badge]) => (
            <option key={value} value={value}>
              {badge.label}
            </option>
          ))}
        </select>
        <select
          name="annee"
          defaultValue={filters.annee}
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-muted focus:border-cyan"
        >
          <option value="">Toutes les années</option>
          {facets.annees.map((annee) => (
            <option key={annee} value={annee}>
              {annee}
            </option>
          ))}
        </select>
        <select
          name="at"
          defaultValue={filters.at}
          className="max-w-48 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-muted focus:border-cyan"
        >
          <option value="">Assistance technique</option>
          {facets.assistanceTechnique.map((at) => (
            <option key={at} value={at}>
              {at}
            </option>
          ))}
        </select>
        <select
          name="moe"
          defaultValue={filters.moe}
          className="max-w-48 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-muted focus:border-cyan"
        >
          <option value="">Maître d&apos;œuvre</option>
          {facets.maitreOeuvre.map((moe) => (
            <option key={moe} value={moe}>
              {moe}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-cyan-soft bg-cyan-soft px-4 py-2 text-xs font-bold text-cyan transition hover:bg-cyan hover:text-paper"
        >
          Filtrer
        </button>
        {(filters.search || filters.statut || filters.annee || filters.at || filters.moe) && (
          <Link href="/projects" className="text-xs font-semibold text-faint hover:text-muted">
            Réinitialiser
          </Link>
        )}
      </form>

      {/* Cartes */}
      {portfolio.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-muted">Aucun marché ne correspond.</p>
          <p className="mt-1 text-xs text-faint">
            Créez votre premier marché — le bordereau, les métrés et les décomptes suivront.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {portfolio.items.map((project) => {
            const badge = PROJECT_STATUS_BADGES[project.status] ?? {
              label: project.status,
              classes: 'bg-sand text-muted',
            };
            const progress = Math.min(100, Math.max(0, project.progressPct));
            const overrun = project.progressPct > 100;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group flex flex-col rounded-xl border border-line bg-paper-2 p-5 shadow-sm transition hover:border-cyan"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-sm font-bold text-cyan">{project.reference}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-ink-2">
                  {project.objet ?? project.name}
                </p>
                <dl className="mt-3 space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Société</dt>
                    <dd className="truncate text-right font-medium">{project.societe ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Année · Commune</dt>
                    <dd className="truncate text-right">
                      {project.annee ?? '—'}
                      {project.commune ? ` · ${project.commune}` : ''}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Montant (TTC)</dt>
                    <dd className="font-mono font-bold tabular-nums text-ink">
                      {fmtMad(project.montantMarcheMad)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold uppercase tracking-widest text-faint">
                      Avancement
                    </span>
                    <span
                      className={`font-mono font-bold tabular-nums ${overrun ? 'text-clay' : 'text-ink-2'}`}
                    >
                      {project.progressPct.toLocaleString('fr-MA', { maximumFractionDigits: 1 })}%
                      {overrun ? ' ⚠' : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand">
                    <div
                      className={`h-full rounded-full ${overrun ? 'bg-clay' : 'bg-gradient-to-r from-cyan to-emerald'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <p className="mt-3 flex items-center justify-between text-[11px] text-faint">
                  <span className="truncate">{project.maitreOeuvre ?? project.buyerName}</span>
                  <span>créé le {fmtDate(project.createdAt)}</span>
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <Pager
          page={page - 1}
          pageSize={PAGE_SIZE}
          total={portfolio.total}
          hrefForPage={(p) => `/projects${buildQuery({ ...filters, page: String(p + 1) })}`}
        />
      </div>
    </div>
  );
}
