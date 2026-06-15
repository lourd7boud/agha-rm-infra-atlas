import { Controller, Get, Inject, Logger, Module, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/auth.module';
import { BrainModule } from '../brain/brain.module';
import {
  DEFAULT_TIER_MODELS,
  LLM_CLIENT,
  type LlmClient,
  type LlmTier,
} from '../brain/llm.client';
import { TenderModule } from '../tender/tender.module';
import {
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from '../tender/tender.repository';
import { WatchModule } from '../watch/watch.module';
import {
  SNAPSHOT_REPOSITORY,
  type SnapshotRepository,
} from '../watch/snapshot.repository';

type AgentKind = 'crawler' | 'llm' | 'deterministic';
type RoomStatus = 'green' | 'orange' | 'red';

interface AgentDef {
  key: string;
  name: string;
  role: string;
  description: string;
  desk: string;
  kind: AgentKind;
  icon: string;
  route: string;
  /** For llm agents: which model tier they actually run on. */
  tier?: LlmTier;
}

interface RoomEntry extends AgentDef {
  status: RoomStatus;
  statusLabel: string;
  statusReason: string;
  tasksDone: number;
  lastActivityAt: string | null;
}

interface RoomPayload {
  engine: { reachable: boolean; degraded: boolean; model: string; reason: string };
  summary: { green: number; orange: number; red: number; total: number };
  agents: RoomEntry[];
}

const REGISTRY: readonly AgentDef[] = [
  { key: 'sentinel', name: 'Agent Sentinel', role: 'Veille marchés publics', description: "Scrute le portail des marchés publics et détecte les nouveaux avis, 24h/24.", desk: 'Découverte', kind: 'crawler', icon: 'intel', route: 'Cron + GET /watch/coverage' },
  { key: 'extractor', name: 'Agent Extracteur', role: 'Extraction avis & DCE', description: "Lit l'avis ou le DCE et en extrait les champs (objet, estimation, caution, délais).", desk: 'Découverte', kind: 'llm', icon: 'documents', route: 'POST /brain/extract-avis', tier: 'T1' },
  { key: 'qualifier', name: 'Agent Qualifier', role: 'Analyse des opportunités', description: "Applique 5 règles éliminatoires et le profil entreprise pour qualifier ou écarter.", desk: 'Découverte', kind: 'deterministic', icon: 'check', route: 'POST /tender/tenders/qualify' },
  { key: 'strategist', name: 'Agent Stratège', role: 'Note Go/No-Go (G1)', description: "Rédige la note Go/No-Go : arguments, risques et vérifications avant décision.", desk: 'Découverte', kind: 'llm', icon: 'command', route: 'POST /tender/tenders/:id/brief', tier: 'T3' },
  { key: 'compliance', name: 'Agent Compliance', role: 'Dossier administratif', description: "Construit la check-list du dossier et signale les pièces manquantes ou expirées.", desk: 'Fabrique', kind: 'deterministic', icon: 'vault', route: 'GET /tender/tenders/:id/checklist' },
  { key: 'bidwriter', name: 'Agent Rédacteur', role: 'Note méthodologique', description: "Génère le squelette de la note méthodologique une fois la décision GO prise.", desk: 'Fabrique', kind: 'llm', icon: 'documents', route: 'POST /tender/tenders/:id/bid-draft', tier: 'T2' },
  { key: 'estimator', name: 'Agent Estimateur', role: 'Détail estimatif', description: "Produit la structure du détail estimatif (postes), sans inventer de prix.", desk: 'Fabrique', kind: 'llm', icon: 'analytics', route: 'POST /tender/tenders/:id/estimate', tier: 'T2' },
  { key: 'modeler', name: 'Agent Modeleur', role: 'Scénarios de prix (G2)', description: "Calcule les scénarios prudent / équilibré / agressif avec espérance de gain.", desk: 'Fabrique', kind: 'deterministic', icon: 'tresorerie', route: 'POST /tender/tenders/:id/scenarios' },
  { key: 'resultminer', name: 'Agent Result Miner', role: 'Résultats & attributions', description: "Mine les résultats d'attribution publiés pour nourrir l'intelligence concurrentielle.", desk: 'Intelligence', kind: 'crawler', icon: 'tenders', route: 'Veille résultats (INTEL)' },
  { key: 'profiler', name: 'Agent Profiler', role: 'Profils concurrents', description: "Construit le profil de chaque concurrent à partir des attributions observées.", desk: 'Intelligence', kind: 'deterministic', icon: 'crm', route: 'GET /intel/competitors/:id/profile' },
  { key: 'risk', name: 'Agent Risk', role: 'Matrice des risques', description: "Établit la matrice structurée des risques du dossier (catégories, gravité).", desk: 'Intelligence', kind: 'llm', icon: 'alert', route: 'POST /tender/tenders/:id/risks', tier: 'T2' },
  { key: 'orchestrator', name: "Chef d'Orchestre", role: 'Coordination générale', description: "Détermine et priorise la prochaine action concrète pour chaque marché.", desk: 'Pilotage', kind: 'deterministic', icon: 'agents', route: 'GET /tender/orchestrator' },
];

const GO_PLUS_STATES = ['go_decided', 'preparing', 'submitted', 'opened', 'won'];
// Aligned with orchestrator.domain terminal states (no further action possible).
const TERMINAL_STATES = ['won', 'lost', 'cancelled', 'no_go', 'rejected'];
const STATUS_LABEL: Record<RoomStatus, string> = {
  green: 'Actif',
  orange: 'En veille',
  red: 'Hors-service',
};

function modelFor(tier: LlmTier | undefined): string {
  const t = tier ?? 'T2';
  const override = { T1: process.env.LLM_MODEL_T1, T2: process.env.LLM_MODEL_T2, T3: process.env.LLM_MODEL_T3 }[t];
  return override && override.trim() ? override : DEFAULT_TIER_MODELS[t];
}

interface ActivityStat {
  count: number;
  last: string | null;
}

/** Counts tenders carrying a given raw artifact and its most recent timestamp. */
function artifactStat(
  records: readonly TenderRecord[],
  rawKey: string,
  tsKey = 'generatedAt',
): ActivityStat {
  let count = 0;
  let last: string | null = null;
  for (const r of records) {
    const node = (r.raw as Record<string, unknown> | null)?.[rawKey];
    if (node && typeof node === 'object') {
      count += 1;
      const g = (node as Record<string, unknown>)[tsKey];
      if (typeof g === 'string' && (!last || g > last)) last = g;
    }
  }
  return { count, last };
}

function qualifierStat(records: readonly TenderRecord[]): ActivityStat {
  let count = 0;
  let last: string | null = null;
  for (const r of records) {
    if (r.qualification) {
      count += 1;
      const c = (r.qualification as { checkedAt?: unknown }).checkedAt;
      if (typeof c === 'string' && (!last || c > last)) last = c;
    }
  }
  return { count, last };
}

const toIso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('délai dépassé')), ms),
    ),
  ]);
}

