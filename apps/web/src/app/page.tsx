import Link from 'next/link';
import Image from 'next/image';
import { apiGet } from '@/lib/api';
import { fmtMad, type ProjectSummary } from '@/lib/projects';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Donut, BarChart, Funnel, Gauge, type DonutSegment } from '@/components/ui/Charts';

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
  summary: { activeTotalMad: number; activeCount: number; staleTotalMad: number };
}
interface ReceivablesResponse {
  totalMad: number;
  aging: Record<'0-30' | '31-60' | '61-90' | '90+', number>;
}
interface Facet {
  key: string;
  label: string;
  count: number;
}
interface InventoryResponse {
  total: number;
  facets: { procedures: Facet[]; states: Facet[]; regions: Facet[] };
}
interface SourceCoverage {
  source: string;
  itemsExtracted: number;
  lastParseOk: boolean | null;
}
interface Employee {
  id: string;
}

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
    if (isRedirectError(error)) throw error;
    return null;
  }
}

type AgentRunStatus = 'green' | 'orange' | 'red';
interface AgentEntry {
  key: string;
  name: string;
  role: string;
  icon: string;
  status: AgentRunStatus;
  statusLabel: string;
  statusReason: string;
}
interface AgentsResponse {
  engine: { reachable: boolean; model: string };
  summary: { green: number; orange: number; red: number; total: number };
  agents: AgentEntry[];
}

const AGENT_ICONS = new Set<IconName>([
  'intel', 'documents', 'check', 'command', 'vault', 'analytics',
  'tresorerie', 'tenders', 'crm', 'alert', 'agents',
]);
function agentIcon(name: string): IconName {
  return AGENT_ICONS.has(name as IconName) ? (name as IconName) : 'agents';
}
const AGENT_STATUS: Record<AgentRunStatus, { dot: string; text: string }> = {
  green: { dot: 'bg-emerald', text: 'text-emerald' },
  orange: { dot: 'bg-ochre', text: 'text-ochre' },
  red: { dot: 'bg-clay', text: 'text-clay' },
};

const PIPELINE_ORDER: [key: string, label: string][] = [
  ['detected', 'Détectés'],
  ['qualified', 'Qualifiés'],
  ['go_decided', 'GO décidé'],
  ['preparing', 'En préparation'],
  ['submitted', 'Soumis'],
  ['opened', 'Plis ouverts'],
  ['won', 'Gagnés'],
];

const DONUT_COLORS = [
  'var(--color-cyan)',
  'var(--color-teal)',
  'var(--color-ochre)',
  'var(--color-emerald)',
  'var(--color-clay)',
];

const URGENCE_DOT: Record<OrchestratorAction['urgence'], string> = {
  critique: 'bg-clay',
  haute: 'bg-ochre',
  normale: 'bg-faint',
};

type Tone = 'cyan' | 'teal' | 'emerald' | 'ochre' | 'clay';
const TONE_TILE: Record<Tone, string> = {
  cyan: 'bg-cyan-soft text-cyan',
  teal: 'bg-teal-soft text-teal',
  emerald: 'bg-emerald-soft text-emerald',
  ochre: 'bg-ochre-soft text-ochre',
  clay: 'bg-clay-soft text-clay',
};

