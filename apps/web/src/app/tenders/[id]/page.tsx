import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { PipelineState, TenderProcedure } from '@atlas/contracts';
import { apiGet, apiPost } from '@/lib/api';
import { PIPELINE_LABELS, urgencyClasses } from '@/lib/labels';

interface RuleOutcome {
  rule: string;
  pass: boolean;
  detail: string;
}

interface Qualification {
  verdict: 'qualified' | 'rejected';
  checkedAt: string;
  rules: RuleOutcome[];
}

interface G1Brief {
  recommandation: 'GO' | 'NO_GO' | 'GO_SOUS_CONDITIONS';
  confiance: number;
  synthese: string;
  argumentsPour: string[];
  risques: string[];
  verifications: string[];
  model?: string;
  generatedAt?: string;
}

interface PricingScenario {
  nom: 'prudent' | 'equilibre' | 'agressif';
  rabaisPct: number;
  prixMad: number;
  margeMad: number;
  probabiliteGain: number;
  esperanceMad: number;
  statutReglementaire: 'conforme' | 'proche_seuil_bas';
  commentaire: string;
}

interface G2Scenarios {
  generatedAt: string;
  hypotheses: { costRatio: number; concurrentsConnus: number; methode: string };
  scenarios: PricingScenario[];
  recommandation: { nom: string; raison: string };
}

interface PlanMilestone {
  code: string;
  label: string;
  dueAt: string;
}

type ChecklistStatus = 'ok' | 'a_renouveler' | 'manquant' | 'a_faire' | 'a_verifier';

interface ChecklistItem {
  code: string;
  label: string;
  status: ChecklistStatus;
  detail?: string;
}

interface ComplianceChecklist {
  ready: boolean;
  items: ChecklistItem[];
  counts: {
    ok: number;
    aRenouveler: number;
    manquant: number;
    aFaire: number;
    aVerifier: number;
  };
}

const CHECKLIST_BADGES: Record<ChecklistStatus, { icon: string; classes: string }> = {
  ok: { icon: '✓', classes: 'text-emerald-600' },
  a_renouveler: { icon: '⟳', classes: 'text-amber-600' },
  manquant: { icon: '✗', classes: 'text-clay' },
  a_faire: { icon: '◻', classes: 'text-muted' },
  a_verifier: { icon: '?', classes: 'text-amber-600' },
};

interface TenderDetail {
  id: string;
  reference: string;
  buyerName: string;
  procedure: TenderProcedure;
  objet: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
  deadlineAt: string;
  sourceUrl?: string;
  pipelineState: PipelineState;
  qualification: Qualification | null;
  raw: { g1Brief?: G1Brief; g2Scenarios?: G2Scenarios } | null;
  daysLeft: number;
  plan: {
    feasible: boolean;
    compressed: boolean;
    daysAvailable: number;
    milestones: PlanMilestone[];
  };
}

const NEXT_ACTIONS: Partial<
  Record<PipelineState, { to: PipelineState; label: string; tone: string }[]>