interface EngineState {
  reachable: boolean;
  degraded: boolean;
  reason: string;
}

/** Live connectivity probe. Detailed errors are logged, never returned. */
async function checkEngine(llm: LlmClient | null): Promise<EngineState> {
  if (!llm) {
    return { reachable: false, degraded: false, reason: 'Moteur IA non configuré (clé absente)' };
  }
  try {
    await withTimeout(llm.complete({ tier: 'T1', prompt: 'ping', maxTokens: 1 }), 7000);
    return { reachable: true, degraded: false, reason: 'Passerelle joignable' };
  } catch (error) {
    const message = (error as Error).message;
    new Logger('Agents').warn(`LLM connectivity check failed: ${message}`);
    return message === 'délai dépassé'
      ? { reachable: false, degraded: true, reason: 'Passerelle lente (délai dépassé)' }
      : { reachable: false, degraded: false, reason: 'Passerelle injoignable' };
  }
}

// Single-flight + short TTL: the room is a polled status panel, so one real
// computation (incl. the LLM ping + full tender scan) serves every caller in
// the window instead of one per request.
const ROOM_TTL_MS = 15_000;
let roomCache: { at: number; payload: RoomPayload } | null = null;
let inflight: Promise<RoomPayload> | null = null;

@Controller('agents')
export class AgentsController {
  constructor(
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Optional()
    @Inject(SNAPSHOT_REPOSITORY)
    private readonly snapshots: SnapshotRepository | null = null,
  ) {}

