import { apiGet } from '@/lib/api';
import { Icon, type IconName } from '@/components/ui/Icon';

type RoomStatus = 'green' | 'orange' | 'red';

interface RoomAgent {
  key: string;
  name: string;
  role: string;
  description: string;
  desk: string;
  kind: 'crawler' | 'llm' | 'deterministic';
  icon: string;
  route: string;
  status: RoomStatus;
  statusLabel: string;
  statusReason: string;
  tasksDone: number;
  lastActivityAt: string | null;
}

interface RoomResponse {
  engine: { reachable: boolean; degraded: boolean; model: string; reason: string };
  summary: { green: number; orange: number; red: number; total: number };
  agents: RoomAgent[];
}

const STATUS: Record<
  RoomStatus,
  { dot: string; text: string; ring: string; bar: string; tile: string; label: string }
> = {
  green: { dot: 'bg-emerald', text: 'text-emerald', ring: 'border-emerald-soft/70', bar: 'bg-emerald', tile: 'bg-emerald-soft text-emerald', label: 'Actif' },
  orange: { dot: 'bg-ochre', text: 'text-ochre', ring: 'border-ochre-soft/70', bar: 'bg-ochre', tile: 'bg-ochre-soft text-ochre', label: 'En veille' },
  red: { dot: 'bg-clay', text: 'text-clay', ring: 'border-clay-soft', bar: 'bg-clay', tile: 'bg-clay-soft text-clay', label: 'Hors-service' },
};

const KIND_LABEL: Record<RoomAgent['kind'], string> = {
  crawler: 'Zélateur · crawl',
  llm: 'IA générative',
  deterministic: 'Moteur déterministe',
};

const DESK_ORDER = ['Découverte', 'Fabrique', 'Intelligence', 'Pilotage'] as const;
const DESK_BLURB: Record<string, string> = {
  Découverte: 'Détecter, lire et qualifier les opportunités.',
  Fabrique: 'Monter le dossier et chiffrer l’offre.',
  Intelligence: 'Comprendre le marché et les concurrents.',
  Pilotage: 'Coordonner et prioriser les actions.',
};

const AGENT_ICONS = new Set<IconName>([
  'intel', 'documents', 'check', 'command', 'vault', 'analytics',
  'tresorerie', 'tenders', 'crm', 'alert', 'agents',
]);
function agentIcon(name: string): IconName {
  return AGENT_ICONS.has(name as IconName) ? (name as IconName) : 'agents';
}

