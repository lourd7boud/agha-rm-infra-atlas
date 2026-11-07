import type { BidWorkspaceState } from '@atlas/contracts';
import {
  BID_STATE_META,
  bidProgressPercent,
  safeBidActions,
} from '@/lib/bid-workspace';

export interface BidWorkspaceView {
  id: string;
  tenderId: string;
  ownerName: string;
  state: BidWorkspaceState;
  version: number;
  currentPackageVersion: number | null;
  officialReceiptEvidenceId: string | null;
  updatedAt: string;
}

const toneClasses = {
  positive: 'bg-emerald-700 text-white hover:bg-emerald-800',
  primary: 'bg-cyan text-white hover:bg-cyan-deep',
  neutral: 'border border-line bg-white text-ink hover:bg-sand',
} as const;

export function BidWorkspacePanel({
  workspace,
  transitionAction,
}: {
  workspace: BidWorkspaceView;
  transitionAction: (formData: FormData) => Promise<void>;
}) {
  const meta = BID_STATE_META[workspace.state];
  const progress = bidProgressPercent(workspace.state);
  const actions = safeBidActions(workspace.state);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="border-b border-line bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 px-6 py-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
              Poste de conduite de la soumission
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{meta.label}</h2>
            <p className="mt-1 text-sm text-slate-300">{meta.description}</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-right backdrop-blur">
            <p className="text-[11px] uppercase tracking-wider text-slate-300">Responsable</p>
            <p className="mt-1 font-medium">{workspace.ownerName}</p>
          </div>
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-cyan-300 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-300">
          <span>Décision</span>
          <span>{progress}% avant dépôt vérifié</span>
        </div>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_18rem]">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Prochaine action sûre
          </h3>
          {actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {actions.map((action) => (
                <form action={transitionAction} key={action.to}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input type="hidden" name="expectedVersion" value={workspace.version} />
                  <input type="hidden" name="to" value={action.to} />
                  <button
                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${toneClasses[action.tone]}`}
                    type="submit"
                  >
                    {action.label}
                  </button>
                </form>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              La prochaine étape exige un sous-processus vérifié (dossier, signature,
              dépôt ou preuve officielle). Aucun raccourci manuel n’est autorisé.
            </div>
          )}
        </div>

        <dl className="grid gap-3 rounded-xl border border-line bg-sand/40 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Version d’état</dt>
            <dd className="font-mono font-semibold">v{workspace.version}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Version du dossier</dt>
            <dd className="font-semibold">{workspace.currentPackageVersion ?? 'Non créée'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Reçu officiel</dt>
            <dd className="font-semibold text-right">
              {workspace.officialReceiptEvidenceId ? 'Vérifié' : 'Absent'}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
