import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { apiGet, apiPatch, apiPost, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import {
  DOCUMENT_EXPIRY_BADGES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_ORDER,
  documentExpiryStatus,
  EQUIPMENT_STATUS_BADGES,
  fmtDate,
  fmtMad,
  fmtMeter,
  METER_UNIT_LABELS,
  WORK_ORDER_STATUS_BADGES,
  WORK_ORDER_TYPE_LABELS,
  type CurrentMeter,
  type EquipmentDetail,
  type EquipmentDocumentRecord,
  type EquipmentMeterReadingRecord,
  type EquipmentWorkOrderRecord,
} from '@/lib/equipment';
import { isRedirectError } from '@/lib/next-redirect';

// One place to turn a GMAO action failure into user-visible feedback: log the
// real cause server-side, then redirect back to the machine detail with a stable
// error code the page renders as a banner. Mirrors /equipment failToEquipment.
function failToDetail(id: string, action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[equipment/${id}] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code =
    status === 400 ? 'invalid' : status === 409 ? 'conflict' : 'failed';
  redirect(`/equipment/${id}?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'addDocument:invalid': 'Document refusé : type ou dates invalides.',
  'addDocument:failed': 'Échec de l’ajout du document. Réessayez.',
  'addMeterReading:invalid':
    'Relevé refusé : renseignez une valeur et une unité valides.',
  'addMeterReading:failed': 'Échec de l’ajout du relevé. Réessayez.',
  'createWorkOrder:invalid':
    'Bon d’intervention refusé : titre trop court ou champ invalide.',
  'createWorkOrder:failed': 'Échec de la création du bon. Réessayez.',
  'advanceWorkOrder:conflict':
    'Changement refusé : transition de statut interdite.',
  'advanceWorkOrder:failed': 'Échec du changement de statut. Réessayez.',
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

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optionalNumber(formData: FormData, key: string): number | undefined {
  const raw = str(formData, key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);

  let detail: EquipmentDetail;
  try {
    detail = await apiGet<EquipmentDetail>(`/equipment/${id}`);
  } catch (error) {
    if (error instanceof AtlasApiError && error.status === 404) notFound();
    throw error;
  }

  const [documents, readings, currentMeter, workOrders, cost, projects] =
    await Promise.all([
      apiGet<EquipmentDocumentRecord[]>(`/equipment/${id}/documents`),
      apiGet<EquipmentMeterReadingRecord[]>(`/equipment/${id}/meter-readings`),
      apiGet<CurrentMeter | null>(`/equipment/${id}/meter`),
      apiGet<EquipmentWorkOrderRecord[]>(`/equipment/${id}/work-orders`),
      apiGet<{ totalMad: number }>(`/equipment/${id}/cost`),
      apiGet<ProjectSummary[]>('/project/projects'),
    ]);

  const { equipment } = detail;
  const badge = EQUIPMENT_STATUS_BADGES[equipment.status];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // ── server actions ──────────────────────────────────────────────────────────

  async function addDocument(formData: FormData) {
    'use server';
    const type = str(formData, 'type');
    if (!type) redirect(`/equipment/${id}?error=addDocument&code=invalid`);
    try {
      await apiPost(`/equipment/${id}/documents`, {
        type,
        reference: str(formData, 'reference') || undefined,
        issueDate: str(formData, 'issueDate') || undefined,
        expiryDate: str(formData, 'expiryDate') || undefined,
        notes: str(formData, 'notes') || undefined,
      });
    } catch (error) {
      failToDetail(id, 'addDocument', error);
    }
    revalidatePath(`/equipment/${id}`);
  }

  async function addMeterReading(formData: FormData) {
    'use server';
    const value = optionalNumber(formData, 'value');
    const unit = str(formData, 'unit');
    if (value === undefined || !unit) {
      redirect(`/equipment/${id}?error=addMeterReading&code=invalid`);
    }
    try {
      await apiPost(`/equipment/${id}/meter-readings`, {
        value,
        unit,
        readingDate: str(formData, 'readingDate') || undefined,
        notes: str(formData, 'notes') || undefined,
      });
    } catch (error) {
      failToDetail(id, 'addMeterReading', error);
    }
    revalidatePath(`/equipment/${id}`);
  }

  async function createWorkOrder(formData: FormData) {
    'use server';
    const title = str(formData, 'title');
    const type = str(formData, 'type');
    if (title.length < 2 || !type) {
      redirect(`/equipment/${id}?error=createWorkOrder&code=invalid`);
    }
    try {
      await apiPost(`/equipment/${id}/work-orders`, {
        type,
        title,
        description: str(formData, 'description') || undefined,
        reportedBy: str(formData, 'reportedBy') || undefined,
        openedAt: str(formData, 'openedAt') || undefined,
        meterAtService: optionalNumber(formData, 'meterAtService'),
        costMad: optionalNumber(formData, 'costMad'),
      });
    } catch (error) {
      failToDetail(id, 'createWorkOrder', error);
    }
    revalidatePath(`/equipment/${id}`);
  }

  async function advanceWorkOrder(formData: FormData) {
    'use server';
    const woId = str(formData, 'woId');
    const status = str(formData, 'status');
    if (!woId || !status) {
      redirect(`/equipment/${id}?error=advanceWorkOrder&code=failed`);
    }
    try {
      await apiPatch(`/equipment/work-orders/${woId}/status`, {
        status,
        costMad: optionalNumber(formData, 'costMad'),
        resolution: str(formData, 'resolution') || undefined,
        completedAt: status === 'clos' ? new Date().toISOString() : undefined,
      });
    } catch (error) {
      failToDetail(id, 'advanceWorkOrder', error);
    }
    revalidatePath(`/equipment/${id}`);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/equipment" className="text-xs text-faint hover:text-ink">
          ← Parc matériel
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight">
            {equipment.name}
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.classes}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="mt-1 font-mono text-sm text-muted">
          {equipment.code ?? '—'}
          {equipment.category ? ` · ${equipment.category}` : ''}
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

      {/* Identity + KPIs */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Fiche machine
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <IdentityField label="Marque" value={equipment.marque} />
            <IdentityField label="Modèle" value={equipment.modele} />
            <IdentityField
              label="N° de série"
              value={equipment.numeroSerie}
              mono
            />
            <IdentityField
              label="Immatriculation"
              value={equipment.immatriculation}
              mono
            />
            <IdentityField
              label="Acquisition"
              value={fmtDate(equipment.acquisitionDate)}
            />
            <IdentityField label="Catégorie" value={equipment.category} />
          </dl>
          {equipment.notes && (
            <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
              {equipment.notes}
            </p>
          )}
        </section>
        <div className="grid gap-4">
          <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Compteur actuel
            </p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
              {fmtMeter(currentMeter)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">
              Coût interventions cumulé
            </p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-clay">
              {fmtMad(cost.totalMad)}
            </p>
          </div>
        </div>
      </div>

      {/* Documents */}
      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Documents &amp; conformité ({documents.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Émission</th>
              <th className="px-4 py-3">Expiration</th>
              <th className="px-4 py-3">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {documents.map((doc) => {
              const st = documentExpiryStatus(doc.expiryDate);
              const stBadge = DOCUMENT_EXPIRY_BADGES[st];
              return (
                <tr key={doc.id}>
                  <td className="px-4 py-3 font-semibold">
                    {DOCUMENT_TYPE_LABELS[doc.type]}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {doc.reference ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(doc.issueDate)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(doc.expiryDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stBadge.classes}`}
                    >
                      {stBadge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {documents.length === 0 && (
          <p className="p-6 text-center text-sm text-faint">
            Aucun document — ajoutez l’assurance, la carte grise ou le contrôle
            technique ci-dessous.
          </p>
        )}
        <form
          action={addDocument}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Type</span>
            <select
              name="type"
              required
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              {DOCUMENT_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Référence (optionnel)
            </span>
            <input
              type="text"
              name="reference"
              maxLength={120}
              className="w-40 rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Émission</span>
            <input
              type="date"
              name="issueDate"
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Expiration</span>
            <input
              type="date"
              name="expiryDate"
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Ajouter
          </button>
        </form>
      </section>

      {/* Meters */}
      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Compteur — relevés d’usage ({readings.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Valeur</th>
              <th className="px-4 py-3">Unité</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {readings.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                  {fmtDate(r.readingDate)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {r.value.toLocaleString('fr-MA')}
                </td>
                <td className="px-4 py-3 text-muted">
                  {METER_UNIT_LABELS[r.unit]}
                </td>
                <td className="px-4 py-3 text-faint">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {readings.length === 0 && (
          <p className="p-6 text-center text-sm text-faint">
            Aucun relevé — enregistrez les heures ou km pour suivre l’usage.
          </p>
        )}
        <form
          action={addMeterReading}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Valeur</span>
            <input
              type="number"
              name="value"
              required
              min={0}
              step="0.1"
              className="w-32 rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Unité</span>
            <select
              name="unit"
              required
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="heures">heures</option>
              <option value="km">km</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Date (optionnel)
            </span>
            <input
              type="date"
              name="readingDate"
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Relever
          </button>
        </form>
      </section>

      {/* Work orders */}
      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Bons d’intervention ({workOrders.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Intervention</th>
              <th className="px-4 py-3">Ouvert le</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3 text-right">Coût</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {workOrders.map((wo) => {
              const woBadge = WORK_ORDER_STATUS_BADGES[wo.status];
              return (
                <tr key={wo.id}>
                  <td className="px-4 py-3 text-muted">
                    {WORK_ORDER_TYPE_LABELS[wo.type]}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {wo.title}
                    {wo.resolution && (
                      <span className="block text-xs font-normal text-faint">
                        {wo.resolution}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {fmtDate(wo.openedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${woBadge.classes}`}
                    >
                      {woBadge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                    {wo.costMad != null ? fmtMad(wo.costMad) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {wo.status === 'ouvert' && (
                        <form action={advanceWorkOrder}>
                          <input type="hidden" name="woId" value={wo.id} />
                          <input type="hidden" name="status" value="en_cours" />
                          <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-cyan transition hover:bg-cyan-soft/30">
                            Démarrer
                          </button>
                        </form>
                      )}
                      {wo.status !== 'clos' && (
                        <form
                          action={advanceWorkOrder}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="woId" value={wo.id} />
                          <input type="hidden" name="status" value="clos" />
                          <input
                            type="number"
                            name="costMad"
                            min={0}
                            step="0.01"
                            placeholder="Coût DH"
                            className="w-24 rounded-md border border-line-2 bg-paper px-2 py-1 text-xs focus:border-cyan focus:outline-none"
                          />
                          <button className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-emerald transition hover:bg-emerald-soft/40">
                            Clôturer
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
        {workOrders.length === 0 && (
          <p className="p-6 text-center text-sm text-faint">
            Aucun bon d’intervention — déclarez une panne ou planifiez un
            entretien ci-dessous.
          </p>
        )}
        <form
          action={createWorkOrder}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Type</span>
            <select
              name="type"
              required
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            >
              <option value="correctif">Correctif (panne)</option>
              <option value="preventif">Préventif (entretien)</option>
            </select>
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Intervention</span>
            <input
              type="text"
              name="title"
              required
              minLength={2}
              maxLength={300}
              className="w-full rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Ouvert le (optionnel)
            </span>
            <input
              type="date"
              name="openedAt"
              className="rounded-md border border-line-2 bg-paper px-3 py-2 text-sm focus:border-cyan focus:outline-none"
            />
          </label>
          <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
            Créer le bon
          </button>
        </form>
      </section>

      {/* Assignment history */}
      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Historique d’affectation ({detail.history.length})
        </h2>
        {detail.history.length === 0 ? (
          <p className="text-sm text-faint">Jamais affectée à un chantier.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {detail.history.map((a) => {
              const project = projectById.get(a.projectId);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <Link
                    href={`/projects/${a.projectId}`}
                    className="font-medium hover:text-cyan"
                  >
                    {project?.reference ?? a.projectId}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {fmtDate(a.assignedAt)} →{' '}
                    {a.returnedAt ? fmtDate(a.returnedAt) : 'en cours'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function IdentityField({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={`mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>
        {value && value !== '—' ? value : '—'}
      </dd>
    </div>
  );
}
