import { Controller, Get, Inject, Module, Optional } from '@nestjs/common';
import { Roles } from '../auth/auth.module';
import { BrainModule } from '../brain/brain.module';
import { LLM_CLIENT, type LlmClient } from '../brain/llm.client';

type AgentKind = 'crawler' | 'llm' | 'deterministic';
type AgentStatus = 'operational' | 'degraded' | 'offline';

interface AgentDef {
  key: string;
  name: string;
  role: string;
  desk: string;
  kind: AgentKind;
  icon: string;
}

interface AgentStatusEntry extends AgentDef {
  status: AgentStatus;
  detail: string;
}

/**
 * The 12-agent tender division. `kind` drives how operational status is
 * derived at request time: deterministic agents are pure code (always up),
 * llm agents require the gateway to be configured, crawler agents report
 * whether they run against the live portal or a recorded fixture.
 */
const REGISTRY: readonly AgentDef[] = [
  { key: 'sentinel', name: 'Agent Sentinel', role: 'Veille marchés publics', desk: 'Découverte', kind: 'crawler', icon: 'intel' },
  { key: 'extractor', name: 'Agent Extracteur', role: 'Extraction avis & DCE', desk: 'Découverte', kind: 'llm', icon: 'documents' },
  { key: 'qualifier', name: 'Agent Qualifier', role: 'Analyse des opportunités', desk: 'Découverte', kind: 'deterministic', icon: 'check' },
  { key: 'strategist', name: 'Agent Stratège', role: 'Note Go/No-Go (G1)', desk: 'Découverte', kind: 'llm', icon: 'command' },
  { key: 'compliance', name: 'Agent Compliance', role: 'Dossier administratif', desk: 'Fabrique', kind: 'deterministic', icon: 'vault' },
  { key: 'bidwriter', name: 'Agent Rédacteur', role: 'Note méthodologique', desk: 'Fabrique', kind: 'llm', icon: 'documents' },
  { key: 'estimator', name: 'Agent Estimateur', role: 'Détail estimatif', desk: 'Fabrique', kind: 'llm', icon: 'analytics' },
  { key: 'modeler', name: 'Agent Modeleur', role: 'Scénarios de prix (G2)', desk: 'Fabrique', kind: 'deterministic', icon: 'tresorerie' },
  { key: 'resultminer', name: 'Agent Result Miner', role: 'Résultats & attributions', desk: 'Intelligence', kind: 'crawler', icon: 'tenders' },
  { key: 'profiler', name: 'Agent Profiler', role: 'Profils concurrents', desk: 'Intelligence', kind: 'deterministic', icon: 'crm' },
  { key: 'risk', name: 'Agent Risk', role: 'Matrice des risques', desk: 'Intelligence', kind: 'llm', icon: 'alert' },
  { key: 'orchestrator', name: "Chef d'Orchestre", role: 'Coordination générale', desk: 'Pilotage', kind: 'deterministic', icon: 'agents' },
];

@Controller('agents')
export class AgentsController {
  constructor(
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  /** Live operational status of every division agent. */
  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get()
  status() {
    const llmReady = this.llm !== null;
    const model = process.env.LLM_MODEL_T3 ?? 'claude-fable-5';
    const live = process.env.WATCH_SOURCE === 'live';

    const agents: AgentStatusEntry[] = REGISTRY.map((a) => {
      if (a.kind === 'llm') {
        return {
          ...a,
          status: llmReady ? 'operational' : 'offline',
          detail: llmReady ? `${a.role} · ${model}` : 'Moteur IA non configuré',
        };
      }
      if (a.kind === 'crawler') {
        return {
          ...a,
          status: 'operational',
          detail: live ? `${a.role} · portail live` : `${a.role} · fixture`,
        };
      }
      return { ...a, status: 'operational', detail: a.role };
    });

    return {
      llm: { ready: llmReady, model },
      summary: {
        operational: agents.filter((x) => x.status === 'operational').length,
        total: agents.length,
      },
      agents,
    };
  }
}

@Module({
  imports: [BrainModule],
  controllers: [AgentsController],
})
export class AgentsModule {}
