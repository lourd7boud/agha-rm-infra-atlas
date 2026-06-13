import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { fmtMad, type ProjectSummary } from '@/lib/projects';
import { Icon, type IconName } from '@/components/ui/Icon';

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
  critique: 'bg-clay-soft text-clay',
  haute: 'bg-ochre-soft text-ochre-deep',
  normale: 'bg-sand text-muted',
};

type Tone = 'ochre' | 'teal' | 'emerald' | 'clay';
const TONE_TILE: Record<Tone, string> = {
  ochre: 'bg-ochre-soft text-ochre-deep',
  teal: 'bg-teal-soft text-teal',
  emerald: 'bg-emerald-soft text-emerald',
  clay: 'bg-clay-soft text-clay',
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

interface KpiCard {
  label: string;
  value: string;
  hint: string;
  href: string;
  icon: IconName;
  tone: Tone;
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

  const cards: KpiCard[] = [
    orchestrator && {
      label: 'Dossiers en attente d’action',
      value: String(orchestrator.length),
      hint: `${urgent.length} action(s) urgente(s)`,
      href: '/tenders',
      icon: 'tenders' as const,
      tone: 'ochre' as const,
    },
    projects && {
      label: 'Chantiers en cours',
      value: String(enCours.length),
      hint:
        enCours.map((p) => `${p.avancementPct.toFixed(0)}%`).join(' · ') ||
        'aucun',
      href: '/projects',
      icon: 'chantiers' as const,
      tone: 'teal' as const,
    },
    receivables && {
      label: 'À encaisser',
      value: fmtMad(receivables.totalMad),
      hint: `retard +60j: ${fmtMad(receivables.aging['61-90'] + receivables.aging['90+'])}`,
      href: '/finance',
      icon: 'tresorerie' as const,
      tone: 'emerald' as const,
    },
    cautions && {
      label: 'Cash bloqué en cautions',
      value: fmtMad(cautions.summary.activeTotalMad),
      hint: `${cautions.summary.activeCount} caution(s) actives`,
      href: '/finance',
      icon: 'vault' as const,
      tone: 'clay' as const,
    },
  ].filter(Boolean) as KpiCard[];

  return (
    <div>
      <header className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold tracking-tight">
            Tableau de bord
          </h1>
          <p className="mt-1 text-sm text-muted">
            L&apos;état de l&apos;entreprise en un regard — marchés, chantiers,
            trésorerie.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-2 px-3 py-1.5 text-xs font-medium text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
          </span>
          Veille en continu
        </span>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group relative overflow-hidden rounded-lg border border-line bg-paper-2 p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-raised"
          >
            <div className="flex items-start justify-between">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${TONE_TILE[card.tone]}`}
              >
                <Icon name={card.icon} size={20} />
              </span>
              <Icon
                name="chevronRight"
                size={16}
                className="translate-x-0 text-faint opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
              />
            </div>
            <p className="mt-4 font-display text-[1.9rem] font-semibold leading-none tabular-nums">
              {card.value}
            </p>
            <p className="mt-2 text-sm font-medium text-ink">{card.label}</p>
            <p className="mt-0.5 text-xs text-muted">{card.hint}</p>
          </Link>
        ))}
      </div>

      {orchestrator && orchestrator.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-card">
          <h2 className="flex items-center gap-2 border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            <Icon name="activity" size={15} className="text-ochre-deep" />
            Prochaines actions — Chef d&apos;Orchestre
          </h2>
          <ul className="divide-y divide-line">
            {orchestrator.slice(0, 8).map((entry) => (
              <li key={entry.tenderId}>
                <Link
                  href={`/tenders/${entry.tenderId}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-sand/60"
                >
                  <span
                    className={`rounded-md px-2 py-1 font-mono text-xs font-bold tabular-nums ${
                      entry.daysLeft <= 7
                        ? 'bg-clay text-paper'
                        : entry.daysLeft <= 15
                          ? 'bg-ochre text-paper'
                          : 'bg-ink text-paper'
                    }`}
                  >
                    {entry.daysLeft < 0 ? 'Échu' : `J-${entry.daysLeft}`}
                  </span>
                  <span className="font-mono text-sm font-semibold">
                    {entry.reference}
                  </span>
                  <span className="flex flex-1 flex-wrap justify-end gap-2">
                    {entry.actions.map((action) => (
                      <span
                        key={action.code}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${URGENCE_TONES[action.urgence]}`}
                      >
                        {action.label} · {action.acteur}
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
        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-card">
          <h2 className="flex items-center gap-2 border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            <Icon name="intel" size={15} className="text-teal" />
            Couverture du portail — veille
          </h2>
          <ul className="divide-y divide-line">
            {coverage.map((entry) => (
              <li
                key={entry.source}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span className="font-semibold uppercase tracking-wide">
                  {entry.source}
                </span>
                <span className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums text-muted">
                  <span>{entry.fetches} relevé(s)</span>
                  <span>{entry.changes} changement(s)</span>
                  <span>{entry.itemsExtracted} avis extraits</span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      entry.lastParseOk === false ? 'text-clay' : 'text-emerald'
                    }`}
                  >
                    <Icon
                      name={entry.lastParseOk === false ? 'alert' : 'check'}
                      size={13}
                    />
                    {entry.lastParseOk === false ? 'analyse KO' : 'analyse OK'}
                  </span>
                  {entry.lastFetchAt && (
                    <span className="text-faint">
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
        <p className="rounded-xl border border-dashed border-line-2 p-12 text-center text-sm text-muted">
          Votre rôle n&apos;a accès à aucune section du tableau de bord —
          utiliser la navigation.
        </p>
      )}
    </div>
  );
}
