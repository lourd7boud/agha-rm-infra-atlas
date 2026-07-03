import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost, AtlasApiError } from '@/lib/api';
import type { ProjectSummary } from '@/lib/projects';
import {
  fmtMad,
  fmtQty,
  MOVEMENT_KIND_BADGES,
  MOVEMENT_KIND_OPTIONS,
  type DepotBalance,
  type DepotRecord,
  type MaterialRecord,
  type MovementKind,
  type StockMovementRecord,
} from '@/lib/stock';
import { isRedirectError } from '@/lib/next-redirect';
import { CatalogueGrid, type CatalogueStockState } from './CatalogueGrid';

/** One enriched balance row: a (depot, material) pair resolved to names + value. */
interface BalanceRow extends DepotBalance {
  depotName: string;
  code: string;
  designation: string;
  unit: string;
  unitCostMad?: number;
}

function buildBalanceRows(
  balances: readonly DepotBalance[],
  depotById: ReadonlyMap<string, DepotRecord>,
  materialById: ReadonlyMap<string, MaterialRecord>,
): BalanceRow[] {
  return balances
    .map((balance) => {
      const depot = depotById.get(balance.depotId);
      const material = materialById.get(balance.materialId);
      return {
        ...balance,
        depotName: depot?.name ?? balance.depotId,
        code: material?.code ?? '—',
        designation: material?.designation ?? balance.materialId,
        unit: material?.unit ?? '',
        unitCostMad: material?.unitCostMad,
      };
    })
    .sort(
      (a, b) =>
        a.depotName.localeCompare(b.depotName) ||
        a.designation.localeCompare(b.designation),
    );
}

function depotLabel(
  id: string | undefined,
  depotById: ReadonlyMap<string, DepotRecord>,
): string {
  if (!id) return '—';
  return depotById.get(id)?.name ?? id;
}

// One place to turn an action failure into user-visible feedback: log the real
// cause server-side, then redirect back to /stock with a stable error code the
// page renders as a banner. The HTTP status (when the cause is an AtlasApiError)
// rides along so a 400 (validation) reads differently from a 5xx (server).
function failToStock(action: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const status = error instanceof AtlasApiError ? error.status : undefined;
  console.error(
    `[stock] action "${action}" failed${status ? ` (HTTP ${status})` : ''}`,
    error,
  );
  const code = status === 400 ? 'invalid' : 'failed';
  redirect(`/stock?error=${action}&code=${code}`);
}

