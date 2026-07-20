'use client';

import { useEffect, useReducer, useState } from 'react';
import type { BdcReponse, LinePricingDecision, PricingRunView } from '@/lib/bdc';
import {
  applyBdcPricingAgent,
  cancelBdcPricingAgent,
  startBdcPricingAgent,
} from '../actions';
import {
  initialPricingAgentState,
  canApplyPricingRun,
  pricingAgentReducer,
  pricingPollInterval,
  selectLineEvidence,
} from './BdcPricingAgentPanel.state';

const STAGES: Array<{ key: PricingRunView['stage']; label: string }> = [
  { key: 'analyse', label: 'Analyse' },
  { key: 'recherche_interne', label: 'Historique' },
  { key: 'recherche_marche', label: 'Marché marocain' },
  { key: 'normalisation', label: 'Normalisation' },
  { key: 'estimation', label: 'Coûts' },
  { key: 'optimisation', label: 'Optimisation' },
  { key: 'brouillon_enregistre', label: 'Prêt' },
];

const CONFIDENCE = {
  elevee: 'Élevée',
  moyenne: 'Moyenne',
  faible: 'Faible',
} as const;

const METHOD = {
  reference_directe: 'Référence directe',
  marche_pondere: 'Marché pondéré',
  decomposition: 'Décomposition',
  ia_conservative: 'Estimation conservatrice',
} as const;

interface Props {
  avisId: string;
  requestedMarkupPct: number;
  initialRun?: PricingRunView | null;
  onBeforeStart: () => Promise<void>;
  onApplied: (response: BdcReponse) => void;
}

