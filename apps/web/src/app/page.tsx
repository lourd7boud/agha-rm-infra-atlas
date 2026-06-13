import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad, type ProjectSummary } from '@/lib/projects';

interface OrchestratorAction {
  code: string;
  label: string;
  acteur: string;
  urgence: 'normale' | 'haute' | 'critique';
}

interface OrchestratorEntry {
  tenderId: string;
  reference: string;
  etat: string;
  daysLeft: number;
  actions: OrchestratorAction[];
}

interface CautionsResponse {
  summary: { activeTotalMad: number; activeCount: number };
}

interface ReceivablesResponse {
  totalMad: number;
  items: unknown[];
  aging: Record<'0-30' | '31-60' | '61-90' | '90+', number>;
}

interface SourceCoverage {
  source: string;
  fetches: number;
  changes: number;
  itemsExtracted: number;
  lastFetchAt: string | null;
  lastParseOk: boolean | null;
}

const URGENCE_TONES: Record<OrchestratorAction['urgence'], string> = {
  critique: 'bg-rose-100 text-rose-800',
  haute: 'bg-amber-100 text-amber-800',
  normale: 'bg-slate-100 text-slate-600',
};

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

async function tryGet<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    // A sign-in redirect must propagate; only role/availability errors degrade.
    if (isRedirectError(error)) throw error;
    // Role-restricted or unavailable section — the dashboard renders without it.
    return null;
  }
}

export default async function DashboardPage() {
  const [orchestrator, cautions, receivables, projects, coverage] =
    await Promise.all([
      tryGet<OrchestratorEntry[]>('/tender/orchestrator'),
      tryGet<CautionsResponse>('/finance/cautions'),
      tryGet<ReceivablesResponse>('/finance/receivables'),
      tryGet<ProjectSummary[]>('/project/projects'),
      tryGet<SourceCoverage[]>('/watch/coverage'),
    ]);

  const enCours = (projects ?? []).filter((p) => p.status === 'en_cours');
  const urgent = (orchestrator ?? []).flatMap((entry) =>
    entry.actions
      .filter((action) => action.urgence !== 'normale')
      .map(() => entry.reference),
  );

  const cards = [
    orchestrator && {
      label: 'Dossiers en attente d’action',
      value: String(orchestrator.length),
      hint: `${urgent.length} action(s) urgente(s)`,
      href: '/tenders',
    },
    projects && {
      label: 'Chantiers en cours',
      value: String(enCours.length),
      hint: enCours
        .map((p) => `${p.avancementPct.toFixed(0)}%`)
        .join(' · ') || 'aucun',
      href: '/projects',
    },
    receivables && {
      label: 'À encaisser',
      value: fmtMad(receivables.totalMad),
      hint: `retard +60j: ${fmtMad(receivables.aging['61-90'] + receivables.aging['90+'])}`,
      href: '/finance',
    },
    cautions && {
      label: 'Cash bloqué en cautions',
      value: fmtMad(cautions.summary.activeTotalMad),
      hint: `${cautions.summary.activeCount} caution(s) actives`,
      href: '/finance',
    },
  ].filter(Boolean) as { label: string; value: string; hint: string; href: string }[];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Tableau de bord</h1>
        <p className="mt-1 text-sm text-slate-500">
          L&apos;état de l&apos;entreprise en un regard — marchés, chantiers,
          trésorerie
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {card.label}
            </p>
            <p className="mt-2 font-mono text-2xl font-black tabular-nums">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{card.hint}</p>
          </Link>
        ))}
      </div>

      {orchestrator && orchestrator.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Prochaines actions (Chef d&apos;Orchestre)
          </h2>
          <ul className="divide-y divide-slate-100">
            {orchestrator.slice(0, 8).map((entry) => (
              <li key={entry.tenderId}>
                <Link
                  href={`/tenders/${entry.tenderId}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-slate-50"
                >
                  <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-bold tabular-nums">
                    J-{entry.daysLeft}
                  </span>
                  <span className="font-semibold">{entry.reference}</span>
                  <span className="flex flex-1 flex-wrap justify-end gap-2">
                    {entry.actions.map((action) => (
                      <span
                        key={action.code}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${URGENCE_TONES[action.urgence]}`}
                      >
                        {action.label} — {action.acteur}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {coverage && coverage.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Couverture du portail (veille)
          </h2>
          <ul className="divide-y divide-slate-100">
            {coverage.map((entry) => (
              <li
                key={entry.source}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span className="font-semibold uppercase">{entry.source}</span>
                <span className="flex gap-4 font-mono text-xs tabular-nums text-slate-500">
                  <span>{entry.fetches} relevé(s)</span>
                  <span>{entry.changes} changement(s)</span>
                  <span>{entry.itemsExtracted} avis extraits</span>
                  <span
                    className={
                      entry.lastParseOk === false ? 'text-rose-600' : 'text-emerald-600'
                    }
                  >
                    {entry.lastParseOk === false ? 'analyse KO' : 'analyse OK'}
                  </span>
                  {entry.lastFetchAt && (
                    <span>
                      {new Date(entry.lastFetchAt).toLocaleString('fr-MA')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!orchestrator && !projects && (
        <p className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
          Votre rôle n&apos;a accès à aucune section du tableau de bord —
          utiliser la navigation ci-dessus.
        </p>
      )}
    </div>
  );
}