const ACTION_ERROR_MESSAGES: Record<string, string> = {
  'createMaterial:invalid': 'Matériau refusé : vérifiez le code, la désignation et l’unité.',
  'createMaterial:failed': 'Échec de l’ajout du matériau. Réessayez.',
  'createDepot:invalid': 'Dépôt refusé : le nom doit comporter au moins 2 caractères.',
  'createDepot:failed': 'Échec de la création du dépôt. Réessayez.',
  'recordMovement:invalid':
    'Mouvement refusé : vérifiez le type, la quantité et les dépôts requis (Entrée → Vers, Consommation → De, Transfert → les deux).',
  'recordMovement:failed': 'Échec de l’enregistrement du mouvement. Réessayez.',
  'addStock:invalid':
    'Ajout refusé : indiquez une quantité supérieure à 0. Le prix est optionnel.',
  'addStock:failed': 'Échec de l’ajout au stock. Réessayez.',
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

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error: actionError, code: actionCode } = await searchParams;
  const errorMessage = actionErrorMessage(actionError, actionCode);
  // Each read degrades independently: one slow/failing endpoint on the shared DB
  // must NEVER white-screen the whole page (it did — the naked Next.js digest).
  // Redirect errors (missing session → /login) MUST still propagate untouched.
  const guard = async <T,>(promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      if (isRedirectError(error)) throw error;
      console.error('[stock] read failed, degrading section', error);
      return null;
    }
  };
  const [materialsR, depotsR, balancesR, movementsR, projectsR] = await Promise.all([
    guard(apiGet<MaterialRecord[]>('/stock/materials')),
    guard(apiGet<DepotRecord[]>('/stock/depots')),
    guard(apiGet<DepotBalance[]>('/stock/balances')),
    guard(apiGet<StockMovementRecord[]>('/stock/movements')),
    guard(apiGet<ProjectSummary[]>('/project/projects')),
  ]);
  const stockDegraded =
    materialsR === null ||
    depotsR === null ||
    balancesR === null ||
    movementsR === null ||
    projectsR === null;
  const materials = materialsR ?? [];
  const depots = depotsR ?? [];
  const balances = balancesR ?? [];
  const movements = movementsR ?? [];
  const projects = projectsR ?? [];

  const depotById = new Map(depots.map((depot) => [depot.id, depot]));
  const materialById = new Map(
    materials.map((material) => [material.id, material]),
  );
  const balanceRows = buildBalanceRows(balances, depotById, materialById);
  const totalValueMad = balanceRows.reduce(
    (sum, row) => sum + row.quantity * (row.unitCostMad ?? 0),
    0,
  );

  // Catalogue grid state: on-hand summed across depots per catalogue code, plus
  // the material's last known unit cost. Only activated (in-DB) codes appear;
  // the grid renders the full catalogue and overlays this where present.
  const onHandByMaterial = new Map<string, number>();
  for (const balance of balances) {
    onHandByMaterial.set(
      balance.materialId,
      (onHandByMaterial.get(balance.materialId) ?? 0) + balance.quantity,
    );
  }
  const stockByCode: Record<string, CatalogueStockState> = {};
  for (const material of materials) {
    stockByCode[material.code] = {
      onHand: onHandByMaterial.get(material.id) ?? 0,
      cost: material.unitCostMad ?? null,
    };
  }
  const depotOptions = depots.map((depot) => ({ id: depot.id, name: depot.name }));

  async function createMaterial(formData: FormData) {
    'use server';
    const code = String(formData.get('code') ?? '').trim();
    const designation = String(formData.get('designation') ?? '').trim();
    const unit = String(formData.get('unit') ?? '').trim();
    if (code.length < 1 || designation.length < 2 || unit.length < 1) {
      redirect('/stock?error=createMaterial&code=invalid');
    }
    try {
      const rawCost = formData.get('unitCostMad');
      const cost = rawCost ? Number(rawCost) : undefined;
      await apiPost('/stock/materials', {
        code,
        designation,
        unit,
        category: String(formData.get('category') ?? '') || undefined,
        unitCostMad:
          cost !== undefined && Number.isFinite(cost) && cost >= 0
            ? cost
            : undefined,
      });
    } catch (error) {
      failToStock('createMaterial', error);
    }
    revalidatePath('/stock');
  }

  async function createDepot(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) {
      redirect('/stock?error=createDepot&code=invalid');
    }
    try {
      await apiPost('/stock/depots', {
        name,
        location: String(formData.get('location') ?? '') || undefined,
      });
    } catch (error) {
      failToStock('createDepot', error);
    }
    revalidatePath('/stock');
  }

  async function recordMovement(formData: FormData) {
    'use server';
    const kind = String(formData.get('kind') ?? '') as MovementKind;
    const materialId = String(formData.get('materialId') ?? '');
    const quantity = Number(formData.get('quantity'));
    if (!kind || !materialId || !Number.isFinite(quantity)) {
      redirect('/stock?error=recordMovement&code=invalid');
    }
    try {
      const rawCost = formData.get('unitCostMad');
      const cost = rawCost ? Number(rawCost) : undefined;
      await apiPost('/stock/movements', {
        kind,
        materialId,
        quantity,
        unitCostMad:
          cost !== undefined && Number.isFinite(cost) && cost >= 0
            ? cost
            : undefined,
        fromDepotId: String(formData.get('fromDepotId') ?? '') || undefined,
        toDepotId: String(formData.get('toDepotId') ?? '') || undefined,
        projectId: String(formData.get('projectId') ?? '') || undefined,
        reference: String(formData.get('reference') ?? '') || undefined,
        notes: String(formData.get('notes') ?? '') || undefined,
      });
    } catch (error) {
      failToStock('recordMovement', error);
    }
    revalidatePath('/stock');
    revalidatePath('/projects');
  }

  // Worker quick-add from a catalogue card: activate the material (idempotent),
  // ensure a depot exists, then record a purchase (entrée). The worker supplies
  // only quantité + montant; everything else rides in from the catalogue entry.
  async function addStock(formData: FormData) {
    'use server';
    const code = String(formData.get('code') ?? '').trim();
    const designation = String(formData.get('designation') ?? '').trim();
    const unit = String(formData.get('unit') ?? '').trim();
    const category = String(formData.get('category') ?? '').trim() || undefined;
    const quantity = Number(formData.get('quantity'));
    if (
      !code ||
      designation.length < 2 ||
      !unit ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      redirect('/stock?error=addStock&code=invalid');
    }
    const rawCost = formData.get('unitCostMad');
    const parsedCost =
      rawCost && String(rawCost).length > 0 ? Number(rawCost) : undefined;
    const unitCostMad =
      parsedCost !== undefined && Number.isFinite(parsedCost) && parsedCost >= 0
        ? parsedCost
        : undefined;
    let depotId = String(formData.get('depotId') ?? '').trim() || undefined;
    try {
      // 1. Activate the catalogue material (idempotent on code); the montant
      //    becomes its standard unit cost so valuation + the card reflect it.
      await apiPost('/stock/materials', {
        code,
        designation,
        unit,
        category,
        unitCostMad,
      });
      // 2. Ensure a destination depot — auto-provision "Dépôt principal" once so
      //    the very first add works with zero setup.
      if (!depotId) {
        await apiPost('/stock/depots', { name: 'Dépôt principal' });
        const allDepots = await apiGet<DepotRecord[]>('/stock/depots');
        depotId =
          allDepots.find((depot) => depot.name === 'Dépôt principal')?.id ??
          allDepots[0]?.id;
      }
      if (!depotId) throw new Error('Aucun dépôt disponible');
      // 3. Resolve the material id (the upsert returns only an outcome).
      const allMaterials = await apiGet<MaterialRecord[]>('/stock/materials');
      const materialId = allMaterials.find((m) => m.code === code)?.id;
      if (!materialId) throw new Error(`Matériau ${code} introuvable`);
      // 4. Record the purchase (entrée) movement into the depot.
      await apiPost('/stock/movements', {
        kind: 'purchase',
        materialId,
        quantity,
        unitCostMad,
        toDepotId: depotId,
        reference: 'Ajout catalogue',
      });
    } catch (error) {
      failToStock('addStock', error);
    }
    revalidatePath('/stock');
    revalidatePath('/projects');
  }

  const canRecord = materials.length > 0 && depots.length > 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Stock &amp; Matériaux</h1>
        <p className="mt-1 text-sm text-muted">
          Catalogue, dépôts et journal des mouvements — soldes et consommation
          valorisés par chantier
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

      {stockDegraded && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-clay-soft bg-clay-soft/20 px-5 py-4 text-sm font-medium text-clay"
        >
          Certaines données du stock n’ont pas pu être chargées (serveur
          momentanément lent). L’affichage est partiel — réessayez dans quelques
          instants.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Matériaux
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {materials.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Dépôts
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {depots.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Mouvements
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {movements.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Valeur du stock
          </p>
          <p className="mt-2 font-mono text-lg font-bold tabular-nums">
            {fmtMad(totalValueMad)}
          </p>
        </div>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Soldes par dépôt ({balanceRows.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Dépôt</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Désignation</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3 text-right">Valeur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {balanceRows.map((row) => (
              <tr key={`${row.depotId} ${row.materialId}`}>
                <td className="px-4 py-3 text-muted">{row.depotName}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                <td className="px-4 py-3 font-semibold">{row.designation}</td>
                <td
                  className={`px-4 py-3 text-right font-mono tabular-nums ${
                    row.quantity < 0 ? 'text-clay' : ''
                  }`}
                >
                  {fmtQty(row.quantity, row.unit)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                  {row.unitCostMad !== undefined
                    ? fmtMad(row.quantity * row.unitCostMad)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {balanceRows.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun solde — enregistrez un stock initial ou un achat ci-dessous.
          </p>
        )}
      </section>

      <CatalogueGrid
        stockByCode={stockByCode}
        depots={depotOptions}
        addStock={addStock}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Dépôts ({depots.length})
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Nom</th>
                <th className="px-4 py-3">Emplacement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {depots.map((depot) => (
                <tr key={depot.id}>
                  <td className="px-4 py-3 font-semibold">{depot.name}</td>
                  <td className="px-4 py-3 text-muted">
                    {depot.location ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {depots.length === 0 && (
            <p className="p-8 text-center text-sm text-faint">
              Aucun dépôt — le premier ajout crée « Dépôt principal ».
            </p>
          )}
          <form
            action={createDepot}
            className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
          >
            <label className="min-w-40 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Nom</span>
              <input
                type="text"
                name="name"
                required
                minLength={2}
                maxLength={200}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">
                Emplacement (optionnel)
              </span>
              <input
                type="text"
                name="location"
                maxLength={300}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Créer
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Matériau hors catalogue
          </h2>
          <p className="px-5 pt-4 text-xs text-faint">
            Pour un article absent du catalogue ci-dessus. Il rejoint ensuite les
            mouvements de stock comme les autres.
          </p>
          <form
            action={createMaterial}
            className="flex flex-wrap items-end gap-3 px-5 py-4"
          >
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Code</span>
              <input
                type="text"
                name="code"
                required
                maxLength={60}
                className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Désignation</span>
              <input
                type="text"
                name="designation"
                required
                minLength={2}
                maxLength={300}
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Unité</span>
              <input
                type="text"
                name="unit"
                required
                maxLength={30}
                className="w-24 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Catégorie</span>
              <input
                type="text"
                name="category"
                maxLength={100}
                className="w-36 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Coût unit. (MAD)</span>
              <input
                type="number"
                name="unitCostMad"
                min={0}
                step="0.01"
                className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Ajouter
            </button>
          </form>
        </section>
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <h2 className="border-b border-line px-5 py-4 text-xs font-semibold uppercase tracking-widest text-faint">
          Journal des mouvements ({movements.length})
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Matériau</th>
              <th className="px-4 py-3 text-right">Quantité</th>
              <th className="px-4 py-3">De</th>
              <th className="px-4 py-3">Vers</th>
              <th className="px-4 py-3">Réf.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {movements.map((movement) => {
              const kindBadge = MOVEMENT_KIND_BADGES[movement.kind];
              const material = materialById.get(movement.materialId);
              return (
                <tr key={movement.id}>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {new Date(movement.occurredAt).toLocaleDateString('fr-MA')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${kindBadge.classes}`}
                    >
                      {kindBadge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {material?.designation ?? movement.materialId}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {fmtQty(movement.quantity, material?.unit)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {depotLabel(movement.fromDepotId, depotById)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {depotLabel(movement.toDepotId, depotById)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-faint">
                    {movement.reference ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {movements.length === 0 && (
          <p className="p-8 text-center text-sm text-faint">
            Aucun mouvement enregistré.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-paper-2 p-6 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
          Enregistrer un mouvement
        </h2>
        <p className="mb-4 text-xs text-faint">
          Entrée → renseigner « Vers » · Consommation → « De » · Transfert → les
          deux dépôts.
        </p>
        {canRecord ? (
          <form action={recordMovement} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Type</span>
              <select
                name="kind"
                required
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                {MOVEMENT_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Matériau</span>
              <select
                name="materialId"
                required
                className="w-full rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.code} — {material.designation}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Quantité</span>
              <input
                type="number"
                name="quantity"
                required
                step="0.01"
                className="w-28 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Coût unit. (MAD)
              </span>
              <input
                type="number"
                name="unitCostMad"
                min={0}
                step="0.01"
                className="w-32 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Dépôt source</span>
              <select
                name="fromDepotId"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">—</option>
                {depots.map((depot) => (
                  <option key={depot.id} value={depot.id}>
                    {depot.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Dépôt dest.</span>
              <select
                name="toDepotId"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">—</option>
                {depots.map((depot) => (
                  <option key={depot.id} value={depot.id}>
                    {depot.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                Chantier (consommation)
              </span>
              <select
                name="projectId"
                className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              >
                <option value="">—</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.reference}
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
                maxLength={100}
                className="w-40 rounded-md border border-line-2 px-3 py-2 text-sm focus:border-cyan focus:outline-none"
              />
            </label>
            <button className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper transition hover:bg-cyan">
              Enregistrer
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed border-line-2 p-6 text-center text-sm text-faint">
            Créez au moins un matériau et un dépôt avant d&apos;enregistrer un
            mouvement.
          </p>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-faint">
        <Link href="/projects" className="hover:text-ink">
          Consommation valorisée détaillée → fiche de chaque chantier
        </Link>
      </p>
    </div>
  );
}