  /** The agents room: live, evidence-based operational status of every agent. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux', 'terrain')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @Get()
  async room(): Promise<RoomPayload> {
    if (roomCache && Date.now() - roomCache.at < ROOM_TTL_MS) {
      return roomCache.payload;
    }
    if (!inflight) {
      inflight = this.compute()
        .then((payload) => {
          roomCache = { at: Date.now(), payload };
          inflight = null;
          return payload;
        })
        .catch((error) => {
          inflight = null;
          throw error;
        });
    }
    return inflight;
  }

  private async compute(): Promise<RoomPayload> {
    const [engine, records, coverage] = await Promise.all([
      checkEngine(this.llm),
      this.tenders.findAll(),
      this.snapshots ? this.snapshots.coverage() : Promise.resolve([]),
    ]);

    const watchCov = coverage.find((c) => c.source === 'watch');
    const intelCov = coverage.find((c) => c.source === 'intel');

    const act: Record<string, ActivityStat> = {
      strategist: artifactStat(records, 'g1Brief'),
      modeler: artifactStat(records, 'g2Scenarios'),
      risk: artifactStat(records, 'riskAssessment'),
      bidwriter: artifactStat(records, 'bidDraft'),
      estimator: artifactStat(records, 'estimateSkeleton'),
      extractor: artifactStat(records, 'extraction', 'extractedAt'),
      qualifier: qualifierStat(records),
      compliance: {
        count: records.filter((r) => GO_PLUS_STATES.includes(r.pipelineState)).length,
        last: null,
      },
      orchestrator: {
        count: records.filter((r) => !TERMINAL_STATES.includes(r.pipelineState)).length,
        last: null,
      },
      sentinel: {
        count: watchCov?.itemsExtracted ?? 0,
        last: toIso(watchCov?.lastFetchAt),
      },
      resultminer: {
        count: intelCov?.itemsExtracted ?? 0,
        last: toIso(intelCov?.lastFetchAt),
      },
      profiler: {
        count: intelCov?.itemsExtracted ?? 0,
        last: toIso(intelCov?.lastFetchAt),
      },
    };

    const agents: RoomEntry[] = REGISTRY.map((def) => {
      const a = act[def.key] ?? { count: 0, last: null };
      let status: RoomStatus;
      let reason: string;

      if (def.kind === 'llm') {
        const model = modelFor(def.tier);
        if (engine.degraded) {
          status = 'orange';
          reason = 'Moteur IA lent — à surveiller';
        } else if (!engine.reachable) {
          status = 'red';
          reason = engine.reason;
        } else if (a.count > 0) {
          status = 'green';
          reason = `${a.count} production(s) · ${model}`;
        } else {
          status = 'orange';
          reason = `Connecté (${model}) · en attente de tâche`;
        }
      } else if (def.kind === 'crawler') {
        const cov = def.key === 'sentinel' ? watchCov : intelCov;
        if (cov?.lastParseOk === false) {
          status = 'red';
          reason = 'Analyse du portail en échec';
        } else if (a.count > 0) {
          status = 'green';
          reason = `${a.count} élément(s) collecté(s)`;
        } else {
          status = 'orange';
          reason = 'Aucun relevé pour le moment';
        }
      } else {
        if (a.count > 0) {
          status = 'green';
          reason = `${a.count} traitement(s)`;
        } else {
          status = 'orange';
          reason = 'Prêt · aucune tâche en cours';
        }
      }

      return {
        ...def,
        status,
        statusLabel: STATUS_LABEL[status],
        statusReason: reason,
        tasksDone: a.count,
        lastActivityAt: a.last,
      };
    });

    const count = (s: RoomStatus) => agents.filter((x) => x.status === s).length;

    return {
      engine: {
        reachable: engine.reachable,
        degraded: engine.degraded,
        model: modelFor('T1'),
        reason: engine.reason,
      },
      summary: {
        green: count('green'),
        orange: count('orange'),
        red: count('red'),
        total: agents.length,
      },
      agents,
    };
  }
}

@Module({
  imports: [BrainModule, TenderModule, WatchModule],
  controllers: [AgentsController],
})
export class AgentsModule {}
