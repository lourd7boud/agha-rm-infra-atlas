'use client';

import { useActionState } from 'react';

export interface CreateSigningActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  taskId?: string;
  pairingSecret?: string;
  pairingExpiresAt?: string;
}

export interface ActiveSigningTaskView {
  task: {
    id: string;
    state: 'pending' | 'claimed';
    pairingExpiresAt: string | null;
    leaseExpiresAt: string | null;
    claimedByDeviceName: string | null;
  };
  files: Array<{ id: string; filename: string }>;
}

const initialState: CreateSigningActionState = { status: 'idle' };

export function BidSigningPanel({
  workspaceVersion,
  signableFiles,
  activeTask,
  createTaskAction,
  cancelTaskAction,
}: {
  workspaceVersion: number;
  signableFiles: number;
  activeTask: ActiveSigningTaskView | null;
  createTaskAction: (
    previous: CreateSigningActionState,
    formData: FormData,
  ) => Promise<CreateSigningActionState>;
  cancelTaskAction: (formData: FormData) => Promise<void>;
}) {
  const [state, action, pending] = useActionState(createTaskAction, initialState);

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <div className="border-b border-violet-100 bg-violet-50 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
          Signature électronique locale
        </p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Passerelle Windows sécurisée</h2>
        <p className="mt-1 text-sm text-muted">
          {signableFiles} fichier(s) seront remis au poste du signataire. Le PIN et la clé
          privée restent exclusivement dans la clé USB.
        </p>
      </div>
      <div className="p-6">
        {state.status === 'success' && state.pairingSecret ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="font-semibold text-emerald-950">Tâche créée — code affiché une seule fois</p>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              Saisissez ce code dans ATLAS Signing Bridge sur le poste où la clé USB est
              branchée. Ne l’envoyez ni par e-mail ni par messagerie.
            </p>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-emerald-800">Identifiant de tâche</dt>
                <dd className="mt-1 break-all font-mono">{state.taskId}</dd>
              </div>
              <div>
                <dt className="text-emerald-800">Secret d’association</dt>
                <dd className="mt-1 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-xs">
                  {state.pairingSecret}
                </dd>
              </div>
            </dl>
          </div>
        ) : activeTask ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-violet-950">
                  {activeTask.task.state === 'pending'
                    ? 'En attente d’association au poste signataire'
                    : 'Signature en cours sur le poste autorisé'}
                </p>
                <p className="mt-2 text-sm leading-6 text-violet-900">
                  {activeTask.files.length} fichier(s) dans le périmètre immuable
                  {activeTask.task.claimedByDeviceName
                    ? ` · ${activeTask.task.claimedByDeviceName}`
                    : ''}
                </p>
                {activeTask.task.state === 'pending' && (
                  <p className="mt-2 text-xs text-violet-800">
                    Si le code affiché une seule fois a été perdu, annulez cette tâche puis
                    créez-en une nouvelle.
                  </p>
                )}
              </div>
              <form action={cancelTaskAction}>
                <input type="hidden" name="taskId" value={activeTask.task.id} />
                <input type="hidden" name="expectedVersion" value={workspaceVersion} />
                <input
                  type="hidden"
                  name="reason"
                  value="Annulation manuelle depuis l’espace de participation"
                />
                <button className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
                  Annuler la tâche
                </button>
              </form>
            </div>
          </div>
        ) : (
          <form action={action}>
            <input type="hidden" name="expectedVersion" value={workspaceVersion} />
            <button
              disabled={pending || signableFiles === 0}
              className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? 'Création sécurisée…' : 'Créer la tâche de signature'}
            </button>
            {signableFiles === 0 && (
              <p className="mt-3 text-sm text-amber-800">
                Aucun document n’a été marqué « signature exigée par le RC » avant le gel.
              </p>
            )}
          </form>
        )}
        {state.status === 'error' && (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {state.message ?? 'La tâche de signature n’a pas pu être créée.'}
          </p>
        )}
      </div>
    </section>
  );
}