> = {
  qualified: [
    {
      to: 'go_decided',
      label: 'Décision GO (G1)',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
    { to: 'no_go', label: 'No-Go', tone: 'bg-slate-600 text-paper hover:bg-cyan' },
  ],
  rejected: [
    {
      to: 'qualified',
      label: 'Requalifier (override G0)',
      tone: 'bg-amber-600 text-paper hover:bg-amber-700',
    },
  ],
  go_decided: [
    {
      to: 'preparing',
      label: 'Lancer la préparation',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
    {
      to: 'no_go',
      label: 'Revenir en No-Go',
      tone: 'bg-slate-600 text-paper hover:bg-cyan',
    },
  ],
  no_go: [
    {
      to: 'go_decided',
      label: 'Reprendre en GO',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
  ],
  preparing: [
    {
      to: 'submitted',
      label: 'Marquer soumis (G3)',
      tone: 'bg-violet-600 text-paper hover:bg-violet-700',
    },
  ],
  submitted: [
    {
      to: 'opened',
      label: 'Plis ouverts',
      tone: 'bg-violet-600 text-paper hover:bg-violet-700',
    },
  ],
  opened: [
    {
      to: 'won',
      label: 'Gagné',
      tone: 'bg-emerald-600 text-paper hover:bg-emerald-700',
    },
    { to: 'lost', label: 'Perdu', tone: 'bg-rose-600 text-paper hover:bg-rose-700' },
  ],
};

const BRIEF_BADGES: Record<G1Brief['recommandation'], string> = {
  GO: 'bg-emerald-600 text-paper',
  NO_GO: 'bg-rose-600 text-paper',
  GO_SOUS_CONDITIONS: 'bg-amber-500 text-paper',
};

function fmtMad(value?: number): string {
  return value !== undefined ? `${value.toLocaleString('fr-MA')} MAD` : '—';
}

export default async function TenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tender, checklist] = await Promise.all([
    apiGet<TenderDetail>(`/tender/tenders/${id}`),
    apiGet<ComplianceChecklist>(`/tender/tenders/${id}/checklist`),
  ]);
  const state = PIPELINE_LABELS[tender.pipelineState];
  const brief = tender.raw?.g1Brief;
  const pricing = tender.raw?.g2Scenarios;
  const actions = NEXT_ACTIONS[tender.pipelineState] ?? [];

  async function transitionTo(formData: FormData) {
    'use server';
    const to = String(formData.get('to'));
    await apiPost(`/tender/tenders/${id}/transition`, { to });
    revalidatePath(`/tenders/${id}`);
    revalidatePath('/tenders');
  }

  async function generateBrief() {
    'use server';
    await apiPost(`/tender/tenders/${id}/brief`);
    revalidatePath(`/tenders/${id}`);
  }

  async function generateScenarios() {
    'use server';
    await apiPost(`/tender/tenders/${id}/scenarios`);
    revalidatePath(`/tenders/${id}`);
  }

  async function enrichFromText(formData: FormData) {
    'use server';
    const text = String(formData.get('text') ?? '');
    if (text.trim().length >= 20) {
      await apiPost(`/tender/tenders/${id}/enrich`, { text });
      revalidatePath(`/tenders/${id}`);
    }
  }

  return (
    <div>
      <Link href="/tenders" className="text-sm text-muted hover:text-ink">
        ← Mur des échéances
      </Link>

      <div className="mt-3 mb-8 flex flex-wrap items-center gap-4">
        <span
          className={`rounded-md px-3 py-1.5 font-mono text-sm font-bold tabular-nums ${urgencyClasses(tender.daysLeft)}`}
        >
          J-{tender.daysLeft}
        </span>
        <h1 className="text-2xl font-black tracking-tight">{tender.reference}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${state.classes}`}>
          {state.label}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Fiche
          </h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-faint">Acheteur</dt>
              <dd className="font-medium">{tender.buyerName}</dd>
            </div>
            <div>
              <dt className="text-faint">Objet</dt>
              <dd className="text-ink-2">{tender.objet}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-faint">Estimation</dt>
                <dd className="font-mono tabular-nums">{fmtMad(tender.estimationMad)}</dd>
              </div>
              <div>
                <dt className="text-faint">Caution provisoire</dt>
                <dd className="font-mono tabular-nums">
                  {fmtMad(tender.cautionProvisoireMad)}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Procédure</dt>
                <dd>{tender.procedure}</dd>
              </div>
              <div>
                <dt className="text-faint">Date limite</dt>
                <dd className="font-mono text-xs tabular-nums">
                  {new Date(tender.deadlineAt).toLocaleString('fr-MA')}
                </dd>
              </div>
            </div>
            {tender.sourceUrl && (
              <div>
                <dt className="text-faint">Source</dt>
                <dd>
                  <a
                    href={tender.sourceUrl}
                    className="text-cyan underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Avis sur le portail
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {actions.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
              {actions.map((action) => (
                <form key={action.to} action={transitionTo}>
                  <input type="hidden" name="to" value={action.to} />
                  <button
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition ${action.tone}`}
                  >
                    {action.label}
                  </button>
                </form>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Qualification automatique (A3)
          </h2>
          {tender.qualification ? (
            <>
              <p
                className={`mb-4 inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                  tender.qualification.verdict === 'qualified'
                    ? 'bg-emerald-soft text-emerald'
                    : 'bg-clay-soft text-clay'
                }`}
              >
                {tender.qualification.verdict === 'qualified' ? 'Qualifié' : 'Écarté'}
              </p>
              <ul className="space-y-2 text-sm">
                {tender.qualification.rules.map((rule) => (
                  <li key={rule.rule} className="flex gap-2">
                    <span className={rule.pass ? 'text-emerald-600' : 'text-clay'}>
                      {rule.pass ? '✓' : '✗'}
                    </span>
                    <span className="text-ink-2">{rule.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-faint">
              Pas encore qualifié — le Qualifier traite les AO détectés/analysés.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Dossier administratif (B1 — Conformité)
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                checklist.ready
                  ? 'bg-emerald-soft text-emerald'
                  : 'bg-clay-soft text-clay'
              }`}
            >
              {checklist.ready
                ? 'Aucune pièce bloquante'
                : `${checklist.counts.manquant} pièce(s) bloquante(s)`}
            </span>
          </div>
          <ul className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            {checklist.items.map((item) => {
              const badge = CHECKLIST_BADGES[item.status];
              return (
                <li key={item.code} className="flex gap-2">
                  <span className={`font-bold ${badge.classes}`}>{badge.icon}</span>
                  <span>
                    <span className="text-slate-800">{item.label}</span>
                    {item.detail && (
                      <span className="block text-xs text-faint">{item.detail}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Note Go/No-Go (A4 — Stratège)
            </h2>
            <form action={generateBrief}>
              <button className="rounded-md border border-line-2 px-3 py-1.5 text-sm font-medium text-ink-2 transition hover:bg-sand">
                {brief ? 'Régénérer la note' : 'Générer la note G1'}
              </button>
            </form>
          </div>

          {brief ? (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <span
                  className={`rounded-md px-3 py-1.5 text-sm font-bold ${BRIEF_BADGES[brief.recommandation]}`}
                >
                  {brief.recommandation.replaceAll('_', ' ')}
                </span>
                <span className="font-mono text-sm tabular-nums text-muted">
                  confiance {(brief.confiance * 100).toFixed(0)}%
                </span>
                {brief.model && (
                  <span className="text-xs text-faint">
                    {brief.model}
                    {brief.generatedAt &&
                      ` · ${new Date(brief.generatedAt).toLocaleString('fr-MA')}`}
                  </span>
                )}
              </div>
              <p className="mb-5 max-w-3xl text-sm leading-relaxed text-ink-2">
                {brief.synthese}
              </p>
              <div className="grid gap-5 text-sm md:grid-cols-3">
                <div>
                  <h3 className="mb-2 font-semibold text-emerald-700">Arguments pour</h3>
                  <ul className="space-y-1.5 text-muted">
                    {brief.argumentsPour.map((item) => (
                      <li key={item}>+ {item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold text-clay">Risques</h3>
                  <ul className="space-y-1.5 text-muted">
                    {brief.risques.map((item) => (
                      <li key={item}>! {item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold text-cyan">
                    Vérifications avant G1
                  </h3>
                  <ul className="space-y-1.5 text-muted">
                    {brief.verifications.map((item) => (
                      <li key={item}>? {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-faint">
              Aucune note générée pour cet appel d&apos;offres.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
              Chiffrage (B4 — Modélisation financière)
            </h2>
            {tender.estimationMad ? (
              <form action={generateScenarios}>
                <button className="rounded-md border border-line-2 px-3 py-1.5 text-sm font-medium text-ink-2 transition hover:bg-sand">
                  {pricing ? 'Recalculer les scénarios' : 'Générer les scénarios G2'}
                </button>
              </form>
            ) : (
              <span className="text-xs text-faint">
                Estimation requise — enrichir la fiche d&apos;abord
              </span>
            )}
          </div>

          {pricing ? (
            <div>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2 pr-4">Scénario</th>
                    <th className="py-2 pr-4 text-right">Rabais</th>
                    <th className="py-2 pr-4 text-right">Prix offert</th>
                    <th className="py-2 pr-4 text-right">Marge</th>
                    <th className="py-2 pr-4 text-right">P(gain)</th>
                    <th className="py-2 pr-4 text-right">Espérance</th>
                    <th className="py-2">Lecture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pricing.scenarios.map((scenario) => {
                    const isBest = scenario.nom === pricing.recommandation.nom;
                    return (
                      <tr key={scenario.nom} className={isBest ? 'bg-emerald-50' : ''}>
                        <td className="py-2.5 pr-4 font-semibold capitalize">
                          {scenario.nom}
                          {isBest && (
                            <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-paper">
                              Recommandé
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {scenario.rabaisPct}%
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {fmtMad(scenario.prixMad)}
                        </td>
                        <td
                          className={`py-2.5 pr-4 text-right font-mono tabular-nums ${
                            scenario.margeMad <= 0 ? 'text-clay' : ''
                          }`}
                        >
                          {fmtMad(scenario.margeMad)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {Math.round(scenario.probabiliteGain * 100)}%
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {fmtMad(scenario.esperanceMad)}
                        </td>
                        <td className="py-2.5 text-xs text-muted">
                          {scenario.commentaire}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-4 text-sm text-ink-2">{pricing.recommandation.raison}</p>
              <p className="mt-2 text-xs text-faint">
                Hypothèses : coûts ≈ {Math.round(pricing.hypotheses.costRatio * 100)}% de
                l&apos;estimation · {pricing.hypotheses.concurrentsConnus} concurrent(s)
                connu(s) via C1 · {pricing.hypotheses.methode} · Généré le{' '}
                {new Date(pricing.generatedAt).toLocaleString('fr-MA')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-faint">
              Aucun scénario calculé — le chiffrage alimente la décision de prix (G2).
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Rétro-planning ({tender.plan.daysAvailable} jours
            {tender.plan.compressed ? ' — compressé' : ''})
          </h2>
          {tender.plan.feasible ? (
            <ol className="space-y-2 text-sm">
              {tender.plan.milestones.map((milestone) => (
                <li key={milestone.code} className="flex justify-between gap-4">
                  <span className="text-ink-2">{milestone.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {new Date(milestone.dueAt).toLocaleDateString('fr-MA')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm font-medium text-clay">
              Délai insuffisant pour préparer un dossier conforme.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Enrichir depuis l&apos;avis / le DCE (A2 — Extracteur)
          </h2>
          <form action={enrichFromText} className="space-y-3">
            <textarea
              name="text"
              rows={5}
              required
              minLength={20}
              maxLength={50_000}
              placeholder="Coller ici le texte de l'avis ou un extrait du DCE…"
              className="w-full rounded-md border border-line-2 p-3 text-sm focus:border-cyan focus:outline-none"
            />
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Extraire et compléter la fiche
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