function mdh(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MDH` : fmtMad(value);
}

interface Kpi {
  label: string;
  value: string;
  hint: string;
  icon: IconName;
  tone: Tone;
}

function Panel({
  title,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  icon?: IconName;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-xl border border-line bg-paper-2 shadow-card ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        {icon && <Icon name={icon} size={15} className="text-cyan" />}
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-faint">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

export default async function CommandCenterPage() {
  const [
    orchestrator,
    cautions,
    receivables,
    projects,
    coverage,
    inventory,
    employees,
    agentsData,
  ] = await Promise.all([
    tryGet<OrchestratorEntry[]>('/tender/orchestrator'),
    tryGet<CautionsResponse>('/finance/cautions'),
    tryGet<ReceivablesResponse>('/finance/receivables'),
    tryGet<ProjectSummary[]>('/project/projects'),
    tryGet<SourceCoverage[]>('/watch/coverage'),
    tryGet<InventoryResponse>('/tender/inventory'),
    tryGet<Employee[]>('/people/employees'),
    tryGet<AgentsResponse>('/agents'),
  ]);

  const enCours = (projects ?? []).filter((p) => p.status === 'en_cours');
  const avancementMoyen =
    enCours.length > 0
      ? Math.round(enCours.reduce((s, p) => s + p.avancementPct, 0) / enCours.length)
      : 0;
  const stateCount = (key: string) =>
    inventory?.facets.states.find((f) => f.key === key)?.count ?? 0;
  const marchesActifs =
    (inventory?.total ?? 0) -
    ['won', 'lost', 'cancelled', 'rejected', 'no_go'].reduce(
      (s, k) => s + stateCount(k),
      0,
    );
  const avisVeilles = (coverage ?? []).reduce((s, c) => s + c.itemsExtracted, 0);
  const retardPlus60 =
    (receivables?.aging['61-90'] ?? 0) + (receivables?.aging['90+'] ?? 0);

  const kpis: Kpi[] = [
    { label: 'Marchés détectés', value: String(inventory?.total ?? 0), hint: `${stateCount('qualified')} qualifiés`, icon: 'tenders', tone: 'cyan' },
    { label: 'Marchés actifs', value: String(Math.max(0, marchesActifs)), hint: 'en cours de traitement', icon: 'command', tone: 'teal' },
    { label: 'Projets en cours', value: String(enCours.length), hint: `${(projects ?? []).length} chantiers au total`, icon: 'chantiers', tone: 'emerald' },
    { label: 'Avancement moyen', value: `${avancementMoyen}%`, hint: 'chantiers en cours', icon: 'activity', tone: 'cyan' },
    { label: 'À encaisser', value: mdh(receivables?.totalMad ?? 0), hint: `retard +60j: ${mdh(retardPlus60)}`, icon: 'tresorerie', tone: 'ochre' },
    { label: 'Cautions actives', value: mdh(cautions?.summary.activeTotalMad ?? 0), hint: `${cautions?.summary.activeCount ?? 0} en banque`, icon: 'vault', tone: 'clay' },
    { label: 'Collaborateurs', value: String(employees?.length ?? '—'), hint: 'effectif enregistré', icon: 'personnel', tone: 'teal' },
    { label: 'Avis veillés', value: String(avisVeilles), hint: 'portail marchés publics', icon: 'intel', tone: 'cyan' },
  ];

  const urgentAlerts = (orchestrator ?? [])
    .flatMap((e) => e.actions.map((a) => ({ ...a, ref: e.reference, id: e.tenderId })))
    .filter((a) => a.urgence !== 'normale')
    .slice(0, 6);

  const pipeline = PIPELINE_ORDER.map(([key, label], i) => ({
    label,
    value: stateCount(key),
    color: i < 3 ? 'var(--color-cyan-deep)' : i < 5 ? 'var(--color-teal)' : 'var(--color-emerald)',
  }));

  const procedureSegments: DonutSegment[] = (inventory?.facets.procedures ?? []).map(
    (f, i) => ({ label: f.label, value: f.count, color: DONUT_COLORS[i % DONUT_COLORS.length]! }),
  );

  const agingBars = receivables
    ? [
        { label: '0-30j', value: receivables.aging['0-30'], color: 'var(--color-emerald)' },
        { label: '31-60j', value: receivables.aging['31-60'], color: 'var(--color-ochre)' },
        { label: '61-90j', value: receivables.aging['61-90'], color: 'var(--color-ochre-deep)' },
        { label: '90j+', value: receivables.aging['90+'], color: 'var(--color-clay)' },
      ]
    : [];

  const topChantiers = enCours
    .slice()
    .sort((a, b) => b.avancementPct - a.avancementPct)
    .slice(0, 4);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan">
            Command Center
          </p>
          <h1 className="font-display text-[1.9rem] font-bold tracking-tight">
            Vue d&apos;ensemble de l&apos;entreprise
          </h1>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-2 px-3 py-1.5 text-xs font-medium text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" />
          </span>
          Données en temps réel
        </span>
      </header>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-line bg-paper-2 p-4 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE_TILE[k.tone]}`}>
                <Icon name={k.icon} size={16} />
              </span>
            </div>
            <p className="mt-3 font-mono text-xl font-bold leading-none tabular-nums">
              {k.value}
            </p>
            <p className="mt-2 text-[11px] font-medium text-muted">{k.label}</p>
            <p className="mt-0.5 text-[10px] text-faint">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Row: alerts · hero · agents */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel title="Alertes & notifications" icon="alert" className="xl:col-span-3">
          {urgentAlerts.length > 0 ? (
            <ul className="space-y-2.5">
              {urgentAlerts.map((a) => (
                <li key={`${a.id}-${a.code}`}>
                  <Link
                    href={`/tenders/${a.id}`}
                    className="flex items-start gap-2.5 rounded-md p-1.5 transition hover:bg-sand/50"
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${URGENCE_DOT[a.urgence]}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-2">{a.label}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {a.ref} · {a.acteur}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-faint">Aucune alerte urgente.</p>
          )}
        </Panel>

        <Panel
          title="Chantiers en cours"
          icon="chantiers"
          className="xl:col-span-5"
          action={
            <Link href="/projects" className="text-[11px] font-medium text-cyan hover:underline">
              Voir tous
            </Link>
          }
        >
          <div className="relative h-64 overflow-hidden rounded-lg border border-line">
            <Image
              src="/brand/atlas-dam.webp"
              alt="Chantiers d'infrastructure AGHA RM INFRA"
              fill
              sizes="40vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-rail via-rail/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3">
              {topChantiers.length > 0 ? (
                topChantiers.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-md bg-rail/70 px-2.5 py-1.5 backdrop-blur"
                  >
                    <Icon name="pin" size={12} className="shrink-0 text-cyan" />
                    <span className="truncate text-xs text-ink">{p.name}</span>
                    <span className="ml-auto font-mono text-xs font-bold tabular-nums text-cyan">
                      {p.avancementPct.toFixed(0)}%
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-md bg-rail/70 px-2.5 py-1.5 text-xs text-muted backdrop-blur">
                  Aucun chantier en cours déclaré.
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title="AI Agents opérationnels"
          icon="agents"
          className="xl:col-span-4"
          action={
            agentsData ? (
              <Link href="/agents" className="text-[11px] font-medium text-cyan hover:underline">
                {agentsData.summary.green}/{agentsData.summary.total} · salle →
              </Link>
            ) : null
          }
        >
          {agentsData ? (
            <>
              <ul className="space-y-1">
                {agentsData.agents.slice(0, 8).map((a) => {
                  const st = AGENT_STATUS[a.status];
                  return (
                    <li
                      key={a.key}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-sand/40"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-soft/60 text-cyan">
                        <Icon name={agentIcon(a.icon)} size={14} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-2">
                          {a.name}
                        </span>
                        <span className="block truncate text-[10px] text-faint">
                          {a.statusReason}
                        </span>
                      </span>
                      <span
                        className={`ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium ${st.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {a.statusLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 border-t border-line pt-2 text-[10px] text-faint">
                Moteur IA :{' '}
                <span className="font-mono text-cyan">
                  {agentsData.engine.reachable ? agentsData.engine.model : 'injoignable'}
                </span>
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-faint">
              Statut des agents indisponible.
            </p>
          )}
        </Panel>
      </div>

      {/* Row: pipeline · procédures · créances */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <Panel title="Pipeline marchés publics" icon="tenders" className="xl:col-span-5">
          <Funnel stages={pipeline} />
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">
            De la détection automatique à l&apos;attribution.
          </p>
        </Panel>

        <Panel title="Marchés par procédure" icon="analytics" className="xl:col-span-4">
          {procedureSegments.length > 0 ? (
            <div className="flex items-center gap-4">
              <Donut segments={procedureSegments} size={130} />
              <ul className="flex-1 space-y-1.5">
                {procedureSegments.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                    <span className="truncate text-muted">{s.label}</span>
                    <span className="ml-auto font-mono tabular-nums text-ink-2">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-faint">Aucune donnée.</p>
          )}
        </Panel>

        <Panel title="Créances par ancienneté" icon="tresorerie" className="xl:col-span-3">
          {agingBars.some((b) => b.value > 0) ? (
            <>
              <BarChart bars={agingBars} height={130} />
              <p className="mt-2 text-center font-mono text-sm font-bold tabular-nums text-ink">
                {mdh(receivables?.totalMad ?? 0)}
              </p>
              <p className="text-center text-[10px] text-faint">total à encaisser</p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-faint">Aucune créance en attente.</p>
          )}
        </Panel>
      </div>

      {/* Row: activité terrain · veille + santé */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <Panel
          title="Activité terrain (avancement)"
          icon="terrain"
          className="xl:col-span-7"
          action={
            <Link href="/projects" className="text-[11px] font-medium text-cyan hover:underline">
              Détails
            </Link>
          }
        >
          {enCours.length > 0 ? (
            <ul className="space-y-3">
              {enCours.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-sm text-ink-2">{p.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand/60">
                    <div
                      className="h-2 rounded-full bg-cyan"
                      style={{ width: `${Math.min(100, p.avancementPct)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-cyan">
                    {p.avancementPct.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-faint">
              Aucun chantier en cours — les journaux de chantier alimentent cette vue.
            </p>
          )}
        </Panel>

        <Panel title="Veille & santé système" icon="activity" className="xl:col-span-5">
          <div className="flex items-center gap-5">
            <Gauge value={avancementMoyen} max={100} size={104} unit="%" label="avancement" />
            <ul className="flex-1 space-y-2 text-sm">
              {(coverage ?? []).slice(0, 3).map((c) => (
                <li key={c.source} className="flex items-center justify-between gap-2">
                  <span className="uppercase text-muted">{c.source}</span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-ink-2">
                    {c.itemsExtracted} avis
                    <Icon
                      name={c.lastParseOk === false ? 'alert' : 'check'}
                      size={13}
                      className={c.lastParseOk === false ? 'text-clay' : 'text-emerald'}
                    />
                  </span>
                </li>
              ))}
              {(coverage ?? []).length === 0 && (
                <li className="text-faint">Veille en attente de relevés.</li>
              )}
            </ul>
          </div>
        </Panel>
      </div>

      {!orchestrator && !projects && !inventory && (
        <p className="mt-4 rounded-xl border border-dashed border-line-2 p-12 text-center text-sm text-muted">
          Votre rôle n&apos;a accès à aucune section — utiliser la navigation.
        </p>
      )}
    </div>
  );
}
