import { describe, expect, test } from 'vitest';
import { nextActions, type OrchestratorTender } from './orchestrator.domain';

const TODAY = new Date('2026-06-12T00:00:00Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);

function tender(partial: Partial<OrchestratorTender>): OrchestratorTender {
  return {
    pipelineState: partial.pipelineState ?? 'qualified',
    estimationMad: 'estimationMad' in partial ? partial.estimationMad : 5_000_000,
    deadlineAt: partial.deadlineAt ?? days(20),
    raw: partial.raw ?? null,
    checklistReady: partial.checklistReady ?? true,
  };
}

const codes = (t: OrchestratorTender) =>
  nextActions(t, TODAY).map((action) => action.code);

describe('nextActions (Chef d’Orchestre)', () => {
  test('detected/parsed tenders wait for the Qualifier', () => {
    expect(codes(tender({ pipelineState: 'detected' }))).toContain('qualifier');
    expect(codes(tender({ pipelineState: 'parsed' }))).toContain('qualifier');
  });

  test('missing estimation asks for enrichment first', () => {
    const actions = codes(tender({ estimationMad: undefined }));
    expect(actions[0]).toBe('enrichir');
  });

  test('qualified without brief → generate G1 brief; with brief → decide G1', () => {
    expect(codes(tender({}))).toContain('generer_brief');
    expect(
      codes(tender({ raw: { g1Brief: { recommandation: 'GO' } } })),
    ).toContain('decider_g1');
  });

  test('go_decided without scenarios → run B4; with scenarios → start preparing', () => {
    expect(codes(tender({ pipelineState: 'go_decided' }))).toContain('chiffrer');
    expect(
      codes(
        tender({
          pipelineState: 'go_decided',
          raw: { g2Scenarios: { recommandation: { nom: 'prudent' } } },
        }),
      ),
    ).toContain('lancer_preparation');
  });

  test('preparing surfaces draft, dossier gaps, then submission', () => {
    const actions = codes(
      tender({ pipelineState: 'preparing', checklistReady: false }),
    );
    expect(actions).toContain('rediger_note');
    expect(actions).toContain('completer_dossier');
  });

  test('preparing near the deadline flags urgent submission', () => {
    const actions = nextActions(
      tender({
        pipelineState: 'preparing',
        deadlineAt: days(2),
        raw: { bidDraft: { titre: 'Note' } },
      }),
      TODAY,
    );
    const submit = actions.find((action) => action.code === 'soumettre');
    expect(submit?.urgence).toBe('critique');
  });

  test('terminal states produce no actions', () => {
    expect(codes(tender({ pipelineState: 'won' }))).toHaveLength(0);
    expect(codes(tender({ pipelineState: 'lost' }))).toHaveLength(0);
    expect(codes(tender({ pipelineState: 'no_go' }))).toHaveLength(0);
  });

  test('submitted and opened wait on external events', () => {
    expect(codes(tender({ pipelineState: 'submitted' }))).toContain(
      'attendre_ouverture',
    );
    expect(codes(tender({ pipelineState: 'opened' }))).toContain(
      'saisir_resultat',
    );
  });
});
