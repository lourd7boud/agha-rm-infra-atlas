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
  manquant: { icon: '✗', classes: 'text-rose-600' },
  a_faire: { icon: '◻', classes: 'text-slate-500' },
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
  raw: { g1Brief?: G1Brief } | null;
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
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
    { to: 'no_go', label: 'No-Go', tone: 'bg-slate-600 text-white hover:bg-slate-700' },
  ],
  rejected: [
    {
      to: 'qualified',
      label: 'Requalifier (override G0)',
      tone: 'bg-amber-600 text-white hover:bg-amber-700',
    },
  ],
  go_decided: [
    {
      to: 'preparing',
      label: 'Lancer la préparation',
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
    {
      to: 'no_go',
      label: 'Revenir en No-Go',
      tone: 'bg-slate-600 text-white hover:bg-slate-700',
    },
  ],
  no_go: [
    {
      to: 'go_decided',
      label: 'Reprendre en GO',
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
  ],
  preparing: [
    {
      to: 'submitted',
      label: 'Marquer soumis (G3)',
      tone: 'bg-violet-600 text-white hover:bg-violet-700',
    },
  ],
  submitted: [
    {
      to: 'opened',
      label: 'Plis ouverts',
      tone: 'bg-violet-600 text-white hover:bg-violet-700',
    },
  ],
  opened: [
    {
      to: 'won',
      label: 'Gagné',
      tone: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
    { to: 'lost', label: 'Perdu', tone: 'bg-rose-600 text-white hover:bg-rose-700' },
  ],
};

const BRIEF_BADGES: Record<G1Brief['recommandation'], string> = {
  GO: 'bg-emerald-600 text-white',
  NO_GO: 'bg-rose-600 text-white',
  GO_SOUS_CONDITIONS: 'bg-amber-500 text-white',
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
      <Link href="/tenders" className="text-sm text-slate-500 hover:text-slate-900">
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
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Fiche
          </h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-400">Acheteur</dt>
              <dd className="font-medium">{tender.buyerName}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Objet</dt>
              <dd className="text-slate-700">{tender.objet}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-slate-400">Estimation</dt>
                <dd className="font-mono tabular-nums">{fmtMad(tender.estimationMad)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Caution provisoire</dt>
                <dd className="font-mono tabular-nums">
                  {fmtMad(tender.cautionProvisoireMad)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Procédure</dt>
                <dd>{tender.procedure}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Date limite</dt>
                <dd className="font-mono text-xs tabular-nums">
                  {new Date(tender.deadlineAt).toLocaleString('fr-MA')}
                </dd>
              </div>
            </div>
            {tender.sourceUrl && (
              <div>
                <dt className="text-slate-400">Source</dt>
                <dd>
                  <a
                    href={tender.sourceUrl}
                    className="text-amber-700 underline-offset-2 hover:underline"
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
            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
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

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Qualification automatique (A3)
          </h2>
          {tender.qualification ? (
            <>
              <p
                className={`mb-4 inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                  tender.qualification.verdict === 'qualified'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {tender.qualification.verdict === 'qualified' ? 'Qualifié' : 'Écarté'}
              </p>
              <ul className="space-y-2 text-sm">
                {tender.qualification.rules.map((rule) => (
                  <li key={rule.rule} className="flex gap-2">
                    <span className={rule.pass ? 'text-emerald-600' : 'text-rose-600'}>
                      {rule.pass ? '✓' : '✗'}
                    </span>
                    <span className="text-slate-700">{rule.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-400">
              Pas encore qualifié — le Qualifier traite les AO détectés/analysés.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Dossier administratif (B1 — Conformité)
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                checklist.ready
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
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
                      <span className="block text-xs text-slate-400">{item.detail}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Note Go/No-Go (A4 — Stratège)
            </h2>
            <form action={generateBrief}>
              <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
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
                <span className="font-mono text-sm tabular-nums text-slate-500">
                  confiance {(brief.confiance * 100).toFixed(0)}%
                </span>
                {brief.model && (
                  <span className="text-xs text-slate-400">
                    {brief.model}
                    {brief.generatedAt &&
                      ` · ${new Date(brief.generatedAt).toLocaleString('fr-MA')}`}
                  </span>
                )}
              </div>
              <p className="mb-5 max-w-3xl text-sm leading-relaxed text-slate-700">
                {brief.synthese}
              </p>
              <div className="grid gap-5 text-sm md:grid-cols-3">
                <div>
                  <h3 className="mb-2 font-semibold text-emerald-700">Arguments pour</h3>
                  <ul className="space-y-1.5 text-slate-600">
                    {brief.argumentsPour.map((item) => (
                      <li key={item}>+ {item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold text-rose-700">Risques</h3>
                  <ul className="space-y-1.5 text-slate-600">
                    {brief.risques.map((item) => (
                      <li key={item}>! {item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold text-amber-700">
                    Vérifications avant G1
                  </h3>
                  <ul className="space-y-1.5 text-slate-600">
                    {brief.verifications.map((item) => (
                      <li key={item}>? {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Aucune note générée pour cet appel d&apos;offres.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Rétro-planning ({tender.plan.daysAvailable} jours
            {tender.plan.compressed ? ' — compressé' : ''})
          </h2>
          {tender.plan.feasible ? (
            <ol className="space-y-2 text-sm">
              {tender.plan.milestones.map((milestone) => (
                <li key={milestone.code} className="flex justify-between gap-4">
                  <span className="text-slate-700">{milestone.label}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {new Date(milestone.dueAt).toLocaleDateString('fr-MA')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm font-medium text-rose-700">
              Délai insuffisant pour préparer un dossier conforme.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
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
              className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-amber-500 focus:outline-none"
            />
            <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
              Extraire et compléter la fiche
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
