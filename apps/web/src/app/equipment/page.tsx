import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import {
  fmtDate,
  EQUIPMENT_STATUS_BADGES,
  EQUIPMENT_STATUS_ORDER,
  type EquipmentDetail,
  type EquipmentRecord,
  type EquipmentStatus,
} from '@/lib/equipment';
import { isRedirectError } from '@/lib/next-redirect';

// One place to turn an action failure into user-visible feedback: log the real
// cause server-side, then redirect back to /equipment with a stable error code
// the page renders as a banner. The HTTP status (when the cause is an
// AtlasApiError) rides along so a 400 (validation) reads differently from a 409
// (transition) or a 5xx (server). Mirrors /stock.
function failToEquipment(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[equipment] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code =
    status === 400 ? 'invalid' : status === 409 ? 'conflict' : 'failed';
  redirect(`/equipment?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createEquipment:invalid':
    'Matériel refusé : la désignation doit comporter au moins 2 caractères.',
  'createEquipment:failed': 'Échec de l’ajout du matériel. Réessayez.',
  'assignEquipment:invalid':
    'Affectation refusée : choisissez un chantier valide.',
  'assignEquipment:conflict':
    'Affectation impossible : seule une machine disponible peut être affectée.',
  'assignEquipment:failed': 'Échec de l’affectation. Réessayez.',
  'returnEquipment:conflict':
    'Retour impossible : seule une machine affectée peut être retournée.',
  'returnEquipment:failed': 'Échec du retour. Réessayez.',
  'setStatus:conflict':
    'Changement refusé : retournez la machine avant de la déclarer hors service.',
  'setStatus:failed': 'Échec du changement de statut. Réessayez.',
};

function actionErrorMessage(
  error: string | undefined,
  code: string | undefined,
): string | undefined {
  if (!error) return undefined;
  return (
    ACTION_ERROR_MESSAGES[`${error}:${code ?? 'failed'}`] ??
    'Une erreur est survenue. Réessayez.'
  );
}

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  const [equipment, projects] = await Promise.all([
    apiGet<EquipmentRecord[]>('/equipment'),
    apiGet<ProjectSummary[]>('/project/projects'),
  ]);

  // The open assignment (project + expected return) lives in GET /equipment/:id;
  // fetch the detail of each posted machine so its row can show where it is and
  // when it is due back, without an N-fetch for idle/broken machines.
  const assignedIds = equipment
    .filter((e) => e.status === 'assignee')
    .map((e) => e.id);
  const details = await Promise.all(
    assignedIds.map((id) => apiGet<EquipmentDetail>(`/equipment/${id}`)),
  );
  const openByEquipment = new Map(
    details
      .filter((d) => d.openAssignment !== null)
      .map((d) => [d.equipment.id, d.openAssignment!]),
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const counts = EQUIPMENT_STATUS_ORDER.reduce<Record<EquipmentStatus, number>>(
    (acc, status) => {
      acc[status] = equipment.filter((e) => e.status === status).length;
      return acc;
    },
    { disponible: 0, assignee: 0, hors_service: 0 },
  );

  async function createEquipment(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) {
      redirect('/equipment?error=createEquipment&code=invalid');
    }
    try {
      const acquisitionDate = String(formData.get('acquisitionDate') ?? '');
      await apiPost('/equipment', {
        name,
        code: String(formData.get('code') ?? '') || undefined,
        category: String(formData.get('category') ?? '') || undefined,
        acquisitionDate: acquisitionDate || undefined,
        notes: String(formData.get('notes') ?? '') || undefined,
      });
    } catch (error) {
      failToEquipment('createEquipment', error);
    }
    revalidatePath('/equipment');
  }

  async function assignEquipment(formData: FormData) {
    'use server';
    const equipmentId = String(formData.get('equipmentId') ?? '');
    const projectId = String(formData.get('projectId') ?? '');
    if (!equipmentId || !projectId) {
      redirect('/equipment?error=assignEquipment&code=invalid');
    }
    try {
      const assignedAt = String(formData.get('assignedAt') ?? '');
      const expectedReturnAt = String(formData.get('expectedReturnAt') ?? '');
      const notes = String(formData.get('notes') ?? '').trim();
      await apiPost(`/equipment/${equipmentId}/assign`, {
        projectId,
        assignedAt: assignedAt || undefined,
        expectedReturnAt: expectedReturnAt || undefined,
        notes: notes || undefined,
      });
    } catch (error) {
      failToEquipment('assignEquipment', error);
    }
    revalidatePath('/equipment');
    revalidatePath(`/projects/${projectId}`);
  }

  async function returnEquipment(formData: FormData) {
    'use server';
    const equipmentId = String(formData.get('equipmentId') ?? '');
    if (!equipmentId) {
      redirect('/equipment?error=returnEquipment&code=failed');
    }
    try {
      const returnedAt = String(formData.get('returnedAt') ?? '');
      await apiPost(`/equipment/${equipmentId}/return`, {
        returnedAt: returnedAt || undefined,
      });
    } catch (error) {
      failToEquipment('returnEquipment', error);
    }
    revalidatePath('/equipment');
    revalidatePath('/projects');
  }

  async function setStatus(formData: FormData) {
    'use server';
    const equipmentId = String(formData.get('equipmentId') ?? '');
    const status = String(formData.get('status') ?? '') as EquipmentStatus;
    if (!equipmentId || !status) {
      redirect('/equipment?error=setStatus&code=failed');
    }
    try {
      await apiPatch(`/equipment/${equipmentId}/status`, { status });
    } catch (error) {
      failToEquipment('setStatus', error);
    }
    revalidatePath('/equipment');
  }

  const canAssign = projects.length > 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">
          Matériel &amp; Équipements
        </h1>
        <p className="mt-1 text-sm text-muted">
          Parc d&apos;engins et d&apos;outillage — inventaire, état et
          affectation aux chantiers avec date de retour prévue
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          {errorMessage}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Parc total
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {equipment.length}
          </p>
        </div>
        {EQUIPMENT_STATUS_ORDER.map((status) => {
          const badge = EQUIPMENT_STATUS_BADGES[status];
          return (
            <div
              key={status}
              className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">
                {badge.label}
              </p>
              <p className="mt-2 font-mono text-lg font-bold tabular-nums">
                {counts[status]}
              </p>
            </div>
          );
        })}
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Inventaire ({equipment.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3">Catégorie</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Chantier</th>
              <th className="px-4 py-3">Retour prévu</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {equipment.map((item) => {
              const badge = EQUIPMENT_STATUS_BADGES[item.status];
              const open = openByEquipment.get(item.id);
              const project = open
                ? projectById.get(open.projectId)
                : undefined;
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold">{item.name}</td>
                  <td className="px-4 py-3 text-muted">
                    {item.category ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {open ? (
                      <Link
                        href={`/projects/${open.projectId}`}
                        className="hover:text-ink"
                      >
                        {project?.reference ?? open.projectId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 font-mono text-xs tabular-nums ${
                      open?.expectedReturnAt ? 'text-muted' : 'text-faint'
                    }`}
                  >
                    {fmtDate(open?.expectedReturnAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {item.status === 'assignee' && (
                        <form action={returnEquipment}>
                          <input
                            type="hidden"
                            name="equipmentId"
                            value={item.id}
                          />
                          <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-sand">
                            Retourner
                          </button>
                        </form>
                      )}
                      {item.status === 'disponible' && (
                        <form action={setStatus}>
                          <input
                            type="hidden"
                            name="equipmentId"
                            value={item.id}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value="hors_service"
                          />
                          <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-clay transition hover:bg-clay-soft/30">
                            Hors service
                          </button>
                        </form>
                      )}
                      {item.status === 'hors_service' && (
                        <form action={setStatus}>
                          <input
                            type="hidden"
                            name="equipmentId"
                            value={item.id}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value="disponible"
                          />
                          <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-emerald transition hover:bg-emerald-soft/40">
                            Remettre en service
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {equipment.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun matériel — ajoutez un engin ci-dessous.
          </p>
        )}
        <form
          action={createEquipment}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Code (optionnel)
            </span>
            <input
              type="text"
              name="code"
              maxLength={60}
              className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Désignation</span>
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={300}
              className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Catégorie (optionnel)
            </span>
            <input
              type="text"
              name="category"
              maxLength={120}
              className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Date d&apos;acquisition (optionnel)
            </span>
            <input
              type="date"
              name="acquisitionDate"
              className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Ajouter
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
          Affecter du matériel à un chantier
        </h2>
        <p className="mb-4 text-xs text-faint">
          Seule une machine disponible peut être affectée. Renseignez la date de
          retour prévue pour anticiper la libération.
        </p>
        {canAssign && counts.disponible > 0 ? (
          <form action={assignEquipment} className="flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Matériel</span>
              <select
                name="equipmentId"
                required
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                {equipment
                  .filter((e) => e.status === 'disponible')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code ? `${item.code} — ` : ''}
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Chantier</span>
              <select
                name="projectId"
                required
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.reference}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Date d&apos;affectation (optionnel)
              </span>
              <input
                type="date"
                name="assignedAt"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Retour prévu (optionnel)
              </span>
              <input
                type="date"
                name="expectedReturnAt"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">
                Note (optionnel)
              </span>
              <input
                type="text"
                name="notes"
                maxLength={2000}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Affecter
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            {projects.length === 0
              ? 'Créez un chantier avant d’affecter du matériel.'
              : 'Aucune machine disponible — toutes sont affectées ou hors service.'}
          </p>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-faint">
        <Link href="/projects" className="hover:text-ink">
          Matériel affecté par chantier → fiche de chaque chantier
        </Link>
      </p>
    </div>
  );
}