function ago(iso: string | null): string {
  if (!iso) return 'aucune activité';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'aucune activité';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function AgentCard({ a }: { a: RoomAgent }) {
  const st = STATUS[a.status];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-paper-2 p-4 shadow-card transition hover:shadow-raised ${st.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${st.bar}`} />
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${st.tile}`}>
          <Icon name={agentIcon(a.icon)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">{a.name}</h3>
            <span className={`ml-auto inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold ${st.text}`}>
              <span className="relative flex h-2 w-2">
                {a.status === 'green' && (
                  <span className={`absolute inline-flex h-full w-full rounded-full motion-safe:animate-ping ${st.dot} opacity-60`} />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${st.dot}`} />
              </span>
              {st.label}
            </span>
          </div>
          <p className="truncate text-[11px] text-faint">{a.role}</p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{a.description}</p>

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono tabular-nums text-ink-2">{a.tasksDone} tâche(s)</span>
          {a.lastActivityAt && (
            <span className="text-faint">{ago(a.lastActivityAt)}</span>
          )}
        </div>
        <p className={`mt-1 text-[11px] ${st.text}`}>{a.statusReason}</p>
        <p className="mt-1.5 truncate font-mono text-[10px] text-faint" title={a.route}>
          {KIND_LABEL[a.kind]} · {a.route}
        </p>
      </div>
    </div>
  );
}

export default async function AgentsRoomPage() {
  const room = await apiGet<RoomResponse>('/agents');
  const problems = room.agents.filter((a) => a.status === 'red');
  const knownDesks = new Set<string>(DESK_ORDER);
  const orphanAgents = room.agents.filter((a) => !knownDesks.has(a.desk));
  const eng = room.engine.reachable
    ? { box: 'border-cyan-soft/60 bg-cyan-soft/15', tile: 'bg-cyan-soft text-cyan', text: 'text-cyan', word: 'connecté' }
    : room.engine.degraded
      ? { box: 'border-ochre-soft/60 bg-ochre-soft/15', tile: 'bg-ochre-soft text-ochre', text: 'text-ochre', word: 'ralenti' }
      : { box: 'border-clay-soft bg-clay-soft/20', tile: 'bg-clay-soft text-clay', text: 'text-clay', word: 'injoignable' };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan">
            Salle des agents
          </p>
          <h1 className="font-display text-[1.9rem] font-bold tracking-tight">
            Les bureaux de la division IA
          </h1>
          <p className="mt-1 text-sm text-muted">
            Chaque agent, ce qu&apos;il fait, et s&apos;il travaille réellement — en direct.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-soft/60 bg-emerald-soft/20 px-3 py-1.5 text-xs font-medium text-emerald">
            <span className="h-2 w-2 rounded-full bg-emerald" /> {room.summary.green} actifs
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ochre-soft/60 bg-ochre-soft/20 px-3 py-1.5 text-xs font-medium text-ochre">
            <span className="h-2 w-2 rounded-full bg-ochre" /> {room.summary.orange} en veille
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-soft bg-clay-soft/20 px-3 py-1.5 text-xs font-medium text-clay">
            <span className="h-2 w-2 rounded-full bg-clay" /> {room.summary.red} en panne
          </span>
        </div>
      </header>

      {/* Engine status banner */}
      <div className={`mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${eng.box}`}>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${eng.tile}`}>
          <Icon name="command" size={16} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">
            Moteur IA — <span className={eng.text}>{eng.word}</span>
          </p>
          <p className="text-[11px] text-muted">
            {room.engine.reason} · modèle ping{' '}
            <span className="font-mono text-cyan">{room.engine.model}</span>
          </p>
        </div>
      </div>

      {/* Problem agents — flagged aside */}
      <section
        className={`mb-6 overflow-hidden rounded-xl border ${
          problems.length > 0 ? 'border-clay-soft bg-clay-soft/10' : 'border-line bg-paper-2'
        } shadow-card`}
      >
        <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-faint">
          <Icon name="alert" size={15} className={problems.length > 0 ? 'text-clay' : 'text-emerald'} />
          Agents à problème
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${problems.length > 0 ? 'bg-clay text-paper' : 'bg-emerald-soft text-emerald'}`}>
            {problems.length}
          </span>
        </h2>
        <div className="p-4">
          {problems.length > 0 ? (
            <ul className="space-y-2">
              {problems.map((a) => (
                <li
                  key={a.key}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-clay-soft bg-paper-2 p-3"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-clay-soft text-clay">
                    <Icon name={agentIcon(a.icon)} size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{a.name}</p>
                    <p className="text-[11px] text-faint">{a.role}</p>
                  </div>
                  <p className="ml-auto max-w-md text-right text-xs font-medium text-clay">
                    {a.statusReason}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Icon name="check" size={16} className="text-emerald" />
              Aucun agent en panne — tous les agents sont connectés à l&apos;entreprise.
            </p>
          )}
        </div>
      </section>

      {/* Offices by desk */}
      <div className="space-y-6">
        {DESK_ORDER.map((desk) => {
          const team = room.agents.filter((a) => a.desk === desk);
          if (team.length === 0) return null;
          return (
            <section key={desk}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-ink-2">
                  Bureau · {desk}
                </h2>
                <p className="text-xs text-faint">{DESK_BLURB[desk]}</p>
                <span className="ml-auto text-[11px] text-faint">
                  {team.filter((a) => a.status === 'green').length}/{team.length} actifs
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {team.map((a) => (
                  <AgentCard key={a.key} a={a} />
                ))}
              </div>
            </section>
          );
        })}

        {orphanAgents.length > 0 && (
          <section>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink-2">
                Autres bureaux
              </h2>
              <p className="text-xs text-faint">Agents hors division standard.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {orphanAgents.map((a) => (
                <AgentCard key={a.key} a={a} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
