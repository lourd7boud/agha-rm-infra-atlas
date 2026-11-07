import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { BidWorkspaceState } from '@atlas/contracts';
import { apiGet, apiPost } from '@/lib/api';
import { BidWorkspacePanel, type BidWorkspaceView } from './BidWorkspacePanel';
import {
  BidPackagePanel,
  type BidPackageSnapshotView,
  type VaultDocumentOption,
} from './BidPackagePanel';
import {
  BidSigningPanel,
  type ActiveSigningTaskView,
  type CreateSigningActionState,
} from './BidSigningPanel';

interface TenderSummary {
  id: string;
  reference: string;
  objet: string;
  buyerName: string;
  deadlineAt: string;
  estimationMad?: number;
  cautionProvisoireMad?: number;
}

export default async function ParticipationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tender, initialWorkspace] = await Promise.all([
    apiGet<TenderSummary>(`/tender/tenders/${id}`),
    apiGet<BidWorkspaceView | null>(`/bid/workspaces/by-tender/${id}`),
  ]);
  let workspace = initialWorkspace;
  let activeSigningTask: ActiveSigningTaskView | null = null;
  if (
    workspace &&
    (workspace.state === 'awaiting_signature' || workspace.state === 'signing')
  ) {
    activeSigningTask = await apiGet<ActiveSigningTaskView | null>(
      `/bid/signing/workspaces/${workspace.id}/tasks/active`,
    );
    if (!activeSigningTask) {
      // Reading the active task also reconciles expired pairing/lease deadlines.
      // Reload the workspace so its optimistic version and recovered state match.
      workspace = await apiGet<BidWorkspaceView | null>(
        `/bid/workspaces/by-tender/${id}`,
      );
    }
  }
  const [packageSnapshot, vaultDocuments] = workspace
    ? await Promise.all([
        apiGet<BidPackageSnapshotView>(`/bid/workspaces/${workspace.id}/package`),
        apiGet<VaultDocumentOption[]>('/vault/documents'),
      ])
    : [null, []];

  async function startParticipation() {
    'use server';
    await apiPost('/bid/workspaces', { tenderId: id });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function transitionAction(formData: FormData) {
    'use server';
    const workspaceId = String(formData.get('workspaceId'));
    const expectedVersion = Number(formData.get('expectedVersion'));
    const to = String(formData.get('to')) as BidWorkspaceState;
    await apiPost(`/bid/workspaces/${workspaceId}/transitions`, {
      to,
      expectedVersion,
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  const baselineRequirements = [
    { code: 'declaration_honneur', label: 'Déclaration sur l’honneur', envelope: 'administrative', required: true, requiresSignature: false },
    { code: 'attestation_fiscale', label: 'Attestation fiscale', envelope: 'administrative', required: true, requiresSignature: false },
    { code: 'attestation_cnss', label: 'Attestation CNSS', envelope: 'administrative', required: true, requiresSignature: false },
    { code: 'registre_commerce', label: 'Registre de commerce', envelope: 'administrative', required: true, requiresSignature: false },
    { code: 'offre_technique', label: 'Offre ou mémoire technique', envelope: 'technical', required: true, requiresSignature: false },
    { code: 'acte_engagement', label: 'Acte d’engagement', envelope: 'financial', required: true, requiresSignature: false },
    { code: 'bordereau_prix', label: 'Bordereau des prix', envelope: 'financial', required: true, requiresSignature: false },
  ] as const;

  async function seedRequirementsAction(formData: FormData) {
    'use server';
    if (!workspace) return;
    await apiPost(`/bid/workspaces/${workspace.id}/package/requirements`, {
      requirements: baselineRequirements,
      expectedVersion: Number(formData.get('expectedVersion')),
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function addRequirementAction(formData: FormData) {
    'use server';
    if (!workspace) return;
    await apiPost(`/bid/workspaces/${workspace.id}/package/requirements`, {
      requirements: [{
        code: String(formData.get('code')).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_'),
        label: String(formData.get('label')),
        envelope: String(formData.get('envelope')),
        required: formData.get('required') === 'on',
        requiresSignature: formData.get('requiresSignature') === 'on',
      }],
      expectedVersion: Number(formData.get('expectedVersion')),
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function updateRequirementAction(formData: FormData) {
    'use server';
    if (!workspace) return;
    await apiPost(`/bid/workspaces/${workspace.id}/package/requirements`, {
      requirements: [{
        code: String(formData.get('code')),
        label: String(formData.get('label')),
        envelope: String(formData.get('envelope')),
        required: formData.get('required') === 'true',
        requiresSignature: formData.get('requiresSignature') === 'on',
      }],
      expectedVersion: Number(formData.get('expectedVersion')),
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function attachFileAction(formData: FormData) {
    'use server';
    if (!workspace) return;
    await apiPost(`/bid/workspaces/${workspace.id}/package/files`, {
      requirementId: String(formData.get('requirementId')),
      vaultDocumentId: String(formData.get('vaultDocumentId')),
      expectedVersion: Number(formData.get('expectedVersion')),
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function freezeAction(formData: FormData) {
    'use server';
    if (!workspace) return;
    await apiPost(`/bid/workspaces/${workspace.id}/package/freeze`, {
      expectedVersion: Number(formData.get('expectedVersion')),
    });
    revalidatePath(`/tenders/${id}/participation`);
  }

  async function createSigningTaskAction(
    _previous: CreateSigningActionState,
    formData: FormData,
  ): Promise<CreateSigningActionState> {
    'use server';
    if (!workspace) return { status: 'error', message: 'Espace de participation absent.' };
    try {
      const created = await apiPost<{
        task: { id: string; pairingExpiresAt: string | null };
        pairingSecret: string;
      }>(`/bid/signing/workspaces/${workspace.id}/tasks`, {
        expectedVersion: Number(formData.get('expectedVersion')),
      });
      revalidatePath(`/tenders/${id}/participation`);
      return {
        status: 'success',
        taskId: created.task.id,
        pairingSecret: created.pairingSecret,
        pairingExpiresAt: created.task.pairingExpiresAt ?? undefined,
      };
    } catch {
      return {
        status: 'error',
        message: 'Création refusée: rechargez l’état et vérifiez le périmètre à signer.',
      };
    }
  }

  async function cancelSigningTaskAction(formData: FormData): Promise<void> {
    'use server';
    if (!workspace) return;
    await apiPost(
      `/bid/signing/workspaces/${workspace.id}/tasks/${String(formData.get('taskId'))}/cancel`,
      {
        expectedVersion: Number(formData.get('expectedVersion')),
        reason: String(formData.get('reason')),
      },
    );
    revalidatePath(`/tenders/${id}/participation`);
  }

  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 py-8 lg:px-8">
      <Link
        href="/tenders"
        className="text-sm font-medium text-muted transition-colors hover:text-cyan"
      >
        ← Inventaire des marchés
      </Link>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
            Participation · {tender.reference}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-ink">
            {tender.objet}
          </h1>
          <p className="mt-2 text-sm text-muted">{tender.buyerName}</p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-[11px] uppercase tracking-wider text-muted">Date limite</p>
          <p className="mt-1 font-semibold text-ink">
            {new Intl.DateTimeFormat('fr-MA', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Africa/Casablanca',
            }).format(new Date(tender.deadlineAt))}
          </p>
        </div>
      </header>

      <div className="mt-8">
        {workspace ? (
          <>
            <BidWorkspacePanel
              workspace={workspace}
              transitionAction={transitionAction}
            />
            {packageSnapshot && (
              <>
                <BidPackagePanel
                  snapshot={packageSnapshot}
                  vaultDocuments={vaultDocuments}
                  seedRequirementsAction={seedRequirementsAction}
                  addRequirementAction={addRequirementAction}
                  updateRequirementAction={updateRequirementAction}
                  attachFileAction={attachFileAction}
                  freezeAction={freezeAction}
                />
                {packageSnapshot.packageVersion?.status === 'frozen' &&
                  (workspace.state === 'frozen' ||
                    workspace.state === 'awaiting_signature' ||
                    workspace.state === 'signing') && (
                    <BidSigningPanel
                      workspaceVersion={workspace.version}
                      signableFiles={packageSnapshot.requirements.filter(
                        (requirement) => requirement.requiresSignature,
                      ).length}
                      activeTask={activeSigningTask}
                      createTaskAction={createSigningTaskAction}
                      cancelTaskAction={cancelSigningTaskAction}
                    />
                  )}
              </>
            )}
          </>
        ) : (
          <section className="rounded-2xl border border-line bg-white p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
              Espace de participation
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">
              Une opération suivie, pas un simple lien externe
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Démarrer crée le dossier de travail interne, son historique inviolable et
              son contrôle de versions. Aucune soumission n’est envoyée à cette étape.
            </p>
            <form action={startParticipation} className="mt-6">
              <button
                type="submit"
                className="rounded-xl bg-cyan px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-deep"
              >
                Démarrer la participation
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