export function BdcPricingAgentPanel({
  avisId,
  requestedMarkupPct,
  initialRun = null,
  onBeforeStart,
  onApplied,
}: Props) {
  const [state, dispatch] = useReducer(pricingAgentReducer, {
    ...initialPricingAgentState,
    run: initialRun,
  });
  const [busy, setBusy] = useState(false);
  const run = state.run;

  useEffect(() => {
    if (!run) return;
    const intervalMs = pricingPollInterval(run.status);
    if (intervalMs === null) return;
    const controller = new AbortController();
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/bdc-pricing/${encodeURIComponent(run.id)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const updated = (await response.json()) as PricingRunView;
        if (mounted) dispatch({ type: 'run_received', run: updated });
      } catch (error) {
        if (mounted && !controller.signal.aborted) {
          dispatch({
            type: 'failed',
            message: error instanceof Error ? error.message : 'Suivi indisponible',
          });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, intervalMs);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [run?.id, run?.status]);

  const start = async () => {
    setBusy(true);
    dispatch({ type: 'reset' });
    try {
      await onBeforeStart();
      const created = await startBdcPricingAgent(avisId, Math.max(15, requestedMarkupPct));
      dispatch({ type: 'run_received', run: created });
    } catch {
      dispatch({ type: 'failed', message: "Impossible de démarrer l'agent" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    setBusy(true);
    try {
      dispatch({ type: 'run_received', run: await cancelBdcPricingAgent(run.id) });
    } catch {
      dispatch({ type: 'failed', message: "L'annulation a échoué" });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!canApplyPricingRun(run)) return;
    setBusy(true);
    try {
      onApplied(await applyBdcPricingAgent(avisId, run.id));
    } catch {
      dispatch({ type: 'failed', message: "L'application au brouillon a échoué" });
    } finally {
      setBusy(false);
    }
  };

  const active = run?.status === 'queued' || run?.status === 'running';
  const hasNonViableWarning = run?.warnings.some((warning) =>
    /non.?viable|marge|plancher/i.test(warning),
  );

  return (
    <div className="border-b border-line bg-cyan-soft/10 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={busy || active}
          className="rounded-lg border border-cyan bg-cyan-soft/30 px-4 py-2 text-sm font-bold text-cyan transition hover:bg-cyan-soft/60 disabled:opacity-50"
        >
          {active ? 'Agent en cours…' : '⚡ Chiffrer par l’agent'}
        </button>
        {active && (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted hover:text-clay"
          >
            Annuler
          </button>
        )}
        {run?.status === 'completed' && (
          <button
            type="button"
            onClick={apply}
            disabled={busy || !canApplyPricingRun(run)}
            className="rounded-lg bg-emerald px-4 py-2 text-sm font-bold text-paper disabled:opacity-50"
          >
            Appliquer au brouillon
          </button>
        )}
        {run && (
          <span className="text-xs text-muted">
            Marge minimale demandée : <strong>{run.requestedMarkupPct}%</strong> · calibration{' '}
            {run.calibrationVersion}
          </span>
        )}
      </div>

      {run && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-sand">
            <div
              className="h-full rounded-full bg-cyan transition-all"
              style={{ width: `${Math.max(0, Math.min(100, run.progressPct))}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4 lg:grid-cols-7">
            {STAGES.map((stage, index) => {
              const currentIndex = STAGES.findIndex((item) => item.key === run.stage);
              const reached = index <= currentIndex;
              return (
                <span
                  key={stage.key}
                  className={reached ? 'font-semibold text-cyan' : 'text-faint'}
                >
                  {reached ? '●' : '○'} {stage.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {(state.error || run?.error) && (
        <div className="mt-3 rounded-lg bg-clay-soft px-3 py-2 text-xs font-semibold text-clay">
          {state.error ?? run?.error} — vous pouvez relancer l’agent.
        </div>
      )}
      {hasNonViableWarning && (
        <div className="mt-3 rounded-lg bg-ochre-soft px-3 py-2 text-xs font-semibold text-ochre">
          Offre non viable détectée : l’agent refuse de descendre sous le plancher de rentabilité.
        </div>
      )}
      {run && run.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ochre">
          {run.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}

      {run?.status === 'completed' && (
        <div className="mt-4 space-y-2">
          {run.decisions.map((decision) => (
            <DecisionRow
              key={decision.idx}
              decision={decision}
              run={run}
              expanded={state.expandedLineIdx === decision.idx}
              onToggle={() =>
                dispatch({ type: 'toggle_evidence', lineIdx: decision.idx })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionRow({
  decision,
  run,
  expanded,
  onToggle,
}: {
  decision: LinePricingDecision;
  run: PricingRunView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const evidence = selectLineEvidence(run, decision.idx);
  return (
    <div className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-xs">
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 text-left">
        <strong className="font-mono text-cyan">#{decision.idx + 1}</strong>
        <span className="font-semibold">{fmt(decision.proposedUnitPriceHt)} DH HT</span>
        <span className="text-muted">
          coût {fmt(decision.estimatedCostHt)} · marge {decision.markupPct}%
        </span>
        <span className="rounded-full bg-sand px-2 py-0.5">
          confiance {CONFIDENCE[decision.confidence]}
        </span>
        <span className="text-muted">{METHOD[decision.method]}</span>
        {decision.manualPriceLocked && (
          <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-ochre">prix manuel verrouillé</span>
        )}
        <span className="ml-auto text-cyan">{evidence.length} source(s) {expanded ? '▲' : '▼'}</span>
      </button>
      <p className="mt-1 text-muted">{decision.explanation}</p>
      <p className="mt-1 text-faint">
        Fourchette : {fmt(decision.rangeLowHt)}–{fmt(decision.rangeHighHt)} DH HT
      </p>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-line pt-2">
          {evidence.length === 0 ? (
            <p className="text-muted">Estimation décomposée sans référence directe.</p>
          ) : (
            evidence.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{item.sourceRef}</span>
                <span>{fmt(item.unitPriceHtMad)} DH/{item.unit}</span>
                <span className="text-faint">
                  {new Date(item.observedAt).toLocaleDateString('fr-MA')} · fiabilité{' '}
                  {Math.round(item.reliability * 100)}%
                </span>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-cyan hover:underline"
                  >
                    Voir la source ↗
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function fmt(value: number): string {
  return value.toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
